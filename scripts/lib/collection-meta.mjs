/**
 * 合集元数据 site/meta.json 的读取与校验。
 *
 * 构建脚本用它写 pages 包的 meta.json,维护者自查脚本用它校验站点设置,
 * 两处判定必须一致,因此只有这一份实现。
 */
import { readFileSync } from 'node:fs'

/**
 * 读取合集元数据,校验下载计数相关字段。
 * 结构不合法时抛出带原因的 Error,由调用方决定中止构建还是记为问题。
 * @param {string} path site/meta.json 路径
 * @param {string} [label] 报错用的名称
 * @returns {object} meta.json 内容
 */
export function readCollectionMeta(path, label = 'meta.json') {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(label + ' 无法读取:' + error.message)
  }
  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new Error(label + ' 不是合法 JSON:' + error.message)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error(label + ' 的顶层必须是对象')
  if (typeof data.DOWNLOAD_COUNT_ENABLE !== 'boolean') throw new Error(label + ' 的 DOWNLOAD_COUNT_ENABLE 必须是布尔值')
  if (data.DOWNLOAD_COUNT_ENABLE === true) {
    if (typeof data.DOWNLOAD_COUNT_API !== 'string' || data.DOWNLOAD_COUNT_API.length === 0) {
      throw new Error(label + ' 的 DOWNLOAD_COUNT_API 必须是非空字符串')
    }
    if (typeof data.API_NEED_IP !== 'boolean') throw new Error(label + ' 的 API_NEED_IP 必须是布尔值')
  }
  return data
}
