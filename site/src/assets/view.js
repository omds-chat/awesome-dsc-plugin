/**
 * DOM 构造与渲染:作者表、插件表、插件详情(版本表与签名材料表)。
 * 所有表格文本水平居中,窄屏由 styles.css 改写成卡片式堆叠。
 */
import { STATUS_TEXT, summarise } from "./format.js";

const STATUS_TONE = {
  present: "ok",
  missing: "missing",
  partial: "warn",
  unknown: "unknown",
};

const STATUS_HINT = {
  present: "该文件存在",
  missing: "该文件不存在",
  partial: "部分版本存在该文件",
  unknown: "无法探测该文件",
};

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (typeof className === "string" && className.length > 0) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function linkOrText(url, text, fallback) {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    const anchor = el("a", "link", text !== undefined && text !== "" ? text : url);
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer noopener";
    return anchor;
  }
  const value = typeof text === "string" && text.length > 0 ? text : url;
  if (typeof value === "string" && value.length > 0) return el("span", "muted", value);
  return el("span", "muted", fallback === undefined ? "未登记" : fallback);
}

export function statusChip(status) {
  const tone = STATUS_TONE[status] === undefined ? "unknown" : STATUS_TONE[status];
  const text = STATUS_TEXT[status] === undefined ? STATUS_TEXT.unknown : STATUS_TEXT[status];
  const chip = el("span", "chip chip-" + tone, text);
  chip.title = STATUS_HINT[status] === undefined ? STATUS_HINT.unknown : STATUS_HINT[status];
  return chip;
}

export function cell(label, content) {
  const node = el("td");
  node.dataset.label = label;
  if (content instanceof Node) node.append(content);
  else if (Array.isArray(content)) node.append(...content);
  else if (content !== undefined && content !== null) node.textContent = String(content);
  return node;
}

export function table(columns, bodyRows, className) {
  const node = el("table", "data-table" + (className === undefined ? "" : " " + className));
  const colgroup = el("colgroup");
  for (const column of columns) {
    const col = el("col");
    if (typeof column.width === "string") col.style.width = column.width;
    colgroup.append(col);
  }
  node.append(colgroup);
  const thead = el("thead");
  const headRow = el("tr");
  for (const column of columns) headRow.append(el("th", "", column.label));
  thead.append(headRow);
  node.append(thead);
  const tbody = el("tbody");
  for (const row of bodyRows) tbody.append(row);
  node.append(tbody);
  const wrap = el("div", "table-wrap");
  wrap.append(node);
  return wrap;
}

/** 作者表:一位作者一行,列出主页、插件数与 L2 层签名材料。 */
export function buildAuthorTable(authors) {
  const rows = authors.map(function (author) {
    const row = el("tr");
    row.append(cell("作者", author.username));
    row.append(cell("主页", linkOrText(author.profile, author.username === "" ? "" : "打开主页")));
    row.append(cell("插件数", String(author.plugins.length)));
    row.append(cell("作者公钥", statusChip(author.pubKey)));
    row.append(cell("L2 清单", statusChip(author.l2Manifest)));
    row.append(cell("L2 清单签名", statusChip(author.l2Signature)));
    return row;
  });
  return table(
    [
      { label: "作者", width: "16%" },
      { label: "主页", width: "20%" },
      { label: "插件数", width: "10%" },
      { label: "作者公钥", width: "18%" },
      { label: "L2 清单", width: "18%" },
      { label: "L2 清单签名", width: "18%" },
    ],
    rows,
  );
}

function layerChips(plugin, author, layers) {
  const stack = el("span", "chip-stack");
  stack.append(el("span", "chip chip-layer", "L1 " + (STATUS_TEXT[layers.l1Manifest] || STATUS_TEXT.unknown)));
  stack.append(el("span", "chip chip-layer", "L2 " + (STATUS_TEXT[author.l2Manifest] || STATUS_TEXT.unknown)));
  stack.append(el("span", "chip chip-layer", "L3 " + (STATUS_TEXT[plugin.l3Manifest] || STATUS_TEXT.unknown)));
  const tone = [layers.l1Manifest, author.l2Manifest, plugin.l3Manifest].every(function (item) {
    return item === "present";
  })
    ? "chip-stack chip-stack-ok"
    : "chip-stack";
  stack.className = tone;
  return stack;
}

/** 插件表:一行一个插件,展开后显示版本表与签名材料表。 */
export function buildPluginTable(entries, options) {
  const rows = [];
  for (const entry of entries) {
    const plugin = entry.plugin;
    const author = entry.author;
    const key = plugin.author + "/" + plugin.dir;
    const expanded = options.expanded.has(key);
    const row = el("tr", "plugin-row");
    row.append(cell("作者", plugin.author));
    row.append(cell("插件", plugin.name));
    row.append(cell("描述", plugin.description === "" ? el("span", "muted", "未填写") : plugin.description));
    row.append(cell("许可证", plugin.license === "" ? el("span", "muted", "未填写") : plugin.license));
    row.append(cell("仓库", linkOrText(plugin.repoLink, "仓库链接")));
    row.append(cell("当前版本", plugin.latest === "" ? el("span", "muted", "无版本") : plugin.latest));
    row.append(cell("签名材料", layerChips(plugin, author, options.layers)));
    const toggle = el("button", "link-button", expanded ? "收起" : "版本 " + plugin.versions.length);
    toggle.type = "button";
    toggle.dataset.action = "toggle";
    toggle.dataset.key = key;
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    row.append(cell("版本", toggle));
    rows.push(row);
    if (expanded) rows.push(buildDetailRow(entry, options));
  }
  return table(
    [
      { label: "作者", width: "10%" },
      { label: "插件", width: "14%" },
      { label: "描述", width: "24%" },
      { label: "许可证", width: "9%" },
      { label: "仓库", width: "12%" },
      { label: "当前版本", width: "9%" },
      { label: "签名材料", width: "14%" },
      { label: "版本", width: "8%" },
    ],
    rows,
    "plugin-table",
  );
}

function buildDetailRow(entry, options) {
  const row = el("tr", "detail-row");
  const holder = cell("", el("div", "detail-stack"));
  holder.colSpan = 8;
  holder.dataset.label = "";
  holder.replaceChildren(buildDetail(entry, options));
  row.append(holder);
  return row;
}

/** 插件详情:版本表 + 签名材料表。detail 为 undefined 表示还在读取。 */
export function buildDetail(entry, options) {
  const plugin = entry.plugin;
  const author = entry.author;
  const stack = el("div", "detail-stack");
  stack.append(el("p", "detail-title", plugin.name + " 的版本与签名材料"));

  const detail = options.details.get(plugin.author + "/" + plugin.dir);
  if (detail === undefined) {
    stack.append(el("p", "detail-note", "正在读取版本与签名材料…"));
    return stack;
  }
  if (typeof detail.error === "string" && detail.error.length > 0) {
    stack.append(el("p", "detail-note detail-note-warn", "读取失败:" + detail.error));
    return stack;
  }

  const versionRows = detail.rows.map(function (record) {
    const row = el("tr");
    row.append(cell("版本", record.version));
    row.append(cell("是否最新", record.latest ? el("span", "chip chip-ok", "最新") : el("span", "muted", "")));
    row.append(cell("许可证", record.meta !== null && typeof record.meta.license === "string" ? record.meta.license : "未填写"));
    row.append(cell("meta.json", statusChip(record.metaStatus)));
    row.append(cell("plugin.js", statusChip(record.bundle)));
    row.append(cell("plugin.js.sig", statusChip(record.bundleSignature)));
    row.append(cell("作者签名", statusChip(record.authorSignature)));
    return row;
  });
  stack.append(
    table(
      [
        { label: "版本", width: "14%" },
        { label: "是否最新", width: "12%" },
        { label: "许可证", width: "16%" },
        { label: "meta.json", width: "14%" },
        { label: "plugin.js", width: "14%" },
        { label: "plugin.js.sig", width: "16%" },
        { label: "作者签名", width: "14%" },
      ],
      versionRows,
      "compact",
    ),
  );

  const bundleSignature = summarise(
    detail.rows.map(function (record) {
      return record.bundleSignature;
    }),
  );
  const authorSignature = summarise(
    detail.rows.map(function (record) {
      return record.authorSignature;
    }),
  );
  const signatureRows = [
    signatureRow("L1 清单", "manifest.json", options.layers.l1Manifest, "manifest.json"),
    signatureRow("L1 清单签名", "manifest.json.sig", options.layers.l1Signature, "manifest.json.sig"),
    signatureRow("L2 清单", "manifest.json", author.l2Manifest, "plugins/" + author.username + "/manifest.json"),
    signatureRow("L2 清单签名", "manifest.json.sig", author.l2Signature, "plugins/" + author.username + "/manifest.json.sig"),
    signatureRow("作者公钥", "author_pub.pem", author.pubKey, "plugins/" + author.username + "/author_pub.pem"),
    signatureRow("L3 清单", "manifest.json", plugin.l3Manifest, "plugins/" + plugin.author + "/" + plugin.dir + "/manifest.json"),
    signatureRow("L3 清单签名", "manifest.json.sig", plugin.l3Signature, "plugins/" + plugin.author + "/" + plugin.dir + "/manifest.json.sig"),
    signatureRow("产物签名", "plugin.js.sig", bundleSignature, "plugins/" + plugin.author + "/" + plugin.dir + "/<版本>/plugin.js.sig"),
    signatureRow("作者签名", "plugin.js.author.sig", authorSignature, "plugins/" + plugin.author + "/" + plugin.dir + "/<版本>/plugin.js.author.sig"),
  ];
  stack.append(
    table(
      [
        { label: "层", width: "18%" },
        { label: "文件", width: "22%" },
        { label: "状态", width: "14%" },
        { label: "路径", width: "46%" },
      ],
      signatureRows,
      "compact signature-table",
    ),
  );
  stack.append(el("p", "detail-note", "以上状态只表示对应文件是否存在,未做任何密码学计算,不代表已验签。"));
  return stack;
}

function signatureRow(layer, file, status, path) {
  const row = el("tr");
  row.append(cell("层", layer));
  row.append(cell("文件", el("span", "mono", file)));
  row.append(cell("状态", statusChip(status)));
  row.append(cell("路径", el("span", "mono path", path)));
  return row;
}
