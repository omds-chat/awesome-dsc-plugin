#!/usr/bin/env node
/**
 * 为声明了 repo 字段的插件条目构建运行时产物。
 *
 * 对每条: 浅克隆仓库 -> pnpm install --frozen-lockfile -> pnpm build
 *         -> dist/plugin.js 复制为 dist/plugins/<id>.js -> 改写条目的 download。
 * 构建失败的条目从 plugins/ 移除,因此随后重新生成的索引不再包含它。
 */

import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PAGES_BASE_URL = 'https://omdsc-dev.github.io/awesome-dsc-plugin'
const pagesBaseUrl = (process.env.PAGES_BASE_URL || DEFAULT_PAGES_BASE_URL).replace(/\/+$/, '')
const buildTimeoutMs = Number(process.env.ARTIFACT_BUILD_TIMEOUT_MS || 600000)
const isWindows = process.platform === 'win32'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pluginsDir = path.join(rootDir, 'plugins')
const distPluginsDir = path.join(rootDir, 'dist', 'plugins')
const tempDir = path.join(rootDir, 'temp', 'artifacts')

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRepo(repo) {
  const raw = String(repo).trim()
  if (raw === '') return null
  if (/^https:\/\/[^\s]+$/i.test(raw)) return raw
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) return 'https://github.com/' + raw + '.git'
  return null
}

function quoteArg(value) {
  return /[\s"]/.test(value) ? '"' + value.replace(/"/g, '\\"') + '"' : value
}

function run(command, args, cwd) {
  return new Promise(function (resolve, reject) {
    const options = {
      cwd: cwd,
      env: Object.assign({}, process.env, { CI: '1', GIT_TERMINAL_PROMPT: '0' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
    // Windows 上 pnpm 与 git 需要经 shell 调用,整条命令自行拼接并转义
    const child = isWindows
      ? spawn([command].concat(args).map(quoteArg).join(' '), Object.assign({ shell: true }, options))
      : spawn(command, args, options)

    let output = ''
    function collect(chunk) {
      output += chunk.toString('utf8')
      if (output.length > 20000) output = output.slice(-20000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    const timer = setTimeout(function () {
      child.kill('SIGKILL')
    }, buildTimeoutMs)

    child.on('error', function (error) {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', function (code) {
      clearTimeout(timer)
      if (code === 0) {
        resolve(output)
        return
      }
      reject(new Error(command + ' ' + args.join(' ') + ' 退出码 ' + code + '\n' + output.trim()))
    })
  })
}

async function buildEntry(fileName, entry) {
  const id = entry.id.trim()
  const repoUrl = normalizeRepo(entry.repo)
  if (repoUrl === null) {
    throw new Error('repo 字段不是可用的仓库地址: ' + String(entry.repo))
  }

  const cloneDir = path.join(tempDir, id)
  await rm(cloneDir, { recursive: true, force: true })

  try {
    await run('git', ['clone', '--depth', '1', '--quiet', repoUrl, cloneDir], rootDir)
    await run('pnpm', ['install', '--frozen-lockfile'], cloneDir)
    await run('pnpm', ['build'], cloneDir)

    const builtFile = path.join(cloneDir, 'dist', 'plugin.js')
    try {
      await copyFile(builtFile, path.join(distPluginsDir, id + '.js'))
    } catch (error) {
      throw new Error('构建产物 dist/plugin.js 不存在或不可读 - ' + error.message)
    }
  } finally {
    await rm(cloneDir, { recursive: true, force: true })
  }

  entry.download = pagesBaseUrl + '/plugins/' + id + '.js'
  await writeFile(path.join(pluginsDir, fileName), JSON.stringify(entry, null, 2) + '\n', 'utf8')
}

async function main() {
  await mkdir(distPluginsDir, { recursive: true })
  await mkdir(tempDir, { recursive: true })

  const fileNames = (await readdir(pluginsDir, { withFileTypes: true }))
    .filter(function (dirent) {
      return dirent.isFile() && dirent.name.endsWith('.json')
    })
    .map(function (dirent) {
      return dirent.name
    })
    .sort()

  let built = 0
  let skipped = 0
  let dropped = 0
  const droppedFiles = []

  for (const fileName of fileNames) {
    const filePath = path.join(pluginsDir, fileName)
    let entry
    try {
      entry = JSON.parse(await readFile(filePath, 'utf8'))
    } catch (error) {
      console.warn('跳过 plugins/' + fileName + ': JSON 解析失败,交由索引校验处理')
      skipped += 1
      continue
    }

    if (!isPlainObject(entry) || entry.repo === undefined) {
      skipped += 1
      continue
    }

    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      console.error('剔除 plugins/' + fileName + ': 缺少 id,无法定位构建产物')
      droppedFiles.push(filePath)
      dropped += 1
      continue
    }

    try {
      await buildEntry(fileName, entry)
      console.log('构建成功: ' + entry.id.trim() + ' -> dist/plugins/' + entry.id.trim() + '.js')
      built += 1
    } catch (error) {
      const reason = error && error.message ? error.message : String(error)
      console.error('剔除 plugins/' + fileName + ': 产物构建失败 - ' + reason)
      droppedFiles.push(filePath)
      dropped += 1
    }
  }

  for (const filePath of droppedFiles) {
    await rm(filePath, { force: true })
  }

  console.log('产物构建汇总: 成功 ' + built + ',剔除 ' + dropped + ',跳过 ' + skipped)
}

main().catch(function (error) {
  console.error('产物构建失败: ' + (error && error.message ? error.message : String(error)))
  process.exitCode = 1
})
