#!/usr/bin/env node
/**
 * 按 catalog 拉取插件并组装 Pages 分发包。
 *
 * 输入只有两类:
 *   catalog 目录里的登记信息(author.json、author_pub.pem、plugin.json);
 *   插件作者自己发布的 base_url 站点(versions.json、各版本 meta.json、plugin.js、可选 plugin.js.author.sig)。
 * 不读 GitHub Release 资产,也不读任何镜像。
 *
 * 产出(pages 根目录):
 *   index.html 与 assets/           来自 site 构建产物
 *   meta.json、tags.json、datalog.json 三个索引文件,由本脚本生成
 *   manifest.json、manifest.json.sig L1 清单及其签名
 *   catalog/、certs/                来自 main 分支,不纳入任何清单
 *   plugins/                        按 catalog 拉取并构建出的父子树
 *
 * plugins 树:
 *   plugins/author_manifest.json
 *   plugins/<作者>/author_pub.pem
 *   plugins/<作者>/plugin_manifest.json
 *   plugins/<作者>/manifest.json(+ .sig)                L2
 *   plugins/<作者>/<插件>/versions.json
 *   plugins/<作者>/<插件>/manifest.json(+ .sig)          L3
 *   plugins/<作者>/<插件>/<版本>/{meta.json,plugin.js,plugin.js.sig[,plugin.js.author.sig]}
 *
 * 任一步失败即整体失败:所有产出先落在临时目录,全部校验通过后才替换 --out,
 * 因此不会留下半成品。pages 根目录不放 eec.pem,合集证书只在 certs/awesome-dsc-plugin-eec.crt。
 *
 * 用法:
 *   EEC_SECRET_KEY=... ROOT_CA_PATH=root_ca.crt node scripts/build-from-catalog.mjs \\
 *     --catalog catalog --certs certs --site site/dist --out dist/pages \\
 *     --published-base https://omdsc-dev.github.io/awesome-dsc-plugin/
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { formatProblems, verifyCollection } from './lib/collection-verify.mjs'
import { buildLayerManifests, listLayerDirs, problem } from './lib/layer-manifests.mjs'
import { EEC_CERT_BASENAME, certMatchesKey, requireOpenssl, resolveKeyFile, signFileCms, verifyChain } from './pki.mjs'
import { fetchVersion, fetchVersions, readCatalog } from './lib/catalog.mjs'

/** site 产物里不允许出现的顶层名字:这些位置由本脚本独占,冲突会让人分不清来源 */
const RESERVED_TOP_LEVEL = [
  'plugins',
  'catalog',
  'certs',
  'meta.json',
  'tags.json',
  'datalog.json',
  'manifest.json',
  'manifest.json.sig',
  'eec.pem',
]

function usage() {
  process.stdout.write([
    '用法: node scripts/build-from-catalog.mjs [选项]',
    '',
    '选项:',
    '  --catalog <目录>          catalog 目录,默认 catalog',
    '  --certs <目录>            证书目录,默认 certs',
    '  --site <目录>             site 构建产物目录,默认 site/dist',
    '  --out <目录>              分发包输出目录,默认 dist/pages',
    '  --meta <文件>             合集元数据来源,默认 meta.json',
    '  --tags <文件>             预设标签来源,默认 tags.json',
    '  --published-base <地址>   已发布站点基址,用于读取上一次的清单 revision;取不到时从 1 开始',
    '  --root-ca <路径>          根证书路径,给出时对分发包做证书链与签名自检',
    '  --collection-name <名称>  合集名称,默认取 package.json 的 name',
    '  --timeout <毫秒>          单次 HTTP 请求超时,默认 30000',
    '  --help                    显示本说明',
    '',
    '环境变量:',
    '  EEC_SECRET_KEY            终端签名私钥,PEM 文本或文件路径;必需',
    '  ROOT_CA_PATH              根证书路径,等价于 --root-ca',
    '  PUBLISHED_BASE            已发布站点基址,等价于 --published-base',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    catalog: 'catalog',
    certs: 'certs',
    site: join('site', 'dist'),
    out: join('dist', 'pages'),
    meta: 'meta.json',
    tags: 'tags.json',
    publishedBase: null,
    rootCa: null,
    collectionName: null,
    timeout: 30000,
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
      case '--catalog': options.catalog = take(); break
      case '--certs': options.certs = take(); break
      case '--site': options.site = take(); break
      case '--out': options.out = take(); break
      case '--meta': options.meta = take(); break
      case '--tags': options.tags = take(); break
      case '--published-base': options.publishedBase = take(); break
      case '--root-ca': options.rootCa = take(); break
      case '--collection-name': options.collectionName = take(); break
      case '--timeout': options.timeout = Number(take()); break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  if (!Number.isInteger(options.timeout) || options.timeout <= 0) throw new Error('--timeout 必须是正整数')
  return options
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function readJsonFile(path, label) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(label + ' 无法读取:' + error.message)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(label + ' 不是合法 JSON:' + error.message)
  }
}

function writeJsonFile(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function copyTree(srcDir, destDir) {
  if (!existsSync(srcDir)) return 0
  mkdirSync(destDir, { recursive: true })
  let count = 0
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name)
    const dest = join(destDir, entry.name)
    if (entry.isDirectory()) {
      count += copyTree(src, dest)
    } else if (entry.isFile()) {
      copyFileSync(src, dest)
      count += 1
    }
  }
  return count
}

/** 校验 site 产物:必须有 index.html,且顶层不能占用本脚本独占的名字。 */
function inspectSite(siteDir, problems) {
  if (!isDirectory(siteDir)) throw new Error('site 产物目录不存在:' + siteDir + '(先执行 site 构建)')
  if (!existsSync(join(siteDir, 'index.html'))) throw new Error('site 产物目录缺少 index.html:' + siteDir)
  if (!isDirectory(join(siteDir, 'assets'))) {
    problems.push(problem('warning', 'SITE_ASSETS_MISSING', 'site 产物目录没有 assets/ 子目录,分发包的样式与脚本可能缺失', siteDir))
  }
  const conflicts = readdirSync(siteDir).filter((name) => RESERVED_TOP_LEVEL.includes(name))
  if (conflicts.length > 0) {
    throw new Error('site 产物目录出现保留名字,会与流水线产出冲突:' + conflicts.join(', '))
  }
}

/**
 * 解析终端签名私钥,并确认它与证书目录里的终端签名证书配对。
 * 不配对时直接失败,避免产出一批无法验签的签名。
 */
function prepareSigner({ certsDir, rootCaPath, problems }) {
  const eecCertPath = join(certsDir, EEC_CERT_BASENAME)
  if (!existsSync(eecCertPath)) {
    problems.push(problem('error', 'EEC_MISSING', '证书目录缺少 ' + EEC_CERT_BASENAME, 'certs/' + EEC_CERT_BASENAME))
    return null
  }
  if (rootCaPath) {
    const chain = verifyChain(eecCertPath, rootCaPath)
    if (!chain.ok) {
      problems.push(problem('error', 'EEC_NOT_CHAINED', 'certs/' + EEC_CERT_BASENAME + ' 不是由给定根证书签发:' + chain.reason, 'certs/' + EEC_CERT_BASENAME))
      return null
    }
  }
  const source = process.env.EEC_SECRET_KEY
  if (!source) {
    problems.push(problem('error', 'SIGN_KEY_MISSING', '需要环境变量 EEC_SECRET_KEY(P-256 私钥 PEM 或路径)', null))
    return null
  }
  let keyFile
  try {
    keyFile = resolveKeyFile(source, 'EEC_SECRET_KEY')
  } catch (error) {
    problems.push(problem('error', 'SIGN_KEY_INVALID', 'EEC 私钥不可用:' + error.message, null))
    return null
  }
  try {
    if (!certMatchesKey(eecCertPath, keyFile.path)) {
      problems.push(
        problem(
          'error',
          'SIGN_KEY_MISMATCH',
          'EEC_SECRET_KEY 与 certs/' + EEC_CERT_BASENAME + ' 不是同一把密钥;请确认证书与 CI secret 配对',
          'certs/' + EEC_CERT_BASENAME,
        ),
      )
      keyFile.cleanup()
      return null
    }
  } catch (error) {
    problems.push(problem('error', 'SIGN_KEY_INVALID', 'EEC 私钥不可用:' + error.message, null))
    keyFile.cleanup()
    return null
  }
  return { eecCertPath, keyFile, cleanup: () => keyFile.cleanup() }
}

/** 列出分发包里每个版本的目录,顺序为作者、插件、版本。 */
function listVersionDirs(root) {
  const found = []
  const pluginsDir = join(root, 'plugins')
  if (!isDirectory(pluginsDir)) return found
  for (const author of readdirSync(pluginsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const authorDir = join(pluginsDir, author)
    for (const plugin of readdirSync(authorDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
      const pluginDir = join(authorDir, plugin)
      const versionsPath = join(pluginDir, 'versions.json')
      if (!existsSync(versionsPath)) continue
      let versions = []
      try {
        const data = JSON.parse(readFileSync(versionsPath, 'utf8'))
        versions = Array.isArray(data?.versions) ? data.versions.filter((item) => typeof item === 'string') : []
      } catch {
        versions = []
      }
      for (const version of versions) {
        const versionDir = join(pluginDir, version)
        if (isDirectory(versionDir)) found.push({ author, plugin, version, versionDir })
      }
    }
  }
  return found
}

/** 用终端签名证书为每个版本的 plugin.js 重新签名。作者自签名原样保留,不做改动。 */
function signPlugins(root, signer, problems) {
  let signed = 0
  for (const { author, plugin, version, versionDir } of listVersionDirs(root)) {
    const filePath = join(versionDir, 'plugin.js')
    if (!existsSync(filePath)) {
      problems.push(problem('error', 'SIGN_TARGET_MISSING', author + '/' + plugin + '/' + version + ' 缺少 plugin.js', 'plugins/' + author + '/' + plugin + '/' + version + '/plugin.js'))
      continue
    }
    try {
      signFileCms(filePath, signer.eecCertPath, signer.keyFile.path)
      signed += 1
    } catch (error) {
      problems.push(problem('error', 'SIGN_FAILED', '为 ' + author + '/' + plugin + '/' + version + '/plugin.js 签名失败:' + error.message, 'plugins/' + author + '/' + plugin + '/' + version + '/plugin.js'))
    }
  }
  return signed
}

/**
 * 按 catalog 拉取并写出 plugins 树。
 * 每个插件的版本列表来自 base_url/versions.json,逐版本拉 meta.json、plugin.js 与可选作者签名。
 * 任何一项校验失败都记为 error,调用方在 error 非空时不产出分发包。
 */
async function writePluginsTree({ staging, catalog, problems, timeoutMs }) {
  const pluginsDir = join(staging, 'plugins')
  mkdirSync(pluginsDir, { recursive: true })
  writeJsonFile(
    join(pluginsDir, 'author_manifest.json'),
    catalog.authors.map((author) => ({ username: author.username, profile: author.profile })).sort((left, right) => (left.username < right.username ? -1 : 1)),
  )

  let versionCount = 0
  for (const author of catalog.authors) {
    const authorDir = join(pluginsDir, author.username)
    mkdirSync(authorDir, { recursive: true })
    copyFileSync(author.pubPath, join(authorDir, 'author_pub.pem'))
    writeJsonFile(
      join(authorDir, 'plugin_manifest.json'),
      author.plugins.map((plugin) => plugin.name).sort(),
    )

    for (const plugin of author.plugins) {
      const pluginDir = join(authorDir, plugin.dirName)
      mkdirSync(pluginDir, { recursive: true })
      let versionsInfo
      try {
        versionsInfo = await fetchVersions(plugin.baseUrl, { timeoutMs })
      } catch (error) {
        problems.push(problem('error', 'VERSIONS_FETCH_FAILED', plugin.name + ' 的版本列表拉取失败:' + error.message, plugin.pluginRel + '/' + 'plugin.json'))
        continue
      }
      writeJsonFile(join(pluginDir, 'versions.json'), { latest: versionsInfo.latest, versions: versionsInfo.versions })

      for (const version of versionsInfo.versions) {
        const versionDir = join(pluginDir, version)
        mkdirSync(versionDir, { recursive: true })
        let payload
        try {
          payload = await fetchVersion(plugin.baseUrl, version, { timeoutMs })
        } catch (error) {
          problems.push(problem('error', 'VERSION_FETCH_FAILED', plugin.name + ' ' + version + ' 拉取失败:' + error.message, plugin.pluginRel))
          continue
        }
        const meta = payload.meta
        if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
          problems.push(problem('error', 'VERSION_META_INVALID', plugin.name + ' ' + version + ' 的 meta.json 必须是对象', plugin.pluginRel))
          continue
        }
        if (meta.name !== plugin.name) {
          problems.push(
            problem('error', 'VERSION_META_MISMATCH', plugin.name + ' ' + version + ' 的 meta.json name 为 ' + JSON.stringify(meta.name) + ',要求 ' + plugin.name, plugin.pluginRel),
          )
          continue
        }
        if (meta.version !== version) {
          problems.push(
            problem('error', 'VERSION_META_MISMATCH', plugin.name + ' ' + version + ' 的 meta.json version 为 ' + JSON.stringify(meta.version) + ',要求 ' + version, plugin.pluginRel),
          )
          continue
        }
        if (!payload.pluginJs || payload.pluginJs.length === 0) {
          problems.push(problem('error', 'PLUGIN_JS_EMPTY', plugin.name + ' ' + version + ' 的 plugin.js 为空', plugin.pluginRel))
          continue
        }
        writeJsonFile(join(versionDir, 'meta.json'), meta)
        writeFileSync(join(versionDir, 'plugin.js'), payload.pluginJs)
        if (payload.authorSig) {
          if (payload.authorSig.length === 0) {
            problems.push(problem('error', 'AUTHOR_SIG_EMPTY', plugin.name + ' ' + version + ' 的 plugin.js.author.sig 为空', plugin.pluginRel))
          } else {
            writeFileSync(join(versionDir, 'plugin.js.author.sig'), payload.authorSig)
          }
        }
        versionCount += 1
      }
    }
  }
  return versionCount
}

/** 生成 datalog.json:每个插件一条,标签暂缺,统一写空数组。 */
function buildDatalog(plugins) {
  return plugins
    .map((plugin) => ({ plugin_name: plugin.name, author: plugin.author, tag: [] }))
    .sort((left, right) => (left.plugin_name < right.plugin_name ? -1 : 1))
}

/** 读取合集元数据,校验下载计数相关字段。 */
function readCollectionMeta(path) {
  const data = readJsonFile(path, 'meta.json')
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('meta.json 的顶层必须是对象')
  if (typeof data.DOWNLOAD_COUNT_ENABLE !== 'boolean') throw new Error('meta.json 的 DOWNLOAD_COUNT_ENABLE 必须是布尔值')
  if (data.DOWNLOAD_COUNT_ENABLE === true) {
    if (typeof data.DOWNLOAD_COUNT_API !== 'string' || data.DOWNLOAD_COUNT_API.length === 0) {
      throw new Error('meta.json 的 DOWNLOAD_COUNT_API 必须是非空字符串')
    }
    if (typeof data.API_NEED_IP !== 'boolean') throw new Error('meta.json 的 API_NEED_IP 必须是布尔值')
  }
  return data
}

/** 读取预设标签,必须是字符串数组。 */
function readTags(path) {
  const data = readJsonFile(path, 'tags.json')
  if (!Array.isArray(data)) throw new Error('tags.json 的顶层必须是字符串数组')
  for (const tag of data) {
    if (typeof tag !== 'string' || tag.length === 0) throw new Error('tags.json 含非字符串或空标签')
  }
  return data
}

/**
 * 从已发布站点读取三层清单的上一次 revision。
 * 取不到或结构不对时返回 null,该层 revision 从 1 开始,并记一条警告。
 */
async function loadPreviousManifests({ publishedBase, layerRels, problems, timeoutMs }) {
  const map = new Map()
  if (!publishedBase) {
    problems.push(problem('warning', 'PUBLISHED_BASE_MISSING', '未提供已发布站点基址,三层清单的 revision 都从 1 开始', null))
    return map
  }
  const base = publishedBase.replace(/\/+$/, '')
  await Promise.all(
    layerRels.map(async (layerRel) => {
      const url = base + '/' + (layerRel ? layerRel + '/' : '') + 'manifest.json'
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
        if (!response.ok) return
        const data = await response.json()
        if (typeof data !== 'object' || data === null || !Array.isArray(data.files)) return
        map.set(layerRel, data)
      } catch {
        return
      }
    }),
  )
  if (map.size === 0) {
    problems.push(problem('warning', 'PREVIOUS_MANIFEST_MISSING', '已发布站点没有可用的清单,三层清单的 revision 从 1 开始', null))
  }
  return map
}

function resolveCollectionName(options) {
  if (options.collectionName) return options.collectionName
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    if (typeof pkg.name === 'string' && pkg.name.length > 0) return pkg.name
  } catch {
    // 没有 package.json 时退回目录名
  }
  return basename(process.cwd())
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write('构建失败:' + error.message + '\n\n')
    usage()
    return 2
  }
  if (options.help) {
    usage()
    return 0
  }

  requireOpenssl()

  const catalogDir = resolve(options.catalog)
  const certsDir = resolve(options.certs)
  const siteDir = resolve(options.site)
  const outDir = resolve(options.out)
  const rootCaPath = options.rootCa ? resolve(options.rootCa) : process.env.ROOT_CA_PATH ? resolve(process.env.ROOT_CA_PATH) : null
  const publishedBase = options.publishedBase || process.env.PUBLISHED_BASE || null

  if (rootCaPath && !existsSync(rootCaPath)) throw new Error('根证书不存在:' + rootCaPath)

  const problems = []
  inspectSite(siteDir, problems)
  const catalog = readCatalog({ catalogDir, problems })
  if (!isDirectory(certsDir)) throw new Error('证书目录不存在:' + certsDir)
  if (!existsSync(join(certsDir, EEC_CERT_BASENAME))) throw new Error('证书目录缺少 ' + EEC_CERT_BASENAME + ':' + certsDir)

  const staging = outDir + '.staging-' + process.pid + '-' + Date.now()
  let signer = null
  try {
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })

    const versionCount = await writePluginsTree({ staging, catalog, problems, timeoutMs: options.timeout })
    const errors = problems.filter((item) => item.level === 'error')
    if (errors.length > 0) {
      process.stderr.write('拉取或校验插件失败,共 ' + errors.length + ' 个错误:\n' + formatProblems(problems) + '\n')
      return 1
    }

    // site 产物放根目录,再把 catalog 与 certs 原样复制进来
    copyTree(siteDir, staging)
    const catalogFiles = copyTree(catalogDir, join(staging, 'catalog'))
    const certFiles = copyTree(certsDir, join(staging, 'certs'))
    writeJsonFile(join(staging, 'meta.json'), readCollectionMeta(resolve(options.meta)))
    writeJsonFile(join(staging, 'tags.json'), readTags(resolve(options.tags)))
    writeJsonFile(join(staging, 'datalog.json'), buildDatalog(catalog.plugins))

    if (existsSync(join(staging, 'eec.pem'))) {
      throw new Error('分发包根目录不允许出现 eec.pem;合集证书只在 certs/' + EEC_CERT_BASENAME)
    }

    signer = prepareSigner({ certsDir: join(staging, 'certs'), rootCaPath, problems })
    const signErrors = problems.filter((item) => item.level === 'error')
    if (signErrors.length > 0) {
      process.stderr.write('签名准备失败:\n' + formatProblems(problems) + '\n')
      return 1
    }
    const signedCount = signPlugins(staging, signer, problems)

    const layers = listLayerDirs(staging)
    const previous = await loadPreviousManifests({
      publishedBase,
      layerRels: layers.map((layer) => layer.layerRel),
      problems,
      timeoutMs: options.timeout,
    })
    const manifests = buildLayerManifests({
      root: staging,
      signer: { eecCertPath: signer.eecCertPath, eecKeyPath: signer.keyFile.path },
      problems,
      previousResolver: (layerRel) => previous.get(layerRel) ?? null,
    })

    const finalErrors = problems.filter((item) => item.level === 'error')
    if (finalErrors.length > 0) {
      process.stderr.write('构建未通过,共 ' + finalErrors.length + ' 个错误:\n' + formatProblems(problems) + '\n')
      return 1
    }

    if (rootCaPath) {
      const result = verifyCollection(staging, { rootCaPath, collectionName: resolveCollectionName(options) })
      if (!result.ok) {
        process.stderr.write('分发包自检未通过,共 ' + result.errorCount + ' 个错误:\n' + formatProblems(result.problems) + '\n')
        return 1
      }
      for (const warning of result.problems) {
        process.stdout.write('[警告] ' + warning.code + ' ' + warning.message + '\n')
      }
    } else {
      process.stdout.write('[警告] 未提供根证书,跳过分发包自检(证书链与 CMS 签名未校验)\n')
    }

    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(join(outDir, '..'), { recursive: true })
    renameSync(staging, outDir)
    signer.cleanup()
    signer = null

    process.stdout.write(
      '分发包已生成:' + outDir + '\n' +
      '  作者 ' + catalog.authors.length + ' 个,插件 ' + catalog.plugins.length + ' 个,版本 ' + versionCount + ' 个\n' +
      '  plugin.js 已用合集 EEC 重新签名 ' + signedCount + ' 份\n' +
      '  catalog 复制 ' + catalogFiles + ' 个文件,certs 复制 ' + certFiles + ' 个文件\n',
    )
    for (const item of manifests) {
      process.stdout.write('  ' + item.layer + ' 清单 ' + item.dir + '/manifest.json revision=' + item.revision + ',覆盖 ' + item.files + ' 个文件' + (item.changed ? '(已更新)' : '(未变化)') + '\n')
    }
    const warnings = problems.filter((item) => item.level === 'warning')
    if (warnings.length > 0) {
      process.stdout.write('警告 ' + warnings.length + ' 条:\n' + formatProblems(warnings) + '\n')
    }
    return 0
  } finally {
    if (signer) signer.cleanup()
    rmSync(staging, { recursive: true, force: true })
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  process.stderr.write('构建失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
