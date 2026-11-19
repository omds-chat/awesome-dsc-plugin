/**
 * catalog 读取与插件站点拉取。
 *
 * catalog 只登记作者与其插件,不含任何产物:
 *   catalog/<作者>/author.json        {username, profile}
 *   catalog/<作者>/author_pub.pem     作者公钥,PEM
 *   catalog/<作者>/<插件>/plugin.json {name, description, license, repo_link, base_url, tags?}
 *
 * plugin.json 的 tags 是可选字符串数组,省略等价于空数组;元素必须是非空字符串且不重复。
 * 标签取值是否属于仓库根 tags.json 的预设清单,由构建脚本另行校验,本模块只校验结构。
 *
 * 版本内容只有一种来源:插件作者自己发布的 base_url 站点。
 * 本模块不读 Release 资产,也不读任何镜像。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describePublicKey } from '../pki.mjs'
import { problem } from './layer-manifests.mjs'

/** 作者登记文件名 */
export const AUTHOR_FILE = 'author.json'
/** 作者公钥文件名 */
export const AUTHOR_PUB_FILE = 'author_pub.pem'
/** 插件登记文件名 */
export const PLUGIN_FILE = 'plugin.json'
/** 版本列表文件名 */
export const VERSIONS_FILE = 'versions.json'
/** plugin.js 字节上限:1 MB */
export const MAX_PLUGIN_BYTES = 1024 * 1024
/** 作者签名文件字节上限 */
export const MAX_SIGNATURE_BYTES = 64 * 1024
/** 远程请求默认超时 */
export const DEFAULT_TIMEOUT_MS = 30000

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const PLUGIN_NAME_PATTERN = /^(?:dsc-[a-z0-9][a-z0-9._-]*|@[a-z0-9][a-z0-9._-]*\/dsc-[a-z0-9][a-z0-9._-]*)$/
const PLUGIN_FIELDS = ['name', 'description', 'license', 'repo_link', 'base_url']
/** plugin.json 的可选字段:省略等价于空数组 */
const PLUGIN_OPTIONAL_FIELDS = ['tags']
/** catalog 根目录允许出现的说明与登记文件,不按登记格式解析 */
const CATALOG_ROOT_FILES = ['README.md', 'removed.json']

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

/** 按 x.y.z 比较两个版本号,返回负数表示 a 小于 b。 */
export function compareVersions(left, right) {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

function trimSlash(url) {
  return String(url).replace(/\/+$/, '')
}

function readJsonFile(path, label, problems) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    problems.push(problem('error', 'CATALOG_JSON_INVALID', label + ' 不是合法 JSON:' + error.message, label))
    return undefined
  }
}

/**
 * 校验 plugin.json 的可选 tags:字符串数组,元素非空且不重复,省略等价于空数组。
 * 结构不合法时记 error 并返回 null,调用方跳过该插件;取值是否属于预设清单不在这里判断。
 * @param {any} data plugin.json 内容
 * @param {string} label 报错用路径
 * @param {Array<object>} problems 问题收集数组
 * @returns {string[]|null} 标签数组,或 null 表示结构不合法
 */
function readPluginTags(data, label, problems) {
  if (!Object.prototype.hasOwnProperty.call(data, 'tags')) return []
  const tags = data.tags
  if (!Array.isArray(tags)) {
    problems.push(problem('error', 'PLUGIN_TAGS_INVALID', label + ' 的 tags 必须是字符串数组', label))
    return null
  }
  const seen = new Set()
  const normalized = []
  let valid = true
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.trim().length === 0) {
      problems.push(problem('error', 'PLUGIN_TAGS_INVALID', label + ' 的 tags 含空值或非字符串元素:' + JSON.stringify(tag), label))
      valid = false
      continue
    }
    if (tag !== tag.trim()) {
      problems.push(problem('error', 'PLUGIN_TAGS_INVALID', label + ' 的标签 ' + JSON.stringify(tag) + ' 首尾含空白', label))
      valid = false
      continue
    }
    if (seen.has(tag)) {
      problems.push(problem('error', 'PLUGIN_TAGS_DUPLICATE', label + ' 的标签 ' + JSON.stringify(tag) + ' 重复出现', label))
      valid = false
      continue
    }
    seen.add(tag)
    normalized.push(tag)
  }
  return valid ? normalized : null
}

/**
 * 读取并校验 catalog 目录。
 * 任一硬性字段缺失或自相矛盾都记为 error;调用方在 errors 非空时整体失败。
 * @param {object} context 上下文
 * @param {string} context.catalogDir catalog 根目录
 * @param {Array<object>} context.problems 问题收集数组
 * @returns {{authors: Array<object>, plugins: Array<object>}}
 */
export function readCatalog({ catalogDir, problems }) {
  const authors = []
  const plugins = []
  if (!isDirectory(catalogDir)) {
    problems.push(problem('error', 'CATALOG_MISSING', 'catalog 目录不存在:' + catalogDir, 'catalog'))
    return { authors, plugins }
  }
  const entries = readdirSync(catalogDir, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))
  const seenPlugins = new Set()
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      if (!CATALOG_ROOT_FILES.includes(entry.name)) {
        problems.push(problem('warning', 'CATALOG_ENTRY_IGNORED', 'catalog 根目录下的文件 ' + entry.name + ' 不属于登记格式,已忽略', 'catalog/' + entry.name))
      }
      continue
    }
    const username = entry.name
    const authorDir = join(catalogDir, username)
    const authorRel = 'catalog/' + username
    const authorPath = join(authorDir, AUTHOR_FILE)
    let profile = null
    if (!isFile(authorPath)) {
      problems.push(problem('error', 'AUTHOR_FILE_MISSING', '作者目录缺少 ' + AUTHOR_FILE, authorRel + '/' + AUTHOR_FILE))
    } else {
      const data = readJsonFile(authorPath, authorRel + '/' + AUTHOR_FILE, problems)
      if (data !== undefined) {
        if (typeof data?.username !== 'string' || data.username.length === 0) {
          problems.push(problem('error', 'AUTHOR_FIELD_INVALID', authorRel + '/' + AUTHOR_FILE + ' 的 username 必须是非空字符串', authorRel + '/' + AUTHOR_FILE))
        } else if (data.username !== username) {
          problems.push(
            problem(
              'error',
              'AUTHOR_NAME_MISMATCH',
              authorRel + '/' + AUTHOR_FILE + ' 的 username 为 ' + JSON.stringify(data.username) + ',与目录名 ' + username + ' 不一致',
              authorRel + '/' + AUTHOR_FILE,
            ),
          )
        }
        if (typeof data?.profile !== 'string' || data.profile.length === 0) {
          problems.push(problem('error', 'AUTHOR_FIELD_INVALID', authorRel + '/' + AUTHOR_FILE + ' 的 profile 必须是非空字符串', authorRel + '/' + AUTHOR_FILE))
        } else {
          profile = data.profile
        }
      }
    }

    const pubPath = join(authorDir, AUTHOR_PUB_FILE)
    if (!isFile(pubPath)) {
      problems.push(problem('error', 'AUTHOR_PUB_MISSING', '作者目录缺少 ' + AUTHOR_PUB_FILE, authorRel + '/' + AUTHOR_PUB_FILE))
    } else {
      try {
        const info = describePublicKey(pubPath)
        if (info.type !== 'ed25519') {
          problems.push(
            problem(
              'warning',
              'AUTHOR_PUB_TYPE',
              authorRel + '/' + AUTHOR_PUB_FILE + ' 不是 Ed25519 公钥,约定作者密钥为 Ed25519,实际为 ' + info.firstLine,
              authorRel + '/' + AUTHOR_PUB_FILE,
            ),
          )
        }
      } catch (error) {
        problems.push(problem('error', 'AUTHOR_PUB_INVALID', authorRel + '/' + AUTHOR_PUB_FILE + ' 不是合法的 PEM 公钥:' + error.message, authorRel + '/' + AUTHOR_PUB_FILE))
      }
    }

    const authorPlugins = []
    const pluginEntries = readdirSync(authorDir, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))
    for (const pluginEntry of pluginEntries) {
      if (!pluginEntry.isDirectory()) continue
      const dirName = pluginEntry.name
      const pluginDir = join(authorDir, dirName)
      const pluginRel = authorRel + '/' + dirName
      const pluginPath = join(pluginDir, PLUGIN_FILE)
      if (!isFile(pluginPath)) {
        problems.push(problem('error', 'PLUGIN_FILE_MISSING', '插件目录缺少 ' + PLUGIN_FILE, pluginRel + '/' + PLUGIN_FILE))
        continue
      }
      const data = readJsonFile(pluginPath, pluginRel + '/' + PLUGIN_FILE, problems)
      if (data === undefined) continue
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        problems.push(problem('error', 'PLUGIN_FIELD_INVALID', pluginRel + '/' + PLUGIN_FILE + ' 的顶层必须是对象', pluginRel + '/' + PLUGIN_FILE))
        continue
      }
      let valid = true
      for (const field of PLUGIN_FIELDS) {
        if (typeof data[field] !== 'string' || data[field].length === 0) {
          problems.push(problem('error', 'PLUGIN_FIELD_INVALID', pluginRel + '/' + PLUGIN_FILE + ' 的 ' + field + ' 必须是非空字符串', pluginRel + '/' + PLUGIN_FILE))
          valid = false
        }
      }
      for (const key of Object.keys(data)) {
        if (!PLUGIN_FIELDS.includes(key) && !PLUGIN_OPTIONAL_FIELDS.includes(key)) {
          problems.push(problem('warning', 'PLUGIN_FIELD_UNKNOWN', pluginRel + '/' + PLUGIN_FILE + ' 含未知字段 ' + key + ',已忽略', pluginRel + '/' + PLUGIN_FILE))
        }
      }
      if (!valid) continue
      if (!PLUGIN_NAME_PATTERN.test(data.name)) {
        problems.push(problem('error', 'PLUGIN_NAME_INVALID', pluginRel + '/' + PLUGIN_FILE + ' 的 name 不是合法插件名:' + JSON.stringify(data.name), pluginRel + '/' + PLUGIN_FILE))
        continue
      }
      const expectedDir = data.name.split('/').pop()
      if (expectedDir !== dirName) {
        problems.push(
          problem(
            'error',
            'PLUGIN_NAME_MISMATCH',
            pluginRel + '/' + PLUGIN_FILE + ' 的 name ' + data.name + ' 要求目录名为 ' + expectedDir + ',实际为 ' + dirName,
            pluginRel + '/' + PLUGIN_FILE,
          ),
        )
        continue
      }
      if (!/^https?:\/\/[^\s]+$/.test(data.base_url)) {
        problems.push(problem('error', 'PLUGIN_BASE_URL_INVALID', pluginRel + '/' + PLUGIN_FILE + ' 的 base_url 必须是 http(s) 绝对地址:' + JSON.stringify(data.base_url), pluginRel + '/' + PLUGIN_FILE))
        continue
      }
      const tags = readPluginTags(data, pluginRel + '/' + PLUGIN_FILE, problems)
      if (tags === null) continue
      if (seenPlugins.has(data.name)) {
        problems.push(problem('error', 'PLUGIN_DUPLICATE', '插件名 ' + data.name + ' 在 catalog 中重复登记', pluginRel + '/' + PLUGIN_FILE))
        continue
      }
      seenPlugins.add(data.name)
      const record = {
        name: data.name,
        description: data.description,
        license: data.license,
        repoLink: data.repo_link,
        baseUrl: data.base_url,
        tags,
        dirName,
        author: username,
        authorDir,
        pluginRel,
        pluginDir,
      }
      authorPlugins.push(record)
      plugins.push(record)
    }
    authors.push({
      username,
      profile,
      authorDir,
      authorRel,
      pubPath,
      pubRel: authorRel + '/' + AUTHOR_PUB_FILE,
      plugins: authorPlugins,
    })
  }
  if (authors.length === 0) {
    problems.push(problem('warning', 'CATALOG_EMPTY', 'catalog 中没有任何作者,本次构建只产出站点与空索引', 'catalog'))
  }
  return { authors, plugins }
}

async function request(url, options = {}) {
  const label = options.label || url
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: { accept: options.accept || '*/*' },
    })
  } catch (error) {
    throw new Error('拉取 ' + label + ' 失败:' + (error && error.message ? error.message : String(error)))
  }
  if (options.optional && response.status === 404) return null
  if (!response.ok) throw new Error('拉取 ' + label + ' 失败:HTTP ' + response.status + '(' + url + ')')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (options.maxBytes && buffer.length > options.maxBytes) {
    throw new Error(label + ' 大小 ' + buffer.length + ' 字节,超过上限 ' + options.maxBytes + ' 字节(' + url + ')')
  }
  return buffer
}

/**
 * 拉取 JSON。
 * @param {string} url 地址
 * @param {{label?: string, timeoutMs?: number, optional?: boolean}} [options] 选项
 * @returns {Promise<any|null>} optional 且 404 时返回 null
 */
export async function fetchJson(url, options = {}) {
  const buffer = await request(url, { ...options, accept: 'application/json' })
  if (buffer === null) return null
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch (error) {
    throw new Error('拉取 ' + (options.label || url) + ' 失败:不是合法 JSON:' + error.message)
  }
}

/**
 * 拉取二进制内容。
 * @param {string} url 地址
 * @param {{label?: string, timeoutMs?: number, optional?: boolean, maxBytes?: number}} [options] 选项
 * @returns {Promise<Buffer|null>} optional 且 404 时返回 null
 */
export async function fetchBytes(url, options = {}) {
  return request(url, options)
}

/**
 * 规范化 versions.json:统一成 {versions, latest},版本号必须是 x.y.z。
 * 接受两种输入:字符串数组,或 {versions, latest} 对象。
 * @param {any} data versions.json 内容
 * @param {string} label 报错用的名称
 * @returns {{versions: string[], latest: string}}
 */
export function normalizeVersions(data, label) {
  let versions = null
  let latest = null
  if (Array.isArray(data)) {
    versions = data
  } else if (data && typeof data === 'object' && Array.isArray(data.versions)) {
    versions = data.versions
    if (typeof data.latest === 'string') latest = data.latest
  } else {
    throw new Error(label + ' 的顶层必须是版本号数组或含 versions 数组的对象')
  }
  if (versions.length === 0) throw new Error(label + ' 的版本列表为空')
  const seen = new Set()
  for (const version of versions) {
    if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
      throw new Error(label + ' 含非法版本号 ' + JSON.stringify(version))
    }
    if (seen.has(version)) throw new Error(label + ' 含重复版本号 ' + version)
    seen.add(version)
  }
  const sorted = [...versions].sort(compareVersions)
  if (latest !== null) {
    if (!SEMVER_PATTERN.test(latest)) throw new Error(label + ' 的 latest 不是合法版本号:' + JSON.stringify(latest))
    if (!seen.has(latest)) throw new Error(label + ' 的 latest ' + latest + ' 不在版本列表内')
  } else {
    latest = sorted[sorted.length - 1]
  }
  return { versions: sorted, latest }
}

/**
 * 从插件站点拉取版本列表。
 * @param {string} baseUrl 插件发布的站点基址
 * @param {{timeoutMs?: number}} [options] 选项
 * @returns {Promise<{versions: string[], latest: string}>}
 */
export async function fetchVersions(baseUrl, options = {}) {
  const url = trimSlash(baseUrl) + '/' + VERSIONS_FILE
  const data = await fetchJson(url, { label: url, timeoutMs: options.timeoutMs })
  return normalizeVersions(data, url)
}

/**
 * 拉取单个版本的 meta.json、plugin.js 与可选的作者签名。
 * 不在此处做字段校验,聚合校验放在构建脚本里,便于一次性列出全部问题。
 * @param {string} baseUrl 插件发布的站点基址
 * @param {string} version 版本号
 * @param {{timeoutMs?: number}} [options] 选项
 * @returns {Promise<{meta: any, pluginJs: Buffer, authorSig: Buffer|null}>}
 */
export async function fetchVersion(baseUrl, version, options = {}) {
  const base = trimSlash(baseUrl) + '/' + version
  const metaUrl = base + '/meta.json'
  const jsUrl = base + '/plugin.js'
  const sigUrl = base + '/plugin.js.author.sig'
  const meta = await fetchJson(metaUrl, { label: metaUrl, timeoutMs: options.timeoutMs })
  const pluginJs = await fetchBytes(jsUrl, {
    label: jsUrl,
    timeoutMs: options.timeoutMs,
    maxBytes: MAX_PLUGIN_BYTES,
  })
  const authorSig = await fetchBytes(sigUrl, {
    label: sigUrl,
    timeoutMs: options.timeoutMs,
    maxBytes: MAX_SIGNATURE_BYTES,
    optional: true,
  })
  return { meta, pluginJs, authorSig }
}
