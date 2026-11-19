/**
 * 与数据无关的纯函数:版本比较、目录名映射、状态汇总。
 * 状态取值与 data.js 保持一致:present / missing / unknown / partial。
 */

export const STATUS_TEXT = {
  present: "存在",
  missing: "缺失",
  partial: "部分缺失",
  unknown: "未探测",
};

/** 插件名去掉命名空间前缀后就是 plugins 下的目录名,与 scripts/lib/catalog.mjs 一致。 */
export function dirFromName(name) {
  const parts = String(name === undefined || name === null ? "" : name).split("/");
  const last = parts[parts.length - 1];
  return last.length > 0 ? last : String(name === undefined || name === null ? "" : name);
}

/** 按 x.y.z 逐段比较,返回负数表示 left 小于 right。 */
export function compareVersions(left, right) {
  const a = String(left).split(".");
  const b = String(right).split(".");
  for (let index = 0; index < 3; index += 1) {
    const x = Number.parseInt(a[index], 10);
    const y = Number.parseInt(b[index], 10);
    const leftValue = Number.isFinite(x) ? x : 0;
    const rightValue = Number.isFinite(y) ? y : 0;
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
  }
  return 0;
}

/** 汇总一组同类文件的存在性:全部存在、全部缺失、部分缺失、无法探测。 */
export function summarise(statuses) {
  const list = statuses.filter(function (item) {
    return typeof item === "string" && item.length > 0;
  });
  if (list.length === 0) return "unknown";
  const present = list.filter(function (item) {
    return item === "present";
  }).length;
  if (present === list.length) return "present";
  if (present === 0) {
    const unknown = list.filter(function (item) {
      return item === "unknown";
    }).length;
    return unknown === list.length ? "unknown" : "missing";
  }
  return "partial";
}

/** 插件排序:名称升序、名称降序、版本降序。 */
export function sortPlugins(plugins, direction) {
  const copy = plugins.slice();
  copy.sort(function (left, right) {
    if (direction === "version-desc") {
      const byVersion = compareVersions(right.latest, left.latest);
      if (byVersion !== 0) return byVersion;
    }
    if (direction === "name-desc") return left.name < right.name ? 1 : -1;
    return left.name < right.name ? -1 : 1;
  });
  return copy;
}
