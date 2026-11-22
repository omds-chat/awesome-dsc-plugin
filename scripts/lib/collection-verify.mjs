/**
 * 合集自洽性校验(PKI 版)。
 *
 * 校验对象是分发规范 v2 的合集目录结构:根目录的终端签名证书、三层哈希清单、
 * 作者公钥、插件清单、版本目录、逐文件 CMS 签名,以及 plugin.js 的网络自建静态扫描(只警告,不阻断)。
 * 只读取文件,不修改任何内容;
 * build-collection.mjs 与 verify-collection.mjs 共用本模块。
 *
 * 三层清单互相独立,不做收束:L1 在合集根,L2 在每个作者目录,L3 在每个插件目录,
 * 每层一份 manifest.json 与一份 manifest.json.sig,只覆盖本层目录内的文件。
 *
 * 校验语义(见 .agents/signing-conventions.md 第六节):本脚本是发布前的强校验,
 * 任一项失败都以非零退出码结束;插件市场一侧的同类校验失败只警告,不阻断。
 * 作者签名是一个例外:它是可选证据,校验失败或公钥与签名两侧不齐都只警告,从不阻断收录。
 * 产物网络自审同样只警告:插件自行联网是收录契约的提示,不是沙箱,不改变退出码。
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  AUTHOR_PUB_FILE,
  MANIFEST_FILE,
  ROOT_CA_FILE,
  VERSION_AUTHOR_SIGNED_FILES,
  VERSION_SIGNED_FILES,
  authorSignaturePath,
  cmsSignaturePath,
  describeCertificate,
  describePublicKey,
  hasDigitalSignature,
  resolveEecCertPath,
  verifyChain,
  verifyFileAuthor,
  verifyFileCms,
} from '../pki.mjs'
import { NETWORK_SELFTALK_ADVICE, PLUGIN_NETWORK_SELFTALK, describeNetworkHit, scanPluginFile } from './plugin-network-scan.mjs'

/**
 * 合集根目录必需的文件。tags.json 可选,存在时才要求被 L1 清单覆盖。
 * 终端签名证书不在合集根,按 resolveEecCertPath 解析(现行布局是 certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt),
 * 因此单独校验,不列入本数组。
 */
export const ROOT_REQUIRED_FILES = ['meta.json', 'plugins.json']
/** 版本目录内必需的文件。meta.json.sig 已取消,产物本体只由 plugin.js.sig 签名 */
export const VERSION_REQUIRED_FILES = ['meta.json', 'plugin.js', 'plugin.js.sig']
/** 作者目录内的公钥文件名 */
export const AUTHOR_PUB_RELATIVE = AUTHOR_PUB_FILE
/** 根证书文件名,仅用于报错提示,合集本身不存放根证书 */
export const ROOT_CA_RELATIVE = ROOT_CA_FILE
/** 清单签名后缀,清单签名路径即 <清单>.sig */
export const MANIFEST_SIGNATURE_SUFFIX = '.sig'
/** 清单结构版本,与 schemas/manifest.schema.json 保持一致 */
export const MANIFEST_SCHEMA_VERSION = 1
/** L1 必需覆盖的文件,相对合集根 */
export const LAYER1_FILES = ['plugins.json', 'meta.json', 'plugins/author_manifest.json']
/** L1 可选覆盖的文件:存在就必须被清单覆盖,不存在则不报错、也不进清单 */
export const LAYER1_OPTIONAL_FILES = ['tags.json']
/** L2 覆盖的文件,相对作者目录。author_pub.pem 缺失时按既有规则降级为警告,清单只覆盖实际存在的文件 */
export const LAYER2_FILES = ['author_pub.pem', 'plugin_manifest.json']
/** L3 固定覆盖的文件,相对插件目录;其余覆盖项是每个版本的 meta.json */
export const LAYER3_FILES = ['versions.json']
/** 单个 plugin.js 逐条报出的网络自建命中上限,超出部分汇总成一条。命中只记警告 */
export const MAX_NETWORK_HITS = 20

/** L3 明确不覆盖的产物本体,由每版本的 plugin.js.sig 独立签名 */
export const LAYER3_EXCLUDED_FILES = ['plugin.js', 'plugin.js.sig']

/**
 * 作者签名的判定结果。
 *
 * 作者层只是附加证据:合集已在登记侧审核过作者与插件,作者签名从不阻断收录,
 * 因此这里只区分「有没有可用的证据」,没有一项会升级为错误。
 * 公钥与签名两侧缺一不可:任一侧缺失都判为「未校验」,不得判为通过。
 */
export const AUTHOR_SIGNATURE_VERDICT = {
  verified: '通过',
  failed: '未通过',
  unpaired: '未校验',
  unsigned: '未校验',
  absent: '未校验',
}

/**
 * 判定一个版本的作者签名配对状态。公钥与签名两侧缺一不可:
 *   - 两侧都在:验通为 verified,验败为 failed;
 *   - 只有 plugin.js.author.sig、没有可用公钥:unpaired,判为未校验;
 *   - 只有公钥、没有 plugin.js.author.sig:unsigned,判为未校验;
 *   - 两侧都没有:absent,判为未校验。
 * @param {{hasSignature: boolean, hasPublicKey: boolean, verified: boolean}} input 配对输入
 * @returns {'verified'|'failed'|'unpaired'|'unsigned'|'absent'}
 */
export function classifyAuthorSignature({ hasSignature, hasPublicKey, verified }) {
  if (!hasSignature) return hasPublicKey ? 'unsigned' : 'absent'
  if (!hasPublicKey) return 'unpaired'
  return verified ? 'verified' : 'failed'
}

export { MANIFEST_FILE, VERSION_SIGNED_FILES, VERSION_AUTHOR_SIGNED_FILES }

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const PLUGIN_NAME_PATTERN = /^(?:dsc-[a-z0-9][a-z0-9._-]*|@[a-z0-9][a-z0-9._-]*\/dsc-[a-z0-9][a-z0-9._-]*)$/

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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

function readText(path) {
  return readFileSync(path, 'utf8')
}

function parseJsonFile(path, label, report) {
  let text
  try {
    text = readText(path)
  } catch (error) {
    report.error('FILE_UNREADABLE', label + ' 无法读取:' + error.message, path)
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    report.error('JSON_INVALID', label + ' 不是合法 JSON:' + error.message, path)
    return undefined
  }
}

const SHA512_PATTERN = /^[0-9a-f]{128}$/

/** 计算文件的 SHA-512,小写十六进制。 */
function sha512Hex(path) {
  return createHash('sha512').update(readFileSync(path)).digest('hex')
}

/** 列出目录下的子目录名,按字典序排序;目录不存在时返回空数组。 */
function listDirectoryNames(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** 读取 versions.json 的版本列表,读不到时返回空数组。 */
function readVersionList(path) {
  if (!isFile(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const list = Array.isArray(data?.versions) ? data.versions : []
    return list.filter((item) => typeof item === 'string')
  } catch {
    return []
  }
}

/**
 * 校验清单条目里的相对路径:必须是相对清单所在目录的正斜杠路径,
 * 不得是绝对路径,不得出现 . 或 .. 段,不得指向清单自身及其签名。
 * @param {string} rel 清单条目里的 path
 * @returns {string|null} 不合法时返回原因,合法返回 null
 */
export function manifestPathProblem(rel) {
  if (typeof rel !== 'string' || rel.length === 0) return 'path 必须是非空字符串'
  if (rel.includes('\\')) return 'path 必须使用正斜杠'
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return 'path 不得是绝对路径'
  const segments = rel.split('/')
  if (segments.some((segment) => segment.length === 0)) return 'path 不得包含空段'
  if (segments.some((segment) => segment === '.' || segment === '..')) return 'path 不得包含 . 或 .. 段'
  if (rel === MANIFEST_FILE || rel === MANIFEST_FILE + MANIFEST_SIGNATURE_SUFFIX) return 'path 不得指向清单自身'
  return null
}

/**
 * 校验一层清单:存在性、结构、路径、覆盖范围、文件哈希与签名。
 * 任何失败都带上层号与具体文件,便于直接定位。
 * @param {object} context 校验上下文
 * @returns {void}
 */
function verifyLayerManifest(context) {
  const { layer, layerRel, layerDir, expectedFiles, report, rootCaPath, eecPath, cmsReady, missingLevel, stats } = context
  const layerLabel = layer + '(' + (layerRel || '.') + ')'
  const manifestRel = layerRel ? layerRel + '/' + MANIFEST_FILE : MANIFEST_FILE
  const manifestPath = join(layerDir, MANIFEST_FILE)
  if (!isFile(manifestPath)) {
    report[missingLevel]('MANIFEST_MISSING', layerLabel + ' 缺少清单文件 ' + MANIFEST_FILE, manifestRel)
    return
  }
  const manifest = parseJsonFile(manifestPath, layerLabel + ' 清单', report)
  if (manifest === undefined) return
  if (!isObject(manifest)) {
    report.error('MANIFEST_INVALID', layerLabel + ' 清单的顶层必须是对象', manifestRel)
    return
  }
  for (const key of Object.keys(manifest)) {
    if (key !== 'schemaVersion' && key !== 'revision' && key !== 'files') {
      report.error('MANIFEST_FIELD_UNKNOWN', layerLabel + ' 清单含未知字段 ' + key, manifestRel)
    }
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    report.error(
      'MANIFEST_SCHEMA_VERSION',
      layerLabel + ' 清单的 schemaVersion 必须是 ' + MANIFEST_SCHEMA_VERSION + ',实际为 ' + JSON.stringify(manifest.schemaVersion),
      manifestRel,
    )
  }
  if (!Number.isInteger(manifest.revision) || manifest.revision < 1) {
    report.error(
      'MANIFEST_REVISION_INVALID',
      layerLabel + ' 清单的 revision 必须是正整数,实际为 ' + JSON.stringify(manifest.revision),
      manifestRel,
    )
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    report.error('MANIFEST_FILES_INVALID', layerLabel + ' 清单的 files 必须是非空数组', manifestRel)
    return
  }

  const covered = new Map()
  for (const [index, item] of manifest.files.entries()) {
    const itemLabel = layerLabel + ' 清单第 ' + index + ' 项'
    if (!isObject(item)) {
      report.error('MANIFEST_ENTRY_INVALID', itemLabel + ' 必须是对象', manifestRel)
      continue
    }
    for (const key of Object.keys(item)) {
      if (key !== 'path' && key !== 'sha512') {
        report.error('MANIFEST_FIELD_UNKNOWN', itemLabel + ' 含未知字段 ' + key, manifestRel)
      }
    }
    const pathProblem = manifestPathProblem(item.path)
    if (pathProblem) {
      report.error('MANIFEST_PATH_INVALID', itemLabel + ' 的 path 不合法:' + pathProblem + '(' + JSON.stringify(item.path) + ')', manifestRel)
      continue
    }
    if (typeof item.sha512 !== 'string' || !SHA512_PATTERN.test(item.sha512)) {
      report.error('MANIFEST_HASH_INVALID', itemLabel + ' 的 sha512 必须是 128 位小写十六进制', manifestRel)
      continue
    }
    if (covered.has(item.path)) {
      report.error('MANIFEST_PATH_DUPLICATE', layerLabel + ' 清单中 ' + item.path + ' 重复出现', manifestRel)
      continue
    }
    covered.set(item.path, item.sha512)
  }

  // 覆盖范围:该层该有的文件都在清单里,清单里没有多余项
  const expected = new Set(expectedFiles)
  for (const rel of expected) {
    const filePath = join(layerDir, ...rel.split('/'))
    const fileRel = layerRel ? layerRel + '/' + rel : rel
    if (!isFile(filePath)) {
      report.error('LAYER_FILE_MISSING', layerLabel + ' 缺少必需文件 ' + rel, fileRel)
      continue
    }
    if (!covered.has(rel)) {
      report.error('MANIFEST_FILE_MISSING', layerLabel + ' 清单缺少文件 ' + rel, manifestRel)
    }
  }
  for (const rel of covered.keys()) {
    if (expected.has(rel)) continue
    const fileRel = layerRel ? layerRel + '/' + rel : rel
    if (layer === 'L3' && LAYER3_EXCLUDED_FILES.includes(rel)) {
      report.error('MANIFEST_FILE_EXTRA', layerLabel + ' 清单不得覆盖 ' + rel + ':产物本体由该版本的 plugin.js.sig 独立签名', fileRel)
    } else {
      report.error('MANIFEST_FILE_EXTRA', layerLabel + ' 清单包含多余项 ' + rel, fileRel)
    }
  }

  // 哈希:逐文件比对 SHA-512
  let mismatched = 0
  for (const [rel, expectedHash] of covered) {
    if (!expected.has(rel)) continue
    const filePath = join(layerDir, ...rel.split('/'))
    if (!isFile(filePath)) continue
    const fileRel = layerRel ? layerRel + '/' + rel : rel
    let actual = null
    try {
      actual = sha512Hex(filePath)
    } catch (error) {
      report.error('MANIFEST_HASH_UNREADABLE', layerLabel + ' 无法读取 ' + rel + ':' + error.message, fileRel)
      continue
    }
    if (actual !== expectedHash) {
      mismatched += 1
      report.error('MANIFEST_HASH_MISMATCH', layerLabel + ' 清单记录的 ' + rel + ' 与文件实际 SHA-512 不一致', fileRel)
    }
  }

  // 签名
  const sigPath = manifestPath + MANIFEST_SIGNATURE_SUFFIX
  const sigRel = manifestRel + MANIFEST_SIGNATURE_SUFFIX
  if (!isFile(sigPath)) {
    report[missingLevel]('MANIFEST_SIGNATURE_MISSING', layerLabel + ' 缺少清单签名 ' + MANIFEST_FILE + MANIFEST_SIGNATURE_SUFFIX, sigRel)
  } else if (!cmsReady) {
    report.warn('SIGN_UNVERIFIABLE', sigRel + ' 无法校验,缺少根证书或终端签名证书', sigRel)
  } else {
    const result = verifyFileCms(manifestPath, sigPath, rootCaPath, eecPath)
    if (!result.ok) {
      report.error('MANIFEST_SIGNATURE_INVALID', layerLabel + ' 清单签名校验失败:' + String(result.reason), sigRel)
    }
  }

  stats.manifests.push({
    layer,
    dir: layerRel || '.',
    revision: Number.isInteger(manifest.revision) ? manifest.revision : null,
    files: covered.size,
    mismatched,
  })
}

/**
 * 校验三层清单。L1 在合集根,L2 在每个作者目录,L3 在每个插件目录,层与层之间不互相引用,
 * 因此任何一层都可以单独校验、单独重签。
 * @param {object} context 校验上下文
 * @returns {void}
 */
function verifyManifests({ root, report, stats, rootCaPath, eecPath, cmsReady, allowMissingManifest }) {
  const missingLevel = allowMissingManifest ? 'warn' : 'error'
  verifyLayerManifest({
    layer: 'L1',
    layerRel: '',
    layerDir: root,
    expectedFiles: [...LAYER1_FILES, ...LAYER1_OPTIONAL_FILES.filter((name) => isFile(join(root, name)))],
    report,
    rootCaPath,
    eecPath,
    cmsReady,
    missingLevel,
    stats,
  })
  const pluginsDir = join(root, 'plugins')
  for (const author of listDirectoryNames(pluginsDir)) {
    const authorDir = join(pluginsDir, author)
    const authorRel = 'plugins/' + author
    const authorFiles = LAYER2_FILES.filter((name) => isFile(join(authorDir, name)))
    verifyLayerManifest({
      layer: 'L2',
      layerRel: authorRel,
      layerDir: authorDir,
      expectedFiles: authorFiles,
      report,
      rootCaPath,
      eecPath,
      cmsReady,
      missingLevel,
      stats,
    })
    for (const plugin of listDirectoryNames(authorDir)) {
      const pluginDir = join(authorDir, plugin)
      const files = [...LAYER3_FILES]
      for (const version of readVersionList(join(pluginDir, 'versions.json'))) files.push(version + '/meta.json')
      verifyLayerManifest({
        layer: 'L3',
        layerRel: authorRel + '/' + plugin,
        layerDir: pluginDir,
        expectedFiles: files,
        report,
        rootCaPath,
        eecPath,
        cmsReady,
        missingLevel,
        stats,
      })
    }
  }
}

/**
 * 解析根证书路径。优先级:显式参数 --root-ca > 环境变量 ROOT_CA_PATH。
 * @param {object} [options] 含 rootCa 字段
 * @param {Record<string, string|undefined>} [env] 环境变量表
 * @returns {string|null} 绝对路径,未提供时返回 null
 */
export function resolveRootCaPath(options = {}, env = process.env) {
  if (typeof options.rootCa === 'string' && options.rootCa.trim().length > 0) return resolve(options.rootCa.trim())
  if (typeof env.ROOT_CA_PATH === 'string' && env.ROOT_CA_PATH.trim().length > 0) return resolve(env.ROOT_CA_PATH.trim())
  return null
}

/**
 * 校验一个合集目录。
 * @param {string} collectionDir 合集根目录
 * @param {object} [options] 选项
 * @param {string|null} [options.rootCaPath] 根证书路径,缺失时无法校验证书链与 CMS 签名
 * @param {string} [options.eecCert] 终端签名证书路径,默认 certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt
 * @param {boolean} [options.allowPlaceholderEec] 骨架模式:根证书缺失或 certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt 未由根 CA 签发时降级为警告
 * @param {string} [options.collectionName] 合集名称,默认取目录名
 * @returns {{ok: boolean, root: string, collectionName: string, errorCount: number, warningCount: number, problems: Array<object>, stats: object}}
 */
export function verifyCollection(collectionDir, options = {}) {
  const root = resolve(collectionDir)
  const problems = []
  const stats = {
    authors: 0,
    plugins: 0,
    versions: 0,
    manifests: [],
    authorSignatures: { verified: 0, failed: 0, unpaired: 0, unsigned: 0, absent: 0 },
    networkHits: 0,
  }
  const report = {
    error(code, message, path) {
      problems.push({ level: 'error', code, message, path: path ?? null })
    },
    warn(code, message, path) {
      problems.push({ level: 'warning', code, message, path: path ?? null })
    },
  }
  const skeleton = options.allowPlaceholderEec === true
  // 骨架模式与 --allow-missing-manifest 都把「清单尚未生成」降级为警告,结构与哈希检查照常执行。
  const allowMissingManifest = options.allowMissingManifest === true || skeleton
  const collectionName = options.collectionName || basename(root)
  const rootCaPath = options.rootCaPath ? resolve(options.rootCaPath) : null
  const eec = resolveEecCertPath(root, options)
  const eecPath = eec.path
  const eecRel = eec.relative

  const finish = () => {
    const errorCount = problems.filter((item) => item.level === 'error').length
    return {
      ok: errorCount === 0,
      root,
      collectionName,
      errorCount,
      warningCount: problems.length - errorCount,
      problems,
      stats,
    }
  }

  if (!isDirectory(root)) {
    report.error('ROOT_MISSING', '合集目录不存在或不是目录:' + root, root)
    return finish()
  }

  // 一、根目录必需文件
  for (const name of ROOT_REQUIRED_FILES) {
    if (!isFile(join(root, name))) report.error('ROOT_FILE_MISSING', '根目录缺少必需文件 ' + name, name)
  }

  // 二、合集元数据
  const metaPath = join(root, 'meta.json')
  const collectionMeta = isFile(metaPath) ? parseJsonFile(metaPath, '根目录 meta.json', report) : undefined
  if (isObject(collectionMeta)) {
    if (typeof collectionMeta.DOWNLOAD_COUNT_ENABLE !== 'boolean') {
      report.error('META_FIELD_INVALID', 'meta.json 的 DOWNLOAD_COUNT_ENABLE 必须是布尔值', 'meta.json')
    } else if (collectionMeta.DOWNLOAD_COUNT_ENABLE === true) {
      if (typeof collectionMeta.DOWNLOAD_COUNT_API !== 'string' || collectionMeta.DOWNLOAD_COUNT_API.length === 0) {
        report.error('META_FIELD_INVALID', '启用下载计数时 meta.json 的 DOWNLOAD_COUNT_API 必须是非空字符串', 'meta.json')
      }
      if (typeof collectionMeta.API_NEED_IP !== 'boolean') {
        report.error('META_FIELD_INVALID', '启用下载计数时 meta.json 的 API_NEED_IP 必须是布尔值', 'meta.json')
      }
    }
  } else if (collectionMeta !== undefined) {
    report.error('META_FIELD_INVALID', '根目录 meta.json 的顶层必须是对象', 'meta.json')
  }

  // 三、终端签名证书与证书链。证书放在 certs 目录,不在合集根
  const chainLevel = skeleton ? 'warn' : 'error'
  let eecParsed = false
  if (!isFile(eecPath)) {
    report.error('EEC_MISSING', '合集缺少终端签名证书 ' + eecRel, eecRel)
  } else {
    let cert = null
    try {
      cert = describeCertificate(eecPath)
      eecParsed = true
    } catch (error) {
      report.error('EEC_INVALID', eecRel + ' 不是可解析的 X.509 证书:' + error.message, eecRel)
    }
    if (cert) {
      if (!rootCaPath) {
        report[chainLevel](
          'ROOT_CA_MISSING',
          '未提供根证书,无法校验 ' + eecRel + ' 的签发链;请用 --root-ca 或环境变量 ROOT_CA_PATH 提供',
          eecRel,
        )
      } else if (!isFile(rootCaPath)) {
        report[chainLevel]('ROOT_CA_MISSING', '根证书文件不存在:' + rootCaPath, null)
      } else {
        const chain = verifyChain(eecPath, rootCaPath)
        if (!chain.ok) {
          report[chainLevel]('EEC_NOT_CHAINED', eecRel + ' 不是由给定根证书签发:' + chain.reason, eecRel)
        }
      }
      if (!cert.validNow) {
        report.error('EEC_EXPIRED', eecRel + ' 已过期,notAfter=' + String(cert.notAfter), eecRel)
      }
      if (!hasDigitalSignature(cert.keyUsage)) {
        report.error(
          'EEC_KEY_USAGE',
          eecRel + ' 的 keyUsage 不含 digitalSignature,实际为 [' + cert.keyUsage.join(', ') + ']',
          eecRel,
        )
      }
      if (cert.isCa === true) {
        report.error('EEC_IS_CA', eecRel + ' 是 CA 证书,要求 basicConstraints 为 CA:FALSE', eecRel)
      } else if (cert.isCa === null) {
        report.warn('EEC_BASIC_CONSTRAINTS', eecRel + ' 缺少 basicConstraints 扩展,建议显式声明 CA:FALSE', eecRel)
      }
    }
  }
  const cmsReady = eecParsed && Boolean(rootCaPath) && isFile(rootCaPath)

  // 四、预设标签
  const tagsPath = join(root, 'tags.json')
  let tagSet = null
  if (isFile(tagsPath)) {
    const tags = parseJsonFile(tagsPath, 'tags.json', report)
    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        report.error('TAGS_INVALID', 'tags.json 的顶层必须是字符串数组', 'tags.json')
      } else {
        const seen = new Set()
        for (const [index, tag] of tags.entries()) {
          if (typeof tag !== 'string' || tag.length === 0) {
            report.error('TAGS_INVALID', 'tags.json 第 ' + index + ' 项必须是非空字符串', 'tags.json')
            continue
          }
          if (seen.has(tag)) report.warn('TAGS_DUPLICATE', 'tags.json 存在重复标签 ' + tag, 'tags.json')
          seen.add(tag)
        }
        tagSet = seen
      }
    }
  }

  // 五、插件目录索引 plugins.json
  const pluginsIndexPath = join(root, 'plugins.json')
  const pluginsIndex = isFile(pluginsIndexPath) ? parseJsonFile(pluginsIndexPath, 'plugins.json', report) : undefined
  const entries = []
  if (pluginsIndex !== undefined) {
    if (!Array.isArray(pluginsIndex)) {
      report.error('PLUGINS_INDEX_INVALID', 'plugins.json 的顶层必须是数组', 'plugins.json')
    } else {
      const seenNames = new Set()
      for (const [index, entry] of pluginsIndex.entries()) {
        const label = 'plugins.json 第 ' + index + ' 项'
        if (!isObject(entry)) {
          report.error('PLUGINS_INDEX_INVALID', label + ' 必须是对象', 'plugins.json')
          continue
        }
        if (typeof entry.plugin_name !== 'string' || !PLUGIN_NAME_PATTERN.test(entry.plugin_name)) {
          report.error('PLUGINS_INDEX_INVALID', label + ' 的 plugin_name 不是合法的插件名', 'plugins.json')
          continue
        }
        if (typeof entry.author !== 'string' || entry.author.length === 0) {
          report.error('PLUGINS_INDEX_INVALID', label + ' 的 author 必须是非空字符串', 'plugins.json')
          continue
        }
        if (!Array.isArray(entry.tag) || entry.tag.some((tag) => typeof tag !== 'string' || tag.length === 0)) {
          report.error('PLUGINS_INDEX_INVALID', label + ' 的 tag 必须是字符串数组', 'plugins.json')
          continue
        }
        if (seenNames.has(entry.plugin_name)) {
          report.error('PLUGINS_INDEX_DUPLICATE', '插件名 ' + entry.plugin_name + ' 在 plugins.json 中重复出现', 'plugins.json')
          continue
        }
        seenNames.add(entry.plugin_name)
        if (tagSet) {
          for (const tag of entry.tag) {
            if (!tagSet.has(tag)) {
              report.error('TAG_NOT_DECLARED', '插件 ' + entry.plugin_name + ' 的标签 ' + tag + ' 未在 tags.json 中声明', 'plugins.json')
            }
          }
        }
        entries.push({ plugin_name: entry.plugin_name, author: entry.author, tag: [...entry.tag] })
      }
    }
  }

  // 六、作者清单
  const authorManifestPath = join(root, 'plugins', 'author_manifest.json')
  const registeredAuthors = new Set()
  if (!isFile(authorManifestPath)) {
    report.error('AUTHOR_MANIFEST_MISSING', 'plugins/author_manifest.json 不存在', 'plugins/author_manifest.json')
  } else {
    const manifest = parseJsonFile(authorManifestPath, 'plugins/author_manifest.json', report)
    if (manifest !== undefined) {
      if (!Array.isArray(manifest)) {
        report.error('AUTHOR_MANIFEST_INVALID', 'plugins/author_manifest.json 的顶层必须是数组', 'plugins/author_manifest.json')
      } else {
        for (const [index, item] of manifest.entries()) {
          const label = 'plugins/author_manifest.json 第 ' + index + ' 项'
          if (!isObject(item) || typeof item.username !== 'string' || item.username.length === 0) {
            report.error('AUTHOR_MANIFEST_INVALID', label + ' 缺少合法的 username', 'plugins/author_manifest.json')
            continue
          }
          if (typeof item.profile !== 'string' || item.profile.length === 0) {
            report.error('AUTHOR_MANIFEST_INVALID', label + ' 缺少合法的 profile', 'plugins/author_manifest.json')
          }
          // 作者名判定大小写不敏感:仅大小写不同的登记视为同一作者,按重复处理
          if (registeredAuthors.has(item.username.toLowerCase())) {
            report.warn('AUTHOR_MANIFEST_DUPLICATE', '作者 ' + item.username + ' 在 author_manifest.json 中重复登记', 'plugins/author_manifest.json')
          }
          registeredAuthors.add(item.username.toLowerCase())
        }
      }
    }
  }

  // 七、逐插件校验
  const authorCache = new Map()
  for (const entry of entries) {
    const author = entry.author
    if (!registeredAuthors.has(author.toLowerCase())) {
      report.warn('AUTHOR_NOT_REGISTERED', '作者 ' + author + ' 未在 plugins/author_manifest.json 中登记', 'plugins/author_manifest.json')
    }
    if (!authorCache.has(author)) {
      authorCache.set(author, inspectAuthor({ root, author, report, stats }))
    }
    const authorContext = authorCache.get(author)
    if (!authorContext) continue
    if (!authorContext.manifestPlugins.has(entry.plugin_name)) {
      report.error(
        'PLUGIN_NOT_IN_MANIFEST',
        '插件 ' + entry.plugin_name + ' 未出现在 plugins/' + author + '/plugin_manifest.json 中',
        'plugins/' + author + '/plugin_manifest.json',
      )
    }
    inspectPlugin({ authorContext, entry, report, stats, rootCaPath, eecPath, cmsReady })
  }

  for (const context of authorCache.values()) stats.authors += 1

  // 八、三层哈希清单
  verifyManifests({ root, report, stats, rootCaPath, eecPath, cmsReady, allowMissingManifest })

  return finish()
}

function inspectAuthor({ root, author, report, stats }) {
  const authorRel = 'plugins/' + author
  const authorDir = join(root, 'plugins', author)
  if (!isDirectory(authorDir)) {
    report.error('AUTHOR_DIR_MISSING', '作者目录不存在:' + authorRel, authorRel)
    return null
  }
  const pubRel = authorRel + '/' + AUTHOR_PUB_FILE
  const pubPath = join(authorDir, AUTHOR_PUB_FILE)
  let publicKeyUsable = false
  if (!isFile(pubPath)) {
    report.warn(
      'AUTHOR_PUB_MISSING',
      '作者公钥不存在:' + pubRel + ',该作者的作者签名一律判为未校验(作者层只警告,不阻断收录)',
      pubRel,
    )
  } else {
    try {
      const info = describePublicKey(pubPath)
      publicKeyUsable = true
      if (info.type !== 'ed25519') {
        report.warn('AUTHOR_PUB_TYPE', pubRel + ' 不是 Ed25519 公钥,约定作者密钥为 Ed25519,实际为 ' + info.firstLine, pubRel)
      }
    } catch (error) {
      report.error('AUTHOR_PUB_INVALID', pubRel + ' 不是合法的 PEM 公钥:' + error.message, pubRel)
    }
  }
  const manifestRel = authorRel + '/plugin_manifest.json'
  const manifestPath = join(authorDir, 'plugin_manifest.json')
  const manifestPlugins = new Set()
  if (!isFile(manifestPath)) {
    report.error('PLUGIN_MANIFEST_MISSING', '作者插件清单不存在:' + manifestRel, manifestRel)
  } else {
    const manifest = parseJsonFile(manifestPath, manifestRel, report)
    if (manifest !== undefined) {
      if (!Array.isArray(manifest)) {
        report.error('PLUGIN_MANIFEST_INVALID', manifestRel + ' 的顶层必须是插件名数组', manifestRel)
      } else {
        for (const [index, name] of manifest.entries()) {
          if (typeof name !== 'string' || !PLUGIN_NAME_PATTERN.test(name)) {
            report.error('PLUGIN_MANIFEST_INVALID', manifestRel + ' 第 ' + index + ' 项不是合法的插件名', manifestRel)
            continue
          }
          manifestPlugins.add(name)
        }
      }
    }
  }
  return { author, authorDir, authorRel, pubPath, pubRel, publicKeyUsable, manifestPlugins, stats }
}

function inspectPlugin({ authorContext, entry, report, stats, rootCaPath, eecPath, cmsReady }) {
  const { author, authorDir, authorRel, pubPath, pubRel, publicKeyUsable } = authorContext
  const dirName = entry.plugin_name.split('/').pop()
  const pluginRel = authorRel + '/' + dirName
  const pluginDir = join(authorDir, dirName)
  if (!isDirectory(pluginDir)) {
    report.error('PLUGIN_DIR_MISSING', '插件目录不存在:' + pluginRel, pluginRel)
    return
  }
  stats.plugins += 1

  const versionsRel = pluginRel + '/versions.json'
  const versionsPath = join(pluginDir, 'versions.json')
  if (!isFile(versionsPath)) {
    report.error('VERSIONS_MISSING', '插件目录缺少 versions.json:' + versionsRel, versionsRel)
    return
  }
  const versionsData = parseJsonFile(versionsPath, versionsRel, report)
  if (versionsData === undefined) return
  if (!isObject(versionsData)) {
    report.error('VERSIONS_INVALID', versionsRel + ' 的顶层必须是对象', versionsRel)
    return
  }
  const versionList = Array.isArray(versionsData.versions) ? versionsData.versions : null
  if (!versionList || versionList.length === 0) {
    report.error('VERSIONS_INVALID', versionsRel + ' 的 versions 必须是非空数组', versionsRel)
    return
  }
  for (const version of versionList) {
    if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
      report.error('VERSIONS_INVALID', versionsRel + ' 含非法版本号 ' + JSON.stringify(version), versionsRel)
    }
  }
  if (typeof versionsData.latest !== 'string' || !SEMVER_PATTERN.test(versionsData.latest)) {
    report.error('VERSIONS_INVALID', versionsRel + ' 的 latest 不是合法版本号', versionsRel)
  } else if (!versionList.includes(versionsData.latest)) {
    report.error('LATEST_NOT_LISTED', versionsRel + ' 的 latest ' + versionsData.latest + ' 不在 versions 列表内', versionsRel)
  }

  /** 各版本的作者签名判定结果,循环结束后按插件汇总一次 */
  const authorSignatures = []
  for (const version of versionList) {
    if (typeof version !== 'string') continue
    const versionRel = pluginRel + '/' + version
    const versionDir = join(pluginDir, version)
    if (!isDirectory(versionDir)) {
      report.error('VERSION_DIR_MISSING', '版本目录不存在:' + versionRel, versionRel)
      continue
    }
    stats.versions += 1
    for (const name of VERSION_REQUIRED_FILES) {
      if (!isFile(join(versionDir, name))) {
        report.error('VERSION_FILE_MISSING', versionRel + ' 缺少必需文件 ' + name, versionRel + '/' + name)
      }
    }
    inspectVersionMeta({ versionDir, versionRel, version, pluginName: entry.plugin_name, report })
    inspectVersionNetwork({ versionDir, versionRel, report, stats })
    authorSignatures.push(
      inspectVersionSignatures({
        version,
        versionDir,
        versionRel,
        report,
        rootCaPath,
        eecPath,
        cmsReady,
        authorPubPath: pubPath,
        authorPubRel: pubRel,
        authorPubUsable: publicKeyUsable,
        author,
        stats,
      }),
    )
  }
  reportAuthorSignatureCoverage({ pluginRel, statuses: authorSignatures, report })
}

function inspectVersionMeta({ versionDir, versionRel, version, pluginName, report }) {
  const metaPath = join(versionDir, 'meta.json')
  if (!isFile(metaPath)) return
  const meta = parseJsonFile(metaPath, versionRel + '/meta.json', report)
  if (meta === undefined) return
  if (!isObject(meta)) {
    report.error('PLUGIN_META_INVALID', versionRel + '/meta.json 的顶层必须是对象', versionRel + '/meta.json')
    return
  }
  if (meta.name !== pluginName) {
    report.error('PLUGIN_META_MISMATCH', versionRel + '/meta.json 的 name 为 ' + JSON.stringify(meta.name) + ',与插件目录索引 plugins.json 中登记的 ' + pluginName + ' 不一致', versionRel + '/meta.json')
  }
  if (meta.version !== version) {
    report.error('PLUGIN_META_MISMATCH', versionRel + '/meta.json 的 version 为 ' + JSON.stringify(meta.version) + ',与目录名 ' + version + ' 不一致', versionRel + '/meta.json')
  }
}

/**
 * 静态扫描一个版本的 plugin.js:插件自行联网不符合约定。
 *
 * 只读产物文本,不做运行时拦截;命中只报警告,不阻断收录、不改变退出码。
 * 这是收录契约而不是沙箱:扫描只提示写法,插件运行期是否联网不受它约束。
 * 命中一条报一条,每条都带命中的字面量与行列位置;插件转发或包装 context.net 不受影响,
 * 判定口径见 lib/plugin-network-scan.mjs。
 * 单个文件最多逐条报 MAX_NETWORK_HITS 条,其余汇总成一条,避免问题列表被同一个文件刷屏。
 * @param {object} context 上下文
 * @param {string} context.versionDir 版本目录
 * @param {string} context.versionRel 版本目录的相对路径
 * @param {object} context.report 问题收集器
 * @param {object} context.stats 统计对象
 */
function inspectVersionNetwork({ versionDir, versionRel, report, stats }) {
  const jsPath = join(versionDir, 'plugin.js')
  if (!isFile(jsPath)) return
  const rel = versionRel + '/plugin.js'
  let scan
  try {
    scan = scanPluginFile(jsPath, { relative: rel })
  } catch (error) {
    report.error('PLUGIN_SCAN_FAILED', rel + ' 读取失败,无法做网络自建扫描:' + error.message, rel)
    return
  }
  if (scan.total === 0) return
  stats.networkHits += scan.total
  for (const hit of scan.hits.slice(0, MAX_NETWORK_HITS)) {
    report.warn(
      PLUGIN_NETWORK_SELFTALK,
      rel + ' ' + describeNetworkHit(hit) + '：' + NETWORK_SELFTALK_ADVICE,
      rel,
    )
  }
  if (scan.total > MAX_NETWORK_HITS) {
    report.warn(
      PLUGIN_NETWORK_SELFTALK,
      rel + ' 另有 ' + (scan.total - MAX_NETWORK_HITS) + ' 处网络自建调用未逐条列出,合计 ' + scan.total + ' 处',
      rel,
    )
  }
}

/**
 * 校验一个版本的合集 CMS 签名与作者签名,返回作者签名的判定结果。
 * 作者签名可选,从不阻断收录:验败只警告,公钥与签名两侧缺一都判为未校验。
 * @returns {{version: string, status: string}} 该作者签名判定结果
 */
function inspectVersionSignatures({ version, versionDir, versionRel, report, rootCaPath, eecPath, cmsReady, authorPubPath, authorPubRel, authorPubUsable, author, stats }) {
  // 合集 CMS 签名:版本目录只剩 plugin.js.sig,meta.json 由 L3 清单覆盖
  for (const name of VERSION_SIGNED_FILES) {
    const filePath = join(versionDir, name)
    if (!isFile(filePath)) continue
    const rel = versionRel + '/' + name
    const sigPath = cmsSignaturePath(filePath)
    if (!isFile(sigPath)) {
      // 缺签名文件已由 VERSION_REQUIRED_FILES 报错,这里不重复
    } else if (!cmsReady) {
      report.warn('SIGN_UNVERIFIABLE', rel + '.sig 无法校验,缺少根证书或终端签名证书', rel + '.sig')
    } else {
      const result = verifyFileCms(filePath, sigPath, rootCaPath, eecPath)
      if (!result.ok) {
        report.error('SIGN_VERIFY_FAILED', rel + '.sig 校验失败,文件内容可能已被篡改:' + String(result.reason), rel + '.sig')
      }
    }
  }

  // 作者分离签名:可选证据,只警告不阻断。公钥与签名两侧缺一不可,单侧缺失判为未校验
  let authorSignature = { version, status: 'absent' }
  for (const name of VERSION_AUTHOR_SIGNED_FILES) {
    const filePath = join(versionDir, name)
    if (!isFile(filePath)) continue
    const authorSigPath = authorSignaturePath(filePath)
    const authorRel = versionRel + '/' + name + '.author.sig'
    const hasSignature = isFile(authorSigPath)
    let verified = false
    let reason = null
    if (hasSignature && authorPubUsable) {
      const result = verifyFileAuthor(filePath, authorSigPath, authorPubPath)
      verified = result.ok
      reason = result.reason
    }
    const status = classifyAuthorSignature({ hasSignature, hasPublicKey: authorPubUsable, verified })
    authorSignature = { version, status }
    stats.authorSignatures[status] += 1
    if (status === 'unpaired') {
      report.warn(
        'AUTHOR_SIGN_UNPAIRED',
        authorRel + ' 存在,但 ' + authorPubRel + ' 缺失或不可用:只有签名没有公钥,作者签名判为' +
          AUTHOR_SIGNATURE_VERDICT.unpaired + ',不计为通过;作者层只警告,不阻断收录',
        authorRel,
      )
    } else if (status === 'failed') {
      report.warn(
        'AUTHOR_SIGN_FAILED',
        authorRel + ' 校验失败,作者 ' + author + ' 的签名与文件不匹配,作者签名判为' +
          AUTHOR_SIGNATURE_VERDICT.failed + ',仅警告不阻断收录:' + String(reason),
        authorRel,
      )
    }
  }
  return authorSignature
}

/**
 * 按插件汇总作者签名的覆盖情况。
 *
 * 作者签名可选,因此「只有公钥、没有签名」不逐版本刷警告,只在插件层汇总一条:
 * 这些版本判为未校验,不计为通过。理由见 README「作者自签名」一节:
 * 合集已在登记侧审核过作者与插件,作者签名只是附加证据,不阻断收录。
 * @param {object} context 上下文
 * @param {string} context.pluginRel 插件目录相对路径
 * @param {Array<{version: string, status: string}>} context.statuses 各版本的判定结果
 * @param {object} context.report 报告器
 * @returns {void}
 */
function reportAuthorSignatureCoverage({ pluginRel, statuses, report }) {
  const unsigned = statuses.filter((item) => item.status === 'unsigned').map((item) => item.version)
  if (unsigned.length === 0) return
  const signed = statuses.filter((item) => item.status === 'verified' || item.status === 'failed').length
  const detail =
    signed === 0
      ? '全部 ' + unsigned.length + ' 个版本都只有作者公钥、没有 plugin.js.author.sig'
      : '版本 ' + unsigned.join('、') + ' 只有作者公钥、没有 plugin.js.author.sig'
  report.warn(
    'AUTHOR_SIGN_UNVERIFIED',
    pluginRel + ' 的' + detail + ',作者签名判为' + AUTHOR_SIGNATURE_VERDICT.unsigned +
      ',不计为通过;作者签名可选,不阻断收录',
    pluginRel,
  )
}

/**
 * 把问题列表格式化为可读文本。
 * @param {Array<object>} problems 问题列表
 * @returns {string}
 */
export function formatProblems(problems) {
  return problems
    .map((item) => {
      const level = item.level === 'error' ? '[错误]' : '[警告]'
      const location = item.path ? ' (' + item.path + ')' : ''
      return level + ' ' + item.code + ' ' + item.message + location
    })
    .join('\n')
}
