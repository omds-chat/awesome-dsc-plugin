/**
 * 维护者自查的检查项定义。
 *
 * 每个检查项只做编排,判定规则全部来自既有模块:
 *   lib/catalog.mjs              读 catalog 登记,含作者目录名规则与大小写唯一性(readCatalog)
 *   lib/catalog-checks.mjs       仓库级检查(作者目录名、预设标签、removed.json、certs)
 *   lib/collection-verify.mjs    pages 包的结构、三层清单、签名与版本校验(verifyCollection)
 *   lib/consistency-verify.mjs   pages 包收录信息交叉校验(verifyCatalogConsistency)
 *   lib/collection-meta.mjs      合集元数据 site/meta.json 的规则
 * 本模块不重新实现任何判定逻辑,也不与 verify:catalog、verify:bundle 分叉。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { problem } from './layer-manifests.mjs'
import { readCatalog } from './catalog.mjs'
import { checkAuthorNames, checkCerts, checkPresetTags, checkRemoved, readPresetTags } from './catalog-checks.mjs'
import { readCollectionMeta } from './collection-meta.mjs'
import { verifyCollection } from './collection-verify.mjs'
import { buildResult, toProblem } from './check-report.mjs'

/** 检查项顺序,汇总入口按此顺序执行 */
export const CHECK_ORDER = ['authors', 'plugins', 'versions', 'manifests', 'certs', 'removed', 'site']

/** 检查项名称 */
export const CHECK_TITLES = {
  authors: '作者目录名合法性与大小写唯一性',
  plugins: '插件名规则与全局唯一性',
  versions: 'versions 与 plugins 树一致',
  manifests: '三层清单覆盖与哈希',
  certs: 'certs 证书链与终端签名证书',
  removed: 'removed.json 结构',
  site: 'site 与 catalog 一致性',
}

const SEMVER_PATTERN = /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/
/** 与 verifyCollection 的版本相关代码;versions 检查只取这些 */
const VERSION_CODES = new Set([
  'VERSIONS_MISSING',
  'VERSIONS_INVALID',
  'LATEST_NOT_LISTED',
  'VERSION_DIR_MISSING',
  'VERSION_FILE_MISSING',
  'PLUGIN_DIR_MISSING',
  'PLUGIN_META_INVALID',
  'PLUGIN_META_MISMATCH',
])

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function listDirectories(dir) {
  if (!isDirectory(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/** 读取 versions.json 的版本列表,读不到时返回空数组。 */
function readVersionList(path) {
  if (!isFile(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(data?.versions) ? data.versions.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

/**
 * 按 path 形状判断一条 catalog 问题属于哪个检查项。
 * catalog 根与作者级问题归 authors,plugin.json 级问题归 plugins。
 * @param {string|null} path 问题路径
 * @returns {'catalog'|'author'|'plugin'}
 */
function classifyCatalogPath(path) {
  if (typeof path !== 'string' || path.length === 0) return 'catalog'
  const segments = path.replace(/\\/g, '/').split('/')
  if (segments[0] !== 'catalog') return 'catalog'
  if (segments.length <= 2) return segments.length === 2 ? 'author' : 'catalog'
  if (segments.length === 3) return 'author'
  return 'plugin'
}

/** verifyCollection 对一个分发包跑一次就够,汇总入口里复用这次结果。 */
const verificationCache = new Map()

function getBundleVerification(context) {
  const bundleDir = resolve(context.bundleDir)
  if (!verificationCache.has(bundleDir)) {
    verificationCache.set(bundleDir, verifyCollection(bundleDir, { rootCaPath: context.rootCaPath }))
  }
  return verificationCache.get(bundleDir)
}

function bundleMissing(check, bundleDir) {
  return buildResult({
    check,
    title: CHECK_TITLES[check],
    target: bundleDir,
    problems: [
      toProblem('warning', 'BUNDLE_MISSING', '分发包目录不存在:' + bundleDir + ';该检查只看构建产物,先构建 pages 包再跑(本次跳过)', null),
    ],
    stats: { skipped: true },
  })
}

/** 作者目录名合法性与大小写不敏感唯一性。 */
function checkAuthors(context) {
  const catalogDir = resolve(context.catalogDir)
  const problems = []
  const catalog = readCatalog({ catalogDir, problems, checkAuthorNames: false })
  checkAuthorNames({ catalogDir, problems })
  const relevant = problems.filter((item) => classifyCatalogPath(item.path) !== 'plugin')
  return buildResult({
    check: 'authors',
    title: CHECK_TITLES.authors,
    target: catalogDir,
    problems: relevant,
    stats: { authors: catalog.authors.length },
  })
}

/** 插件名规则与全局唯一性;跨作者共用裸目录名只告警。 */
function checkPlugins(context) {
  const catalogDir = resolve(context.catalogDir)
  const problems = []
  const catalog = readCatalog({ catalogDir, problems, checkAuthorNames: false })
  const relevant = problems.filter((item) => classifyCatalogPath(item.path) === 'plugin')
  const byDir = new Map()
  for (const plugin of catalog.plugins) {
    const names = byDir.get(plugin.dirName)
    if (names) names.push(plugin.name)
    else byDir.set(plugin.dirName, [plugin.name])
  }
  for (const [dirName, names] of [...byDir.entries()].sort()) {
    const distinct = [...new Set(names)].sort()
    if (distinct.length < 2) continue
    relevant.push(
      problem(
        'warning',
        'PLUGIN_DIRNAME_SHARED',
        '插件 ' + distinct.join(' 与 ') + ' 去掉命名空间后都落在 plugins/<作者>/' + dirName +
          ';同一作者下不能共存,跨作者时目录名相同,站点与脚本按裸目录名索引容易混淆',
        'catalog',
      ),
    )
  }
  return buildResult({
    check: 'plugins',
    title: CHECK_TITLES.plugins,
    target: catalogDir,
    problems: relevant,
    stats: { plugins: catalog.plugins.length, dirNames: byDir.size },
  })
}

/** versions 与 plugins 树一致。 */
function checkVersions(context) {
  const bundleDir = resolve(context.bundleDir)
  if (!isDirectory(bundleDir)) return bundleMissing('versions', bundleDir)
  const verification = getBundleVerification(context)
  const problems = verification.problems.filter((item) => VERSION_CODES.has(item.code))
  const pluginsDir = join(bundleDir, 'plugins')
  for (const author of listDirectories(pluginsDir)) {
    for (const plugin of listDirectories(join(pluginsDir, author))) {
      const pluginDir = join(pluginsDir, author, plugin)
      const versionsPath = join(pluginDir, 'versions.json')
      if (!isFile(versionsPath)) continue
      const declared = readVersionList(versionsPath)
      for (const dirName of listDirectories(pluginDir)) {
        if (!SEMVER_PATTERN.test(dirName)) continue
        if (declared.includes(dirName)) continue
        problems.push(
          problem(
            'warning',
            'VERSION_DIR_UNLISTED',
            'plugins/' + author + '/' + plugin + '/' + dirName + ' 是版本目录,但 versions.json 没有登记 ' + dirName,
            'plugins/' + author + '/' + plugin + '/' + dirName,
          ),
        )
      }
    }
  }
  return buildResult({
    check: 'versions',
    title: CHECK_TITLES.versions,
    target: bundleDir,
    problems,
    stats: { plugins: verification.stats.plugins, versions: verification.stats.versions },
  })
}

/** 三层清单覆盖与哈希。 */
function checkManifests(context) {
  const bundleDir = resolve(context.bundleDir)
  if (!isDirectory(bundleDir)) return bundleMissing('manifests', bundleDir)
  const verification = getBundleVerification(context)
  const problems = verification.problems.filter((item) => item.code.startsWith('MANIFEST_') || item.code === 'LAYER_FILE_MISSING')
  const mismatched = problems.filter((item) => item.code === 'MANIFEST_HASH_MISMATCH').length
  return buildResult({
    check: 'manifests',
    title: CHECK_TITLES.manifests,
    target: bundleDir,
    problems,
    stats: { manifests: verification.stats.manifests.length, mismatched },
  })
}

/** certs 证书链与终端签名证书。 */
function checkCertsRepo(context) {
  const certsDir = resolve(context.certsDir)
  const problems = []
  let stats
  try {
    stats = checkCerts({ certsDir, rootCaPath: context.rootCaPath, problems })
  } catch (error) {
    problems.push(problem('error', 'OPENSSL_UNAVAILABLE', '无法调用 OpenSSL 校验证书:' + (error && error.message ? error.message : String(error)), null))
    stats = { eecCert: false, secretPub: false, chainChecked: false }
  }
  return buildResult({ check: 'certs', title: CHECK_TITLES.certs, target: certsDir, problems, stats })
}

/** removed.json 结构。 */
function checkRemovedFile(context) {
  const catalogDir = resolve(context.catalogDir)
  const ignored = []
  const catalog = readCatalog({ catalogDir, problems: ignored, checkAuthorNames: false })
  const problems = []
  const records = checkRemoved({ catalogDir, plugins: catalog.plugins, problems })
  return buildResult({
    check: 'removed',
    title: CHECK_TITLES.removed,
    target: join(catalogDir, 'removed.json').split('\\').join('/'),
    problems,
    stats: { records, registeredPlugins: catalog.plugins.length },
  })
}

/** site 与 catalog 的一致性:预设标签、合集元数据。 */
function checkSiteConsistency(context) {
  const siteDir = resolve(context.siteDir)
  const catalogDir = resolve(context.catalogDir)
  const problems = []
  const presetTags = readPresetTags(join(siteDir, 'tags.json'), problems)
  const ignored = []
  const catalog = readCatalog({ catalogDir, problems: ignored, checkAuthorNames: false })
  checkPresetTags({ plugins: catalog.plugins, presetTags, problems })
  const used = new Set()
  for (const plugin of catalog.plugins) for (const tag of plugin.tags) used.add(tag)
  // 插件一个都没有时不报未使用标签,否则模板状态的仓库会一次刷出全部预设标签的告警
  if (presetTags !== null && catalog.plugins.length > 0) {
    for (const tag of presetTags) {
      if (used.has(tag)) continue
      problems.push(
        problem('warning', 'TAG_UNUSED', 'site/tags.json 的标签 ' + JSON.stringify(tag) + ' 没有任何插件使用;新增标签要与使用它的插件在同一次提交里加入', 'site/tags.json'),
      )
    }
  }
  try {
    readCollectionMeta(join(siteDir, 'meta.json'), 'site/meta.json')
  } catch (error) {
    problems.push(problem('error', 'SITE_META_INVALID', error.message, 'site/meta.json'))
  }
  return buildResult({
    check: 'site',
    title: CHECK_TITLES.site,
    target: siteDir,
    problems,
    stats: { tags: presetTags === null ? 0 : presetTags.length, plugins: catalog.plugins.length },
  })
}

/**
 * 按名称执行一个检查项。
 * @param {string} name 检查项标识
 * @param {object} context 上下文
 * @returns {object} 检查结果
 */
export function runCheck(name, context) {
  switch (name) {
    case 'authors': return checkAuthors(context)
    case 'plugins': return checkPlugins(context)
    case 'versions': return checkVersions(context)
    case 'manifests': return checkManifests(context)
    case 'certs': return checkCertsRepo(context)
    case 'removed': return checkRemovedFile(context)
    case 'site': return checkSiteConsistency(context)
    default: throw new Error('未知检查项:' + name)
  }
}

/**
 * 把命令行参数整理成检查上下文。
 * @param {Record<string, any>} options 解析后的参数
 * @returns {object} 上下文
 */
export function contextFrom(options) {
  const rootCa = typeof options.rootCa === 'string' && options.rootCa.length > 0 ? resolve(options.rootCa) : process.env.ROOT_CA_PATH ? resolve(process.env.ROOT_CA_PATH) : null
  return {
    catalogDir: options.catalog ?? 'catalog',
    certsDir: options.certs ?? 'certs',
    siteDir: options.site ?? 'site',
    bundleDir: options.dir ?? join('dist', 'pages'),
    rootCaPath: rootCa,
  }
}
