#!/usr/bin/env node
/**
 * 自查:作者目录名合法性与大小写不敏感唯一性。
 *
 * 规则来自 lib/catalog.mjs(readCatalog:GitHub 用户名规则与 AUTHOR_NAME_COLLISION)
 * 与 lib/catalog-checks.mjs(checkAuthorNames),本脚本只负责参数、JSON 输出与退出码。
 * 仅大小写不同的作者目录(Alice 与 alice)属于同一个 GitHub 用户,按错误报出冲突的两个目录。
 *
 * 用法:
 *   node scripts/check-authors.mjs
 *   node scripts/check-authors.mjs --json
 *   node scripts/check-authors.mjs --json | node scripts/summarize.mjs
 */
import { runCheckMain } from './lib/check-report.mjs'
import { contextFrom, runCheck } from './lib/check-suite.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/check-authors.mjs [选项]',
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
  run: (options) => runCheck('authors', contextFrom(options)),
})
