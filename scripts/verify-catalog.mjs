#!/usr/bin/env node
/**
 * 仓库级校验:只查 catalog/ 与 certs/,不碰任何分发包内容。
 *
 * 本仓库不再在根目录保存 pages 包的基线文件(plugins.json、manifest.json、plugins/),
 * 因此仓库级校验只看两处源数据:
 *   catalog/   收录登记(author.json、author_pub.pem、plugin.json、removed.json)
 *   certs/     信任材料(合集终端签名证书,可选配对公钥)
 * 合集设置(site/meta.json、site/tags.json)只用于标签取值判断,不做结构以外的检查。
 *
 * 作者目录名的大小写不敏感唯一性由 lib/catalog.mjs 的 readCatalog 报(AUTHOR_NAME_COLLISION),
 * 构建与仓库级校验调用同一个函数,因此 Alice 与 alice 这类冲突在两处都会被拦住。
 *
 * 构建出的 pages 包由 verify-bundle.mjs 校验:三层清单、清单签名、产物签名与收录信息交叉一致性。
 * 检查函数都在 lib/catalog-checks.mjs,维护者自查脚本 scripts/check-*.mjs 复用同一组函数输出单个 JSON。
 *
 * 用法:
 *   node scripts/verify-catalog.mjs
 *   node scripts/verify-catalog.mjs --catalog catalog --certs certs --tags site/tags.json
 *   ROOT_CA_PATH=root_ca.crt node scripts/verify-catalog.mjs
 */
import { join, resolve } from 'node:path'
import { formatProblems } from './lib/collection-verify.mjs'
import { readCatalog } from './lib/catalog.mjs'
import {
  checkAuthorNames,
  checkCerts,
  checkPluginDirectories,
  checkPresetTags,
  checkRemoved,
  readPresetTags,
} from './lib/catalog-checks.mjs'
import { opensslVersion } from './pki.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/verify-catalog.mjs [选项]',
    '',
    '选项:',
    '  --catalog <目录>   catalog 目录,默认 catalog',
    '  --certs <目录>     证书目录,默认 certs',
    '  --tags <文件>      预设标签来源,默认 site/tags.json',
    '  --root-ca <路径>   根证书路径,给出时校验合集证书的签发链',
    '  --json             以 JSON 输出校验结果',
    '  --help             显示本说明',
    '',
    '环境变量:',
    '  ROOT_CA_PATH       根证书路径,等价于 --root-ca',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    catalog: 'catalog',
    certs: 'certs',
    tags: join('site', 'tags.json'),
    rootCa: null,
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
      case '--catalog': options.catalog = take(); break
      case '--certs': options.certs = take(); break
      case '--tags': options.tags = take(); break
      case '--root-ca': options.rootCa = take(); break
      case '--json': options.json = true; break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  return options
}

function main() {
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

  const catalogDir = resolve(options.catalog)
  const certsDir = resolve(options.certs)
  const tagsPath = resolve(options.tags)
  const rootCaPath = options.rootCa ? resolve(options.rootCa) : process.env.ROOT_CA_PATH ? resolve(process.env.ROOT_CA_PATH) : null

  const problems = []
  const presetTags = readPresetTags(tagsPath, problems)
  // 作者目录名由本脚本的 checkAuthorNames 报,读 catalog 时关掉同一条检查,避免一个问题报两遍
  const catalog = readCatalog({ catalogDir, problems, checkAuthorNames: false })
  const invalidAuthorNames = checkAuthorNames({ catalogDir, problems })
  const authorNameCollisions = problems.filter((item) => item.code === 'AUTHOR_NAME_COLLISION').length
  checkPresetTags({ plugins: catalog.plugins, presetTags, problems })
  const removedCount = checkRemoved({ catalogDir, plugins: catalog.plugins, problems })
  const leftovers = checkPluginDirectories(catalog.plugins, problems)
  const certStats = checkCerts({ certsDir, rootCaPath, problems })

  const errors = problems.filter((item) => item.level === 'error')
  const warnings = problems.filter((item) => item.level === 'warning')

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: errors.length === 0,
          catalogDir,
          certsDir,
          tagsPath,
          rootCaPath,
          authors: catalog.authors.length,
          invalidAuthorNames,
          authorNameCollisions,
          plugins: catalog.plugins.length,
          removed: removedCount,
          versionDirWarnings: leftovers,
          certs: certStats,
          problems,
        },
        null,
        2,
      ) + '\n',
    )
  } else {
    if (problems.length > 0) process.stdout.write(formatProblems(problems) + '\n')
    const summary =
      'catalog 作者 ' + catalog.authors.length + ' 个,' +
      '插件 ' + catalog.plugins.length + ' 个,' +
      'removed.json 记录 ' + removedCount + ' 条,' +
      'certs/ 证书 ' + (certStats.eecCert ? '1 份' : '0 份') +
      (certStats.chainChecked ? '(已校验签发链)' : '')
    if (errors.length === 0) {
      process.stdout.write('catalog 校验通过 ' + summary + ',警告 ' + warnings.length + ' 条\n')
    } else {
      process.stdout.write('catalog 校验未通过 ' + summary + ',错误 ' + errors.length + ' 条,警告 ' + warnings.length + ' 条\n')
    }
  }

  return errors.length === 0 ? 0 : 1
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('校验失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
