/**
 * ci-memory 分支上三层清单的镜像:读回与写回。
 *
 * ci-memory 是与 main 无公共祖先的孤立并行分支,只承载跨构建延续的状态:
 * layer-manifests/ 下按分发路径一一镜像三层 manifest.json 与同名 .sig,规则见分支内的
 * layer-manifests/README.md。读回只取 schemaVersion、revision 与 files,验签不参与;
 * 写回只写清单与签名,不写任何分发内容(plugins.json、plugin.js、证书一概不动)。
 *
 * 三种「读不到」的边界处理不同:
 *   工作区不存在或不是 git 工作区  分支缺失,报错中止,不代为创建;
 *   layer-manifests/ 里没有该层清单  该层没有分支上的上一版,由调用方决定回退到线上还是从 1 开始;
 *   清单存在但不是合法 JSON、或缺 files 数组  该层按读不到处理,并记一条警告。
 *
 * 写回要求清单与签名成对:任一层缺一份即写回失败,流水线据此中止发布,不沿用旧 revision。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { MANIFEST_FILE } from '../pki.mjs'
import { listLayerDirs, problem } from './layer-manifests.mjs'

/** ci-memory 分支上存放三层清单的目录名,与分支内 README 的镜像规则一致 */
export const CI_MEMORY_LAYER_ROOT = 'layer-manifests'
/** 清单签名的后缀,与 pki.mjs 的 signManifest 一致 */
export const MANIFEST_SIG_SUFFIX = '.sig'

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

/** 该层在 ci-memory 分支上的目录;L1 的 layerRel 为空串,对应 layer-manifests/ 本身。 */
export function layerDirInBranch(branchRoot, layerRel) {
  return layerRel ? join(branchRoot, CI_MEMORY_LAYER_ROOT, ...layerRel.split('/')) : join(branchRoot, CI_MEMORY_LAYER_ROOT)
}

/** 该层在 ci-memory 分支上的清单与签名路径。 */
export function layerManifestPaths(branchRoot, layerRel) {
  const dir = layerDirInBranch(branchRoot, layerRel)
  return { dir, manifest: join(dir, MANIFEST_FILE), signature: join(dir, MANIFEST_FILE + MANIFEST_SIG_SUFFIX) }
}

/** 用于日志与报错的层名:合集根显示为 L1,其余按分发路径显示。 */
export function describeLayerRel(layerRel) {
  return layerRel === '' ? 'L1(合集根)' : layerRel
}

/** 报错时的层标签:L1 只写层号,其余写成「L2(plugins/<作者>)」。 */
function layerLabel(layer) {
  return layer.layerRel ? layer.layer + '(' + layer.layerRel + ')' : layer.layer
}

/**
 * 确认 ci-memory 工作区可用:目录必须存在且是 git 工作区(有 .git)。
 * 分支缺失是硬错误:流水线报错中止,不代为创建分支。
 * @param {string} branchRoot 工作区路径
 * @param {string} [label] 报错时使用的名称
 * @returns {string} 绝对路径
 */
export function requireCiMemoryRoot(branchRoot, label = 'ci-memory 工作区') {
  if (typeof branchRoot !== 'string' || branchRoot.length === 0) {
    throw new Error(label + ' 未指定路径(--ci-memory 或 CI_MEMORY_DIR)')
  }
  const root = resolve(branchRoot)
  if (!isDirectory(root)) {
    throw new Error(label + '不存在:' + root + ';ci-memory 分支缺失时流水线报错中止,不代为创建')
  }
  if (!existsSync(join(root, '.git'))) {
    throw new Error(label + '不是 git 工作区(缺少 .git):' + root + ';请先检出 ci-memory 分支再重试')
  }
  return root
}

/**
 * 按层读回 ci-memory 分支上的上一版清单。
 * 只读清单本体,不读签名,也不校验签名:revision 与 files 都在清单里。
 * @param {object} context 上下文
 * @param {string} context.branchRoot ci-memory 工作区
 * @param {string[]} context.layerRels 需要读回的层,合集根为空串
 * @param {Array<object>} context.problems 问题收集数组,只放警告
 * @returns {{root: string, mirrorRoot: string, mirrorExists: boolean, manifests: Map<string, object>, missing: string[]}}
 */
export function readCiMemoryManifests({ branchRoot, layerRels, problems }) {
  const root = requireCiMemoryRoot(branchRoot)
  const mirrorRoot = join(root, CI_MEMORY_LAYER_ROOT)
  const mirrorExists = isDirectory(mirrorRoot)
  const manifests = new Map()
  const missing = []
  for (const layerRel of layerRels) {
    const { manifest } = layerManifestPaths(root, layerRel)
    const rel = relative(root, manifest).split(sep).join('/')
    if (!existsSync(manifest)) {
      missing.push(layerRel)
      continue
    }
    let data
    try {
      data = JSON.parse(readFileSync(manifest, 'utf8'))
    } catch (error) {
      problems.push(problem('warning', 'CI_MEMORY_MANIFEST_INVALID', 'ci-memory 分支上的 ' + rel + ' 不是合法 JSON:' + error.message + ';该层按读不到处理', rel))
      missing.push(layerRel)
      continue
    }
    if (!isObject(data) || !Array.isArray(data.files)) {
      problems.push(problem('warning', 'CI_MEMORY_MANIFEST_INVALID', 'ci-memory 分支上的 ' + rel + ' 缺少 files 数组;该层按读不到处理', rel))
      missing.push(layerRel)
      continue
    }
    manifests.set(layerRel, data)
  }
  return { root, mirrorRoot, mirrorExists, manifests, missing }
}

/** 两个文件字节是否完全一致;旧文件不存在或读不了都按「不一致」处理。 */
function sameFile(source, dest) {
  try {
    return existsSync(dest) && readFileSync(source).equals(readFileSync(dest))
  } catch {
    return false
  }
}

/** 内容一致时不落盘,避免写回把未变化的层也变成一次提交。 */
function copyIfChanged(source, dest) {
  if (sameFile(source, dest)) return false
  copyFileSync(source, dest)
  return true
}

/** 递归列出镜像目录里的清单与签名文件。README.md 等人工维护文件不在其中,永不删除。 */
function listManifestFiles(dir, found = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : 1))
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listManifestFiles(full, found)
    else if (entry.isFile() && (entry.name === MANIFEST_FILE || entry.name === MANIFEST_FILE + MANIFEST_SIG_SUFFIX)) found.push(full)
  }
  return found
}

/** 自底向上删除空目录,根目录本身保留。 */
function pruneEmptyDirs(dir, isRoot) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return true
  }
  let empty = true
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!pruneEmptyDirs(join(dir, entry.name), false)) empty = false
    } else {
      empty = false
    }
  }
  if (empty && !isRoot) {
    rmSync(dir, { recursive: true, force: true })
    return true
  }
  return empty
}

/**
 * 删除本次不再存在的层:作者下架、插件剔除或整个插件树消失时,旧清单不能留在分支上,
 * 否则下一次构建会把残留的旧清单当成现行层。只删 manifest.json 与 manifest.json.sig,
 * 人工维护的 README.md 不动;删空的目录一并清理。
 * @returns {string[]} 被删除的清单相对路径
 */
function pruneStaleLayers({ mirrorRoot, expected, dryRun }) {
  const removed = []
  for (const file of listManifestFiles(mirrorRoot)) {
    const layerRel = relative(mirrorRoot, dirname(file)).split(sep).join('/')
    if (expected.has(layerRel)) continue
    if (!dryRun) rmSync(file, { force: true })
    removed.push(relative(dirname(mirrorRoot), file).split(sep).join('/'))
  }
  if (!dryRun && removed.length > 0) pruneEmptyDirs(mirrorRoot, true)
  return removed
}

/**
 * 把 pages 包里的三层清单与签名写回 ci-memory 工作区。
 * 只做文件层动作,提交与推送由流水线用 git 完成。
 * @param {object} context 上下文
 * @param {string} context.bundleRoot 已校验的 pages 包目录
 * @param {string} context.branchRoot ci-memory 工作区
 * @param {boolean} [context.dryRun] 只打印计划,不落盘
 * @returns {{root: string, layers: Array<{layer: string, layerRel: string, changed: boolean}>, removed: string[], written: number}}
 */
export function writeCiMemoryManifests({ bundleRoot, branchRoot, dryRun = false }) {
  const bundle = resolve(bundleRoot)
  if (!isDirectory(bundle)) throw new Error('pages 包目录不存在:' + bundle)
  const root = requireCiMemoryRoot(branchRoot)
  if (root === bundle) throw new Error('ci-memory 工作区不能与 pages 包目录相同:' + root)
  const layers = listLayerDirs(bundle)
  if (layers.length === 0) throw new Error('pages 包里没有可写回的层:' + bundle)
  const expected = new Set(layers.map((layer) => layer.layerRel))
  const written = []
  for (const layer of layers) {
    const source = {
      manifest: join(layer.layerDir, MANIFEST_FILE),
      signature: join(layer.layerDir, MANIFEST_FILE + MANIFEST_SIG_SUFFIX),
    }
    if (!existsSync(source.manifest)) {
      throw new Error(layerLabel(layer) + ' 缺少清单:' + source.manifest + ';请先完成构建与签名')
    }
    if (!existsSync(source.signature)) {
      throw new Error(layerLabel(layer) + ' 缺少清单签名:' + source.signature + ';清单与签名必须成对写回')
    }
    const dest = layerManifestPaths(root, layer.layerRel)
    let changed
    if (dryRun) {
      changed = !sameFile(source.manifest, dest.manifest) || !sameFile(source.signature, dest.signature)
    } else {
      mkdirSync(dest.dir, { recursive: true })
      const manifestChanged = copyIfChanged(source.manifest, dest.manifest)
      const signatureChanged = copyIfChanged(source.signature, dest.signature)
      changed = manifestChanged || signatureChanged
    }
    written.push({ layer: layer.layer, layerRel: layer.layerRel, changed })
  }
  const mirrorRoot = join(root, CI_MEMORY_LAYER_ROOT)
  const removed = pruneStaleLayers({ mirrorRoot, expected, dryRun })
  return { root, layers: written, removed, written: written.filter((item) => item.changed).length }
}
