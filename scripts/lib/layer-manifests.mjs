/**
 * 三层哈希清单的生成与签名。
 *
 * L1 合集根、L2 每个作者目录、L3 每个插件目录各一份 manifest.json 与 manifest.json.sig,
 * 层与层之间互不引用,任何一层都可以单独校验、单独重签。
 * build-collection.mjs(本地构建)与 build-from-catalog.mjs(Pages 流水线)共用本模块,
 * 保证两条路径产出的清单语义完全一致。
 *
 * revision 语义:该层文件集合与哈希都没变时沿用旧 revision,有变化时加一,没有旧清单时从 1 开始。
 * 旧清单可以由调用方注入(build-from-catalog 从已发布站点读),没有注入时读该层目录内的 manifest.json。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MANIFEST_FILE, signManifest } from '../pki.mjs'
import {
  LAYER1_FILES,
  LAYER1_OPTIONAL_FILES,
  LAYER2_FILES,
  LAYER3_FILES,
  MANIFEST_SCHEMA_VERSION,
} from './collection-verify.mjs'

/** 构造一条问题记录,结构与 collection-verify 的 problems 一致。 */
export function problem(level, code, message, path) {
  return { level, code, message, path: path ?? null }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 列出目录下的子目录名,按字典序排序;目录不存在时返回空数组。 */
export function listDirectoryNames(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/** 读取 versions.json 的版本列表,读不到时返回空数组。 */
export function readVersionList(path) {
  if (!existsSync(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const list = Array.isArray(data?.versions) ? data.versions : []
    return list.filter((item) => typeof item === 'string')
  } catch {
    return []
  }
}

/** 计算文件的 SHA-512,小写十六进制。 */
export function sha512Of(path) {
  return createHash('sha512').update(readFileSync(path)).digest('hex')
}

/** 把层目录内的相对路径列表转成清单条目,按 path 字典序排列,只收实际存在的普通文件。 */
export function layerEntries(layerDir, relativePaths) {
  const entries = []
  for (const rel of relativePaths) {
    const filePath = join(layerDir, ...rel.split('/'))
    if (!existsSync(filePath)) continue
    if (!statSync(filePath).isFile()) continue
    entries.push({ path: rel, sha512: sha512Of(filePath) })
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return entries
}

/** 读取该层现有的旧清单,只用于沿用 revision;读不到或结构不对时返回 null。 */
export function readPreviousManifest(layerDir) {
  const path = join(layerDir, MANIFEST_FILE)
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return isObject(data) && Array.isArray(data.files) ? data : null
  } catch {
    return null
  }
}

/** 旧清单记录的文件集合与哈希是否与新算出的完全一致。 */
export function sameEntries(previous, entries) {
  if (!previous) return false
  if (previous.files.length !== entries.length) return false
  const recorded = new Map()
  for (const item of previous.files) {
    if (isObject(item) && typeof item.path === 'string') recorded.set(item.path, item.sha512)
  }
  return entries.every((item) => recorded.get(item.path) === item.sha512)
}

/**
 * 列出三层清单各自的目录与覆盖范围。
 * L1 覆盖合集根的索引、作者清单;L2 覆盖 author_pub.pem 与 plugin_manifest.json;
 * L3 覆盖 versions.json 与每个版本的 meta.json。catalog 与 certs 是登记信息与信任材料,不进任何清单。
 * @param {string} root 合集根目录
 * @returns {Array<{layer: string, layerRel: string, layerDir: string, files: string[]}>}
 */
export function listLayerDirs(root) {
  const layers = [{ layer: 'L1', layerRel: '', layerDir: root, files: [...LAYER1_FILES, ...LAYER1_OPTIONAL_FILES] }]
  const pluginsDir = join(root, 'plugins')
  for (const author of listDirectoryNames(pluginsDir)) {
    const authorDir = join(pluginsDir, author)
    const authorRel = 'plugins/' + author
    layers.push({ layer: 'L2', layerRel: authorRel, layerDir: authorDir, files: [...LAYER2_FILES] })
    for (const plugin of listDirectoryNames(authorDir)) {
      const pluginDir = join(authorDir, plugin)
      const files = [...LAYER3_FILES]
      for (const version of readVersionList(join(pluginDir, 'versions.json'))) files.push(version + '/meta.json')
      layers.push({ layer: 'L3', layerRel: authorRel + '/' + plugin, layerDir: pluginDir, files })
    }
  }
  return layers
}

/**
 * 写一层清单并按需签名。
 * @param {object} context 上下文
 * @param {string} context.layer 层号,L1/L2/L3
 * @param {string} context.layerRel 该层相对合集根的路径,合集根为空串
 * @param {string} context.layerDir 该层目录的绝对路径
 * @param {Array<{path: string, sha512: string}>} context.entries 清单条目
 * @param {{eecCertPath: string, eecKeyPath: string}|null} context.signer 签名字段;为 null 时不签名
 * @param {Array<object>} context.problems 问题收集数组
 * @param {object|null|undefined} [context.previous] 旧清单;undefined 表示读该层目录内的 manifest.json
 * @returns {{layer: string, dir: string, revision: number, files: number, changed: boolean}}
 */
export function writeLayerManifest({ layer, layerRel, layerDir, entries, signer, problems, previous }) {
  const previousManifest = previous === undefined ? readPreviousManifest(layerDir) : previous
  const unchanged = sameEntries(previousManifest, entries)
  const previousRevision =
    previousManifest && Number.isInteger(previousManifest.revision) && previousManifest.revision > 0
      ? previousManifest.revision
      : null
  let revision = 1
  if (previousRevision !== null) revision = unchanged ? previousRevision : previousRevision + 1
  const manifest = { schemaVersion: MANIFEST_SCHEMA_VERSION, revision, files: entries }
  const manifestPath = join(layerDir, MANIFEST_FILE)
  const text = JSON.stringify(manifest, null, 2) + '\n'
  const previousText = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null
  const changed = previousText !== text
  if (changed) writeFileSync(manifestPath, text, 'utf8')
  const rel = layerRel ? layerRel + '/' + MANIFEST_FILE : MANIFEST_FILE
  const sigPath = manifestPath + '.sig'
  if (signer) {
    try {
      signManifest(manifestPath, signer.eecCertPath, signer.eecKeyPath)
      problems.push(problem('warning', 'MANIFEST_SIGNED', layer + ' 清单已签名:' + rel, rel + '.sig'))
    } catch (error) {
      problems.push(problem('error', 'MANIFEST_SIGN_FAILED', layer + ' 清单签名失败:' + error.message, rel))
    }
  } else if (changed && existsSync(sigPath)) {
    rmSync(sigPath, { force: true })
    problems.push(
      problem(
        'warning',
        'MANIFEST_SIG_REMOVED',
        layer + ' 清单内容已变化,已删除失效的 ' + rel + '.sig;请用 --sign 重新签名',
        rel + '.sig',
      ),
    )
  }
  return { layer, dir: layerRel || '.', revision, files: entries.length, changed }
}

/**
 * 生成三层清单:L1 合集根、L2 每个作者目录、L3 每个插件目录,互不引用。
 * @param {object} context 上下文
 * @param {string} context.root 合集根目录
 * @param {{eecCertPath: string, eecKeyPath: string}|null} context.signer 签名字段
 * @param {Array<object>} context.problems 问题收集数组
 * @param {(layerRel: string) => (object|null)} [context.previousResolver] 旧清单来源
 * @returns {Array<object>} 每层一条摘要
 */
export function buildLayerManifests({ root, signer, problems, previousResolver }) {
  const summaries = []
  for (const layer of listLayerDirs(root)) {
    const entries = layerEntries(layer.layerDir, layer.files)
    const previous = previousResolver ? (previousResolver(layer.layerRel) ?? null) : undefined
    summaries.push(writeLayerManifest({ ...layer, entries, signer, problems, previous }))
  }
  return summaries
}
