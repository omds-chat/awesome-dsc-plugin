#!/usr/bin/env node
/**
 * 本地 npm registry 模拟器:零依赖 Node http 服务,离线联调「收录条件校验」用。
 *
 * 这是联调用具,不是 registry 实现:只模拟 npm 包的发布登记与元数据查询,
 * 不实现 tarball 存储,不实现 npm 生态的认证(没有 token,也没有 publish
 * 权限校验);数据只是本地 packages/ 目录下的 JSON 记录,目录已在
 * .gitignore 排除,不进仓库。npm 包名强校验(scripts/lib/npm-package-check.mjs)
 * 只用到元数据文档的 versions 与 dist-tags.latest 两个字段,本模拟器把
 * 这两个字段照 npm registry 的形状给出,校验脚本就能在没有外网时走通
 * 「包存在且一致」与「包不存在(NPM_PACKAGE_NOT_FOUND)」两条判定。
 *
 * 端点:
 *   GET    /<包名>          registry 元数据文档;无记录返回 npm 风格 404 {"error":"Not Found"}
 *   PUT    /<包名>          模拟发布,body 为 {"version":"x.y.z","shasum?":"40 位十六进制"};
 *                           shasum 缺省时按包名与版本计算一个确定值,重复版本覆盖更新,返回 201
 *   DELETE /<包名>/<版本>   模拟下架(unpublish 语义);最后一个版本下架后整包回到 404
 *   GET    /__health        健康检查
 *
 * 用法:
 *   node scripts/dev/npm-registry-mock.mjs
 *   node scripts/dev/npm-registry-mock.mjs --port 61123 --packages packages --host 127.0.0.1
 *
 * 端口默认 61123:61117-61122 已被其他本地联调服务占用。
 * 只监听本地回环 127.0.0.1,不对外网提供服务。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(moduleDir, '..', '..')

/** 默认端口,与 .env.example 的 NPM_REGISTRY_URL 保持一致 */
const DEFAULT_PORT = 61123
/** 默认监听地址:联调用具只开本地回环 */
const DEFAULT_HOST = '127.0.0.1'
/** 默认数据目录:仓库根 packages/,gitignore 已排除 */
const DEFAULT_PACKAGES_DIR = 'packages'
/** 请求体字节上限:发布登记只需要包名与版本,64KB 足够 */
const MAX_BODY_BYTES = 64 * 1024
/** 包名规则:与 npm-package-check 一致,dsc-xxx 或 @scope/dsc-xxx */
const PACKAGE_NAME_PATTERN = /^(?:dsc-[a-z0-9][a-z0-9._-]*|@[a-z0-9][a-z0-9._-]*\/dsc-[a-z0-9][a-z0-9._-]*)$/
/** 版本规则:x.y.z,各段为无前导零的非负整数 */
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
/** shasum 规则:npm 用 SHA-1,40 位十六进制 */
const SHASUM_PATTERN = /^[0-9a-f]{40}$/

function usage() {
  process.stdout.write([
    '用法: node scripts/dev/npm-registry-mock.mjs [选项]',
    '',
    '选项:',
    '  --port <端口>        监听端口,默认 ' + DEFAULT_PORT + '(61117-61122 已被其他联调服务占用)',
    '  --host <地址>        监听地址,默认 ' + DEFAULT_HOST + '(只开本地回环)',
    '  --packages <目录>    数据目录,默认仓库根 ' + DEFAULT_PACKAGES_DIR + '/(gitignore 已排除)',
    '  --help               显示本说明',
    '',
    '端点:',
    '  GET    /<包名>         元数据文档;无记录返回 404 {"error":"Not Found"}',
    '  PUT    /<包名>         模拟发布,body {"version":"x.y.z","shasum?":"40 位十六进制"}',
    '  DELETE /<包名>/<版本>  模拟下架(unpublish 语义)',
    '  GET    /__health       健康检查',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, host: DEFAULT_HOST, packages: join(repoRoot, DEFAULT_PACKAGES_DIR), help: false }
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
      case '--port': options.port = Number(take()); break
      case '--host': options.host = take(); break
      case '--packages': options.packages = resolve(take()); break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('--port 必须是 1 到 65535 的整数')
  }
  return options
}

/**
 * 按 x.y.z 比较两个版本号,返回负数表示 left 小于 right。
 * 与 scripts/lib/catalog.mjs 的 compareVersions 同一规则,不引入依赖。
 */
function compareVersions(left, right) {
  const a = String(left).split('.').map(Number)
  const b = String(right).split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

/** 数据文件名:encodeURIComponent 后的包名,带 % 字符,作用域斜杠也被编码,不产生子目录 */
function recordPath(packagesDir, name) {
  return join(packagesDir, encodeURIComponent(name) + '.json')
}

function readRecord(packagesDir, name) {
  const path = recordPath(packagesDir, name)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    // 数据文件损坏按无记录处理并提示,不模拟器崩掉整个服务
    process.stderr.write('[npm-registry-mock] 数据文件损坏,按无记录处理:' + path + ':' + error.message + '\n')
    return null
  }
}

function writeRecord(packagesDir, name, record) {
  mkdirSync(packagesDir, { recursive: true })
  writeFileSync(recordPath(packagesDir, name), JSON.stringify(record, null, 2) + '\n')
}

/** shasum 缺省时按包名与版本计算确定值:同一 name@version 恒得同一摘要,语义近似 tarball 摘要 */
function computeShasum(name, version) {
  return createHash('sha1').update(name + '@' + version + '\n', 'utf8').digest('hex')
}

/** 重算 dist-tags.latest:取 semver 最大的版本 */
function pickLatest(versions) {
  let latest = null
  for (const version of Object.keys(versions)) {
    if (latest === null || compareVersions(version, latest) > 0) latest = version
  }
  return latest
}

/** 构造 npm registry 形状的元数据文档 */
function metadataDocument(name, record) {
  const versions = {}
  for (const [version, item] of Object.entries(record.versions)) {
    versions[version] = { dist: { shasum: item.shasum } }
  }
  return { name, versions, 'dist-tags': { latest: pickLatest(record.versions) } }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** npm 风格 404:registry 对从未发布过的包返回 {"error":"Not Found"} */
function sendNotFound(res) {
  sendJson(res, 404, { error: 'Not Found' })
}

/** 读请求体,超限或读失败时回 null 并已答复客户端 */
function readBody(req, res) {
  return new Promise((resolvePromise) => {
    const chunks = []
    let bytes = 0
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolvePromise(value)
    }
    req.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) {
        sendJson(res, 413, { error: '请求体超过 ' + MAX_BODY_BYTES + ' 字节上限' })
        req.destroy()
        finish(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => finish(null))
  })
}

/**
 * 从请求路径解出包名(GET/PUT /<包名>)或包名与版本(DELETE /<包名>/<版本>)。
 * npm 客户端把作用域包名编码成 /@scope%2Fdsc-xxx,整体 decode 后再拆分。
 * @param {string} pathname 原始路径(已去掉查询串)
 * @param {string} method HTTP 方法
 * @returns {{name: string, version: string|null} | {error: string}}
 */
function parseTarget(pathname, method) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname.replace(/^\/+/, '').replace(/\/+$/, ''))
  } catch {
    return { error: '路径包含非法转义序列' }
  }
  if (decoded.length === 0) return { error: '缺少包名' }
  let name = decoded
  let version = null
  if (method === 'DELETE') {
    const separator = decoded.lastIndexOf('/')
    if (separator === -1) return { error: 'DELETE 需要 /<包名>/<版本> 形式的路径' }
    name = decoded.slice(0, separator)
    version = decoded.slice(separator + 1)
    if (version.length === 0) return { error: 'DELETE 路径缺少版本号' }
  }
  if (!PACKAGE_NAME_PATTERN.test(name)) {
    return { error: '包名 ' + JSON.stringify(name) + ' 不是合法 npm 包名(本模拟器只收 dsc-xxx 或 @scope/dsc-xxx 形状)' }
  }
  return { name, version }
}

/** 处理 PUT 发布登记 */
async function handlePublish(packagesDir, name, req, res) {
  const raw = await readBody(req, res)
  if (raw === null) return
  let body
  try {
    body = raw.trim().length === 0 ? {} : JSON.parse(raw)
  } catch {
    sendJson(res, 400, { error: '请求体不是合法 JSON' })
    return
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    sendJson(res, 400, { error: '请求体必须是对象 {"version":"x.y.z","shasum?":"40 位十六进制"}' })
    return
  }
  for (const key of Object.keys(body)) {
    if (key !== 'version' && key !== 'shasum') {
      sendJson(res, 400, { error: '请求体含未知字段 ' + JSON.stringify(key) + ',只接受 version 与 shasum' })
      return
    }
  }
  if (typeof body.version !== 'string' || !VERSION_PATTERN.test(body.version)) {
    sendJson(res, 400, { error: 'version 必须是 x.y.z 形式的版本号:' + JSON.stringify(body.version ?? null) })
    return
  }
  let shasum
  if (body.shasum === undefined || body.shasum === null) {
    shasum = computeShasum(name, body.version)
  } else if (typeof body.shasum !== 'string' || !SHASUM_PATTERN.test(body.shasum)) {
    sendJson(res, 400, { error: 'shasum 必须是 40 位十六进制(SHA-1):' + JSON.stringify(body.shasum) })
    return
  } else {
    shasum = body.shasum.toLowerCase()
  }
  const record = readRecord(packagesDir, name) ?? { versions: {} }
  const overwritten = Object.prototype.hasOwnProperty.call(record.versions, body.version)
  record.versions[body.version] = { shasum }
  writeRecord(packagesDir, name, record)
  sendJson(res, 201, { ok: true, name, version: body.version, shasum, overwritten, 'dist-tags': { latest: pickLatest(record.versions) } })
}

/** 处理 DELETE 下架 */
function handleUnpublish(packagesDir, name, version, res) {
  const record = readRecord(packagesDir, name)
  if (record === null || !Object.prototype.hasOwnProperty.call(record.versions, version)) {
    sendNotFound(res)
    return
  }
  delete record.versions[version]
  if (Object.keys(record.versions).length === 0) {
    // 最后一个版本下架后整包消失,后续查询回到 npm 风格 404:
    // 与 npm-package-check 的「查不到登记包名」判定对应,用来测
    // 「曾发布后下架」在收录条件里的表现
    rmSync(recordPath(packagesDir, name), { force: true })
  } else {
    writeRecord(packagesDir, name, record)
  }
  sendJson(res, 200, { ok: true, name, version, remaining: Object.keys(record.versions).length })
}

/** 统计数据目录里的包记录数,健康检查用 */
function countRecords(packagesDir) {
  if (!existsSync(packagesDir)) return 0
  return readdirSafe(packagesDir).filter((entry) => entry.endsWith('.json')).length
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

async function main() {
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

  const packagesDir = options.packages
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host ?? '127.0.0.1'))
    const pathname = url.pathname
    process.stdout.write('[npm-registry-mock] ' + req.method + ' ' + pathname + '\n')
    try {
      if (req.method === 'GET' && pathname === '/__health') {
        sendJson(res, 200, { ok: true, packages: countRecords(packagesDir), storage: packagesDir, pid: process.pid })
        return
      }
      if (req.method === 'GET' || req.method === 'PUT' || req.method === 'DELETE') {
        const target = parseTarget(pathname, req.method)
        if (target.error) {
          sendJson(res, 400, { error: target.error })
          return
        }
        if (req.method === 'GET') {
          const record = readRecord(packagesDir, target.name)
          if (record === null || Object.keys(record.versions).length === 0) {
            sendNotFound(res)
            return
          }
          sendJson(res, 200, metadataDocument(target.name, record))
          return
        }
        if (req.method === 'PUT') {
          await handlePublish(packagesDir, target.name, req, res)
          return
        }
        handleUnpublish(packagesDir, target.name, target.version, res)
        return
      }
      sendJson(res, 405, { error: '本模拟器只支持 GET /<包名>、PUT /<包名>、DELETE /<包名>/<版本> 与 GET /__health' })
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { error: '模拟器内部错误:' + (error && error.message ? error.message : String(error)) })
      else res.destroy()
    }
  })

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(options.port, options.host, () => resolvePromise())
  })
  process.stdout.write(
    '[npm-registry-mock] 监听 http://' + options.host + ':' + options.port + '/ ,数据目录 ' + packagesDir + ' ,按 Ctrl+C 停止\n',
  )
  process.stdout.write('[npm-registry-mock] 健康检查: GET /__health\n')

  await new Promise(() => {
    // 一直运行,由外部 Ctrl+C 或作业管理停止
  })
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    process.stderr.write('npm-registry-mock 启动失败:' + (error && error.message ? error.message : String(error)) + '\n')
    process.exitCode = 1
  },
)
