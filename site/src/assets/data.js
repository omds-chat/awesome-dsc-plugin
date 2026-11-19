/**
 * 站点数据读取。
 *
 * 所有路径都相对本站根目录,也就是 pages 包根目录,不跨站拉取。
 *
 * 作者与插件列表的来源优先级:
 *   1. catalog/index.json             可选索引,存在即以其为准;
 *   2. plugins/author_manifest.json   每个 pages 包都写出的作者清单;
 *   3. datalog.json                   兜底,只提供作者名与插件名。
 * 插件展示字段来自 catalog/<作者>/<插件>/plugin.json,缺失时回落到最新版本的 meta.json。
 * 版本列表来自 plugins/<作者>/<插件>/versions.json。
 * 签名材料只做文件存在性探测,不做任何密码学运算。
 */

export const PRESENT = "present";
export const MISSING = "missing";
export const UNKNOWN = "unknown";

export const PATHS = {
  catalogIndex: "catalog/index.json",
  authorManifest: "plugins/author_manifest.json",
  datalog: "datalog.json",
  l1Manifest: "manifest.json",
  l1Signature: "manifest.json.sig",
  authorJson: function (author) {
    return "catalog/" + author + "/author.json";
  },
  authorPub: function (author) {
    return "plugins/" + author + "/author_pub.pem";
  },
  authorPluginManifest: function (author) {
    return "plugins/" + author + "/plugin_manifest.json";
  },
  authorL2Manifest: function (author) {
    return "plugins/" + author + "/manifest.json";
  },
  authorL2Signature: function (author) {
    return "plugins/" + author + "/manifest.json.sig";
  },
  catalogPlugin: function (author, plugin) {
    return "catalog/" + author + "/" + plugin + "/plugin.json";
  },
  versions: function (author, plugin) {
    return "plugins/" + author + "/" + plugin + "/versions.json";
  },
  pluginL3Manifest: function (author, plugin) {
    return "plugins/" + author + "/" + plugin + "/manifest.json";
  },
  pluginL3Signature: function (author, plugin) {
    return "plugins/" + author + "/" + plugin + "/manifest.json.sig";
  },
  versionMeta: function (author, plugin, version) {
    return "plugins/" + author + "/" + plugin + "/" + version + "/meta.json";
  },
  versionBundle: function (author, plugin, version) {
    return "plugins/" + author + "/" + plugin + "/" + version + "/plugin.js";
  },
  versionBundleSignature: function (author, plugin, version) {
    return "plugins/" + author + "/" + plugin + "/" + version + "/plugin.js.sig";
  },
  versionAuthorSignature: function (author, plugin, version) {
    return "plugins/" + author + "/" + plugin + "/" + version + "/plugin.js.author.sig";
  },
};

const jsonCache = new Map();
const probeCache = new Map();

function request(rel, init) {
  return fetch(rel, Object.assign({ cache: "no-store" }, init));
}

/** 读取同源 JSON,404 视为缺失,网络失败或非 2xx 视为无法探测。 */
export function readJson(rel) {
  if (!jsonCache.has(rel)) jsonCache.set(rel, loadJson(rel));
  return jsonCache.get(rel);
}

async function loadJson(rel) {
  let response;
  try {
    response = await request(rel, { method: "GET", headers: { accept: "application/json" } });
  } catch (error) {
    return { status: UNKNOWN, rel: rel, data: null };
  }
  if (response.status === 404 || response.status === 410) return { status: MISSING, rel: rel, data: null };
  if (!response.ok) return { status: UNKNOWN, rel: rel, data: null };
  try {
    return { status: PRESENT, rel: rel, data: await response.json() };
  } catch (error) {
    return { status: UNKNOWN, rel: rel, data: null };
  }
}

/** 探测同源文件是否存在,只发 HEAD,不做任何内容读取。 */
export function probe(rel) {
  if (!probeCache.has(rel)) probeCache.set(rel, loadProbe(rel));
  return probeCache.get(rel);
}

async function loadProbe(rel) {
  let response;
  try {
    response = await request(rel, { method: "HEAD" });
  } catch (error) {
    return UNKNOWN;
  }
  if (response.status === 404 || response.status === 410) return MISSING;
  if (response.ok) return PRESENT;
  if (response.status === 405 || response.status === 501) return probeWithGet(rel);
  return UNKNOWN;
}

async function probeWithGet(rel) {
  try {
    const response = await request(rel, { method: "GET", headers: { range: "bytes=0-0" } });
    if (response.status === 404 || response.status === 410) return MISSING;
    if (response.ok || response.status === 206) return PRESENT;
    return UNKNOWN;
  } catch (error) {
    return UNKNOWN;
  }
}

function pickDescription(value) {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") {
    const preferred = ["zh-CN", "en-US"];
    for (const key of preferred) {
      if (typeof value[key] === "string" && value[key].length > 0) return value[key];
    }
    for (const key of Object.keys(value)) {
      if (typeof value[key] === "string" && value[key].length > 0) return value[key];
    }
  }
  return "";
}

function parseVersions(result) {
  if (result.status !== PRESENT || result.data === null || !Array.isArray(result.data.versions)) {
    return { latest: "", versions: [], status: result.status };
  }
  const versions = result.data.versions.filter(function (item) {
    return typeof item === "string" && item.length > 0;
  });
  const declared = typeof result.data.latest === "string" ? result.data.latest : "";
  const latest = versions.indexOf(declared) === -1 ? (versions.length > 0 ? versions[0] : "") : declared;
  return { latest: latest, versions: versions, status: result.status };
}

function readIndexAuthors(data) {
  if (data === null || typeof data !== "object" || !Array.isArray(data.authors)) return null;
  const authors = [];
  for (const entry of data.authors) {
    if (entry === null || typeof entry !== "object" || typeof entry.username !== "string") continue;
    const plugins = [];
    if (Array.isArray(entry.plugins)) {
      for (const plugin of entry.plugins) {
        if (plugin === null || typeof plugin !== "object" || typeof plugin.name !== "string") continue;
        plugins.push({
          name: plugin.name,
          description: typeof plugin.description === "string" ? plugin.description : "",
          license: typeof plugin.license === "string" ? plugin.license : "",
          repoLink: typeof plugin.repo_link === "string" ? plugin.repo_link : "",
          baseUrl: typeof plugin.base_url === "string" ? plugin.base_url : "",
        });
      }
    }
    authors.push({
      username: entry.username,
      profile: typeof entry.profile === "string" ? entry.profile : null,
      plugins: plugins,
    });
  }
  return authors;
}

async function resolvePlugin(author, name, hint) {
  const dir = hint !== null && hint !== undefined && typeof hint.name === "string" ? hint.name.split("/").pop() : name.split("/").pop();
  const [versionsJson, registration, l3Manifest, l3Signature] = await Promise.all([
    readJson(PATHS.versions(author, dir)),
    readJson(PATHS.catalogPlugin(author, dir)),
    probe(PATHS.pluginL3Manifest(author, dir)),
    probe(PATHS.pluginL3Signature(author, dir)),
  ]);
  const parsed = parseVersions(versionsJson);
  let meta = null;
  if (parsed.latest.length > 0) {
    const latestMeta = await readJson(PATHS.versionMeta(author, dir, parsed.latest));
    if (latestMeta.status === PRESENT && latestMeta.data !== null && typeof latestMeta.data === "object") meta = latestMeta.data;
  }
  const registered = registration.status === PRESENT && registration.data !== null ? registration.data : null;
  const hintDescription = hint !== null && hint !== undefined && typeof hint.description === "string" ? hint.description : "";
  const hintLicense = hint !== null && hint !== undefined && typeof hint.license === "string" ? hint.license : "";
  const hintRepoLink = hint !== null && hint !== undefined && typeof hint.repoLink === "string" ? hint.repoLink : "";
  const hintBaseUrl = hint !== null && hint !== undefined && typeof hint.baseUrl === "string" ? hint.baseUrl : "";
  const description = hintDescription || (registered !== null ? pickDescription(registered.description) : "") || (meta !== null ? pickDescription(meta.description) : "");
  const license = hintLicense || (registered !== null && typeof registered.license === "string" ? registered.license : "") || (meta !== null && typeof meta.license === "string" ? meta.license : "");
  const repoLink = hintRepoLink || (registered !== null && typeof registered.repo_link === "string" ? registered.repo_link : "") || (meta !== null && typeof meta.repo_link === "string" ? meta.repo_link : "");
  const baseUrl = hintBaseUrl || (registered !== null && typeof registered.base_url === "string" ? registered.base_url : "");
  return {
    author: author,
    dir: dir,
    name: typeof (registered !== null ? registered.name : null) === "string" ? registered.name : (hint !== null && hint !== undefined && typeof hint.name === "string" ? hint.name : name),
    description: description,
    license: license,
    repoLink: repoLink,
    baseUrl: baseUrl,
    latest: parsed.latest,
    versions: parsed.versions,
    versionsStatus: parsed.status,
    l3Manifest: l3Manifest,
    l3Signature: l3Signature,
  };
}

async function resolveAuthor(entry, datalog) {
  const username = entry.username;
  const names = [];
  if (Array.isArray(entry.plugins) && entry.plugins.length > 0) {
    for (const plugin of entry.plugins) names.push(plugin.name);
  } else {
    const manifest = await readJson(PATHS.authorPluginManifest(username));
    if (manifest.status === PRESENT && Array.isArray(manifest.data)) {
      for (const name of manifest.data) {
        if (typeof name === "string" && name.length > 0) names.push(name);
      }
    } else if (Array.isArray(datalog)) {
      for (const record of datalog) {
        if (record !== null && typeof record === "object" && record.author === username && typeof record.plugin_name === "string") {
          names.push(record.plugin_name);
        }
      }
    }
  }
  let profile = entry.profile;
  if (typeof profile !== "string" || profile.length === 0) {
    const authorInfo = await readJson(PATHS.authorJson(username));
    profile = authorInfo.status === PRESENT && authorInfo.data !== null && typeof authorInfo.data.profile === "string" ? authorInfo.data.profile : "";
  }
  const [pubKey, l2Manifest, l2Signature] = await Promise.all([
    probe(PATHS.authorPub(username)),
    probe(PATHS.authorL2Manifest(username)),
    probe(PATHS.authorL2Signature(username)),
  ]);
  const hints = new Map();
  if (Array.isArray(entry.plugins)) {
    for (const plugin of entry.plugins) hints.set(plugin.name.split("/").pop(), plugin);
  }
  const plugins = [];
  for (const name of names) {
    const dir = name.split("/").pop();
    plugins.push(await resolvePlugin(username, name, hints.get(dir) || null));
  }
  plugins.sort(function (left, right) {
    return left.name < right.name ? -1 : 1;
  });
  return {
    username: username,
    profile: typeof profile === "string" ? profile : "",
    pubKey: pubKey,
    l2Manifest: l2Manifest,
    l2Signature: l2Signature,
    plugins: plugins,
  };
}

/** 读取整份合集:作者及其插件。 */
export async function loadCollection() {
  const index = await readJson(PATHS.catalogIndex);
  const indexed = index.status === PRESENT ? readIndexAuthors(index.data) : null;
  const [l1Manifest, l1Signature] = await Promise.all([probe(PATHS.l1Manifest), probe(PATHS.l1Signature)]);
  if (indexed !== null && indexed.length > 0) {
    const authors = [];
    for (const entry of indexed) authors.push(await resolveAuthor(entry, null));
    return {
      source: "catalog/index.json",
      l1Manifest: l1Manifest,
      l1Signature: l1Signature,
      authors: authors.sort(function (left, right) {
        return left.username < right.username ? -1 : 1;
      }),
    };
  }
  const [manifest, datalog] = await Promise.all([readJson(PATHS.authorManifest), readJson(PATHS.datalog)]);
  const entries = [];
  const seen = new Set();
  if (manifest.status === PRESENT && Array.isArray(manifest.data)) {
    for (const record of manifest.data) {
      if (record === null || typeof record !== "object" || typeof record.username !== "string") continue;
      if (seen.has(record.username)) continue;
      seen.add(record.username);
      entries.push({ username: record.username, profile: typeof record.profile === "string" ? record.profile : "", plugins: null });
    }
  }
  const datalogRecords = datalog.status === PRESENT && Array.isArray(datalog.data) ? datalog.data : [];
  for (const record of datalogRecords) {
    if (record === null || typeof record !== "object" || typeof record.author !== "string") continue;
    if (seen.has(record.author)) continue;
    seen.add(record.author);
    entries.push({ username: record.author, profile: "", plugins: null });
  }
  const authors = [];
  for (const entry of entries) authors.push(await resolveAuthor(entry, datalogRecords));
  const sources = [];
  if (manifest.status === PRESENT) sources.push("plugins/author_manifest.json");
  if (datalog.status === PRESENT) sources.push("datalog.json");
  return {
    source: sources.length > 0 ? sources.join(" 与 ") : "未找到作者索引",
    l1Manifest: l1Manifest,
    l1Signature: l1Signature,
    authors: authors.sort(function (left, right) {
      return left.username < right.username ? -1 : 1;
    }),
  };
}

/** 读取一个插件的逐版本明细:meta.json 与各版本签名材料的存在性。 */
export async function loadPluginDetail(plugin) {
  const rows = await Promise.all(
    plugin.versions.map(async function (version) {
      const [meta, bundle, bundleSignature, authorSignature] = await Promise.all([
        readJson(PATHS.versionMeta(plugin.author, plugin.dir, version)),
        probe(PATHS.versionBundle(plugin.author, plugin.dir, version)),
        probe(PATHS.versionBundleSignature(plugin.author, plugin.dir, version)),
        probe(PATHS.versionAuthorSignature(plugin.author, plugin.dir, version)),
      ]);
      return {
        version: version,
        latest: version === plugin.latest,
        metaStatus: meta.status,
        meta: meta.status === PRESENT && meta.data !== null && typeof meta.data === "object" ? meta.data : null,
        bundle: bundle,
        bundleSignature: bundleSignature,
        authorSignature: authorSignature,
      };
    }),
  );
  return rows;
}
