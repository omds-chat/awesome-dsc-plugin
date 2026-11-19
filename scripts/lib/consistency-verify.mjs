/**
 * pages 包收录信息交叉校验的核心逻辑。
 *
 * verify-catalog-consistency.mjs 负责命令行参数与文本输出,scripts/check-*.mjs 负责编排与 JSON 输出,
 * 判定规则只有这一份,两处不会分叉。本模块只读取文件,不修改任何内容。
 *
 * 校验对象是同一份 pages 包里的五处信息:
 *   catalog/index.json              汇总索引,由构建生成;
 *   plugins.json                    插件目录索引,由构建生成,与 plugins/ 目录成对;
 *   plugins/author_manifest.json    作者清单,由构建生成;
 *   catalog/<作者>/...              pages 包里的登记副本;
 *   plugins/<作者>/<插件>/...       构建出的插件树与三层清单。
 *
 * 校验项:
 *   1. catalog/index.json 的每个插件,在 plugins/<作者>/<插件>/ 存在,versions.json 含当前版本,
 *      且版本目录、版本数、latest 与索引一致;
 *   2. plugins.json 的每条记录,在 plugins/ 下找得到,作者、标签与版本都和索引一致;
 *   3. plugins/author_manifest.json 的作者集合与 catalog/index.json 的作者集合相等;
 *   4. 每层清单里列出的文件都真实存在,plugins 树的作者与插件目录结构与 catalog 副本一致;
 *   5. 索引里的登记字段与 catalog 副本里的 plugin.json 一致,标签来自 tags.json 的预设清单。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** pages 包 catalog 目录里的汇总索引文件名 */
export const INDEX_FILE = 'index.json'
/** pages 包 catalog 目录里的异常清单文件名 */
export const ANOMALIES_FILE = 'anomalies.json'
/** 插件目录索引文件名,与分发包里的 plugins/ 目录成对 */
export const PLUGINS_INDEX_FILE = 'plugins.json'

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

/** 读 JSON,失败时把原因交给调用方。 */
function readJson(path) {
  try {
    return { ok: true, data: JSON.parse(readFileSync(path, 'utf8')), error: null }
  } catch (error) {
    return { ok: false, data: null, error: error.message }
  }
}

function sortedSets(left, right) {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return {
    missing: [...rightSet].filter((item) => !leftSet.has(item)).sort(),
    extra: [...leftSet].filter((item) => !rightSet.has(item)).sort(),
  }
}

function sameArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

function listManifestFiles(dir, found = []) {
  if (!isDirectory(dir)) return found
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listManifestFiles(full, found)
    else if (entry.isFile() && entry.name === 'manifest.json') found.push(full)
  }
  return found
}

/**
 * 交叉校验一个 pages 包的收录信息。
 * @param {string} pagesDir pages 包目录
 * @returns {{ok: boolean, root: string, missing: boolean, failures: Array<{code: string, message: string, path: string|null}>, stats: object}}
 */
export function verifyCatalogConsistency(pagesDir) {
  const root = resolve(pagesDir)
  const failures = []
  const fail = (code, message, path = null) => failures.push({ code, message, path })
  const rel = (path) => path.slice(root.length + 1).split(/[\\/]/).join('/')

  if (!isDirectory(root)) {
    return { ok: false, root, missing: true, failures, stats: {} }
  }

  // ---- 读取各层输入 ----
  const indexRead = readJson(join(root, 'catalog', INDEX_FILE))
  if (!indexRead.ok) {
    fail('INDEX_UNREADABLE', 'catalog/' + INDEX_FILE + ' 不可用:' + (indexRead.error || '文件缺失'), 'catalog/' + INDEX_FILE)
  }
  const index = indexRead.ok && indexRead.data !== null && typeof indexRead.data === 'object' ? indexRead.data : null
  const indexAuthors = index && Array.isArray(index.authors) ? index.authors : []
  const indexPlugins = index && Array.isArray(index.plugins) ? index.plugins : []
  if (index && !Array.isArray(index.authors)) fail('INDEX_SHAPE', 'catalog/' + INDEX_FILE + ' 的 authors 必须是数组', 'catalog/' + INDEX_FILE)
  if (index && !Array.isArray(index.plugins)) fail('INDEX_SHAPE', 'catalog/' + INDEX_FILE + ' 的 plugins 必须是数组', 'catalog/' + INDEX_FILE)

  const pluginsIndexRead = readJson(join(root, PLUGINS_INDEX_FILE))
  if (!pluginsIndexRead.ok) fail('PLUGINS_INDEX_UNREADABLE', PLUGINS_INDEX_FILE + ' 不可用:' + (pluginsIndexRead.error || '文件缺失'), PLUGINS_INDEX_FILE)
  const pluginsIndex = pluginsIndexRead.ok && Array.isArray(pluginsIndexRead.data) ? pluginsIndexRead.data : []
  if (pluginsIndexRead.ok && !Array.isArray(pluginsIndexRead.data)) fail('PLUGINS_INDEX_SHAPE', PLUGINS_INDEX_FILE + ' 的顶层必须是数组', PLUGINS_INDEX_FILE)

  const manifestRead = readJson(join(root, 'plugins', 'author_manifest.json'))
  if (!manifestRead.ok) fail('AUTHOR_MANIFEST_UNREADABLE', 'plugins/author_manifest.json 不可用:' + (manifestRead.error || '文件缺失'), 'plugins/author_manifest.json')
  const authorManifest = manifestRead.ok && Array.isArray(manifestRead.data) ? manifestRead.data : []
  const manifestAuthors = authorManifest
    .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.username === 'string')
    .map((entry) => entry.username)
    .sort()

  const tagsRead = readJson(join(root, 'tags.json'))
  const presetTags = tagsRead.ok && Array.isArray(tagsRead.data) ? tagsRead.data.filter((item) => typeof item === 'string') : null
  const presetTagSet = presetTags === null ? null : new Set(presetTags)

  const indexByName = new Map()
  for (const plugin of indexPlugins) {
    if (plugin === null || typeof plugin !== 'object' || typeof plugin.name !== 'string') {
      fail('INDEX_SHAPE', 'catalog/' + INDEX_FILE + ' 的插件条目缺少 name:' + JSON.stringify(plugin), 'catalog/' + INDEX_FILE)
      continue
    }
    indexByName.set(plugin.name, plugin)
  }

  // ---- 1. 索引插件与 plugins 树、版本 ----
  for (const plugin of indexPlugins) {
    if (plugin === null || typeof plugin !== 'object' || typeof plugin.name !== 'string') continue
    const author = plugin.author
    if (typeof author !== 'string' || author.length === 0) {
      fail('INDEX_PLUGIN_AUTHOR_INVALID', '插件 ' + plugin.name + ' 在 catalog/' + INDEX_FILE + ' 里缺少 author', 'catalog/' + INDEX_FILE)
      continue
    }
    const dirName = plugin.name.split('/').pop()
    const pluginDir = join(root, 'plugins', author, dirName)
    const pluginRel = 'plugins/' + author + '/' + dirName
    if (!isDirectory(pluginDir)) {
      fail('INDEX_PLUGIN_DIR_MISSING', 'catalog/' + INDEX_FILE + ' 里的插件 ' + author + '/' + plugin.name + ' 在 ' + pluginRel + ' 不存在', pluginRel)
      continue
    }
    const versionsRead = readJson(join(pluginDir, 'versions.json'))
    if (!versionsRead.ok) {
      fail('PLUGIN_VERSIONS_UNREADABLE', pluginRel + '/versions.json 不可用:' + (versionsRead.error || '文件缺失'), pluginRel + '/versions.json')
      continue
    }
    const versions = Array.isArray(versionsRead.data?.versions) ? versionsRead.data.versions.filter((item) => typeof item === 'string') : []
    const latest = typeof versionsRead.data?.latest === 'string' ? versionsRead.data.latest : null
    if (versions.length === 0) fail('PLUGIN_VERSIONS_EMPTY', pluginRel + '/versions.json 没有版本', pluginRel + '/versions.json')
    const current = plugin.current_version
    if (typeof current !== 'string' || !versions.includes(current)) {
      fail('INDEX_VERSION_MISSING', '插件 ' + author + '/' + plugin.name + ' 的当前版本 ' + JSON.stringify(current) + ' 不在 versions.json 的版本列表内', pluginRel + '/versions.json')
    } else {
      const versionDir = join(pluginDir, current)
      if (!isDirectory(versionDir)) fail('INDEX_VERSION_DIR_MISSING', '插件 ' + author + '/' + plugin.name + ' 的版本目录 ' + current + ' 不存在', pluginRel + '/' + current)
      if (!isFile(join(versionDir, 'meta.json'))) fail('INDEX_VERSION_META_MISSING', '插件 ' + author + '/' + plugin.name + ' 的 ' + current + '/meta.json 不存在', pluginRel + '/' + current + '/meta.json')
      if (!isFile(join(versionDir, 'plugin.js'))) fail('INDEX_VERSION_BUNDLE_MISSING', '插件 ' + author + '/' + plugin.name + ' 的 ' + current + '/plugin.js 不存在', pluginRel + '/' + current + '/plugin.js')
    }
    if (latest !== null && latest !== current) {
      fail('INDEX_LATEST_MISMATCH', '插件 ' + author + '/' + plugin.name + ' 的 current_version 为 ' + JSON.stringify(current) + ',versions.json 的 latest 为 ' + JSON.stringify(latest), pluginRel + '/versions.json')
    }
    if (plugin.version_count !== versions.length) {
      fail('INDEX_VERSION_COUNT_MISMATCH', '插件 ' + author + '/' + plugin.name + ' 的 version_count 为 ' + JSON.stringify(plugin.version_count) + ',versions.json 实际有 ' + versions.length + ' 个版本', pluginRel + '/versions.json')
    }
    const tags = Array.isArray(plugin.tags) ? plugin.tags : []
    if (presetTagSet !== null) {
      for (const tag of tags) {
        if (!presetTagSet.has(tag)) {
          fail('INDEX_TAG_UNKNOWN', '插件 ' + author + '/' + plugin.name + ' 的标签 ' + JSON.stringify(tag) + ' 不在 tags.json 的预设清单内', 'tags.json')
        }
      }
    } else if (tags.length > 0) {
      fail('TAG_SOURCE_MISSING', 'tags.json 缺失,但插件 ' + author + '/' + plugin.name + ' 声明了标签', 'tags.json')
    }

    // 索引条目与 catalog 副本里的 plugin.json
    const registrationRel = 'catalog/' + author + '/' + dirName + '/plugin.json'
    const registrationRead = readJson(join(root, 'catalog', author, dirName, 'plugin.json'))
    if (!registrationRead.ok) {
      fail('CATALOG_PLUGIN_MISSING', '插件 ' + author + '/' + plugin.name + ' 在 ' + registrationRel + ' 不存在', registrationRel)
    } else {
      const registration = registrationRead.data
      const fields = [
        ['name', registration?.name, plugin.name],
        ['description', registration?.description, plugin.description],
        ['license', registration?.license, plugin.license],
        ['repo_link', registration?.repo_link, plugin.repo_link],
        ['base_url', registration?.base_url, plugin.base_url],
      ]
      for (const [field, registered, indexed] of fields) {
        if (registered !== indexed) {
          fail('INDEX_REGISTRATION_MISMATCH', '插件 ' + author + '/' + plugin.name + ' 的 ' + field + ' 在 plugin.json 中为 ' + JSON.stringify(registered) + ',在 catalog/' + INDEX_FILE + ' 中为 ' + JSON.stringify(indexed), registrationRel)
        }
      }
      const registrationTags = Array.isArray(registration?.tags) ? registration.tags : []
      if (!sameArray(registrationTags, tags)) {
        fail('INDEX_TAG_MISMATCH', '插件 ' + author + '/' + plugin.name + ' 的 tags 在 plugin.json 中为 ' + JSON.stringify(registrationTags) + ',在 catalog/' + INDEX_FILE + ' 中为 ' + JSON.stringify(tags), registrationRel)
      }
    }
  }

  // ---- 2. 插件目录索引与 plugins 树、索引 ----
  for (const record of pluginsIndex) {
    if (record === null || typeof record !== 'object' || typeof record.plugin_name !== 'string' || typeof record.author !== 'string') {
      fail('PLUGINS_INDEX_SHAPE', PLUGINS_INDEX_FILE + ' 的记录必须含 plugin_name 与 author:' + JSON.stringify(record), PLUGINS_INDEX_FILE)
      continue
    }
    const dirName = record.plugin_name.split('/').pop()
    const pluginDir = join(root, 'plugins', record.author, dirName)
    const pluginRel = 'plugins/' + record.author + '/' + dirName
    if (!isDirectory(pluginDir)) {
      fail('PLUGINS_INDEX_PLUGIN_MISSING', PLUGINS_INDEX_FILE + ' 的插件 ' + record.author + '/' + record.plugin_name + ' 在 ' + pluginRel + ' 不存在', PLUGINS_INDEX_FILE)
      continue
    }
    const versionsRead = readJson(join(pluginDir, 'versions.json'))
    if (!versionsRead.ok) {
      fail('PLUGINS_INDEX_VERSIONS_UNREADABLE', pluginRel + '/versions.json 不可用:' + (versionsRead.error || '文件缺失'), pluginRel + '/versions.json')
      continue
    }
    const latest = typeof versionsRead.data?.latest === 'string' ? versionsRead.data.latest : null
    const indexed = indexByName.get(record.plugin_name)
    if (!indexed) {
      fail('PLUGINS_INDEX_NOT_IN_INDEX', PLUGINS_INDEX_FILE + ' 的插件 ' + record.plugin_name + ' 不在 catalog/' + INDEX_FILE + ' 里', PLUGINS_INDEX_FILE)
    } else {
      if (indexed.author !== record.author) {
        fail('PLUGINS_INDEX_AUTHOR_MISMATCH', '插件 ' + record.plugin_name + ' 在 ' + PLUGINS_INDEX_FILE + ' 的作者为 ' + record.author + ',在 catalog/' + INDEX_FILE + ' 中为 ' + indexed.author, PLUGINS_INDEX_FILE)
      }
      if (indexed.current_version !== latest) {
        fail('PLUGINS_INDEX_VERSION_MISMATCH', '插件 ' + record.plugin_name + ' 在 versions.json 的 latest 为 ' + JSON.stringify(latest) + ',在 catalog/' + INDEX_FILE + ' 的 current_version 为 ' + JSON.stringify(indexed.current_version), PLUGINS_INDEX_FILE)
      }
      const indexTags = Array.isArray(indexed.tags) ? indexed.tags : []
      const recordTags = Array.isArray(record.tag) ? record.tag : []
      if (!sameArray(indexTags, recordTags)) {
        fail('PLUGINS_INDEX_TAG_MISMATCH', '插件 ' + record.plugin_name + ' 的 tag 在 ' + PLUGINS_INDEX_FILE + ' 中为 ' + JSON.stringify(recordTags) + ',在 catalog/' + INDEX_FILE + ' 中为 ' + JSON.stringify(indexTags), PLUGINS_INDEX_FILE)
      }
    }
    const recordTags = Array.isArray(record.tag) ? record.tag : []
    if (presetTagSet !== null) {
      for (const tag of recordTags) {
        if (!presetTagSet.has(tag)) {
          fail('PLUGINS_INDEX_TAG_UNKNOWN', '插件 ' + record.plugin_name + ' 的标签 ' + JSON.stringify(tag) + ' 不在 tags.json 的预设清单内', 'tags.json')
        }
      }
    }
  }
  for (const plugin of indexPlugins) {
    if (plugin === null || typeof plugin !== 'object' || typeof plugin.name !== 'string') continue
    if (!pluginsIndex.some((record) => record !== null && typeof record === 'object' && record.plugin_name === plugin.name)) {
      fail('INDEX_PLUGIN_NOT_IN_PLUGINS_INDEX', 'catalog/' + INDEX_FILE + ' 的插件 ' + plugin.name + ' 不在 ' + PLUGINS_INDEX_FILE + ' 里', PLUGINS_INDEX_FILE)
    }
  }

  // ---- 3. 作者集合 ----
  const indexAuthorNames = indexAuthors
    .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.username === 'string')
    .map((entry) => entry.username)
    .sort()
  let diff = sortedSets(manifestAuthors, indexAuthorNames)
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    fail(
      'AUTHOR_SET_MISMATCH',
      'plugins/author_manifest.json 与 catalog/' + INDEX_FILE + ' 的作者集合不一致' +
        (diff.missing.length > 0 ? ';仅索引有:' + diff.missing.join(', ') : '') +
        (diff.extra.length > 0 ? ';仅 author_manifest 有:' + diff.extra.join(', ') : ''),
      'plugins/author_manifest.json',
    )
  }
  const pluginsAuthorDirs = listDirectories(join(root, 'plugins')).filter((name) => name !== '')
  diff = sortedSets(pluginsAuthorDirs, indexAuthorNames)
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    fail(
      'PLUGINS_AUTHOR_DIR_MISMATCH',
      'plugins/ 的作者目录与 catalog/' + INDEX_FILE + ' 的作者不一致' +
        (diff.missing.length > 0 ? ';缺少目录:' + diff.missing.join(', ') : '') +
        (diff.extra.length > 0 ? ';多出目录:' + diff.extra.join(', ') : ''),
      'plugins',
    )
  }

  // ---- 4. plugins 树与 catalog 副本结构 ----
  const catalogAuthorDirs = listDirectories(join(root, 'catalog')).filter((name) => name !== '')
  diff = sortedSets(catalogAuthorDirs, indexAuthorNames)
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    fail(
      'CATALOG_AUTHOR_DIR_MISMATCH',
      'catalog/ 的作者目录与 catalog/' + INDEX_FILE + ' 的作者不一致' +
        (diff.missing.length > 0 ? ';缺少目录:' + diff.missing.join(', ') : '') +
        (diff.extra.length > 0 ? ';多出目录:' + diff.extra.join(', ') : ''),
      'catalog',
    )
  }
  for (const author of indexAuthorNames) {
    const pluginsAuthorDir = join(root, 'plugins', author)
    const catalogAuthorDir = join(root, 'catalog', author)
    if (!isDirectory(catalogAuthorDir)) {
      fail('CATALOG_AUTHOR_DIR_MISSING', 'catalog/' + author + ' 目录不存在,但该作者已收录进索引', 'catalog/' + author)
      continue
    }
    if (!isFile(join(pluginsAuthorDir, 'author_pub.pem'))) fail('AUTHOR_PUB_MISSING', 'plugins/' + author + '/author_pub.pem 不存在', 'plugins/' + author + '/author_pub.pem')
    if (!isFile(join(catalogAuthorDir, 'author_pub.pem'))) fail('CATALOG_AUTHOR_PUB_MISSING', 'catalog/' + author + '/author_pub.pem 不存在', 'catalog/' + author + '/author_pub.pem')
    const pluginDirs = listDirectories(pluginsAuthorDir).filter((name) => isFile(join(pluginsAuthorDir, name, 'versions.json')))
    const catalogPluginDirs = listDirectories(catalogAuthorDir).filter((name) => isFile(join(catalogAuthorDir, name, 'plugin.json')))
    diff = sortedSets(pluginDirs, catalogPluginDirs)
    if (diff.missing.length > 0 || diff.extra.length > 0) {
      fail(
        'CATALOG_TREE_MISMATCH',
        '作者 ' + author + ' 的插件目录在 plugins/ 与 catalog/ 不一致' +
          (diff.missing.length > 0 ? ';plugins/ 缺少:' + diff.missing.join(', ') : '') +
          (diff.extra.length > 0 ? ';plugins/ 多出:' + diff.extra.join(', ') : ''),
        'plugins/' + author,
      )
    }
    const manifestList = readJson(join(pluginsAuthorDir, 'plugin_manifest.json'))
    if (!manifestList.ok || !Array.isArray(manifestList.data)) {
      fail('PLUGIN_MANIFEST_UNREADABLE', 'plugins/' + author + '/plugin_manifest.json 不可用', 'plugins/' + author + '/plugin_manifest.json')
    } else {
      const listed = manifestList.data.filter((item) => typeof item === 'string').sort()
      const actual = pluginDirs
        .map((dirName) => {
          const registration = readJson(join(catalogAuthorDir, dirName, 'plugin.json'))
          return registration.ok && typeof registration.data?.name === 'string' ? registration.data.name : dirName
        })
        .sort()
      diff = sortedSets(listed, actual)
      if (diff.missing.length > 0 || diff.extra.length > 0) {
        fail(
          'PLUGIN_MANIFEST_MISMATCH',
          '作者 ' + author + ' 的 plugin_manifest.json 与插件目录不一致' +
            (diff.missing.length > 0 ? ';缺少:' + diff.missing.join(', ') : '') +
            (diff.extra.length > 0 ? ';多出:' + diff.extra.join(', ') : ''),
          'plugins/' + author + '/plugin_manifest.json',
        )
      }
    }
  }

  // ---- 5. 每层清单列出的文件必须存在 ----
  const manifestFiles = listManifestFiles(root).sort()
  for (const manifestPath of manifestFiles) {
    const parsed = readJson(manifestPath)
    if (!parsed.ok) {
      fail('MANIFEST_UNREADABLE', rel(manifestPath) + ' 不可用:' + parsed.error, rel(manifestPath))
      continue
    }
    const files = Array.isArray(parsed.data?.files) ? parsed.data.files : null
    if (files === null) {
      fail('MANIFEST_SHAPE', rel(manifestPath) + ' 的 files 必须是数组', rel(manifestPath))
      continue
    }
    const baseDir = join(manifestPath, '..')
    for (const entry of files) {
      if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string') {
        fail('MANIFEST_SHAPE', rel(manifestPath) + ' 的条目必须含字符串 path', rel(manifestPath))
        continue
      }
      const target = join(baseDir, ...entry.path.split('/'))
      if (!isFile(target)) fail('MANIFEST_FILE_MISSING', rel(manifestPath) + ' 记录的 ' + entry.path + ' 实际不存在', rel(manifestPath))
    }
  }

  const anomalyRead = readJson(join(root, 'catalog', ANOMALIES_FILE))
  const anomalyCount = anomalyRead.ok && Array.isArray(anomalyRead.data?.excluded) ? anomalyRead.data.excluded.length : 0

  return {
    ok: failures.length === 0,
    root,
    missing: false,
    failures,
    stats: {
      authors: indexAuthorNames.length,
      plugins: indexPlugins.length,
      records: pluginsIndex.length,
      authorManifestAuthors: manifestAuthors.length,
      manifests: manifestFiles.length,
      anomalies: anomalyCount,
    },
  }
}
