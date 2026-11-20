#!/usr/bin/env node
/**
 * pages 包校验:把两条只读校验串成一条命令。
 *
 *   1. verify-collection.mjs          三层清单、清单签名、产物签名、证书链、必需文件与哈希
 *   2. verify-catalog-consistency.mjs  catalog/index.json、plugins.json、plugins/author_manifest.json、
 *                                     catalog/ 副本与 plugins/ 树的收录信息交叉一致性
 *
 * 两条校验都针对同一个 pages 包目录,任一条以非零退出码结束,本脚本就以非零退出码结束。
 * 不给根证书(--root-ca 或 ROOT_CA_PATH)时证书链无法校验,第 1 条报 ROOT_CA_MISSING 并以非零退出码结束,
 * 结构与哈希照常校验;只做结构与哈希检查时,直接对 verify-collection.mjs 加 --allow-placeholder-eec。
 * 作者签名不改变退出码:验签失败与公钥、签名两侧不齐都只警告。
 *
 * 用法:
 *   node scripts/verify-bundle.mjs --dir dist/pages
 *   node scripts/verify-bundle.mjs --dir dist/pages --root-ca root_ca.crt
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))

function usage() {
  process.stdout.write([
    '用法: node scripts/verify-bundle.mjs [选项]',
    '',
    '选项:',
    '  --dir <目录>      pages 包目录,默认 dist/pages',
    '  --root-ca <路径>  根证书路径,给出时校验证书链与全部签名',
    '  --quiet           交叉校验只输出差异,不输出通过项统计',
    '  --help            显示本说明',
    '',
    '环境变量:',
    '  ROOT_CA_PATH      根证书路径,等价于 --root-ca',
    '',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = { dir: join('dist', 'pages'), rootCa: null, quiet: false, help: false }
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
      case '--root-ca': options.rootCa = take(); break
      case '--quiet': options.quiet = true; break
      case '--help':
      case '-h': options.help = true; break
      default: throw new Error('未知参数 ' + arg)
    }
  }
  return options
}

/** 依次执行一条子校验,输出直连当前终端;返回是否通过。 */
function runStep({ title, file, args }) {
  process.stdout.write('\n== ' + title + '\n')
  const result = spawnSync(process.execPath, [join(scriptDir, file), ...args], { stdio: 'inherit' })
  if (result.error) {
    process.stderr.write('无法执行 ' + file + ':' + result.error.message + '\n')
    return false
  }
  return result.status === 0
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

  const rootCa = options.rootCa || process.env.ROOT_CA_PATH || null

  const collectionArgs = ['--dir', options.dir]
  if (rootCa) collectionArgs.push('--root-ca', rootCa)
  const consistencyArgs = ['--dir', options.dir]
  if (options.quiet) consistencyArgs.push('--quiet')

  const collectionOk = runStep({
    title: 'pages 包结构、三层清单、清单签名与产物签名',
    file: 'verify-collection.mjs',
    args: collectionArgs,
  })
  const consistencyOk = runStep({
    title: '收录信息交叉一致性',
    file: 'verify-catalog-consistency.mjs',
    args: consistencyArgs,
  })

  process.stdout.write('\n')
  if (collectionOk && consistencyOk) {
    process.stdout.write('pages 包校验通过:' + options.dir + '\n')
    return 0
  }
  const failed = []
  if (!collectionOk) failed.push('结构、清单与签名')
  if (!consistencyOk) failed.push('收录信息交叉一致性')
  process.stdout.write('pages 包校验未通过:' + failed.join('、') + '\n')
  return 1
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write('校验失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
