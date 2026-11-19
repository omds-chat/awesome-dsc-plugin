#!/usr/bin/env node
/**
 * 自查:removed.json 结构。
 *
 * 复用 lib/catalog-checks.mjs 的 checkRemoved:顶层数组、字段取值、未知字段、重复登记,
 * 以及「已下架却又在 catalog 里仍有登记」的矛盾。
 *
 * 用法:
 *   node scripts/check-removed.mjs
 *   node scripts/check-removed.mjs --json
 *   node scripts/check-removed.mjs --catalog catalog --json | node scripts/summarize.mjs
 */
import { runCheckMain } from './lib/check-report.mjs'
import { contextFrom, runCheck } from './lib/check-suite.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/check-removed.mjs [选项]',
    '',
    '选项:',
    '  --catalog <目录>   catalog 目录,默认 catalog',
    '  --json             输出单个 JSON 对象',
    '  --help             显示本说明',
    '',
  ].join('\n'))
}

process.exitCode = runCheckMain({
  usage,
  flags: {
    catalog: { kind: 'value', default: 'catalog' },
    json: { kind: 'flag' },
    help: { kind: 'flag' },
  },
  run: (options) => runCheck('removed', contextFrom(options)),
})
