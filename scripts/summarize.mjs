#!/usr/bin/env node
/**
 * 把管道传入的一个或多个检查结果合并成一个总 JSON。
 *
 * 支持三种用法:
 *   node scripts/check-authors.mjs --json | node scripts/summarize.mjs
 *   cat a.json b.json | node scripts/summarize.mjs
 *   node scripts/summarize.mjs a.json b.json
 *
 * 输入允许多个 JSON 对象连续出现,对象之间可以是换行、逗号或空白;按出现顺序合并。
 * 输出结构与 scripts/check-all.mjs 一致,见 lib/check-report.mjs 文件头。
 * 退出码:合并后全部通过为 0,任一条 error 级问题为 1,输入不是合法 JSON 为 2。
 *
 * 用法:
 *   node scripts/check-cert.mjs --json | node scripts/summarize.mjs
 *   node scripts/summarize.mjs --text result.json
 */
import { readFileSync } from 'node:fs'
import { finish, mergeResults } from './lib/check-report.mjs'

function usage() {
  process.stdout.write([
    '用法: node scripts/summarize.mjs [选项] [文件...]',
    '',
    '从标准输入或给定文件读取一个或多个检查结果(JSON 对象),合并成一个总 JSON。',
    '',
    '选项:',
    '  --text   输出便于人读的文本,默认输出总 JSON',
    '  --help   显示本说明',
    '',
  ].join('\n'))
}

/** 读出全部标准输入。 */
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 按大括号配对切出连续的 JSON 对象,字符串里的括号与转义不参与配对。
 * @param {string} text 输入文本
 * @returns {string[]} 每个 JSON 对象的原文
 */
function splitJsonObjects(text) {
  const found = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0 && start !== -1) {
        found.push(text.slice(start, index + 1))
        start = -1
      }
      if (depth < 0) throw new Error('输入里的 JSON 大括号不配对')
    }
  }
  if (depth !== 0) throw new Error('输入里的 JSON 大括号不配对')
  return found
}

/**
 * 把一段文本解析成检查结果列表。
 * @param {string} text JSON 文本
 * @param {string} source 来源说明,用于报错
 * @returns {object[]} 检查结果列表
 */
function parseResults(text, source) {
  const chunks = splitJsonObjects(text)
  if (chunks.length === 0) throw new Error(source + ' 里没有 JSON 对象')
  return chunks.map((chunk, index) => {
    let value
    try {
      value = JSON.parse(chunk)
    } catch (error) {
      throw new Error(source + ' 里第 ' + (index + 1) + ' 个 JSON 对象无法解析:' + error.message)
    }
    if (value === null || typeof value !== 'object' || !Array.isArray(value.problems)) {
      throw new Error(source + ' 里第 ' + (index + 1) + ' 个对象不是检查结果:缺少 problems 数组')
    }
    return value
  })
}

async function main() {
  const argv = process.argv.slice(2)
  const files = []
  let text = false
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      usage()
      return 0
    }
    if (arg === '--text') {
      text = true
      continue
    }
    if (arg.startsWith('--')) {
      process.stderr.write('参数错误:未知参数 ' + arg + '\n\n')
      usage()
      return 2
    }
    files.push(arg)
  }
  let results
  try {
    if (files.length > 0) {
      results = files.flatMap((file) => parseResults(readFileSync(file, 'utf8'), file))
    } else {
      results = parseResults(await readStdin(), '标准输入')
    }
  } catch (error) {
    process.stderr.write('无法读取检查结果:' + (error && error.message ? error.message : String(error)) + '\n')
    return 2
  }
  return finish(mergeResults(results), text !== true)
}

try {
  process.exitCode = await main()
} catch (error) {
  process.stderr.write('合并失败:' + (error && error.message ? error.message : String(error)) + '\n')
  process.exitCode = 2
}
