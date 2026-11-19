#!/usr/bin/env node
/**
 * 交叉校验 pages 包里各部分收录信息是否一致。
 *
 * 判定规则在 lib/consistency-verify.mjs,本脚本只负责命令行参数与文本输出;
 * 维护者自查脚本 scripts/check-*.mjs 复用同一个模块并输出单个 JSON,规则不会分叉。
 * 校验对象与逐项说明见 lib/consistency-verify.mjs 的文件头。
 *
 * 任何不一致都以非零退出码失败,并逐条列出差异。
 *
 * 用法:
 *   node scripts/verify-catalog-consistency.mjs --dir dist/pages
 *   node scripts/verify-catalog-consistency.mjs --dir dist/pages --quiet
 */
import { verifyCatalogConsistency } from './lib/consistency-verify.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/verify-catalog-consistency.mjs [选项]',
    '',
    '选项:',
    '  --dir <目录>   pages 包目录,默认 dist/pages',
    '  --quiet        只输出差异,不输出通过项统计',
    '  --help         显示本说明',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = { dir: 'dist/pages', quiet: false, help: false }
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
      case '--quiet': options.quiet = true; break
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

  const result = verifyCatalogConsistency(options.dir)
  if (result.missing) {
    process.stderr.write('pages 包目录不存在:' + result.root + '\n')
    return 2
  }

  if (!result.ok) {
    process.stderr.write('catalog 收录信息不一致,共 ' + result.failures.length + ' 项:\n')
    for (const failure of result.failures) process.stderr.write('  [' + failure.code + '] ' + failure.message + '\n')
    process.stderr.write('\n校验目录:' + result.root + '\n')
    return 1
  }

  if (!options.quiet) {
    process.stdout.write(
      'catalog 收录信息一致:' + result.root + '\n' +
      '  catalog/index.json:作者 ' + result.stats.authors + ' 个,插件 ' + result.stats.plugins + ' 个\n' +
      '  plugins.json:记录 ' + result.stats.records + ' 条\n' +
      '  plugins/author_manifest.json:作者 ' + result.stats.authorManifestAuthors + ' 个\n' +
      '  三层清单:' + result.stats.manifests + ' 份,记录的文件全部存在\n' +
      '  catalog/anomalies.json:本次发布剔除 ' + result.stats.anomalies + ' 个插件\n',
    )
  }
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('校验失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
