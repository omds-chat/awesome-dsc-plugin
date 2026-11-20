/** 页面入口:加载合集数据、维护筛选状态、渲染工具栏与表格。 */
import { loadCollection, loadPluginDetail } from "./data.js";
import { sortPlugins } from "./format.js";
import { buildAuthorTable, buildPluginTable, el } from "./view.js";

const state = {
  collection: null,
  query: "",
  author: "",
  sort: "name-asc",
  expanded: new Set(),
  details: new Map(),
};

const content = document.getElementById("content");
const statusLine = document.getElementById("status");
let sectionsNode = null;

function setStatus(text, tone) {
  statusLine.textContent = text;
  statusLine.className = "status-line" + (tone === undefined ? "" : " status-" + tone);
}

function pluginCountOf(collection) {
  return collection.authors.reduce(function (total, author) {
    return total + author.plugins.length;
  }, 0);
}

function filteredEntries() {
  const collection = state.collection;
  if (collection === null) return [];
  const entries = [];
  const query = state.query.trim().toLowerCase();
  for (const author of collection.authors) {
    if (state.author !== "" && author.username !== state.author) continue;
    for (const plugin of author.plugins) {
      if (query.length > 0) {
        const haystack = [plugin.name, plugin.description, plugin.license, plugin.author].join(" ").toLowerCase();
        if (haystack.indexOf(query) === -1) continue;
      }
      entries.push({ author: author, plugin: plugin });
    }
  }
  const plugins = sortPlugins(
    entries.map(function (entry) {
      return entry.plugin;
    }),
    state.sort,
  );
  const byKey = new Map();
  for (const entry of entries) byKey.set(entry.plugin.author + "/" + entry.plugin.dir, entry);
  return plugins.map(function (plugin) {
    return byKey.get(plugin.author + "/" + plugin.dir);
  });
}

function createToolbar() {
  const collection = state.collection;
  const toolbar = el("section", "toolbar");
  toolbar.setAttribute("aria-label", "筛选与排序");

  const searchField = el("div", "field");
  const searchLabel = el("label", "field-label", "搜索");
  searchLabel.htmlFor = "plugin-search";
  const search = el("input", "search-input");
  search.id = "plugin-search";
  search.type = "search";
  search.autocomplete = "off";
  search.spellcheck = false;
  search.placeholder = "插件名、描述或许可证";
  search.value = state.query;
  search.addEventListener("input", function () {
    state.query = search.value;
    renderSections();
  });
  searchField.append(searchLabel, search);

  const authorField = el("div", "field");
  const authorLabel = el("label", "field-label", "作者");
  authorLabel.htmlFor = "author-select";
  const authorSelect = el("select", "select");
  authorSelect.id = "author-select";
  const all = el("option", "", "全部作者");
  all.value = "";
  authorSelect.append(all);
  for (const author of collection.authors) {
    const option = el("option", "", author.username);
    option.value = author.username;
    authorSelect.append(option);
  }
  authorSelect.value = state.author;
  authorSelect.addEventListener("change", function () {
    state.author = authorSelect.value;
    renderSections();
  });
  authorField.append(authorLabel, authorSelect);

  const sortField = el("div", "field");
  const sortLabel = el("label", "field-label", "排序");
  sortLabel.htmlFor = "sort-select";
  const sortSelect = el("select", "select");
  sortSelect.id = "sort-select";
  for (const item of [
    { value: "name-asc", label: "名称升序" },
    { value: "name-desc", label: "名称降序" },
    { value: "version-desc", label: "版本降序" },
  ]) {
    const option = el("option", "", item.label);
    option.value = item.value;
    sortSelect.append(option);
  }
  sortSelect.value = state.sort;
  sortSelect.addEventListener("change", function () {
    state.sort = sortSelect.value;
    renderSections();
  });
  sortField.append(sortLabel, sortSelect);

  toolbar.append(searchField, authorField, sortField);
  return toolbar;
}

function authorsSection() {
  const collection = state.collection;
  const section = el("section", "section");
  const heading = el("h2", "section-title", "作者");
  const note = el("p", "section-note", collection.authors.length === 0 ? "页面内没有读到作者登记。" : "共 " + collection.authors.length + " 位作者。");
  section.append(heading, note);
  if (collection.authors.length > 0) section.append(buildAuthorTable(collection.authors));
  return section;
}

function pluginsSection(entries) {
  const section = el("section", "section");
  const heading = el("h2", "section-title", "插件");
  const note = el("p", "section-note", entries.length === 0 ? "当前筛选下没有插件。" : "共 " + entries.length + " 个插件。");
  section.append(heading, note);
  if (entries.length > 0) {
    section.append(
      buildPluginTable(entries, {
        expanded: state.expanded,
        details: state.details,
        layers: { l1Manifest: state.collection.l1Manifest, l1Signature: state.collection.l1Signature },
      }),
    );
  }
  return section;
}

function renderSections() {
  if (sectionsNode === null || state.collection === null) return;
  sectionsNode.replaceChildren(authorsSection(), pluginsSection(filteredEntries()));
}

async function togglePlugin(key) {
  if (state.expanded.has(key)) {
    state.expanded.delete(key);
    renderSections();
    return;
  }
  state.expanded.add(key);
  renderSections();
  if (state.details.has(key)) return;
  const entry = filteredEntries().filter(function (item) {
    return item.plugin.author + "/" + item.plugin.dir === key;
  })[0];
  if (entry === undefined) return;
  try {
    const rows = await loadPluginDetail(entry.plugin);
    state.details.set(key, { rows: rows, error: "" });
  } catch (error) {
    state.details.set(key, { rows: [], error: error instanceof Error ? error.message : String(error) });
  }
  renderSections();
}

function onContentClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("button[data-action='toggle']");
  if (button === null) return;
  const key = button.dataset.key;
  if (typeof key !== "string" || key.length === 0) return;
  void togglePlugin(key);
}

async function boot() {
  setStatus("正在读取页面内的合集数据…");
  try {
    const collection = await loadCollection();
    state.collection = collection;
    if (collection.authors.length === 0) {
      setStatus("页面内没有读到作者与插件:catalog/index.json、plugins/author_manifest.json 与 plugins.json 都不可用。", "warn");
    } else {
      setStatus("已读取 " + collection.authors.length + " 位作者、" + pluginCountOf(collection) + " 个插件;数据来自 " + collection.source + "。");
    }
    content.replaceChildren();
    sectionsNode = el("div", "sections");
    content.append(createToolbar(), sectionsNode);
    content.addEventListener("click", onContentClick);
    renderSections();
  } catch (error) {
    setStatus("读取合集数据失败:" + (error instanceof Error ? error.message : String(error)), "error");
  }
}

void boot();
