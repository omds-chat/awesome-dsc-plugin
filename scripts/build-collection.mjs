#!/usr/bin/env node
/**
 * 校验合集并生成分发内容。
 *
 * 流程:--sign 时先用 EEC 为每个版本的 plugin.js 生成 CMS 分离签名,
 * 再生成三层哈希清单(L1 合集根、L2 作者目录、L3 插件目录)并逐层签名,
 * 然后校验合集,校验不通过则以非零退出码结束并列出全部问题;
 * 校验通过后把根目录元数据、三层清单、certs/ 与 plugins/ 目录复制到输出目录,
 * 并写入 build-info.json 作为分发索引。根证书不进 dist,由 online-data 分发。
 *
 * revision 语义:该层文件集合与哈希都没变时沿用旧 revision,有变化时加一,
 * 没有旧清单时从 1 开始。旧清单从该层目录现有的 manifest.json 读取。
 *
 * 用法:
 *   node scripts/build-collection.mjs --dir . --root-ca root_ca.crt --out dist
 *   EEC_SECRET_KEY=... node scripts/build-collection.mjs --dir . --root-ca root_ca.crt --sign --out dist
 *   node scripts/build-collection.mjs --dir template --allow-placeholder-eec --out dist
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MANIFEST_FILE, formatProblems, resolveRootCaPath, verifyCollection } from './lib/collection-verify.mjs'
import { buildLayerManifests, problem } from './lib/layer-manifests.mjs'
import {
  VERSION_SIGNED_FILES,
  certMatchesKey,
  describeCertificate,
  requireOpenssl,
  resolveEecCertPath,
  resolveKeyFile,
  signFileCms,
} from './pki.mjs'

/**
 * 分发内容里的合集根文件。三层清单与签名一并分发,签名针对拷贝后的字节依然有效。
 * 终端签名证书不在根目录,由 writeDist 复制整个 certs 目录。
 */
const ROOT_DIST_FILES = ['meta.json', 'plugins.json', 'tags.json', MANIFEST_FILE, MANIFEST_FILE + '.sig']

function usage() {
  process.stdout.write([
    '用法: node scripts/build-collection.mjs [选项]',
    '',
    '选项:',
    '  --dir <目录>                合集根目录,默认当前目录',
    '  --out <目录>                分发内容输出目录,默认 dist',
    '  --root-ca <路径>            根证书路径,用于校验证书链与 CMS 签名',
    '  --sign                      用 EEC_SECRET_KEY 为每个版本的 meta.json 与 plugin.js 签名',
    '  --allow-placeholder-eec     骨架模式:根证书缺失或 certs/awesome-dsc-plugin-eec.crt 未由根 CA 签发时只警告',
    '  --collection-name <名称>    合集名称,默认取合集目录名',
    '  --help                      显示本说明',
    '',
    '环境变量:',
    '  ROOT_CA_PATH                根证书路径,等价于 --root-ca',
    '  EEC_SECRET_KEY              EEC 私钥,可为 PEM 文本或文件路径',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    dir: '.',
    out: 'dist',
    rootCa: null,
    sign: false,
    allowPlaceholderEec: false,
    collectionName: null,
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
      case '--dir': options.dir = take(); break
      case '--out': options.out = take(); break
      case '--root-ca': options.rootCa = take(); break
      case '--sign': options.sign = true; break
      case '--allow-placeholder-eec': options.allowPlaceholderEec = true; break
      case '--collection-name': options.collectionName = take(); break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  return options
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function listVersionDirs(root) {
  const pluginsIndexPath = join(root, 'plugins.json')
  if (!existsSync(pluginsIndexPath)) return []
  let pluginsIndex
  try {
    pluginsIndex = readJson(pluginsIndexPath)
  } catch {
    return []
  }
  if (!Array.isArray(pluginsIndex)) return []
  const found = []
  for (const entry of pluginsIndex) {
    if (typeof entry !== 'object' || entry === null) continue
    if (typeof entry.plugin_name !== 'string' || typeof entry.author !== 'string') continue
    const dirName = entry.plugin_name.split('/').pop()
    const pluginDir = join(root, 'plugins', entry.author, dirName)
    const versionsPath = join(pluginDir, 'versions.json')
    if (!existsSync(versionsPath)) continue
    let versions
    try {
      versions = readJson(versionsPath)
    } catch {
      continue
    }
    const list = Array.isArray(versions?.versions) ? versions.versions : []
    for (const version of list) {
      if (typeof version !== 'string') continue
      const versionDir = join(pluginDir, version)
      if (statSync(versionDir, { throwIfNoEntry: false })?.isDirectory()) found.push({ versionDir, version })
    }
  }
  return found
}

/** 解析 EEC 私钥并确认与 certs 里的终端签名证书配对。不配对时直接失败,避免产出一批无法验签的签名。 */
function prepareSigner(root, problems) {
  const source = process.env.EEC_SECRET_KEY
  if (!source) {
    problems.push(problem('error', 'SIGN_KEY_MISSING', '启用 --sign 时需要环境变量 EEC_SECRET_KEY(P-256 私钥 PEM 或路径)', null))
    return null
  }
  const eec = resolveEecCertPath(root)
  const eecPath = eec.path
  if (!existsSync(eecPath)) {
    problems.push(problem('error', 'EEC_MISSING', '合集缺少 ' + eec.relative + ',无法签名', eec.relative))
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
    if (!certMatchesKey(eecPath, keyFile.path)) {
      problems.push(
        problem(
          'error',
          'SIGN_KEY_MISMATCH',
          'EEC_SECRET_KEY 与 ' + eec.relative + ' 不是同一把密钥;请确认 certs/awesome-dsc-plugin-eec.crt 与 CI secret 配对',
          eec.relative,
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
  return { eecPath, keyFile, cleanup: () => keyFile.cleanup() }
}

/** 用 EEC 为每个版本的 plugin.js 生成 CMS 分离签名。meta.json 由 L3 清单覆盖,不再单独签名。 */
function signVersionFiles(root, signer, problems) {
  for (const { versionDir, version } of listVersionDirs(root)) {
    for (const name of VERSION_SIGNED_FILES) {
      const filePath = join(versionDir, name)
      if (!existsSync(filePath)) {
        problems.push(problem('error', 'SIGN_TARGET_MISSING', '版本 ' + version + ' 缺少待签名文件 ' + name, filePath))
        continue
      }
      try {
        signFileCms(filePath, signer.eecPath, signer.keyFile.path)
        problems.push(problem('warning', 'SIGNED', '已用 EEC 为 ' + version + '/' + name + ' 生成 CMS 签名', filePath + '.sig'))
      } catch (error) {
        problems.push(problem('error', 'SIGN_FAILED', '为 ' + version + '/' + name + ' 签名失败:' + error.message, filePath))
      }
    }
  }
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

function collectIndex(root) {
  const pluginsIndexPath = join(root, 'plugins.json')
  if (!existsSync(pluginsIndexPath)) return []
  let pluginsIndex
  try {
    pluginsIndex = readJson(pluginsIndexPath)
  } catch {
    return []
  }
  if (!Array.isArray(pluginsIndex)) return []
  const index = []
  for (const entry of pluginsIndex) {
    if (typeof entry !== 'object' || entry === null) continue
    if (typeof entry.plugin_name !== 'string' || typeof entry.author !== 'string') continue
    const dirName = entry.plugin_name.split('/').pop()
    const versionsPath = join(root, 'plugins', entry.author, dirName, 'versions.json')
    let latest = null
    let versions = []
    if (existsSync(versionsPath)) {
      try {
        const data = readJson(versionsPath)
        latest = typeof data.latest === 'string' ? data.latest : null
        versions = Array.isArray(data.versions) ? data.versions : []
      } catch {
        latest = null
        versions = []
      }
    }
    index.push({ name: entry.plugin_name, author: entry.author, latest, versions })
  }
  return index
}

function readEecFingerprint(root) {
  const eecPath = resolveEecCertPath(root).path
  if (!existsSync(eecPath)) return null
  try {
    return describeCertificate(eecPath).fingerprint
  } catch {
    return null
  }
}

function writeDist(root, outDir, collectionName) {
  if (resolve(outDir) === resolve(root)) throw new Error('输出目录不能与合集根目录相同')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  let files = 0
  for (const name of ROOT_DIST_FILES) {
    const src = join(root, name)
    if (!existsSync(src)) continue
    copyFileSync(src, join(outDir, name))
    files += 1
  }
  files += copyTree(join(root, 'certs'), join(outDir, 'certs'))
  files += copyTree(join(root, 'plugins'), join(outDir, 'plugins'))
  const index = collectIndex(root)
  const info = {
    collection: collectionName,
    plugin_count: index.length,
    author_count: new Set(index.map((item) => item.author)).size,
    eec_sha256: readEecFingerprint(root),
    plugins: index,
  }
  writeFileSync(join(outDir, 'build-info.json'), JSON.stringify(info, null, 2) + '\n', 'utf8')
  files += 1
  return { files, info }
}

function main() {
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

  try {
    requireOpenssl()
  } catch (error) {
    process.stderr.write('构建失败:' + error.message + '\n')
    return 2
  }

  const root = resolve(options.dir)
  const outDir = resolve(options.out)
  const problems = []

  const signer = options.sign ? prepareSigner(root, problems) : null
  const manifestSigner = signer ? { eecCertPath: signer.eecPath, eecKeyPath: signer.keyFile.path } : null
  let manifests = []
  try {
    if (signer) signVersionFiles(root, signer, problems)
    manifests = buildLayerManifests({ root, signer: manifestSigner, problems })
  } finally {
    if (signer) signer.cleanup()
  }

  const rootCaPath = resolveRootCaPath(options)
  const result = verifyCollection(root, {
    rootCaPath,
    allowPlaceholderEec: options.allowPlaceholderEec,
    collectionName: options.collectionName,
  })
  const allProblems = [...problems, ...result.problems]
  const errors = allProblems.filter((item) => item.level === 'error')
  const warnings = allProblems.filter((item) => item.level === 'warning')

  if (errors.length > 0) {
    process.stderr.write('合集校验未通过,共 ' + errors.length + ' 个错误:' + '\n')
    process.stderr.write(formatProblems(allProblems) + '\n')
    return 1
  }

  for (const item of manifests) {
    process.stdout.write(
      item.layer + ' 清单 ' + item.dir + '/' + MANIFEST_FILE +
      ' revision=' + item.revision +
      ',覆盖 ' + item.files + ' 个文件' +
      (item.changed ? '(已更新)' : '(未变化)') + '\n',
    )
  }
  const dist = writeDist(root, outDir, result.collectionName)
  process.stdout.write(
    '合集 ' + result.collectionName + ' 校验通过:' +
    result.stats.authors + ' 个作者,' +
    result.stats.plugins + ' 个插件,' +
    result.stats.versions + ' 个版本' + '\n',
  )
  if (warnings.length > 0) {
    process.stdout.write('警告 ' + warnings.length + ' 条:' + '\n')
    process.stdout.write(formatProblems(warnings) + '\n')
  }
  process.stdout.write('分发内容已写入 ' + outDir + ',共 ' + dist.files + ' 个文件' + '\n')
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('构建失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
