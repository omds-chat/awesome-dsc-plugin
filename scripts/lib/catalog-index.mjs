/**
 * pages 包 catalog 目录里由构建生成的两份汇总文件。
 *
 *   catalog/index.json      给站点与外部查阅用的汇总:作者列表与插件列表;
 *   catalog/anomalies.json  本次发布被剔除的插件清单,含作者、插件、阶段与失败原因。
 *
 * 两份文件都只描述「本次发布实际收录了什么」,因此只接收构建判定为可发布的作者与插件;
 * 被剔除的插件不进入 index.json,也不出现在 datalog.json 与 plugins 树里。
 * catalog 目录不纳入任何清单,两份文件同样不被清单覆盖。
 */

/**
 * 生成 catalog/index.json。
 * 插件条目字段固定为 author、name、description、license、repo_link、base_url、
 * current_version、tags、version_count;作者条目额外内嵌自己的插件列表,
 * 便于站点只读一份文件就能画出作者页。
 * @param {object} context 上下文
 * @param {string} context.collectionName 合集名称
 * @param {string|null} context.releaseTag 本次发布的 tag
 * @param {Array<{username: string, profile: string|null, plugins: Array<object>}>} context.authors 已收录的作者
 * @param {Array<object>} context.plugins 已收录的插件,含 latest、versionCount 与 tags
 * @returns {object} index.json 内容
 */
export function buildCatalogIndex({ collectionName, releaseTag, authors, plugins }) {
  const counts = new Map()
  for (const plugin of plugins) counts.set(plugin.author, (counts.get(plugin.author) ?? 0) + 1)
  const authorEntries = authors
    .map((author) => ({
      username: author.username,
      profile: author.profile ?? '',
      plugin_count: counts.get(author.username) ?? 0,
      plugins: author.plugins
        .map((plugin) => registrationEntry(plugin))
        .sort(byName),
    }))
    .sort((left, right) => (left.username < right.username ? -1 : 1))
  const pluginEntries = plugins
    .map((plugin) => ({
      ...registrationEntry(plugin),
      author: plugin.author,
      current_version: plugin.latest ?? null,
      tags: Array.isArray(plugin.tags) ? [...plugin.tags] : [],
      version_count: plugin.versionCount ?? 0,
    }))
    .sort((left, right) => (left.name === right.name ? compareText(left.author, right.author) : compareText(left.name, right.name)))
  return {
    schemaVersion: 1,
    collection: { name: collectionName, release: releaseTag ?? null },
    authors: authorEntries,
    plugins: pluginEntries,
  }
}

/**
 * 生成 catalog/anomalies.json:本次发布被剔除的插件。
 * @param {object} context 上下文
 * @param {string} context.collectionName 合集名称
 * @param {string|null} context.releaseTag 本次发布的 tag
 * @param {Array<{author: string, plugin: string, stage: string, reason: string, base_url: string}>} context.anomalies 剔除记录
 * @returns {object} anomalies.json 内容
 */
export function buildAnomalyReport({ collectionName, releaseTag, anomalies }) {
  const sorted = [...anomalies].sort((left, right) =>
    left.author === right.author ? compareText(left.plugin, right.plugin) : compareText(left.author, right.author),
  )
  return {
    schemaVersion: 1,
    collection: collectionName,
    release: releaseTag ?? null,
    excluded_count: sorted.length,
    excluded: sorted.map((item) => ({
      author: item.author,
      plugin: item.plugin,
      stage: item.stage,
      reason: item.reason,
      base_url: item.base_url ?? '',
    })),
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function byName(left, right) {
  return compareText(left.name, right.name)
}

function registrationEntry(plugin) {
  return {
    name: plugin.name,
    description: plugin.description,
    license: plugin.license,
    repo_link: plugin.repoLink,
    base_url: plugin.baseUrl,
  }
}
