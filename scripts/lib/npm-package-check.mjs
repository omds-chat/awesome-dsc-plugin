/**
 * npm 包名强校验:awesome 合集收录要求作者必须把插件发布到 npm,
 * 且 npm 包名必须与插件名一致(dsc-xxx 对应 npm 包 dsc-xxx,
 * @scope/dsc-xxx 对应 @scope/dsc-xxx)。
 *
 * 数据来源是目录形态的 catalog 登记:catalog/<作者>/<插件>/plugin.json。
 * plugin.json 的 npm 字段是可选的登记包名;省略时登记包名就是插件名本身。
 * 登记包名与插件名不一致按错误报出;registry 上查不到登记包名也按错误报出,
 * 报错都带插件 id、期望包名与实际登记包名,便于作者直接修正。
 *
 * 在线查询走 https registry(默认 https://registry.npmjs.org/)。
 * CI 可联网,查询失败即错误;本地无网时不把网络故障当登记错误,输出
 * 「跳过在线检查」警告(NPM_CHECK_OFFLINE)并跳过余下查询,结构判定照常进行。
 * 判定结果只进 problems 数组,不直接退出;是否失败由调用方按 error 级问题决定。
 *
 * 本模块不读任何构建产物,也不做签名与网络自审;registry 查询支持注入
 * fetchImpl 与 registryUrl,便于离线夹具测试。
 */
import { problem } from './layer-manifests.mjs'

/** 默认 npm registry 地址 */
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org/'

/** 登记包名与插件名不一致 */
export const NPM_NAME_MISMATCH = 'NPM_NAME_MISMATCH'
/** registry 上查不到登记包名:作者还没有发布这个包 */
export const NPM_PACKAGE_NOT_FOUND = 'NPM_PACKAGE_NOT_FOUND'
/** registry 不可达,跳过在线检查(本地无网时只警告,不阻断) */
export const NPM_CHECK_OFFLINE = 'NPM_CHECK_OFFLINE'

/** 在线查询默认超时毫秒数 */
export const NPM_QUERY_TIMEOUT_MS = 15000

/**
 * 读登记包名:plugin.json 声明了 npm 字段时用它,否则就是插件名本身。
 * @param {{name: string, npm?: string}} plugin 插件登记记录
 * @returns {string} 登记包名
 */
export function registeredNpmName(plugin) {
  return typeof plugin.npm === 'string' && plugin.npm.length > 0 ? plugin.npm : plugin.name
}

/**
 * 查询 registry 上一个包是否存在。
 * registry 对从未发布过的包返回 404;对发布后又撤销(unpublish)的包返回 200,
 * 但 versions 为空,两种情形都判为「不存在」。
 * @param {string} name npm 包名
 * @param {object} [options] 选项
 * @param {string} [options.registryUrl] registry 地址,默认官方 registry
 * @param {number} [options.timeoutMs] 查询超时毫秒数
 * @param {typeof fetch} [options.fetchImpl] 注入的 fetch 实现,夹具测试用
 * @returns {Promise<{status: 'found'|'missing'|'unreachable', url: string, latest?: string|null, reason?: string}>}
 */
export async function queryNpmPackage(name, options = {}) {
  const registryUrl = options.registryUrl || NPM_REGISTRY_URL
  const timeoutMs = options.timeoutMs ?? NPM_QUERY_TIMEOUT_MS
  const doFetch = options.fetchImpl || fetch
  const url = registryUrl.replace(/\/+$/, '') + '/' + encodeURIComponent(name)
  let response
  try {
    response = await doFetch(url, {
      headers: { accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return { status: 'unreachable', url, reason: error && error.message ? error.message : String(error) }
  }
  if (response.status === 404) return { status: 'missing', url }
  if (!response.ok) return { status: 'unreachable', url, reason: 'HTTP ' + response.status }
  let data
  try {
    data = JSON.parse(await response.text())
  } catch (error) {
    return { status: 'unreachable', url, reason: 'registry 响应不是合法 JSON:' + (error && error.message ? error.message : String(error)) }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { status: 'unreachable', url, reason: 'registry 响应顶层不是对象' }
  }
  const versions = data.versions
  if (!versions || typeof versions !== 'object' || Array.isArray(versions) || Object.keys(versions).length === 0) {
    return { status: 'missing', url }
  }
  const distTags = data['dist-tags']
  return { status: 'found', url, latest: distTags && typeof distTags.latest === 'string' ? distTags.latest : null }
}

/**
 * 校验目录形态下每个插件的 npm 包名:登记包名必须与插件名一致,且 registry 上存在。
 * 同名包只查一次 registry;registry 不可达时输出一条「跳过在线检查」警告并停止余下查询。
 * @param {object} context 上下文
 * @param {Array<{name: string, author: string, pluginRel: string, npm?: string}>} context.plugins 插件登记记录
 * @param {Array<object>} context.problems 问题收集数组
 * @param {string} [context.registryUrl] registry 地址
 * @param {number} [context.timeoutMs] 查询超时毫秒数
 * @param {typeof fetch} [context.fetchImpl] 注入的 fetch 实现,夹具测试用
 * @param {boolean} [context.skip] 为 true 时整体跳过,只记一条统计
 * @returns {Promise<{registered: number, mismatched: number, queried: number, found: number, missing: number, offlineSkipped: number, skipped: boolean}>}
 */
export async function checkNpmPackages(context = {}) {
  const { plugins = [], problems } = context
  const stats = { registered: plugins.length, mismatched: 0, queried: 0, found: 0, missing: 0, offlineSkipped: 0, skipped: false }
  if (context.skip === true) {
    stats.skipped = true
    return stats
  }
  const registryUrl = context.registryUrl || NPM_REGISTRY_URL
  const results = new Map()
  let offline = false
  for (const [index, plugin] of plugins.entries()) {
    const registered = registeredNpmName(plugin)
    const id = '插件 ' + plugin.name + '(作者 ' + plugin.author + ',' + plugin.pluginRel + ')'
    if (registered !== plugin.name) {
      stats.mismatched += 1
      problems.push(
        problem(
          'error',
          NPM_NAME_MISMATCH,
          id + ' 的登记 npm 包名 ' + JSON.stringify(registered) + ' 与插件名不一致:期望包名 ' + JSON.stringify(plugin.name) +
            ',实际登记包名 ' + JSON.stringify(registered) + ';npm 包名必须与插件名完全一致,请改为只发布与插件同名的包',
          plugin.pluginRel + '/plugin.json',
        ),
      )
    }
    if (offline) continue
    let verdict = results.get(registered)
    if (verdict === undefined) {
      stats.queried += 1
      verdict = await queryNpmPackage(registered, { registryUrl, timeoutMs: context.timeoutMs, fetchImpl: context.fetchImpl })
      results.set(registered, verdict)
    }
    if (verdict.status === 'found') {
      stats.found += 1
      continue
    }
    if (verdict.status === 'missing') {
      stats.missing += 1
      problems.push(
        problem(
          'error',
          NPM_PACKAGE_NOT_FOUND,
          id + ' 的 npm 包不存在:期望包名 ' + JSON.stringify(plugin.name) + ',实际登记包名 ' + JSON.stringify(registered) +
            ';本合集收录要求作者先把插件发布到 npm,包名与插件名一致,请在发布后重新提交(查询 ' + verdict.url + ')',
          plugin.pluginRel + '/plugin.json',
        ),
      )
      continue
    }
    // registry 不可达:本地无网时按警告跳过,不把网络故障当登记错误
    offline = true
    stats.offlineSkipped = plugins.length - index - 1
    problems.push(
      problem(
        'warning',
        NPM_CHECK_OFFLINE,
        'npm registry 不可达,跳过在线检查(' + verdict.url + ':' + String(verdict.reason) + ');' +
          '余下 ' + stats.offlineSkipped + ' 个插件不再发起在线查询,登记结构判定照常进行;CI 环境联网时会完整校验',
        null,
      ),
    )
  }
  return stats
}
