#!/usr/bin/env node
/**
 * 自查:versions 与 plugins 树一致。
 *
 * 只看构建出的 pages 包:版本校验复用 lib/collection-verify.mjs 的 verifyCollection
 * (versions.json 合法、latest 在列表内、版本目录与每个版本的必需文件齐全、meta.json 的 name 与 version 对齐),
 * 另外把「存在版本目录但 versions.json 没有登记」按告警报出。
 * 分发包目录不存在时该检查记一条 BUNDLE_MISSING 告警并跳过,退出码仍为 0。
 *
 * 用法:
 *   node scripts/check-versions.mjs --dir dist/pages
 *   node scripts/check-versions.mjs --dir dist/pages --root-ca root_ca.crt --json
 */
import { runCheckMain } from './lib/check-report.mjs'
import { contextFrom, runCheck } from './lib/check-suite.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/check-versions.mjs [选项]',
    '',
    '选项:',
    '  --dir <目录>       pages 包目录,默认 dist/pages',
    '  --root-ca <路径>   根证书路径,给出时一并校验清单签名(等价于 ROOT_CA_PATH)',
    '  --json             输出单个 JSON 对象',
    '  --help             显示本说明',
    '',
  ].join('\n'))
}

process.exitCode = runCheckMain({
  usage,
  flags: {
    dir: { kind: 'value', default: 'dist/pages' },
    rootCa: { kind: 'value', default: null },
    json: { kind: 'flag' },
    help: { kind: 'flag' },
  },
  run: (options) => runCheck('versions', contextFrom(options)),
})
