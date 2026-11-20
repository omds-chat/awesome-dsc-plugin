#!/usr/bin/env node
/**
 * 按 catalog 拉取插件并组装 Pages 分发包。
 *
 * 输入有三类:
 *   catalog 目录里的登记信息(author.json、author_pub.pem、plugin.json);
 *   插件作者自己发布的 base_url 站点(versions.json、各版本 meta.json、plugin.js、可选 plugin.js.author.sig)。
 * 不读 GitHub Release 资产,也不读任何镜像。
 *
 * 输入还有第三类:site 目录里的合集设置。
 *   site/meta.json                    合集元数据,原样进入 pages 包 meta.json
 *   site/tags.json                    预设标签,原样进入 pages 包 tags.json
 * 仓库根不再存放任何分发包索引文件,构建产物只出现在 pages 包里。
 *
 * 产出(pages 根目录):
 *   index.html 与 assets/              来自 site 构建产物
 *   meta.json、tags.json               原样取自 site/meta.json 与 site/tags.json
 *   plugins.json                       插件目录索引,由 catalog 生成
 *   manifest.json、manifest.json.sig   L1 清单及其签名
 *   catalog/                           登记信息复制,并额外生成 index.json 与 anomalies.json
 *   certs/                             来自 main 分支,不纳入任何清单
 *   plugins/                           按 catalog 拉取并构建出的父子树
 *
 * plugins 树:
 *   plugins/author_manifest.json
 *   plugins/<作者>/author_pub.pem
 *   plugins/<作者>/plugin_manifest.json
 *   plugins/<作者>/manifest.json(+ .sig)                L2
 *   plugins/<作者>/<插件>/versions.json
 *   plugins/<作者>/<插件>/manifest.json(+ .sig)          L3
 *   plugins/<作者>/<插件>/<版本>/{meta.json,plugin.js,plugin.js.sig[,plugin.js.author.sig]}
 *
 * 两类问题的处理边界,实现里严格区分:
 *   登记不合规   catalog 里的文件本身不合法(缺字段、name 与目录不符、tags 结构或取值不合规等)。
 *                这是作者需要修正的登记错误,构建以非零退出码中止,一个插件都不发布。
 *   运行期异常   作者站点拉取失败(网络、HTTP 4xx/5xx)、远端 versions.json 不合法、
 *                远端 meta.json 与登记不符、plugin.js 为空等。只剔除该插件,其余插件照常构建与发布;
 *                剔除项写入 catalog/anomalies.json,由 scripts/report-build-anomalies.mjs 上报到仓库 Issue。
 *   签名失败、清单生成失败、分发自检失败既不是登记错误也不是单个插件的问题,仍按构建失败处理。
 *   作者签名是另一类:它是可选证据,拉取失败、为空或验签失败都只记警告,从不剔除插件、也不让构建失败。
 *
 * 所有产出先落在临时目录,全部校验通过后才替换 --out,因此不会留下半成品。
 * pages 根目录不放 eec.pem,合集证书只在 certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt。
 *
 * 用法:
 *   EEC_SECRET_KEY=... ROOT_CA_PATH=root_ca.crt node scripts/build-from-catalog.mjs \
 *     --catalog catalog --certs certs --site site/dist --out dist/pages \
 *     --published-base https://omds-chat.github.io/awesome-dsc-plugin/
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { formatProblems, verifyCollection } from './lib/collection-verify.mjs'
import { buildLayerManifests, listLayerDirs, problem } from './lib/layer-manifests.mjs'
import { buildAnomalyReport, buildCatalogIndex } from './lib/catalog-index.mjs'
import { readCollectionMeta } from './lib/collection-meta.mjs'
import {
  EEC_CERT_REL_IN_CERTS,
  EEC_CERT_RELATIVE,
  certMatchesKey,
  requireOpenssl,
  resolveKeyFile,
  signFileCms,
  verifyChain,
} from './pki.mjs'
import { fetchVersion, fetchVersions, readCatalog } from './lib/catalog.mjs'

/** site 产物里不允许出现的顶层名字:这些位置由本脚本独占,冲突会让人分不清来源 */
const RESERVED_TOP_LEVEL = [
  'plugins',
  'catalog',
  'certs',
  'meta.json',
  'tags.json',
  'plugins.json',
  'manifest.json',
  'manifest.json.sig',
  'eec.pem',
]

/** pages 包 catalog 目录里的汇总索引文件名 */
const CATALOG_INDEX_FILE = 'index.json'
/** pages 包 catalog 目录里的异常清单文件名 */
const ANOMALIES_FILE = 'anomalies.json'

/** 拉取异常:带阶段标记,便于异常清单写清失败发生在哪一步 */
class StageError extends Error {
  constructor(stage, message) {
    super(message)
    this.name = 'StageError'
    this.stage = stage
  }
}

function usage() {
  process.stdout.write([
    '用法: node scripts/build-from-catalog.mjs [选项]',
    '',
    '选项:',
    '  --catalog <目录>          catalog 目录,默认 catalog',
    '  --certs <目录>            证书目录,默认 certs',
    '  --site <目录>             site 构建产物目录,默认 site/dist',
    '  --out <目录>              分发包输出目录,默认 dist/pages',
    '  --meta <文件>             合集元数据来源,默认 site/meta.json',
    '  --tags <文件>             预设标签来源,默认 site/tags.json',
    '  --release-tag <tag>       本次发布的 tag,写入 catalog/index.json 与 catalog/anomalies.json',
    '  --published-base <地址>   已发布站点基址,用于读取上一次的清单 revision;取不到时从 1 开始',
    '  --root-ca <路径>          根证书路径,给出时对分发包做证书链与签名自检',
    '  --collection-name <名称>  合集名称,默认取 package.json 的 name',
    '  --timeout <毫秒>          单次 HTTP 请求超时,默认 30000',
    '  --help                    显示本说明',
    '',
    '环境变量:',
    '  EEC_SECRET_KEY            终端签名私钥,PEM 文本或文件路径;必需',
    '  ROOT_CA_PATH              根证书路径,等价于 --root-ca',
    '  PUBLISHED_BASE            已发布站点基址,等价于 --published-base',
    '  GITHUB_REF_NAME           本次发布的 tag,等价于 --release-tag',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    catalog: 'catalog',
    certs: 'certs',
    site: join('site', 'dist'),
    out: join('dist', 'pages'),
    meta: join('site', 'meta.json'),
    tags: join('site', 'tags.json'),
    releaseTag: null,
    publishedBase: null,
    rootCa: null,
    collectionName: null,
    timeout: 30000,
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
      case '--out': options.out = take(); break
      case '--meta': options.meta = take(); break
      case '--tags': options.tags = take(); break
      case '--release-tag': options.releaseTag = take(); break
      case '--published-base': options.publishedBase = take(); break
      case '--root-ca': options.rootCa = take(); break
      case '--collection-name': options.collectionName = take(); break
      case '--timeout': options.timeout = Number(take()); break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  if (!Number.isInteger(options.timeout) || options.timeout <= 0) throw new Error('--timeout 必须是正整数')
  return options
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function readJsonFile(path, label) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(label + ' 无法读取:' + error.message)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(label + ' 不是合法 JSON:' + error.message)
  }
}

function writeJsonFile(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function copyTree(srcDir, destDir) {
  if (!existsSync(srcDir)) return 0
  mkdirSync(destDir, { recursive: true })
  let count = 0
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name)
    const dest = join(destDir, entry.name)
    if (entry.isDirectory()) {
      count += copyTree(src, dest)
    } else if (entry.isFile()) {
      copyFileSync(src, dest)
      count += 1
    }
  }
  return count
}

/**
 * 把 catalog 目录复制进 pages 包,跳过本次发布剔除的作者与插件。
 * 跳过是为了让 pages 包里的 catalog 与 plugins 树保持同一套收录范围:
 * 被剔除的插件不留下悬挂的登记目录,交叉校验脚本因此可以直接比对两棵树。
 * @param {object} context 上下文
 * @param {string} context.catalogDir 仓库 catalog 目录
 * @param {string} context.destDir pages 包的 catalog 目录
 * @param {Set<string>} context.excludedAuthors 被整体剔除的作者
 * @param {Set<string>} context.excludedPlugins 被剔除的插件,键为 <作者>/<插件>
 * @returns {number} 复制的文件数
 */
function copyCatalogTree({ catalogDir, destDir, excludedAuthors, excludedPlugins }) {
  if (!existsSync(catalogDir)) return 0
  mkdirSync(destDir, { recursive: true })
  let count = 0
  for (const entry of readdirSync(catalogDir, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const src = join(catalogDir, entry.name)
    const dest = join(destDir, entry.name)
    if (entry.isFile()) {
      copyFileSync(src, dest)
      count += 1
      continue
    }
    if (!entry.isDirectory()) continue
    if (excludedAuthors.has(entry.name)) continue
    mkdirSync(dest, { recursive: true })
    for (const child of readdirSync(src, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))) {
      const childSrc = join(src, child.name)
      const childDest = join(dest, child.name)
      if (child.isDirectory()) {
        if (excludedPlugins.has(entry.name + '/' + child.name)) continue
        count += copyTree(childSrc, childDest)
      } else if (child.isFile()) {
        copyFileSync(childSrc, childDest)
        count += 1
      }
    }
  }
  return count
}

/** 校验 site 产物:必须有 index.html,且顶层不能占用本脚本独占的名字。 */
function inspectSite(siteDir, problems) {
  if (!isDirectory(siteDir)) throw new Error('site 产物目录不存在:' + siteDir + '(先执行 site 构建)')
  if (!existsSync(join(siteDir, 'index.html'))) throw new Error('site 产物目录缺少 index.html:' + siteDir)
  if (!isDirectory(join(siteDir, 'assets'))) {
    problems.push(problem('warning', 'SITE_ASSETS_MISSING', 'site 产物目录没有 assets/ 子目录,分发包的样式与脚本可能缺失', siteDir))
  }
  const conflicts = readdirSync(siteDir).filter((name) => RESERVED_TOP_LEVEL.includes(name))
  if (conflicts.length > 0) {
    throw new Error('site 产物目录出现保留名字,会与流水线产出冲突:' + conflicts.join(', '))
  }
}

/**
 * 解析终端签名私钥,并确认它与证书目录里的终端签名证书配对。
 * 不配对时直接失败,避免产出一批无法验签的签名。
 */
function prepareSigner({ certsDir, rootCaPath, problems }) {
  const eecCertPath = join(certsDir, EEC_CERT_REL_IN_CERTS)
  if (!existsSync(eecCertPath)) {
    problems.push(problem('error', 'EEC_MISSING', '证书目录缺少 ' + EEC_CERT_RELATIVE, EEC_CERT_RELATIVE))
    return null
  }
  if (rootCaPath) {
    const chain = verifyChain(eecCertPath, rootCaPath)
    if (!chain.ok) {
      problems.push(problem('error', 'EEC_NOT_CHAINED', EEC_CERT_RELATIVE + ' 不是由给定根证书签发:' + chain.reason, EEC_CERT_RELATIVE))
      return null
    }
  }
  const source = process.env.EEC_SECRET_KEY
  if (!source) {
    problems.push(problem('error', 'SIGN_KEY_MISSING', '需要环境变量 EEC_SECRET_KEY(P-256 私钥 PEM 或路径)', null))
    return null
  }
  let keyFile
  try {
    keyFile = resolveKeyFile(source, 'EEC_SECRET_KEY')
  } catch (error) {
    problems.push(problem('error', 'SIGN_KEY_INVALID', 'EEC 私钥不可用:' + error.message, null))
    return null
  }
  try {
    if (!certMatchesKey(eecCertPath, keyFile.path)) {
      problems.push(
        problem(
          'error',
          'SIGN_KEY_MISMATCH',
          'EEC_SECRET_KEY 与 ' + EEC_CERT_RELATIVE + ' 不是同一把密钥;请确认证书与 CI secret 配对',
          EEC_CERT_RELATIVE,
        ),
      )
      keyFile.cleanup()
      return null
    }
  } catch (error) {
    problems.push(problem('error', 'SIGN_KEY_INVALID', 'EEC 私钥不可用:' + error.message, null))
    keyFile.cleanup()
    return null
  }
  return { eecCertPath, keyFile, cleanup: () => keyFile.cleanup() }
}

/** 列出分发包里每个版本的目录,顺序为作者、插件、版本。 */
function listVersionDirs(root) {
  const found = []
  const pluginsDir = join(root, 'plugins')
  if (!isDirectory(pluginsDir)) return found
  for (const author of readdirSync(pluginsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const authorDir = join(pluginsDir, author)
    for (const plugin of readdirSync(authorDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
      const pluginDir = join(authorDir, plugin)
      const versionsPath = join(pluginDir, 'versions.json')
      if (!existsSync(versionsPath)) continue
      let versions = []
      try {
        const data = JSON.parse(readFileSync(versionsPath, 'utf8'))
        versions = Array.isArray(data?.versions) ? data.versions.filter((item) => typeof item === 'string') : []
      } catch {
        versions = []
      }
      for (const version of versions) {
        const versionDir = join(pluginDir, version)
        if (isDirectory(versionDir)) found.push({ author, plugin, version, versionDir })
      }
    }
  }
  return found
}

/** 用终端签名证书为每个版本的 plugin.js 重新签名。作者自签名原样保留,不做改动。 */
function signPlugins(root, signer, problems) {
  let signed = 0
  for (const { author, plugin, version, versionDir } of listVersionDirs(root)) {
    const filePath = join(versionDir, 'plugin.js')
    if (!existsSync(filePath)) {
      problems.push(problem('error', 'SIGN_TARGET_MISSING', author + '/' + plugin + '/' + version + ' 缺少 plugin.js', 'plugins/' + author + '/' + plugin + '/' + version + '/plugin.js'))
      continue
    }
    try {
      signFileCms(filePath, signer.eecCertPath, signer.keyFile.path)
      signed += 1
    } catch (error) {
      problems.push(problem('error', 'SIGN_FAILED', '为 ' + author + '/' + plugin + '/' + version + '/plugin.js 签名失败:' + error.message, 'plugins/' + author + '/' + plugin + '/' + version + '/plugin.js'))
    }
  }
  return signed
}

/**
 * 从作者站点拉取一个插件的全部版本产物,先放进内存。
 * 只有全部版本都通过校验才落盘,因此单个插件不会在 plugins 树里留下半成品目录。
 * @param {object} plugin catalog 里的插件记录
 * @param {{timeoutMs: number}} options 选项
 * @returns {Promise<{latest: string, versions: string[], releases: Array<object>}>}
 */
async function pullPlugin(plugin, { timeoutMs }) {
  let versionsInfo
  try {
    versionsInfo = await fetchVersions(plugin.baseUrl, { timeoutMs })
  } catch (error) {
    throw new StageError('versions', 'versions.json 拉取或解析失败:' + error.message)
  }
  const releases = []
  for (const version of versionsInfo.versions) {
    let payload
    try {
      payload = await fetchVersion(plugin.baseUrl, version, { timeoutMs })
    } catch (error) {
      throw new StageError('version', version + ' 的版本产物拉取失败:' + error.message)
    }
    const meta = payload.meta
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
      throw new StageError('meta', version + ' 的 meta.json 必须是对象')
    }
    if (meta.name !== plugin.name) {
      throw new StageError('meta', version + ' 的 meta.json name 为 ' + JSON.stringify(meta.name) + ',要求 ' + plugin.name)
    }
    if (meta.version !== version) {
      throw new StageError('meta', version + ' 的 meta.json version 为 ' + JSON.stringify(meta.version) + ',要求 ' + version)
    }
    if (!payload.pluginJs || payload.pluginJs.length === 0) {
      throw new StageError('bundle', version + ' 的 plugin.js 为空')
    }
    releases.push({ version, meta, pluginJs: payload.pluginJs, authorSig: payload.authorSig, authorSigNote: payload.authorSigNote })
  }
  return { latest: versionsInfo.latest, versions: versionsInfo.versions, releases }
}

/** 把拉取到的版本产物落盘为一个插件目录。 */
function writePluginFiles(pluginDir, pulled) {
  writeJsonFile(join(pluginDir, 'versions.json'), { latest: pulled.latest, versions: pulled.versions })
  for (const release of pulled.releases) {
    const versionDir = join(pluginDir, release.version)
    mkdirSync(versionDir, { recursive: true })
    writeJsonFile(join(versionDir, 'meta.json'), release.meta)
    writeFileSync(join(versionDir, 'plugin.js'), release.pluginJs)
    if (release.authorSig) writeFileSync(join(versionDir, 'plugin.js.author.sig'), release.authorSig)
  }
}

/**
 * 按 catalog 拉取并写出 plugins 树。
 * 拉取失败的插件只记入 anomalies 并跳过,不影响其余插件;
 * catalog 本身的登记错误在进入本函数之前就已经让构建失败。
 * @param {object} context 上下文
 * @param {string} context.staging 临时输出目录
 * @param {{authors: Array<object>, plugins: Array<object>}} context.catalog catalog 读取结果
 * @param {Array<object>} context.anomalies 剔除记录收集数组
 * @param {Array<object>} context.problems 问题收集数组
 * @param {number} context.timeoutMs 单次请求超时
 * @returns {Promise<{includedAuthors: Array<object>, includedPlugins: Array<object>, versionCount: number}>}
 */
async function writePluginsTree({ staging, catalog, anomalies, problems, timeoutMs }) {
  const pluginsDir = join(staging, 'plugins')
  mkdirSync(pluginsDir, { recursive: true })
  const includedAuthors = []
  const includedPlugins = []
  let versionCount = 0

  for (const author of catalog.authors) {
    const pulledPlugins = []
    for (const plugin of author.plugins) {
      try {
        const pulled = await pullPlugin(plugin, { timeoutMs })
        pulledPlugins.push({ plugin, pulled })
        // 作者签名是可选项:取不到或为空只记警告,插件照常收录
        for (const release of pulled.releases) {
          if (!release.authorSigNote) continue
          problems.push(
            problem(
              'warning',
              'AUTHOR_SIGNATURE_IGNORED',
              '插件 ' + author.username + '/' + plugin.name + ' ' + release.version + ' 的' + release.authorSigNote + ';作者签名是可选证据,不阻断收录',
              'plugins/' + author.username + '/' + plugin.dirName + '/' + release.version + '/plugin.js.author.sig',
            ),
          )
        }
      } catch (error) {
        if (!(error instanceof StageError)) throw error
        anomalies.push({
          author: author.username,
          plugin: plugin.name,
          stage: error.stage,
          reason: error.message,
          base_url: plugin.baseUrl,
        })
        problems.push(
          problem(
            'warning',
            'PLUGIN_EXCLUDED',
            '插件 ' + author.username + '/' + plugin.name + ' 已从本次发布剔除(阶段 ' + error.stage + '):' + error.message,
            plugin.pluginRel,
          ),
        )
      }
    }
    if (pulledPlugins.length === 0) {
      if (author.plugins.length > 0) {
        problems.push(
          problem('warning', 'AUTHOR_EXCLUDED', '作者 ' + author.username + ' 的插件全部被剔除,本次发布不写入该作者目录', author.authorRel),
        )
      }
      continue
    }

    const authorDir = join(pluginsDir, author.username)
    mkdirSync(authorDir, { recursive: true })
    copyFileSync(author.pubPath, join(authorDir, 'author_pub.pem'))
    writeJsonFile(
      join(authorDir, 'plugin_manifest.json'),
      pulledPlugins.map((item) => item.plugin.name).sort(),
    )

    for (const { plugin, pulled } of pulledPlugins) {
      const pluginDir = join(authorDir, plugin.dirName)
      mkdirSync(pluginDir, { recursive: true })
      writePluginFiles(pluginDir, pulled)
      versionCount += pulled.releases.length
      includedPlugins.push({ ...plugin, latest: pulled.latest, versionCount: pulled.releases.length })
    }
    includedAuthors.push({ username: author.username, profile: author.profile, plugins: pulledPlugins.map((item) => item.plugin) })
  }

  writeJsonFile(
    join(pluginsDir, 'author_manifest.json'),
    includedAuthors
      .map((author) => ({ username: author.username, profile: author.profile }))
      .sort((left, right) => (left.username < right.username ? -1 : 1)),
  )
  return { includedAuthors, includedPlugins, versionCount }
}

/** 生成 plugins.json(插件目录索引):每个插件一条,tag 取自该插件 plugin.json 的 tags。 */
function buildPluginsIndex(plugins) {
  return plugins
    .map((plugin) => ({ plugin_name: plugin.name, author: plugin.author, tag: Array.isArray(plugin.tags) ? [...plugin.tags] : [] }))
    .sort((left, right) => (left.plugin_name < right.plugin_name ? -1 : 1))
}

/**
 * 读取预设标签清单,必须是元素非空、互不重复的字符串数组。
 * 文件缺失时按空清单处理并记警告:此时任何标签都会被视为未登记。
 * @param {string} path tags.json 路径
 * @param {Array<object>} problems 问题收集数组
 * @returns {string[]} 预设标签
 */
function readTags(path, problems) {
  if (!existsSync(path)) {
    problems.push(problem('warning', 'TAGS_FILE_MISSING', '预设标签文件不存在:' + path + ',本次构建按空清单处理', 'tags.json'))
    return []
  }
  const data = readJsonFile(path, 'tags.json')
  if (!Array.isArray(data)) throw new Error('tags.json 的顶层必须是字符串数组')
  const seen = new Set()
  for (const tag of data) {
    if (typeof tag !== 'string' || tag.trim().length === 0) throw new Error('tags.json 含非字符串或空标签')
    if (seen.has(tag)) throw new Error('tags.json 含重复标签 ' + tag)
    seen.add(tag)
  }
  return data
}

/**
 * 校验每个插件声明的标签都在 tags.json 的预设清单内。
 * 越界标签属于登记错误:构建直接中止并指出是哪个插件、哪个标签,而不是静默丢弃该标签。
 * @param {object} context 上下文
 * @param {{plugins: Array<object>}} context.catalog catalog 读取结果
 * @param {string[]} context.presetTags 预设标签
 * @param {Array<object>} context.problems 问题收集数组
 */
function checkPresetTags({ catalog, presetTags, problems }) {
  const allowed = new Set(presetTags)
  for (const plugin of catalog.plugins) {
    for (const tag of plugin.tags) {
      if (!allowed.has(tag)) {
        problems.push(
          problem(
            'error',
            'PLUGIN_TAG_UNKNOWN',
            '插件 ' + plugin.name + '(作者 ' + plugin.author + ')的标签 ' + JSON.stringify(tag) + ' 不在 tags.json 的预设清单内',
            plugin.pluginRel + '/plugin.json',
          ),
        )
      }
    }
  }
}

/**
 * 从已发布站点读取三层清单的上一次 revision。
 * 取不到或结构不对时返回 null,该层 revision 从 1 开始,并记一条警告。
 */
async function loadPreviousManifests({ publishedBase, layerRels, problems, timeoutMs }) {
  const map = new Map()
  if (!publishedBase) {
    problems.push(problem('warning', 'PUBLISHED_BASE_MISSING', '未提供已发布站点基址,三层清单的 revision 都从 1 开始', null))
    return map
  }
  const base = publishedBase.replace(/\/+$/, '')
  await Promise.all(
    layerRels.map(async (layerRel) => {
      const url = base + '/' + (layerRel ? layerRel + '/' : '') + 'manifest.json'
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
        if (!response.ok) return
        const data = await response.json()
        if (typeof data !== 'object' || data === null || !Array.isArray(data.files)) return
        map.set(layerRel, data)
      } catch {
        return
      }
    }),
  )
  if (map.size === 0) {
    problems.push(problem('warning', 'PREVIOUS_MANIFEST_MISSING', '已发布站点没有可用的清单,三层清单的 revision 从 1 开始', null))
  }
  return map
}

function resolveCollectionName(options) {
  if (options.collectionName) return options.collectionName
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    if (typeof pkg.name === 'string' && pkg.name.length > 0) return pkg.name
  } catch {
    // 没有 package.json 时退回目录名
  }
  return basename(process.cwd())
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write('构建失败:' + error.message + '\n\n')
    usage()
    return 2
  }
  if (options.help) {
    usage()
    return 0
  }

  requireOpenssl()

  const catalogDir = resolve(options.catalog)
  const certsDir = resolve(options.certs)
  const siteDir = resolve(options.site)
  const outDir = resolve(options.out)
  const rootCaPath = options.rootCa ? resolve(options.rootCa) : process.env.ROOT_CA_PATH ? resolve(process.env.ROOT_CA_PATH) : null
  const publishedBase = options.publishedBase || process.env.PUBLISHED_BASE || null
  const releaseTag = options.releaseTag || process.env.GITHUB_REF_NAME || process.env.RELEASE_TAG || null
  const collectionName = resolveCollectionName(options)

  if (rootCaPath && !existsSync(rootCaPath)) throw new Error('根证书不存在:' + rootCaPath)

  const problems = []
  inspectSite(siteDir, problems)
  const presetTags = readTags(resolve(options.tags), problems)
  const catalog = readCatalog({ catalogDir, problems })
  checkPresetTags({ catalog, presetTags, problems })

  if (!isDirectory(certsDir)) throw new Error('证书目录不存在:' + certsDir)
  if (!existsSync(join(certsDir, EEC_CERT_REL_IN_CERTS))) throw new Error('证书目录缺少 ' + EEC_CERT_RELATIVE + ':' + certsDir)

  // 登记不合规在这里就中止:不让作者带着不合法的登记进入拉取阶段,也不发布任何插件。
  const registrationErrors = problems.filter((item) => item.level === 'error')
  if (registrationErrors.length > 0) {
    process.stderr.write('catalog 登记不合规,共 ' + registrationErrors.length + ' 个错误,未开始拉取插件:\n' + formatProblems(problems) + '\n')
    return 1
  }

  const staging = outDir + '.staging-' + process.pid + '-' + Date.now()
  let signer = null
  try {
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })

    const anomalies = []
    const { includedAuthors, includedPlugins, versionCount } = await writePluginsTree({
      staging,
      catalog,
      anomalies,
      problems,
      timeoutMs: options.timeout,
    })

    // site 产物放根目录,再把 catalog 与 certs 复制进来
    copyTree(siteDir, staging)
    const includedAuthorNames = new Set(includedAuthors.map((author) => author.username))
    const excludedAuthors = new Set(catalog.authors.filter((author) => !includedAuthorNames.has(author.username)).map((author) => author.username))
    const excludedPlugins = new Set(anomalies.map((item) => item.author + '/' + item.plugin))
    const catalogFiles = copyCatalogTree({ catalogDir, destDir: join(staging, 'catalog'), excludedAuthors, excludedPlugins })
    const certFiles = copyTree(certsDir, join(staging, 'certs'))

    writeJsonFile(join(staging, 'meta.json'), readCollectionMeta(resolve(options.meta)))
    writeJsonFile(join(staging, 'tags.json'), presetTags)
    writeJsonFile(join(staging, 'plugins.json'), buildPluginsIndex(includedPlugins))
    writeJsonFile(
      join(staging, 'catalog', CATALOG_INDEX_FILE),
      buildCatalogIndex({ collectionName, releaseTag, authors: includedAuthors, plugins: includedPlugins }),
    )
    writeJsonFile(
      join(staging, 'catalog', ANOMALIES_FILE),
      buildAnomalyReport({ collectionName, releaseTag, anomalies }),
    )

    if (existsSync(join(staging, 'eec.pem'))) {
      throw new Error('分发包根目录不允许出现 eec.pem;合集证书只在 ' + EEC_CERT_RELATIVE)
    }

    signer = prepareSigner({ certsDir: join(staging, 'certs'), rootCaPath, problems })
    const signErrors = problems.filter((item) => item.level === 'error')
    if (signErrors.length > 0) {
      process.stderr.write('签名准备失败:\n' + formatProblems(problems) + '\n')
      return 1
    }
    const signedCount = signPlugins(staging, signer, problems)

    const layers = listLayerDirs(staging)
    const previous = await loadPreviousManifests({
      publishedBase,
      layerRels: layers.map((layer) => layer.layerRel),
      problems,
      timeoutMs: options.timeout,
    })
    const manifests = buildLayerManifests({
      root: staging,
      signer: { eecCertPath: signer.eecCertPath, eecKeyPath: signer.keyFile.path },
      problems,
      previousResolver: (layerRel) => previous.get(layerRel) ?? null,
    })

    const finalErrors = problems.filter((item) => item.level === 'error')
    if (finalErrors.length > 0) {
      process.stderr.write('构建未通过,共 ' + finalErrors.length + ' 个错误:\n' + formatProblems(problems) + '\n')
      return 1
    }

    if (rootCaPath) {
      const result = verifyCollection(staging, { rootCaPath, collectionName })
      if (!result.ok) {
        process.stderr.write('分发包自检未通过,共 ' + result.errorCount + ' 个错误:\n' + formatProblems(result.problems) + '\n')
        return 1
      }
      for (const warning of result.problems) {
        process.stdout.write('[警告] ' + warning.code + ' ' + warning.message + '\n')
      }
    } else {
      process.stdout.write('[警告] 未提供根证书,跳过分发包自检(证书链与 CMS 签名未校验)\n')
    }

    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(join(outDir, '..'), { recursive: true })
    renameSync(staging, outDir)
    signer.cleanup()
    signer = null

    process.stdout.write(
      '分发包已生成:' + outDir + '\n' +
      '  作者 ' + includedAuthors.length + ' 个,插件 ' + includedPlugins.length + ' 个,版本 ' + versionCount + ' 个\n' +
      '  plugin.js 已用合集 EEC 重新签名 ' + signedCount + ' 份\n' +
      '  catalog 复制 ' + catalogFiles + ' 个文件,certs 复制 ' + certFiles + ' 个文件\n' +
      '  catalog/' + CATALOG_INDEX_FILE + ' 记录作者 ' + includedAuthors.length + ' 个、插件 ' + includedPlugins.length + ' 个\n',
    )
    for (const item of manifests) {
      process.stdout.write('  ' + item.layer + ' 清单 ' + item.dir + '/manifest.json revision=' + item.revision + ',覆盖 ' + item.files + ' 个文件' + (item.changed ? '(已更新)' : '(未变化)') + '\n')
    }
    if (anomalies.length > 0) {
      process.stdout.write('剔除了 ' + anomalies.length + ' 个插件,发布未受影响;异常清单 catalog/' + ANOMALIES_FILE + ':\n')
      for (const item of anomalies) {
        process.stdout.write('  - ' + item.author + '/' + item.plugin + ' [阶段 ' + item.stage + '] ' + item.reason + '\n')
      }
    } else {
      process.stdout.write('本次构建没有剔除任何插件(catalog/' + ANOMALIES_FILE + ' 为空清单)\n')
    }
    const warnings = problems.filter((item) => item.level === 'warning')
    if (warnings.length > 0) {
      process.stdout.write('警告 ' + warnings.length + ' 条:\n' + formatProblems(warnings) + '\n')
    }
    return 0
  } finally {
    if (signer) signer.cleanup()
    rmSync(staging, { recursive: true, force: true })
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  process.stderr.write('构建失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
