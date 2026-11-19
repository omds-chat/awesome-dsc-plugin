#!/usr/bin/env node
/**
 * 自查汇总入口:一次跑完全部检查,输出一个总 JSON。
 *
 * 检查项与单检查脚本一一对应,顺序见 lib/check-suite.mjs 的 CHECK_ORDER:
 *   authors   作者目录名合法性与大小写唯一性       scripts/check-authors.mjs
 *   plugins   插件名规则与全局唯一性               scripts/check-plugins.mjs
 *   versions  versions 与 plugins 树一致           scripts/check-versions.mjs
 *   manifests 三层清单覆盖与哈希                   scripts/check-manifests.mjs
 *   certs     certs 证书链与终端签名证书           scripts/check-certs.mjs
 *   removed   removed.json 结构                    scripts/check-removed.mjs
 *   site      site 与 catalog 一致性               scripts/check-site.mjs
 *
 * 默认输出总 JSON;加 --text 输出便于人读的文本。
 * 退出码:全部检查通过为 0,任一检查有 error 级问题为 1,参数错误为 2。
 *
 * 用法:
 *   node scripts/check-all.mjs
 *   node scripts/check-all.mjs --dir dist/pages --root-ca root_ca.crt
 *   node scripts/check-all.mjs --text
 */
import { join } from 'node:path'
import { finish, mergeResults, parseFlags } from './lib/check-report.mjs'
import { CHECK_ORDER, contextFrom, runCheck } from './lib/check-suite.mjs'

const FLAGS = {
  catalog: { kind: 'value', default: 'catalog' },
  certs: { kind: 'value', default: 'certs' },
  site: { kind: 'value', default: 'site' },
  dir: { kind: 'value', default: join('dist', 'pages') },
  rootCa: { kind: 'value', default: null },
  json: { kind: 'flag' },
  text: { kind: 'flag' },
  help: { kind: 'flag' },
}

function usage() {
  process.stdout.write([
    '用法: node scripts/check-all.mjs [选项]',
    '',
    '选项:',
    '  --catalog <目录>   catalog 目录,默认 catalog',
    '  --certs <目录>     证书目录,默认 certs',
    '  --site <目录>      站点设置目录,默认 site',
    '  --dir <目录>       pages 包目录,默认 dist/pages',
    '  --root-ca <路径>   根证书路径,给出时校验证书链与清单签名(等价于 ROOT_CA_PATH)',
    '  --text             输出便于人读的文本,默认输出总 JSON',
    '  --json             输出总 JSON(默认行为,便于显式声明)',
    '  --help             显示本说明',
    '',
  ].join('\n'))
}

function main() {
  let options
  try {
    options = parseFlags(process.argv.slice(2), FLAGS)
  } catch (error) {
    process.stderr.write('参数错误:' + error.message + '\n\n')
    usage()
    return 2
  }
  if (options.help) {
    usage()
    return 0
  }
  const context = contextFrom(options)
  const results = CHECK_ORDER.map((name) => runCheck(name, context))
  return finish(mergeResults(results), options.text !== true)
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('检查失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 2
}
