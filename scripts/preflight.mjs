#!/usr/bin/env node
/**
 * 发版前预检:一次性跑完本合集全部可本地自检项,汇总输出,供合集维护者在 PR 前自查。
 *
 * 检查项(判定逻辑全部复用既有模块,不另立规则):
 *   catalog  收录登记:作者目录名、插件名规则、预设标签、removed.json、site 设置
 *   certs    certs/ 证书材料与终端签名证书(需要 OpenSSL;本地缺 OpenSSL 降级为警告)
 *   npm      npm 包名强校验:登记包名与插件名一致且 registry 上存在(lib/npm-package-check.mjs)
 *   bundle   pages 包三层清单、哈希与签名占位(骨架模式,骨架外证书链校验降级为警告)
 *   scan     产物静态扫描:plugin.js 网络自建调用,命中只记警告
 *
 * bundle 与 scan 依赖已构建的 dist/pages;目录不存在时记警告并跳过,不当作失败。
 * npm 检查在本地无网时由 lib/npm-package-check.mjs 降级为「跳过在线检查」警告;
 * CI 联网时查不到包按错误拦截。任何 error 级问题都使退出码为 1。
 *
 * 用法:
 *   node scripts/preflight.mjs
 *   node scripts/preflight.mjs --dir dist/pages --comment preflight-comment.md
 *   node scripts/preflight.mjs --json
 *
 * 选项:
 *   --catalog <目录>   catalog 目录,默认 catalog
 *   --certs <目录>     证书目录,默认 certs
 *   --site <目录>      站点设置目录,默认 site
 *   --dir <目录>       pages 包目录,默认 dist/pages
 *   --registry <地址>  npm registry 地址,默认读环境变量 NPM_REGISTRY_URL(缺省官方源)
 *   --skip-npm         跳过 npm 包名在线检查
 *   --comment <路径>   同时把报告写成 PR 评论 Markdown(工作流用)
 *   --json             以 JSON 输出汇总
 *   --help             显示本说明
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readCatalog } from './lib/catalog.mjs'
import { checkAuthorNames, checkCerts, checkPresetTags, checkRemoved, checkPluginDirectories, readPresetTags } from './lib/catalog-checks.mjs'
import { readCollectionMeta } from './lib/collection-meta.mjs'
import { verifyCollection } from './lib/collection-verify.mjs'
import { NPM_REGISTRY_URL, checkNpmPackages } from './lib/npm-package-check.mjs'
import { resolveNpmRegistryUrl } from './lib/env.mjs'
import { PLUGIN_NETWORK_SELFTALK } from './lib/plugin-network-scan.mjs'
import { formatPreflightComment, PREFLIGHT_COMMENT_MARKER } from './lib/preflight-comment.mjs'

/** 骨架模式下允许降级为警告的问题代码:清单与签名占位属于「尚未生成」,不阻断本地自查 */
const PLACEHOLDER_CODES = new Set([
  'ROOT_CA_MISSING',
  'SIGN_UNVERIFIABLE',
  'MANIFEST_MISSING',
  'MANIFEST_SIGNATURE_MISSING',
  'EEC_MISSING',
  'EEC_CHAIN_INVALID',
])

function usage() {
  process.stdout.write([
    '用法: node scripts/preflight.mjs [选项]',
    '',
    '选项:',
    '  --catalog <目录>   catalog 目录,默认 catalog',
    '  --certs <目录>     证书目录,默认 certs',
    '  --site <目录>      站点设置目录,默认 site',
    '  --dir <目录>       pages 包目录,默认 dist/pages',
    '  --registry <地址>  npm registry 地址,默认读环境变量 NPM_REGISTRY_URL(缺省 ' + NPM_REGISTRY_URL + ')',
    '  --skip-npm         跳过 npm 包名在线检查',
    '  --comment <路径>   同时把报告写成 PR 评论 Markdown,固定标记见 lib/preflight-comment.mjs',
    '  --json             以 JSON 输出汇总',
    '  --help             显示本说明',
    '',
    '环境变量:',
    '  NPM_REGISTRY_URL   npm registry 地址,等价于 --registry;离线联调指向 scripts/dev/npm-registry-mock.mjs(见 README「本地校验」)',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    catalog: 'catalog',
    certs: 'certs',
    site: 'site',
    dir: join('dist', 'pages'),
    registry: resolveNpmRegistryUrl(),
    skipNpm: false,
    comment: null,
    json: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const separator = arg.indexOf('=')
    const flag = separator === -1 ? arg : arg.slice(0, separator)
    const inline = separator === -1 ? null : arg.slice(separator + 1)
    const take = () => {
      if (inline !== null) return inline
      index += 1
      const value = argv[index]
      if (value === undefined) throw new Error(flag + ' 缺少取值')
      return value
    }
    switch (flag) {
      case '--catalog': options.catalog = take(); break
      case '--certs': options.certs = take(); break
      case '--site': options.site = take(); break
      case '--dir': options.dir = take(); break
      case '--registry': options.registry = take(); break
      case '--skip-npm': options.skipNpm = true; break
      case '--comment': options.comment = take(); break
      case '--json': options.json = true; break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  return options
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 构造单个检查项结果并归一化问题记录。 */
function buildCheck(name, title, problems, stats = {}) {
  const normalized = problems.map((item) => ({
    level: item.level,
    code: String(item.code),
    path: item.path == null ? null : String(item.path).split('\\').join('/'),
    message: String(item.message),
  }))
  const errors = normalized.filter((item) => item.level === 'error').length
  return {
    name,
    title,
    ok: errors === 0,
    counts: { errors, warnings: normalized.length - errors, problems: normalized.length },
    problems: normalized,
    stats,
  }
}

/** catalog 登记:作者目录名、插件名规则、预设标签、removed.json、site 设置。不联网、不需要 OpenSSL。 */
function checkCatalogRegistration({ catalogDir, siteDir }) {
  const problems = []
  const presetTags = readPresetTags(join(siteDir, 'tags.json'), problems)
  const catalog = readCatalog({ catalogDir, problems, checkAuthorNames: false })
  checkAuthorNames({ catalogDir, problems })
  checkPresetTags({ plugins: catalog.plugins, presetTags, problems })
  const removedCount = checkRemoved({ catalogDir, plugins: catalog.plugins, problems })
  const leftovers = checkPluginDirectories(catalog.plugins, problems)
  try {
    readCollectionMeta(join(siteDir, 'meta.json'), 'site/meta.json')
  } catch (error) {
    problems.push({ level: 'error', code: 'SITE_META_INVALID', message: error.message, path: 'site/meta.json' })
  }
  return buildCheck('catalog', '收录登记(catalog 与 site 设置)', problems, {
    authors: catalog.authors.length,
    plugins: catalog.plugins.length,
    removed: removedCount,
    versionDirWarnings: leftovers,
    pluginsFound: catalog.plugins,
  })
}

/** certs/ 证书材料。需要 OpenSSL;本地缺 OpenSSL 或调用失败时降级为警告,不阻断预检。 */
function checkCertsSafe({ certsDir }) {
  const problems = []
  let stats = { eecCert: false, secretPub: false, chainChecked: false }
  try {
    stats = checkCerts({ certsDir, rootCaPath: null, problems })
  } catch (error) {
    problems.push({
      level: 'warning',
      code: 'OPENSSL_UNAVAILABLE',
      message: '无法调用 OpenSSL 校验证书,跳过 certs 检查:' + (error && error.message ? error.message : String(error)) + ';CI 环境会完整校验',
      path: null,
    })
    return buildCheck('certs', 'certs 证书材料', problems, { ...stats, skipped: true })
  }
  return buildCheck('certs', 'certs 证书材料', problems, stats)
}

/**
 * pages 包三层清单、哈希与签名占位。骨架模式:根证书与清单签名缺失时按既有口径降级为警告。
 * 产物扫描(PLUGIN_NETWORK_SELFTALK)从这里拆出,单独作为 scan 检查项。
 */
function splitBundleResult(verification) {
  const bundleProblems = []
  const scanProblems = []
  for (const item of verification.problems) {
    if (item.code === PLUGIN_NETWORK_SELFTALK) scanProblems.push(item)
    else bundleProblems.push(item)
  }
  return { bundleProblems, scanProblems }
}

function checkBundleAndScan({ bundleDir }) {
  if (!isDirectory(bundleDir)) {
    const note = {
      level: 'warning',
      code: 'BUNDLE_MISSING',
      message: 'pages 包目录不存在:' + bundleDir + ';清单、签名占位与产物扫描跳过,先跑 pnpm build 再预检(不阻断本次预检)',
      path: null,
    }
    return [
      buildCheck('bundle', '三层清单与签名占位(pages 包)', [note], { skipped: true }),
      buildCheck('scan', '产物静态扫描(plugin.js 网络自建)', [note], { skipped: true }),
    ]
  }
  const verification = verifyCollection(bundleDir, { allowPlaceholderEec: true })
  const { bundleProblems, scanProblems } = splitBundleResult(verification)
  // 骨架模式下「尚未生成」类问题已是警告;其余骨架外降级项也按警告处理,避免本地无根证书时误报错误
  for (const item of bundleProblems) {
    if (PLACEHOLDER_CODES.has(item.code) && item.level === 'error') item.level = 'warning'
  }
  const bundle = buildCheck('bundle', '三层清单与签名占位(pages 包)', bundleProblems, {
    manifests: verification.stats.manifests.length,
    authors: verification.stats.authors,
    plugins: verification.stats.plugins,
    versions: verification.stats.versions,
  })
  const scan = buildCheck('scan', '产物静态扫描(plugin.js 网络自建)', scanProblems, {
    scannedScripts: countPluginScripts(bundleDir),
    hits: verification.stats.networkHits,
  })
  return [bundle, scan]
}

/** 统计 pages 包 plugins/ 树下的 plugin.js 个数,只用于报告数字;目录不存在返回 0。 */
function countPluginScripts(bundleDir) {
  const pluginsDir = join(bundleDir, 'plugins')
  if (!isDirectory(pluginsDir)) return 0
  let count = 0
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name))
      else if (entry.name === 'plugin.js') count += 1
    }
  }
  walk(pluginsDir)
  return count
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write('参数错误:' + error.message + '\n\n')
    usage()
    return 2
  }
  if (options.help) {
    usage()
    return 0
  }

  const catalogDir = resolve(options.catalog)
  const certsDir = resolve(options.certs)
  const siteDir = resolve(options.site)
  const bundleDir = resolve(options.dir)

  const catalogCheck = checkCatalogRegistration({ catalogDir, siteDir })
  const certsCheck = checkCertsSafe({ certsDir })
  // npm 检查消费 catalog 检查读出的插件登记;catalog 结构坏到读不出插件时,登记错误已在 catalog 项报过
  const npmProblems = []
  const npmStats = await checkNpmPackages({
    plugins: catalogCheck.stats.pluginsFound || [],
    problems: npmProblems,
    registryUrl: options.registry,
    skip: options.skipNpm,
  })
  const npmCheck = buildCheck(
    'npm',
    'npm 包名(登记包名与插件名一致且已发布)',
    npmProblems,
    { ...npmStats, skippedNote: options.skipNpm ? '已用 --skip-npm 跳过' : undefined },
  )
  const [bundleCheck, scanCheck] = checkBundleAndScan({ bundleDir })

  const checks = [catalogCheck, certsCheck, npmCheck, bundleCheck, scanCheck]
  const errorCount = checks.reduce((sum, item) => sum + item.counts.errors, 0)
  const warningCount = checks.reduce((sum, item) => sum + item.counts.warnings, 0)
  const summary = {
    ok: errorCount === 0,
    check: 'preflight',
    title: '发版前预检',
    target: process.cwd(),
    counts: { errors: errorCount, warnings: warningCount, problems: errorCount + warningCount },
    checks,
    problems: checks.flatMap((item) => item.problems.map((problem) => ({ check: item.name, ...problem }))),
    stats: { checks: checks.length },
    generatedAt: new Date().toISOString(),
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
  } else {
    process.stdout.write('== 发版前预检 ==\n')
    for (const item of checks) {
      process.stdout.write(
        (item.ok ? '[通过] ' : '[未通过] ') + item.name + ' ' + item.title +
          ':错误 ' + item.counts.errors + ' 条,警告 ' + item.counts.warnings + ' 条\n',
      )
      for (const problem of item.problems) {
        const level = problem.level === 'error' ? '  [错误] ' : '  [警告] '
        const location = problem.path ? '(' + problem.path + ')' : ''
        process.stdout.write(level + problem.code + ' ' + problem.message + ' ' + location + '\n')
      }
    }
    process.stdout.write(
      (summary.ok ? '预检通过:' : '预检未通过:') + '错误 ' + errorCount + ' 条,警告 ' + warningCount + ' 条\n',
    )
  }

  // 评论文件在退出码判定之前写出:预检失败时工作流也要把失败结果更新到 PR 同一楼
  if (options.comment) {
    const comment = PREFLIGHT_COMMENT_MARKER + '\n' + formatPreflightComment(summary)
    writeFileSync(options.comment, comment, 'utf8')
    process.stdout.write('预检评论已写入 ' + options.comment + '\n')
  }

  return summary.ok ? 0 : 1
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    process.stderr.write('预检失败:' + (error && error.message ? error.message : String(error)) + '\n')
    process.exitCode = 2
  },
)
