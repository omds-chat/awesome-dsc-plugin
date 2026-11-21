/**
 * 产物静态扫描:检查 plugin.js 有没有自行发起网络调用。
 *
 * 契约:插件不得自建网络通道。插件需要网络能力时由宿主提供 context.net,插件可以转发或包装它,
 * 但不得直接使用全局 fetch、XMLHttpRequest、WebSocket、EventSource、navigator.sendBeacon,
 * 也不得用 import() 加载远程地址。
 *
 * 这是收录侧门禁,不是运行时拦截:只读产物字节、按文本匹配,命中报 PLUGIN_NETWORK_SELFTALK,
 * 并指出命中的字面量与所在行、列。构建期命中让该插件从本次发布剔除;分发自检命中记为错误。
 *
 * 判定口径:只匹配全局对象上的直接调用——方法名前一个字符不是点号,或前面明确写着 window、
 * globalThis、self、global 这类全局对象。因此 context.net.fetch(...)、net.fetch(...) 这类
 * 转发调用不算命中,插件包装宿主网络能力不受影响。
 *
 * 已知误伤:本模块不是 JavaScript 解析器,不区分代码、注释、字符串与正则字面量,同名字样照样命中;
 * 把全局调用赋给别名后再调用(例如 const send = fetch; send(url))同样检测不到。
 * 误伤时由作者在注释或 PR 说明中解释,或改写为 context.net 转发。
 */
import { readFileSync } from 'node:fs'

/** 命中网络自建调用时使用的问题代码 */
export const PLUGIN_NETWORK_SELFTALK = 'PLUGIN_NETWORK_SELFTALK'

/** 方法名前一个字符不是点号、不是标识符字符 */
const BOUNDARY = '(?<![\\w$.])'

/** 允许出现在方法名前的全局对象限定符,例如 window.fetch( */
const GLOBAL_QUALIFIER = '(?:(?:window|globalThis|self|global)\\s*\\.\\s*)?'

/**
 * 扫描规则。每条规则对应一种自建网络通道,id 用于报告,label 用于说明命中的是什么写法。
 * 规则只描述「怎么认出这个字面量」,不含任何修复建议;建议写在文档与报错文案里。
 */
export const NETWORK_RULES = [
  {
    id: 'fetch',
    label: '全局 fetch(',
    pattern: new RegExp(BOUNDARY + GLOBAL_QUALIFIER + 'fetch\\s*\\(', 'g'),
  },
  {
    id: 'xmlhttprequest',
    label: 'XMLHttpRequest',
    pattern: new RegExp(BOUNDARY + GLOBAL_QUALIFIER + 'XMLHttpRequest\\b', 'g'),
  },
  {
    id: 'websocket',
    label: 'WebSocket',
    pattern: new RegExp(BOUNDARY + GLOBAL_QUALIFIER + 'WebSocket\\b', 'g'),
  },
  {
    id: 'eventsource',
    label: 'EventSource',
    pattern: new RegExp(BOUNDARY + GLOBAL_QUALIFIER + 'EventSource\\b', 'g'),
  },
  {
    id: 'sendbeacon',
    label: 'navigator.sendBeacon',
    pattern: new RegExp(
      BOUNDARY + GLOBAL_QUALIFIER + 'navigator\\s*\\.\\s*sendBeacon\\b|' + BOUNDARY + 'sendBeacon\\s*\\(',
      'g',
    ),
  },
  {
    id: 'remote-import',
    label: 'import() 远程地址',
    // 只认字符串字面量开头的远程地址:http://、https:// 与协议相对的 //host/path
    pattern: new RegExp(
      BOUNDARY + 'import\\s*\\(\\s*(?:\\/\\*[\\s\\S]*?\\*\\/\\s*)?([\'"\`])(?:https?:)?\\/\\/[^\'"\`\\s]*\\1',
      'g',
    ),
  },
]

/** 单条命中描述里的字面量长度上限,避免超长行撑破报告 */
const MAX_LITERAL_LENGTH = 120
/** 单条命中描述里所在行内容的长度上限 */
const MAX_LINE_LENGTH = 160

/**
 * 把文本切成行起始偏移表,供二分定位行列使用。
 * @param {string} source 文本
 * @returns {number[]} 每行首个字符的偏移
 */
function buildLineStarts(source) {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

/**
 * 把字符偏移换算成 1 起始的行号与列号。
 * @param {number[]} lineStarts 行起始偏移表
 * @param {number} offset 字符偏移
 * @returns {{line: number, column: number}}
 */
function locate(lineStarts, offset) {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (lineStarts[middle] <= offset) low = middle
    else high = middle - 1
  }
  return { line: low + 1, column: offset - lineStarts[low] + 1 }
}

/** 把可能跨行或超长的字面量压成一行,便于报告阅读。 */
function compress(text, limit) {
  const flattened = text.replace(/\s+/g, ' ').trim()
  return flattened.length > limit ? flattened.slice(0, limit) + '…' : flattened
}

/**
 * 取某一行去掉首尾空白后的内容,供报告展示命中上下文。
 * @param {string} source 文本
 * @param {number[]} lineStarts 行起始偏移表
 * @param {number} line 1 起始行号
 * @returns {string}
 */
function lineTextAt(source, lineStarts, line) {
  const start = lineStarts[line - 1]
  const end = line < lineStarts.length ? lineStarts[line] - 1 : source.length
  return compress(source.slice(start, end), MAX_LINE_LENGTH)
}

/**
 * 扫描一段插件源码。
 * @param {string} source 插件产物文本(plugin.js 内容)
 * @param {object} [options] 选项
 * @param {string} [options.relative] 报告里使用的相对路径,默认 plugin.js
 * @returns {{ok: boolean, hits: Array<object>, counts: Record<string, number>, total: number}}
 */
export function scanPluginSource(source, options = {}) {
  const text = typeof source === 'string' ? source : ''
  const relative = options.relative || 'plugin.js'
  const lineStarts = buildLineStarts(text)
  const hits = []
  const counts = {}
  for (const rule of NETWORK_RULES) {
    counts[rule.id] = 0
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags)
    for (const match of text.matchAll(pattern)) {
      const offset = match.index ?? 0
      const { line, column } = locate(lineStarts, offset)
      counts[rule.id] += 1
      hits.push({
        code: PLUGIN_NETWORK_SELFTALK,
        rule: rule.id,
        label: rule.label,
        literal: compress(match[0], MAX_LITERAL_LENGTH),
        offset,
        line,
        column,
        lineText: lineTextAt(text, lineStarts, line),
        path: relative,
      })
    }
  }
  hits.sort((left, right) => left.offset - right.offset)
  return { ok: hits.length === 0, hits, counts, total: hits.length }
}

/**
 * 扫描一个 plugin.js 文件。文件读不到时抛出异常,由调用方决定是报错还是跳过。
 * @param {string} filePath 文件绝对路径
 * @param {object} [options] 选项
 * @param {string} [options.relative] 报告里使用的相对路径
 * @returns {{ok: boolean, hits: Array<object>, counts: Record<string, number>, total: number}}
 */
export function scanPluginFile(filePath, options = {}) {
  return scanPluginSource(readFileSync(filePath, 'utf8'), options)
}

/**
 * 把一条命中描述成「第 X 行第 Y 列 字面量(写法)」,报错与异常清单共用这一种句式。
 * @param {object} hit scanPluginSource 的命中项
 * @returns {string}
 */
export function describeNetworkHit(hit) {
  return '第 ' + hit.line + ' 行第 ' + hit.column + ' 列 ' + JSON.stringify(hit.literal) + '(' + hit.label + ')'
}

/**
 * 把多条命中压成一句话,默认最多列出前 5 条,其余只报数量。
 * @param {Array<object>} hits 命中列表
 * @param {number} [limit] 最多列出的条数
 * @returns {string}
 */
export function summarizeNetworkHits(hits, limit = 5) {
  const shown = hits.slice(0, limit).map(describeNetworkHit)
  const rest = hits.length - shown.length
  return shown.join('、') + (rest > 0 ? ',另有 ' + rest + ' 处未列出' : '')
}
