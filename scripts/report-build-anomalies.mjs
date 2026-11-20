#!/usr/bin/env node
/**
 * 把本次构建剔除的插件上报到本仓库的 Issue。
 *
 * 输入是构建写出的 catalog/anomalies.json。流程:
 *   1. 读异常清单,没有剔除项时直接结束;
 *   2. 用 GitHub REST API 找标题固定的追踪 Issue;
 *   3. 找到就往该 Issue 追加一条评论,找不到就新建一个;
 *   4. 全部请求都通过 curl 命令行发出,鉴权用环境变量里的 GITHUB_TOKEN,
 *      不引入任何外部服务、第三方脚本或 SDK。
 *
 * 边界:上报只是旁路。任何失败(令牌缺失、网络错误、权限不足、API 报错)
 * 都只打印警告并以 0 退出,绝不让发布失败。
 *
 * 用法:
 *   GITHUB_TOKEN=... GITHUB_REPOSITORY=omds-chat/awesome-dsc-plugin \
 *     node scripts/report-build-anomalies.mjs \
 *       --anomalies dist/pages/catalog/anomalies.json --tag v1.0.0
 *
 *   # 只检查请求体,不发任何请求
 *   node scripts/report-build-anomalies.mjs --anomalies dist/pages/catalog/anomalies.json \
 *     --repo owner/name --tag v1.0.0 --api-base http://127.0.0.1:9/ --dry-run
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/** 追踪 Issue 的固定标题:改动会让历史追踪断裂,不要随手改 */
export const TRACKER_TITLE = '[自动] 插件剔除追踪'

/** 阶段代码 → 中文说明,仅用于上报正文的可读性 */
const STAGE_LABELS = {
  versions: 'versions.json 拉取或解析',
  version: '版本产物拉取',
  meta: 'meta.json 校验',
  bundle: 'plugin.js 校验',
  'author-signature': '作者签名校验',
}

function usage() {
  process.stdout.write([
    '用法: node scripts/report-build-anomalies.mjs [选项]',
    '',
    '选项:',
    '  --anomalies <文件>   异常清单,默认 dist/pages/catalog/anomalies.json',
    '  --repo <owner/name>  目标仓库,默认取 GITHUB_REPOSITORY',
    '  --tag <tag>          本次发布的 tag,默认取异常清单里的 release 或 GITHUB_REF_NAME',
    '  --api-base <地址>    API 基址,默认取 GITHUB_API_URL 或 https://api.github.com',
    '  --token-env <变量名> 存放令牌的环境变量名,默认 GITHUB_TOKEN',
    '  --timeout <秒>       单次 curl 超时,默认 30',
    '  --dry-run            只打印请求与请求体,不发任何请求',
    '  --help               显示本说明',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    anomalies: 'dist/pages/catalog/anomalies.json',
    repo: process.env.GITHUB_REPOSITORY || '',
    tag: process.env.GITHUB_REF_NAME || '',
    apiBase: process.env.GITHUB_API_URL || 'https://api.github.com',
    tokenEnv: 'GITHUB_TOKEN',
    timeout: 30,
    dryRun: false,
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
      case '--anomalies': options.anomalies = take(); break
      case '--repo': options.repo = take(); break
      case '--tag': options.tag = take(); break
      case '--api-base': options.apiBase = take(); break
      case '--token-env': options.tokenEnv = take(); break
      case '--timeout': options.timeout = Number(take()); break
      case '--dry-run': options.dryRun = true; break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  if (!Number.isInteger(options.timeout) || options.timeout <= 0) throw new Error('--timeout 必须是正整数')
  options.apiBase = String(options.apiBase).replace(/\/+$/, '')
  options.repo = String(options.repo).replace(/^\/+|\/+$/g, '')
  return options
}

/** 表格单元格转义:竖线与换行都会破坏 Markdown 表格。 */
function cell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

function stageLabel(stage) {
  const label = STAGE_LABELS[stage]
  return label ? '"' + cell(stage) + '"(' + label + ')' : '"' + cell(stage || 'unknown') + '"'
}

/**
 * 生成上报正文:本次发布的 tag、异常条目表格,以及「已自动剔除、未阻塞发布」的说明。
 * @param {{release?: string|null, excluded?: Array<object>, collection?: string}} report 异常清单
 * @param {string} tag 本次发布的 tag
 * @returns {string} Markdown 正文
 */
export function buildIssueBody(report, tag) {
  const excluded = Array.isArray(report?.excluded) ? report.excluded : []
  const rows = excluded.map(
    (item) =>
      '| ' + cell(item.author) + ' | ' + cell(item.plugin) + ' | ' + stageLabel(item.stage) + ' | ' + cell(item.reason) + ' |',
  )
  return [
    '## 本次构建剔除的插件',
    '',
    '| 项 | 值 |',
    '|:---:|:---:|',
    '| 发布 tag | ' + cell(tag || '(未提供)') + ' |',
    '| 合集 | ' + cell(report?.collection || '(未提供)') + ' |',
    '| 剔除数量 | ' + excluded.length + ' |',
    '| 构建结论 | 其余插件正常收录并发布,本次发布未阻塞 |',
    '',
    '| 作者 | 插件 | 阶段 | 失败原因 |',
    '|:---:|:---:|:---:|:---:|',
    ...(rows.length > 0 ? rows : ['| - | - | - | - |']),
    '',
    '已自动剔除、未阻塞发布:上表中的插件没有写入本次 pages 包,也不出现在 plugins.json、' +
      'catalog/index.json 与 plugins/ 树里,其余插件照常发布。',
    '',
    '登记不合规(catalog 文件本身不合法)不走这条路径:遇到登记错误构建会直接中止,等待作者修正后再发布。',
    '',
    '完整清单见 pages 包的 catalog/anomalies.json。',
  ].join('\n')
}

/**
 * 用 curl 发一次请求,返回 {status, body}。
 * 令牌通过 stdin 传给 curl 的 --config,不出现在命令行参数里。
 */
function curlJson({ method, url, token, body, timeoutSeconds }) {
  const config = token ? 'header = "Authorization: Bearer ' + token + '"\n' : ''
  const args = [
    '-sS',
    '--max-time',
    String(timeoutSeconds),
    '-X',
    method,
    url,
    '-H',
    'Accept: application/vnd.github+json',
    '-H',
    'X-GitHub-Api-Version: 2022-11-28',
    '--config',
    '-',
    '-w',
    '\n<<<STATUS>>>%{http_code}',
  ]
  if (body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body))
  }
  const result = spawnSync('curl', args, { input: config, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error) throw new Error('调用 curl 失败:' + result.error.message)
  const output = result.stdout || ''
  const marker = output.lastIndexOf('<<<STATUS>>>')
  if (marker === -1) throw new Error('curl 没有返回 HTTP 状态码:' + (result.stderr || '').trim())
  const status = Number(output.slice(marker + '<<<STATUS>>>'.length).trim())
  const text = output.slice(0, marker).trim()
  if (!Number.isInteger(status) || status === 0) {
    throw new Error('请求失败:' + (result.stderr || '').trim())
  }
  return { status, body: text }
}

/** 打印等价 curl 命令,令牌以 *** 覆盖,--dry-run 时使用。 */
function describeRequest({ method, url, token, body }) {
  const lines = [
    'curl -sS -X ' + method + ' ' + url,
    "  -H 'Accept: application/vnd.github+json'",
    "  -H 'X-GitHub-Api-Version: 2022-11-28'",
    '  --config -   # header = "Authorization: Bearer ' + (token ? '***' : '(未设置)') + '"',
  ]
  if (body !== undefined) {
    lines.push("  -H 'Content-Type: application/json'")
    lines.push('  --data-binary ' + JSON.stringify(body))
  }
  return lines.join('\n')
}

/** 在已打开的 Issue 里按固定标题找追踪 Issue。 */
function findTrackerIssue({ apiBase, repo, token, timeoutSeconds }) {
  for (let page = 1; page <= 10; page += 1) {
    const url = apiBase + '/repos/' + repo + '/issues?state=open&per_page=100&page=' + page
    const response = curlJson({ method: 'GET', url, token, timeoutSeconds })
    if (response.status !== 200) throw new Error('列出 Issue 失败:HTTP ' + response.status + ' ' + response.body.slice(0, 200))
    let list
    try {
      list = JSON.parse(response.body)
    } catch (error) {
      throw new Error('列出 Issue 的响应不是合法 JSON:' + error.message)
    }
    if (!Array.isArray(list)) throw new Error('列出 Issue 的响应不是数组')
    for (const item of list) {
      if (item === null || typeof item !== 'object') continue
      if (item.pull_request) continue
      if (item.title === TRACKER_TITLE) return item
    }
    if (list.length < 100) break
  }
  return null
}

function runReport(options) {
  const token = process.env[options.tokenEnv] || ''
  if (!existsSync(options.anomalies)) {
    process.stdout.write('[信息] 没有异常清单 ' + options.anomalies + ',跳过上报\n')
    return 0
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(options.anomalies, 'utf8'))
  } catch (error) {
    process.stdout.write('[警告] 异常清单不是合法 JSON,跳过上报:' + error.message + '\n')
    return 0
  }
  const excluded = Array.isArray(parsed?.excluded) ? parsed.excluded : []
  if (excluded.length === 0) {
    process.stdout.write('[信息] 本次构建没有剔除插件,跳过上报\n')
    return 0
  }
  if (!options.repo) {
    process.stdout.write('[警告] 没有目标仓库(GITHUB_REPOSITORY 或 --repo),跳过上报;剔除项见 ' + options.anomalies + '\n')
    return 0
  }
  if (!token && !options.dryRun) {
    process.stdout.write('[警告] 环境变量 ' + options.tokenEnv + ' 为空,跳过上报;剔除项见 ' + options.anomalies + '\n')
    return 0
  }

  const tag = options.tag || parsed?.release || ''
  const body = buildIssueBody(parsed, tag)

  if (options.dryRun) {
    process.stdout.write('[干跑] 不上报任何请求;本次剔除 ' + excluded.length + ' 个插件\n')
    process.stdout.write('[干跑] 追踪 Issue 标题:' + TRACKER_TITLE + '\n')
    process.stdout.write('[干跑] 查找已有追踪 Issue 的请求:\n' + describeRequest({
      method: 'GET',
      url: options.apiBase + '/repos/' + options.repo + '/issues?state=open&per_page=100&page=1',
      token,
    }) + '\n')
    process.stdout.write('[干跑] 没有追踪 Issue 时新建的请求:\n' + describeRequest({
      method: 'POST',
      url: options.apiBase + '/repos/' + options.repo + '/issues',
      token,
      body: { title: TRACKER_TITLE, body },
    }) + '\n')
    process.stdout.write('[干跑] 已有追踪 Issue 时追加评论的请求:\n' + describeRequest({
      method: 'POST',
      url: options.apiBase + '/repos/' + options.repo + '/issues/<number>/comments',
      token,
      body: { body },
    }) + '\n')
    process.stdout.write('[干跑] 请求体:\n' + body + '\n')
    return 0
  }

  const issue = findTrackerIssue({ apiBase: options.apiBase, repo: options.repo, token, timeoutSeconds: options.timeout })
  if (issue && Number.isInteger(issue.number)) {
    const url = options.apiBase + '/repos/' + options.repo + '/issues/' + issue.number + '/comments'
    const response = curlJson({ method: 'POST', url, token, body: { body }, timeoutSeconds: options.timeout })
    if (response.status !== 201) throw new Error('追加评论失败:HTTP ' + response.status + ' ' + response.body.slice(0, 200))
    process.stdout.write('[信息] 已往追踪 Issue #' + issue.number + ' 追加评论:' + TRACKER_TITLE + '\n')
    return 0
  }
  const url = options.apiBase + '/repos/' + options.repo + '/issues'
  const response = curlJson({ method: 'POST', url, token, body: { title: TRACKER_TITLE, body }, timeoutSeconds: options.timeout })
  if (response.status !== 201) throw new Error('新建 Issue 失败:HTTP ' + response.status + ' ' + response.body.slice(0, 200))
  let number = null
  try {
    number = JSON.parse(response.body)?.number ?? null
  } catch {
    number = null
  }
  process.stdout.write('[信息] 已新建追踪 Issue' + (number ? ' #' + number : '') + ':' + TRACKER_TITLE + '\n')
  return 0
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write('[警告] 参数错误,跳过上报:' + error.message + '\n\n')
    usage()
    return 0
  }
  if (options.help) {
    usage()
    return 0
  }
  try {
    return runReport(options)
  } catch (error) {
    // 上报失败不得导致发布失败:打出一条明确的警告就结束。
    const reason = error && error.message ? error.message : String(error)
    process.stderr.write('[警告] 上报异常清单失败,发布不受影响:' + reason + '\n')
    process.stderr.write('::warning title=插件剔除上报失败::' + reason.replace(/\r?\n/g, ' ') + '\n')
    return 0
  }
}

if (process.argv[1] && process.argv[1].endsWith('report-build-anomalies.mjs')) {
  process.exitCode = main()
}
