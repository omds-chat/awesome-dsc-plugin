#!/usr/bin/env node
/**
 * 自查:certs 证书链与终端签名证书。
 *
 * 复用 lib/catalog-checks.mjs 的 checkCerts:certs/ 只放来源文件夹,合集证书固定在
 * certs/<来源 id>/<来源 id>-eec.crt,必须存在、未过期、keyUsage 含 digitalSignature、
 * basicConstraints 非 CA;给出根证书时校验签发链;配对公钥存在就必须能解析。
 * 不给根证书时签发链只记警告。
 *
 * 用法:
 *   node scripts/check-certs.mjs
 *   ROOT_CA_PATH=root_ca.crt node scripts/check-certs.mjs --json
 *   node scripts/check-certs.mjs --certs certs --root-ca root_ca.crt --json
 */
import { runCheckMain } from './lib/check-report.mjs'
import { contextFrom, runCheck } from './lib/check-suite.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/check-certs.mjs [选项]',
    '',
    '选项:',
    '  --certs <目录>     证书目录,默认 certs',
    '  --root-ca <路径>   根证书路径,给出时校验签发链(等价于 ROOT_CA_PATH)',
    '  --json             输出单个 JSON 对象',
    '  --help             显示本说明',
    '',
  ].join('\n'))
}

process.exitCode = runCheckMain({
  usage,
  flags: {
    certs: { kind: 'value', default: 'certs' },
    rootCa: { kind: 'value', default: null },
    json: { kind: 'flag' },
    help: { kind: 'flag' },
  },
  run: (options) => runCheck('certs', contextFrom(options)),
})
