#!/usr/bin/env node
/**
 * 语法自检:对仓库内全部脚本与站点源码执行 node --check,只解析不执行。
 *
 * 本仓库没有 TypeScript,也没有第三方依赖,唯一需要机器把关的静态约定就是「每个脚本都能被 Node 解析」。
 * 用法:pnpm type
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** 需要检查的目录与文件,相对仓库根目录 */
const TARGETS = ['scripts', join('site', 'build.mjs'), join('site', 'src', 'assets')]
/** 参与语法检查的扩展名 */
const EXTENSIONS = ['.mjs', '.js']

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 递归收集目标路径下的脚本文件,按路径排序,结果稳定可复现。 */
function collect(target, found = []) {
  const full = resolve(target)
  if (isDirectory(full)) {
    for (const entry of readdirSync(full, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))) {
      collect(join(full, entry.name), found)
    }
    return found
  }
  if (EXTENSIONS.some((extension) => full.endsWith(extension))) found.push(full)
  return found
}

function main() {
  const files = []
  for (const target of TARGETS) {
    for (const file of collect(join(rootDir, target))) {
      if (!files.includes(file)) files.push(file)
    }
  }
  if (files.length === 0) {
    process.stderr.write('没有找到需要检查的脚本,请确认命令在仓库根目录执行\n')
    return 1
  }

  const failures = []
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      const detail = String(error.stderr || error.message || '').trim().split('\n').slice(0, 4).join(' ')
      failures.push({ file: relative(rootDir, file).split('\\').join('/'), detail })
    }
  }

  for (const failure of failures) process.stderr.write('[错误] ' + failure.file + ' ' + failure.detail + '\n')
  if (failures.length > 0) {
    process.stdout.write('语法检查未通过:错误 ' + failures.length + ' 条,共检查 ' + files.length + ' 个文件\n')
    return 1
  }
  process.stdout.write('语法检查通过:共 ' + files.length + ' 个文件\n')
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('语法检查失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
