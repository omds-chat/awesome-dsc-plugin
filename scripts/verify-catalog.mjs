#!/usr/bin/env node
/**
 * 仓库级校验:只查 catalog/ 与 certs/,不碰任何分发包内容。
 *
 * 本仓库不再在根目录保存 pages 包的基线文件(datalog.json、manifest.json、plugins/),
 * 因此仓库级校验只看两处源数据:
 *   catalog/   收录登记(author.json、author_pub.pem、plugin.json、removed.json)
 *   certs/     信任材料(合集终端签名证书,可选配对公钥)
 * 合集设置(site/meta.json、site/tags.json)只用于标签取值判断,不做结构以外的检查。
 *
 * 构建出的 pages 包由 verify-bundle.mjs 校验:三层清单、清单签名、产物签名与收录信息交叉一致性。
 *
 * 用法:
 *   node scripts/verify-catalog.mjs
 *   node scripts/verify-catalog.mjs --catalog catalog --certs certs --tags site/tags.json
 *   ROOT_CA_PATH=root_ca.crt node scripts/verify-catalog.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatProblems } from './lib/collection-verify.mjs'
import { problem } from './lib/layer-manifests.mjs'
import { readCatalog } from './lib/catalog.mjs'
import {
  EEC_CERT_BASENAME,
  describeCertificate,
  describePublicKey,
  hasDigitalSignature,
  opensslVersion,
  verifyChain,
} from './pki.mjs'

/** 已下架插件清单文件名 */
const REMOVED_FILE = 'removed.json'
/** 与 EEC 私钥配对的公钥材料文件名,可选 */
const SECRET_PUB_FILE = 'awesome-dsc-plugin-secret.pub'
/** 插件名合法形式:与 lib/catalog.mjs 保持一致 */
const PLUGIN_NAME_PATTERN = /^(?:dsc-[a-z0-9][a-z0-9._-]*|@[a-z0-9][a-z0-9._-]*\/dsc-[a-z0-9][a-z0-9._-]*)$/
/** removed.json 每条记录必填字段,与 schemas/catalog-removed.schema.json 一致 */
const REMOVED_REQUIRED_FIELDS = ['name', 'base_url', 'removed_in']
/** removed.json 的可选字段 */
const REMOVED_OPTIONAL_FIELDS = ['note']

function usage() {
  process.stdout.write([
    '用法: node scripts/verify-catalog.mjs [选项]',
    '',
    '选项:',
    '  --catalog <目录>   catalog 目录,默认 catalog',
    '  --certs <目录>     证书目录,默认 certs',
    '  --tags <文件>      预设标签来源,默认 site/tags.json',
    '  --root-ca <路径>   根证书路径,给出时校验合集证书的签发链',
    '  --json             以 JSON 输出校验结果',
    '  --help             显示本说明',
    '',
    '环境变量:',
    '  ROOT_CA_PATH       根证书路径,等价于 --root-ca',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    catalog: 'catalog',
    certs: 'certs',
    tags: join('site', 'tags.json'),
    rootCa: null,
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
      case '--tags': options.tags = take(); break
      case '--root-ca': options.rootCa = take(); break
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

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function readJson(path, label, problems) {
  try {
    return { ok: true, data: JSON.parse(readFileSync(path, 'utf8')), error: null }
  } catch (error) {
    problems.push(problem('error', 'CATALOG_JSON_INVALID', label + ' 不是合法 JSON:' + error.message, label))
    return { ok: false, data: null, error: error.message }
  }
}

/**
 * 读取预设标签清单:不存在按错误处理,结构不合法记错误。
 * 标签取值以这份清单为准,仓库级校验必须能读到它。
 */
function readPresetTags(path, problems) {
  if (!isFile(path)) {
    problems.push(problem('error', 'TAGS_FILE_MISSING', '预设标签文件不存在:' + path, 'site/tags.json'))
    return null
  }
  const result = readJson(path, 'site/tags.json', problems)
  if (!result.ok) return null
  if (!Array.isArray(result.data)) {
    problems.push(problem('error', 'TAGS_INVALID', 'tags.json 的顶层必须是字符串数组', 'site/tags.json'))
    return null
  }
  const seen = new Set()
  let valid = true
  for (const tag of result.data) {
    if (typeof tag !== 'string' || tag.trim().length === 0) {
      problems.push(problem('error', 'TAGS_INVALID', 'tags.json 含非字符串或空标签', 'site/tags.json'))
      valid = false
      continue
    }
    if (seen.has(tag)) {
      problems.push(problem('error', 'TAGS_DUPLICATE', 'tags.json 含重复标签 ' + tag, 'site/tags.json'))
      valid = false
    }
    seen.add(tag)
  }
  return valid ? result.data : null
}

/** 每个插件声明的标签都必须落在预设清单内。 */
function checkPresetTags({ plugins, presetTags, problems }) {
  if (presetTags === null) return
  const allowed = new Set(presetTags)
  for (const plugin of plugins) {
    for (const tag of plugin.tags) {
      if (!allowed.has(tag)) {
        problems.push(
          problem(
            'error',
            'PLUGIN_TAG_UNKNOWN',
            '插件 ' + plugin.name + '(作者 ' + plugin.author + ')的标签 ' + JSON.stringify(tag) + ' 不在 site/tags.json 的预设清单内',
            plugin.pluginRel + '/plugin.json',
          ),
        )
      }
    }
  }
}

/**
 * 校验 removed.json:结构、字段取值、重复登记,以及「已下架却又在登记表里」的矛盾。
 * 版本层不在 catalog 登记,所以插件目录下出现子目录时只给警告,提示删除占位或残留的版本目录。
 */
function checkRemoved({ catalogDir, plugins, problems }) {
  const path = join(catalogDir, REMOVED_FILE)
  const rel = 'catalog/' + REMOVED_FILE
  const registered = new Set(plugins.map((plugin) => plugin.name))
  if (!isFile(path)) {
    problems.push(problem('error', 'REMOVED_FILE_MISSING', '缺少已下架插件清单:' + rel, rel))
    return 0
  }
  const result = readJson(path, rel, problems)
  if (!result.ok) return 0
  if (!Array.isArray(result.data)) {
    problems.push(problem('error', 'REMOVED_SHAPE', rel + ' 的顶层必须是数组', rel))
    return 0
  }
  const seen = new Set()
  for (const [index, entry] of result.data.entries()) {
    const label = rel + ' 第 ' + (index + 1) + ' 项'
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(problem('error', 'REMOVED_SHAPE', label + ' 必须是对象', rel))
      continue
    }
    let valid = true
    for (const field of REMOVED_REQUIRED_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
        problems.push(problem('error', 'REMOVED_FIELD_INVALID', label + ' 的 ' + field + ' 必须是非空字符串', rel))
        valid = false
      }
    }
    if (typeof entry.note === 'string' && entry.note.trim().length === 0) {
      problems.push(problem('error', 'REMOVED_FIELD_INVALID', label + ' 的 note 给出时必须是非空字符串', rel))
      valid = false
    }
    for (const key of Object.keys(entry)) {
      if (!REMOVED_REQUIRED_FIELDS.includes(key) && !REMOVED_OPTIONAL_FIELDS.includes(key)) {
        problems.push(problem('error', 'REMOVED_FIELD_UNKNOWN', label + ' 含 schema 之外的字段 ' + key, rel))
        valid = false
      }
    }
    if (!valid) continue
    if (!PLUGIN_NAME_PATTERN.test(entry.name)) {
      problems.push(problem('error', 'REMOVED_NAME_INVALID', label + ' 的 name 不是合法插件名:' + JSON.stringify(entry.name), rel))
      continue
    }
    if (!/^https?:\/\/[^\s]+$/.test(entry.base_url) || !entry.base_url.endsWith('/')) {
      problems.push(problem('error', 'REMOVED_BASE_URL_INVALID', label + ' 的 base_url 必须是 http(s) 绝对地址且以斜杠结尾:' + JSON.stringify(entry.base_url), rel))
      continue
    }
    if (seen.has(entry.name)) {
      problems.push(problem('error', 'REMOVED_DUPLICATE', '插件 ' + entry.name + ' 在 ' + rel + ' 中重复登记', rel))
      continue
    }
    seen.add(entry.name)
    if (registered.has(entry.name)) {
      problems.push(problem('error', 'REMOVED_STILL_REGISTERED', '插件 ' + entry.name + ' 已记入 ' + rel + ',但在 catalog 里仍有登记', rel))
    }
  }
  return result.data.length
}

/** 插件目录下不应出现版本目录:版本由 CI 从 base_url 发现,仓库只放 plugin.json。 */
function checkPluginDirectories(plugins, problems) {
  let leftovers = 0
  for (const plugin of plugins) {
    let entries
    try {
      entries = readdirSync(plugin.pluginDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      leftovers += 1
      problems.push(
        problem(
          'warning',
          'PLUGIN_VERSION_DIR',
          plugin.pluginRel + '/' + entry.name + ' 是版本目录,catalog 只登记 plugin.json,版本由构建从 base_url 发现',
          plugin.pluginRel + '/' + entry.name,
        ),
      )
    }
  }
  return leftovers
}

/**
 * 校验 certs/:合集证书必须存在、未过期、keyUsage 含 digitalSignature、basicConstraints 不是 CA;
 * 给出根证书时还要校验签发链。配对公钥可选,存在就必须能被 OpenSSL 解析。
 */
function checkCerts({ certsDir, rootCaPath, problems }) {
  const stats = { eecCert: false, secretPub: false, chainChecked: false }
  if (!isDirectory(certsDir)) {
    problems.push(problem('error', 'CERTS_DIR_MISSING', '证书目录不存在:' + certsDir, 'certs'))
    return stats
  }

  const eecPath = join(certsDir, EEC_CERT_BASENAME)
  const eecRel = 'certs/' + EEC_CERT_BASENAME
  if (!isFile(eecPath)) {
    problems.push(problem('error', 'EEC_CERT_MISSING', '缺少合集终端签名证书:' + eecRel, eecRel))
  } else {
    stats.eecCert = true
    try {
      const info = describeCertificate(eecPath)
      if (!info.validNow) {
        problems.push(problem('error', 'EEC_CERT_EXPIRED', eecRel + ' 已过期:' + String(info.notAfter), eecRel))
      }
      if (info.isCa === true) {
        problems.push(problem('error', 'EEC_CERT_IS_CA', eecRel + ' 的 basicConstraints 是 CA:TRUE,终端证书必须是非 CA', eecRel))
      }
      if (!hasDigitalSignature(info.keyUsage)) {
        problems.push(problem('error', 'EEC_CERT_KEY_USAGE', eecRel + ' 的 keyUsage 缺少 digitalSignature', eecRel))
      }
    } catch (error) {
      problems.push(problem('error', 'EEC_CERT_INVALID', eecRel + ' 无法解析:' + error.message, eecRel))
    }

    if (rootCaPath) {
      const chain = verifyChain(eecPath, rootCaPath)
      if (!chain.ok) {
        problems.push(problem('error', 'EEC_CHAIN_INVALID', eecRel + ' 未由给定根证书签发:' + String(chain.reason), eecRel))
      } else {
        stats.chainChecked = true
      }
    } else {
      problems.push(problem('warning', 'ROOT_CA_MISSING', '未提供根证书(--root-ca 或 ROOT_CA_PATH),跳过 ' + eecRel + ' 的签发链校验', eecRel))
    }
  }

  const pubPath = join(certsDir, SECRET_PUB_FILE)
  const pubRel = 'certs/' + SECRET_PUB_FILE
  if (isFile(pubPath)) {
    stats.secretPub = true
    try {
      const info = describePublicKey(pubPath)
      if (info.type !== 'ec') {
        problems.push(problem('warning', 'EEC_PUB_TYPE', pubRel + ' 不是 EC 公钥,约定 EEC 密钥为 ECDSA P-256,实际首行为 ' + info.firstLine, pubRel))
      }
    } catch (error) {
      problems.push(problem('error', 'EEC_PUB_INVALID', pubRel + ' 不是合法的 PEM 公钥:' + error.message, pubRel))
    }
  }
  return stats
}

function main() {
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

  try {
    const version = opensslVersion()
    if (version.major < 3) {
      process.stderr.write('校验失败:需要 OpenSSL 3.0 及以上,当前为 ' + version.text + '\n')
      return 2
    }
  } catch (error) {
    process.stderr.write('校验失败:' + error.message + '\n')
    return 2
  }

  const catalogDir = resolve(options.catalog)
  const certsDir = resolve(options.certs)
  const tagsPath = resolve(options.tags)
  const rootCaPath = options.rootCa ? resolve(options.rootCa) : process.env.ROOT_CA_PATH ? resolve(process.env.ROOT_CA_PATH) : null

  const problems = []
  const presetTags = readPresetTags(tagsPath, problems)
  const catalog = readCatalog({ catalogDir, problems })
  checkPresetTags({ plugins: catalog.plugins, presetTags, problems })
  const removedCount = checkRemoved({ catalogDir, plugins: catalog.plugins, problems })
  const leftovers = checkPluginDirectories(catalog.plugins, problems)
  const certStats = checkCerts({ certsDir, rootCaPath, problems })

  const errors = problems.filter((item) => item.level === 'error')
  const warnings = problems.filter((item) => item.level === 'warning')

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: errors.length === 0,
          catalogDir,
          certsDir,
          tagsPath,
          rootCaPath,
          authors: catalog.authors.length,
          plugins: catalog.plugins.length,
          removed: removedCount,
          versionDirWarnings: leftovers,
          certs: certStats,
          problems,
        },
        null,
        2,
      ) + '\n',
    )
  } else {
    if (problems.length > 0) process.stdout.write(formatProblems(problems) + '\n')
    const summary =
      'catalog 作者 ' + catalog.authors.length + ' 个,' +
      '插件 ' + catalog.plugins.length + ' 个,' +
      'removed.json 记录 ' + removedCount + ' 条,' +
      'certs/ 证书 ' + (certStats.eecCert ? '1 份' : '0 份') +
      (certStats.chainChecked ? '(已校验签发链)' : '')
    if (errors.length === 0) {
      process.stdout.write('catalog 校验通过 ' + summary + ',警告 ' + warnings.length + ' 条\n')
    } else {
      process.stdout.write('catalog 校验未通过 ' + summary + ',错误 ' + errors.length + ' 条,警告 ' + warnings.length + ' 条\n')
    }
  }

  return errors.length === 0 ? 0 : 1
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('校验失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
