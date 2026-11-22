#!/usr/bin/env node
/**
 * 把已经校验过的 pages 包里的三层清单与签名写回 ci-memory 工作区。
 *
 * 只做文件层动作:按分发路径镜像到 <ci-memory>/layer-manifests/,清单与同名 .sig 成对写入,
 * 并删除本次不再存在的层(作者下架、插件剔除)以免旧清单被下一次构建当成现行层。
 * 清单内容一致时不落盘,仅 .sig 重签字节不同不算变更,内容毫无变化的重跑不产生提交。
 * 提交与推送由流水线用 git 完成;本脚本不调用 git,也不发任何网络请求。
 * 写回失败以非零退出码结束,流水线据此中止发布,不沿用旧 revision。
 *
 * 用法:
 *   node scripts/write-ci-memory.mjs --bundle dist/pages --ci-memory single-branch/ci-memory
 *   node scripts/write-ci-memory.mjs --bundle dist/pages --ci-memory ... --dry-run
 */
import { resolve } from 'node:path'
import { writeCiMemoryManifests } from './lib/ci-memory.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/write-ci-memory.mjs [选项]',
    '',
    '选项:',
    '  --bundle <目录>      pages 包目录,默认 dist/pages',
    '  --ci-memory <目录>   ci-memory 分支的本地工作区;必需,分支缺失时报错中止',
    '  --dry-run            只打印写回计划,不落盘',
    '  --help               显示本说明',
    '',
    '环境变量:',
    '  CI_MEMORY_DIR        ci-memory 分支工作区路径,等价于 --ci-memory',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    bundle: resolve('dist', 'pages'),
    ciMemory: process.env.CI_MEMORY_DIR || null,
    dryRun: false,
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
      case '--bundle': options.bundle = take(); break
      case '--ci-memory': options.ciMemory = take(); break
      case '--dry-run': options.dryRun = true; break
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
    process.stderr.write('写回失败:' + error.message + '\n\n')
    usage()
    return 2
  }
  if (options.help) {
    usage()
    return 0
  }

  let result
  try {
    result = writeCiMemoryManifests({
      bundleRoot: options.bundle,
      branchRoot: options.ciMemory,
      dryRun: options.dryRun,
    })
  } catch (error) {
    process.stderr.write('写回失败:' + (error && error.message ? error.message : String(error)) + '\n')
    return 1
  }

  const prefix = options.dryRun ? '[dry-run] ' : ''
  for (const item of result.layers) {
    process.stdout.write(
      prefix + item.layer + ' 清单 ' + (item.layerRel || '合集根') + ' -> layer-manifests/' +
      (item.layerRel ? item.layerRel + '/' : '') + 'manifest.json ' +
      (item.changed ? '(已写入,清单与同名 .sig 同步更新)' : '(清单内容一致,保留旧 .sig,未改动)') + '\n',
    )
  }
  for (const removed of result.removed) {
    process.stdout.write(prefix + '删除本次不再存在的层:' + removed + '\n')
  }
  process.stdout.write(
    prefix + '写回' + (options.dryRun ? '计划' : '完成') + ':工作区 ' + result.root +
    ',共 ' + result.layers.length + ' 层,实际改动 ' + result.written + ' 层,删除 ' + result.removed.length + ' 个文件\n',
  )
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('写回失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
