/**
 * catalog/ 与 certs/ 的仓库级检查。
 *
 * verify-catalog.mjs(仓库级强校验)与 scripts/check-*.mjs(维护者自查)共用本模块,
 * 规则只写一份:自查脚本只负责编排与输出 JSON,不重复实现判定逻辑。
 * 本模块只读取文件,不修改任何内容。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AUTHOR_NAME_PATTERN, describeAuthorNameProblem } from './catalog.mjs'
import { problem } from './layer-manifests.mjs'
import {
  EEC_CERT_REL_IN_CERTS,
  EEC_PUB_REL_IN_CERTS,
  describeCertificate,
  describePublicKey,
  hasDigitalSignature,
  verifyChain,
} from '../pki.mjs'

/** 已下架插件清单文件名 */
export const REMOVED_FILE = 'removed.json'
/** 插件名合法形式:与 lib/catalog.mjs 保持一致 */
export const PLUGIN_NAME_PATTERN = /^(?:dsc-[a-z0-9][a-z0-9._-]*|@[a-z0-9][a-z0-9._-]*\/dsc-[a-z0-9][a-z0-9._-]*)$/
/** removed.json 每条记录必填字段,与 schemas/catalog-removed.schema.json 一致 */
export const REMOVED_REQUIRED_FIELDS = ['name', 'base_url', 'removed_in']
/** removed.json 的可选字段 */
export const REMOVED_OPTIONAL_FIELDS = ['note']

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
 * @param {string} path site/tags.json 路径
 * @param {Array<object>} problems 问题收集数组
 * @returns {string[]|null} 合法时返回标签数组
 */
export function readPresetTags(path, problems) {
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

/**
 * 校验 catalog/ 下的作者目录名:必须符合 GitHub 用户名规则。
 * 目录名同时是 author.json 的 username 与 pages 包里 plugins/<作者>/ 的目录名,
 * 名字不合法会同时污染登记与分发路径,所以按错误处理。
 * 大小写不敏感的唯一性由 lib/catalog.mjs 的 readCatalog 报(AUTHOR_NAME_COLLISION)。
 * @param {object} context 上下文
 * @param {string} context.catalogDir catalog 根目录
 * @param {Array<object>} context.problems 问题收集数组
 * @returns {number} 不合法的目录数
 */
export function checkAuthorNames({ catalogDir, problems }) {
  if (!isDirectory(catalogDir)) return 0
  const entries = readdirSync(catalogDir, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))
  let invalid = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (AUTHOR_NAME_PATTERN.test(entry.name)) continue
    invalid += 1
    problems.push(
      problem(
        'error',
        'AUTHOR_NAME_INVALID',
        'catalog/' + entry.name + ' 的目录名 ' + JSON.stringify(entry.name) + ' 不是合法作者名:' + describeAuthorNameProblem(entry.name) +
          ';作者名按 GitHub 用户名规则校验,只允许字母、数字与连字符,不得以连字符开头或结尾,长度 1 到 39 字符',
        'catalog/' + entry.name,
      ),
    )
  }
  return invalid
}

/**
 * 每个插件声明的标签都必须落在预设清单内。
 * @param {object} context 上下文
 * @param {Array<object>} context.plugins catalog 读到的插件
 * @param {string[]|null} context.presetTags 预设标签;为 null 时跳过
 * @param {Array<object>} context.problems 问题收集数组
 */
export function checkPresetTags({ plugins, presetTags, problems }) {
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
 * @param {object} context 上下文
 * @param {string} context.catalogDir catalog 根目录
 * @param {Array<object>} context.plugins catalog 读到的插件
 * @param {Array<object>} context.problems 问题收集数组
 * @returns {number} 记录条数
 */
export function checkRemoved({ catalogDir, plugins, problems }) {
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

/**
 * 插件目录下不应出现版本目录:版本由 CI 从 base_url 发现,仓库只放 plugin.json。
 * @param {Array<object>} plugins catalog 读到的插件
 * @param {Array<object>} problems 问题收集数组
 * @returns {number} 残留版本目录数
 */
export function checkPluginDirectories(plugins, problems) {
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
 * 校验 certs/ 的目录布局:certs/ 下只允许来源文件夹,证书与公钥放在 certs/<来源 id>/<文件名>;
 * 文件夹名即来源 id,目录内的文件名必须以 <来源 id>- 开头,
 * 且只允许证书(.crt)与公钥(.pub),私钥一律不得入库。
 * @param {object} context 上下文
 * @param {string} context.certsDir 证书目录
 * @param {Array<object>} context.problems 问题收集数组
 * @returns {void}
 */
export function checkCertsLayout({ certsDir, problems }) {
  for (const entry of readdirSync(certsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      problems.push(
        problem(
          'error',
          'CERTS_STRAY_FILE',
          'certs/ 下只允许来源文件夹,' + entry.name + ' 应放进 certs/<来源 id>/',
          'certs/' + entry.name,
        ),
      )
      continue
    }
    const sourceId = entry.name
    for (const file of readdirSync(join(certsDir, sourceId), { withFileTypes: true })) {
      const rel = 'certs/' + sourceId + '/' + file.name
      if (file.isDirectory()) {
        problems.push(
          problem('error', 'CERTS_NESTED_DIR', rel + ' 不要再嵌套目录,certs/ 只有 certs/<来源 id>/<文件名> 两层', rel),
        )
        continue
      }
      if (!file.name.startsWith(sourceId + '-')) {
        problems.push(
          problem('error', 'CERTS_FILE_NAME', rel + ' 的文件名必须以 ' + sourceId + '- 开头', rel),
        )
      }
      if (!file.name.endsWith('.crt') && !file.name.endsWith('.pub')) {
        problems.push(
          problem('error', 'CERTS_PRIVATE_MATERIAL', rel + ' 既不是证书(.crt)也不是公钥(.pub),certs/ 不得存放私钥', rel),
        )
      }
    }
  }
}

/**
 * 校验 certs/:合集证书必须存在、未过期、keyUsage 含 digitalSignature、basicConstraints 不是 CA;
 * 给出根证书时还要校验签发链。配对公钥可选,存在就必须能被 OpenSSL 解析。
 * @param {object} context 上下文
 * @param {string} context.certsDir 证书目录
 * @param {string|null} context.rootCaPath 根证书路径
 * @param {Array<object>} context.problems 问题收集数组
 * @returns {{eecCert: boolean, secretPub: boolean, chainChecked: boolean}} 统计
 */
export function checkCerts({ certsDir, rootCaPath, problems }) {
  const stats = { eecCert: false, secretPub: false, chainChecked: false }
  if (!isDirectory(certsDir)) {
    problems.push(problem('error', 'CERTS_DIR_MISSING', '证书目录不存在:' + certsDir, 'certs'))
    return stats
  }

  checkCertsLayout({ certsDir, problems })

  const eecPath = join(certsDir, EEC_CERT_REL_IN_CERTS)
  const eecRel = 'certs/' + EEC_CERT_REL_IN_CERTS
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

  const pubPath = join(certsDir, EEC_PUB_REL_IN_CERTS)
  const pubRel = 'certs/' + EEC_PUB_REL_IN_CERTS
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
