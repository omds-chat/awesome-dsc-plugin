#!/usr/bin/env node
/**
 * 自查:插件名规则与全局唯一性。
 *
 * 规则来自 lib/catalog.mjs 的 readCatalog:插件名必须以 dsc- 为前缀,目录名取裸插件名,
 * 同名插件在整个 catalog 里只能登记一次(PLUGIN_DUPLICATE 按错误处理)。
 * 去掉命名空间后落在同一目录名的插件(例如 dsc-demo 与 @alice/dsc-demo)按告警报出。
 *
 * 用法:
 *   node scripts/check-plugins.mjs
 *   node scripts/check-plugins.mjs --json
 *   node scripts/check-plugins.mjs --json | node scripts/summarize.mjs
 */
import { runCheckMain } from './lib/check-report.mjs'
import { contextFrom, runCheck } from './lib/check-suite.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/check-plugins.mjs [选项]',
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
  run: (options) => runCheck('plugins', contextFrom(options)),
})
