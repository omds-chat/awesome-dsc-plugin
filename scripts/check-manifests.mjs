#!/usr/bin/env node
/**
 * 自查:三层清单覆盖与哈希。
 *
 * 复用 lib/collection-verify.mjs 的 verifyCollection,只取清单相关的问题:
 * 清单存在性与结构、path 合法性、覆盖范围、SHA-512 比对与清单签名。
 * 不给根证书时清单签名只记警告,哈希与覆盖范围照常校验。
 *
 * 用法:
 *   node scripts/check-manifests.mjs --dir dist/pages
 *   node scripts/check-manifests.mjs --dir dist/pages --root-ca root_ca.crt --json
 */
import { runCheckMain } from './lib/check-report.mjs'
import { contextFrom, runCheck } from './lib/check-suite.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/check-manifests.mjs [选项]',
    '',
    '选项:',
    '  --dir <目录>       pages 包目录,默认 dist/pages',
    '  --root-ca <路径>   根证书路径,给出时校验清单签名(等价于 ROOT_CA_PATH)',
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
  run: (options) => runCheck('manifests', contextFrom(options)),
})
