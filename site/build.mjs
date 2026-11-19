#!/usr/bin/env node
/**
 * 零依赖构建:把 site/src 复制成自包含的 site/dist。
 *
 * 产出:
 *   dist/index.html          由 src/index.html 把 __ASSETS__ 占位改写为 ./assets/
 *   dist/assets/*.js         原生 ES 模块入口与依赖,不做打包、不引入框架
 *   dist/assets/styles.css   样式
 *   dist/.nojekyll           关闭 GitHub Pages 的 Jekyll 处理
 *
 * 产物只有 index.html 与 assets/,不需要任何服务端。
 * 用法: node build.mjs
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(rootDir, 'src')
const distDir = path.join(rootDir, 'dist')
const assetsDir = path.join(distDir, 'assets')
const pageEntry = path.join(srcDir, 'index.html')
const styleEntry = path.join(srcDir, 'assets', 'styles.css')
const pageOut = path.join(distDir, 'index.html')
const noJekyllOut = path.join(distDir, '.nojekyll')

const ASSET_TOKEN = '__ASSETS__'
const ASSET_BASE = './assets/'
const ALLOWED_EXTENSIONS = ['.html', '.js', '.css', '.svg', '.png', '.ico', '.woff2']
const IMPORT_PATTERN = /\bfrom\s*["'](\.\/[^"']+)["']/g

async function listFiles(dir, prefix) {
  const found = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : prefix + '/' + entry.name
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await listFiles(full, rel)))
    } else if (entry.isFile()) {
      found.push({ rel, full })
    }
  }
  return found
}

async function emptyDist() {
  await rm(distDir, { recursive: true, force: true })
  await mkdir(assetsDir, { recursive: true })
}

async function copyAssets() {
  const files = await listFiles(path.join(srcDir, 'assets'), '')
  await cp(path.join(srcDir, 'assets'), assetsDir, { recursive: true })
  return files.length
}

/** 校验 assets 下每个 ES 模块的相对 import 都指向存在的文件,避免产物 404 到运行时才暴露。 */
async function checkImports() {
  const jsFiles = (await listFiles(assetsDir, '')).filter((item) => item.rel.endsWith('.js'))
  const known = new Set(
    (await listFiles(assetsDir, '')).map((item) => item.rel),
  )
  const problems = []
  for (const file of jsFiles) {
    const source = await readFile(file.full, 'utf8')
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.rel), match[1]))
      if (!known.has(target)) problems.push(file.rel + ' 引用了不存在的模块 ' + match[1])
    }
  }
  if (problems.length > 0) throw new Error('模块引用不完整:' + problems.join(';'))
  return jsFiles.length
}

async function renderPage() {
  const source = await readFile(pageEntry, 'utf8')
  const count = source.split(ASSET_TOKEN).length - 1
  if (count === 0) throw new Error('src/index.html 没有 ' + ASSET_TOKEN + ' 占位,无法改写资源路径')
  const rendered = source.split(ASSET_TOKEN).join(ASSET_BASE)
  if (rendered.indexOf(ASSET_TOKEN) !== -1) throw new Error('资源路径改写后仍残留 ' + ASSET_TOKEN)
  await writeFile(pageOut, rendered, 'utf8')
  await writeFile(noJekyllOut, '', 'utf8')
  return count
}

/** 校验产物:顶层只有 index.html、.nojekyll 与 assets/,全部是静态文件。 */
async function inspectDist() {
  const entries = await readdir(distDir, { withFileTypes: true })
  const allowedTop = new Set(['index.html', '.nojekyll', 'assets'])
  const unexpected = entries
    .map((entry) => (entry.isDirectory() ? entry.name + '/' : entry.name))
    .filter((name) => !allowedTop.has(name.replace(/\/$/, '')))
  if (unexpected.length > 0) throw new Error('site/dist 顶层出现意外条目:' + unexpected.join(', '))
  const files = await listFiles(distDir, '')
  for (const file of files) {
    // 点开头的文件是托管平台的元数据(例如 .nojekyll),没有扩展名,单独放行。
    if (path.basename(file.rel).startsWith('.')) continue
    const extension = path.extname(file.rel)
    if (!ALLOWED_EXTENSIONS.includes(extension)) throw new Error('产物含非静态文件:' + file.rel)
  }
  const page = await readFile(pageOut, 'utf8')
  if (page.indexOf('./assets/') === -1) throw new Error('index.html 没有引用 ./assets/ 下的资源')
  if (page.indexOf('<script') !== -1 && page.indexOf('src="./assets/main.js"') === -1) {
    throw new Error('index.html 的脚本入口不是 ./assets/main.js')
  }
  const styles = await stat(path.join(assetsDir, 'styles.css'))
  const script = await stat(path.join(assetsDir, 'main.js'))
  if (styles.size === 0 || script.size === 0) throw new Error('产物里的样式或脚本为空')
  const rows = []
  for (const file of files) {
    const info = await stat(file.full)
    rows.push({ rel: file.rel, size: info.size })
  }
  rows.sort((left, right) => (left.rel < right.rel ? -1 : 1))
  return { files: rows, total: rows.reduce((sum, item) => sum + item.size, 0) }
}

async function main() {
  await emptyDist()
  const assetCount = await copyAssets()
  const rewritten = await renderPage()
  const moduleCount = await checkImports()
  const result = await inspectDist()
  const styleEntryInfo = await stat(styleEntry)
  if (styleEntryInfo.size === 0) throw new Error('src/assets/styles.css 为空')

  console.log('site/dist/')
  for (const row of result.files) {
    console.log('  ' + row.rel.padEnd(28) + String(row.size).padStart(9) + ' B')
  }
  console.log('文件 ' + result.files.length + ' 个,合计 ' + result.total + ' B')
  console.log('复制 assets 源文件 ' + assetCount + ' 个,校验 ES 模块 ' + moduleCount + ' 个')
  console.log('index.html 资源占位改写 ' + rewritten + ' 处,全部指向 ./assets/')
}

main().catch(function (error) {
  console.error('site 构建失败:' + (error && error.message ? error.message : String(error)))
  process.exitCode = 1
})
