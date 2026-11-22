#!/usr/bin/env node
/**
 * 合集自洽性校验,针对一个已经组装好的合集目录(pages 包),供 CI 与开发者本地使用。
 * 仓库根不是合集目录:仓库级校验用 scripts/verify-catalog.mjs,两条 pages 包校验由 verify-bundle.mjs 合并。
 *
 * 与 build-collection.mjs 共用 lib/collection-verify.mjs 的校验逻辑,只读不写。
 * 校验覆盖:证书链、三层哈希清单(存在性、结构、路径、覆盖范围、SHA-512、清单签名)、
 * 版本目录必需文件与 plugin.js.sig、作者签名、标签与插件登记的一致性,
 * 以及 plugin.js 的网络自建静态扫描(命中报 PLUGIN_NETWORK_SELFTALK 警告,只警告、不阻断)。
 * 证书链与 CMS 签名校验需要根证书:用 --root-ca 指定,或设置环境变量 ROOT_CA_PATH。
 *
 * 用法:
 *   node scripts/verify-collection.mjs --dir dist/pages --root-ca root_ca.crt
 *   (合集目录含 catalog/ 副本时,本命令同时做 npm 包名强校验,详见下文 --skip-npm)
 *   ROOT_CA_PATH=root_ca.crt node scripts/verify-collection.mjs --dir dist/pages
 *   node scripts/verify-collection.mjs --dir template --allow-placeholder-eec
 *   node scripts/verify-collection.mjs --dir dist/pages --allow-missing-manifest
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { readCatalog } from './lib/catalog.mjs'
import { formatProblems, resolveRootCaPath, verifyCollection } from './lib/collection-verify.mjs'
import { NPM_REGISTRY_URL, checkNpmPackages } from './lib/npm-package-check.mjs'
import { resolveNpmRegistryUrl } from './lib/env.mjs'
import { opensslVersion } from './pki.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/verify-collection.mjs [选项]',
    '',
    '选项:',
    '  --dir <目录>                合集根目录,默认当前目录',
    '  --root-ca <路径>            根证书路径,用于校验证书链与 CMS 签名',
    '  --allow-placeholder-eec     骨架模式:根证书缺失、certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt 未由根 CA 签发、清单或清单签名缺失时只警告',
    '  --allow-missing-manifest    只放开三层清单与清单签名缺失,结构与哈希检查照常执行',
    '  --registry <地址>           npm registry 地址,默认读环境变量 NPM_REGISTRY_URL(缺省 ' + NPM_REGISTRY_URL + ')',
    '  --skip-npm                  跳过 catalog 副本的 npm 包名在线检查',
    '  --collection-name <名称>    合集名称,默认取合集目录名',
    '  --json                      以 JSON 输出校验结果',
    '  --help                      显示本说明',
    '',
    '环境变量:',
    '  ROOT_CA_PATH                根证书路径,等价于 --root-ca',
    '  NPM_REGISTRY_URL            npm registry 地址,等价于 --registry;离线联调指向组织仓工具 .github/tools/dev-local-npmjs/dev-local-npmjs.mjs(见 README「本地校验」)',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    dir: '.',
    rootCa: null,
    allowPlaceholderEec: false,
    allowMissingManifest: false,
    registry: resolveNpmRegistryUrl(),
    skipNpm: false,
    collectionName: null,
    json: false,
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
      case '--root-ca': options.rootCa = take(); break
      case '--allow-placeholder-eec': options.allowPlaceholderEec = true; break
      case '--allow-missing-manifest': options.allowMissingManifest = true; break
      case '--registry': options.registry = take(); break
      case '--skip-npm': options.skipNpm = true; break
      case '--collection-name': options.collectionName = take(); break
      case '--json': options.json = true; break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  return options
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write('校验失败:' + error.message + '\n\n')
    usage()
    return 2
  }
  if (options.help) {
    usage()
    return 0
  }

  try {
    const version = opensslVersion()
    if (version.major < 3) {
      process.stderr.write('校验失败:需要 OpenSSL 3.0 及以上,当前为 ' + version.text + '\n')
      return 2
    }
  } catch (error) {
    process.stderr.write('校验失败:' + error.message + '\n')
    return 2
  }

  const rootCaPath = resolveRootCaPath(options)
  const result = verifyCollection(options.dir, {
    rootCaPath,
    allowPlaceholderEec: options.allowPlaceholderEec,
    allowMissingManifest: options.allowMissingManifest,
    collectionName: options.collectionName,
  })

  // npm 包名强校验:对合集目录里的 catalog/ 登记副本逐插件检查登记包名与插件名一致、registry 上存在。
  // 登记副本缺失只警告;registry 不可达(本地无网)由 checkNpmPackages 降级为「跳过在线检查」警告,不阻断。
  let npmStats
  const catalogDir = join(options.dir, 'catalog')
  let hasCatalogCopy = false
  try {
    hasCatalogCopy = statSync(catalogDir).isDirectory()
  } catch {
    hasCatalogCopy = false
  }
  if (options.skipNpm) {
    npmStats = { skipped: true }
  } else if (!hasCatalogCopy) {
    npmStats = { skipped: true, reason: 'no-catalog-copy' }
    result.problems.push({
      level: 'warning',
      code: 'NPM_CHECK_OFFLINE',
      message: '合集目录下没有 catalog/ 登记副本(' + catalogDir + '),跳过 npm 包名检查',
      path: null,
    })
  } else {
    const catalog = readCatalog({ catalogDir, problems: result.problems, checkAuthorNames: true })
    npmStats = await checkNpmPackages({
      plugins: catalog.plugins,
      problems: result.problems,
      registryUrl: options.registry,
    })
  }
  const npmErrors = result.problems.filter((item) => item.level === 'error').length
  result.errorCount = npmErrors
  result.warningCount = result.problems.length - npmErrors
  result.ok = npmErrors === 0
  result.npm = npmStats

  if (options.json) {
    process.stdout.write(JSON.stringify({ ...result, rootCaPath }, null, 2) + '\n')
  } else {
    if (result.problems.length > 0) process.stdout.write(formatProblems(result.problems) + '\n')
    for (const item of result.stats.manifests) {
      process.stdout.write(
        '清单 ' + item.layer + ' ' + item.dir + ' revision=' + String(item.revision) + ',覆盖 ' + item.files + ' 个文件' + '\n',
      )
    }
    const npmSummary = npmStats.skipped === true
      ? ',npm 包名检查跳过'
      : ',npm 包名检查 ' + npmStats.registered + ' 个' +
        (npmStats.offlineSkipped > 0 ? '(registry 不可达,跳过 ' + npmStats.offlineSkipped + ' 个在线查询)' : '') +
        (npmStats.mismatched > 0 ? ',包名不一致 ' + npmStats.mismatched + ' 个' : '') +
        (npmStats.missing > 0 ? ',包不存在 ' + npmStats.missing + ' 个' : '')
    const summary =
      '合集 ' + result.collectionName + ':' +
      result.stats.authors + ' 个作者,' +
      result.stats.plugins + ' 个插件,' +
      result.stats.versions + ' 个版本,' +
      result.stats.manifests.length + ' 层清单' +
      npmSummary
    if (result.ok) {
      process.stdout.write('校验通过 ' + summary + ',警告 ' + result.warningCount + ' 条\n')
    } else {
      process.stdout.write('校验未通过 ' + summary + ',错误 ' + result.errorCount + ' 条,警告 ' + result.warningCount + ' 条\n')
    }
  }

  return result.ok ? 0 : 1
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    process.stderr.write('校验失败:' + (error && error.message ? error.message : String(error)) + '\n')
    process.exitCode = 1
  },
)
