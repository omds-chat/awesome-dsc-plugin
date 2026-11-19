#!/usr/bin/env node
/**
 * 自查:site 与 catalog 一致性。
 *
 * 站点设置是 pages 包的来源:site/tags.json 是标签取值的唯一依据,site/meta.json 原样进入
 * pages 包根目录。本检查复用 lib/catalog-checks.mjs 的 readPresetTags 与 checkPresetTags
 * 校验「catalog 里用到的标签都在预设清单内」,复用 lib/collection-meta.mjs 校验 meta.json 结构,
 * 并把预设清单里没有任何插件使用的标签按告警报出(新增标签要与使用它的插件同一次提交)。
 *
 * 用法:
 *   node scripts/check-site.mjs
 *   node scripts/check-site.mjs --site site --catalog catalog --json
 */
import { runCheckMain } from './lib/check-report.mjs'
import { contextFrom, runCheck } from './lib/check-suite.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/check-site.mjs [选项]',
    '',
    '选项:',
    '  --site <目录>      站点设置目录,默认 site',
    '  --catalog <目录>   catalog 目录,默认 catalog',
    '  --json             输出单个 JSON 对象',
    '  --help             显示本说明',
    '',
  ].join('\n'))
}

process.exitCode = runCheckMain({
  usage,
  flags: {
    site: { kind: 'value', default: 'site' },
    catalog: { kind: 'value', default: 'catalog' },
    json: { kind: 'flag' },
    help: { kind: 'flag' },
  },
  run: (options) => runCheck('site', contextFrom(options)),
})
