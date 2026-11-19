# 插件树

本文说明 pages 包 `plugins/` 目录的结构与必需文件。仓库根没有 `plugins/` 目录:插件树是构建产物,只在构建出的 pages 包里出现,本仓库只保留这份说明。

`plugins/` 存放合集收录的全部插件,按「作者 / 插件 / 版本」三层组织。每层一份 `manifest.json` 与一份 `manifest.json.sig`:清单记录本层文件的 SHA-512,签名由根 CA 签发的终端签名证书(EEC)生成。产物本体另有每版本的 `plugin.js.sig`,作者可选地用自有密钥追加一份裸公钥分离签名。

## 作者目录

`plugins/<author>/`

- 目录名即作者英文名称,必须与 `datalog.json` 的 `author`、`plugins/author_manifest.json` 的 `username` 完全一致。
- 仅允许小写字母、数字、连字符,不得以连字符开头或结尾,最长 39 字符。

| 文件 | 必需 | 说明 |
|:---:|:---:|:---:|
| `plugin_manifest.json` | 是 | 该作者的插件名数组,例如 `["dsc-demo"]` |
| `author_pub.pem` | 否 | 作者公钥,OpenSSL PEM,Ed25519。版本目录出现 `plugin.js.author.sig` 时必须存在 |
| `manifest.json` | 是 | L2 清单,覆盖本目录的 `author_pub.pem` 与 `plugin_manifest.json`,文件存在才覆盖 |
| `manifest.json.sig` | 是 | L2 清单的 CMS 分离签名,由 EEC 生成 |

作者公钥由插件作者提供,登记在 `catalog/<作者>/author_pub.pem`,构建时复制到 pages 包的 `plugins/<作者>/author_pub.pem`。不要在合集里手工生成。缺失时校验只给警告,该作者的插件便不能带作者签名。

## 插件目录

`plugins/<author>/<plugin>/`

- 目录名取插件 npm 包名去掉命名空间前缀:`dsc-demo` 写作 `dsc-demo`,`@alice/dsc-demo` 同样写作 `dsc-demo`。
- 插件名必须匹配 `dsc-xxx` 或 `@scope/dsc-xxx`,仅允许小写字母、数字、点、下划线、连字符。
- 目录内必需 `versions.json`:

```json
{
  "latest": "1.0.0",
  "versions": ["1.0.0", "0.9.0"]
}
```

- `latest` 必须出现在 `versions` 内;`versions` 由收录脚本按版本号降序写入且不重复,手工修改时保持同样的顺序。
- 目录内另有 `manifest.json` 与 `manifest.json.sig`,即 L3 清单,覆盖 `versions.json` 与每个版本的 `meta.json`。L3 不覆盖 `plugin.js` 与 `plugin.js.sig`,产物本体由每版本的 `plugin.js.sig` 独立签名。

## 版本目录

`plugins/<author>/<plugin>/<x.y.z>/`

| 文件 | 必需 | 签名者 | 说明 |
|:---:|:---:|:---:|:---:|
| `meta.json` | 是 | 无 | 插件运行时元数据,由 L3 清单覆盖,不再单独签名 |
| `plugin.js` | 是 | 无 | 插件运行时脚本,单文件 ESM,使用 LF 换行 |
| `plugin.js.sig` | 是 | 本仓库 EEC | `plugin.js` 的 CMS 分离签名,由 CI 的 `build-from-catalog.mjs` 重新生成 |
| `plugin.js.author.sig` | 否 | 插件作者 | `plugin.js` 的裸公钥分离签名,随插件产物提供,存在时用 `plugins/<author>/author_pub.pem` 校验 |

`meta.json.sig` 与 `meta.json.author.sig` 已取消:版本目录里的合集签名只剩 `plugin.js.sig`。`meta.json` 由 L3 清单覆盖并由合集 EEC 绑定,作者公钥本身由 L2 覆盖;若作者沿用 `dsc-plugin-template` 的产物,该模板会一并产出 `meta.json.author.sig`,本仓库不收录这个文件。

CMS 签名与作者签名都是对文件原始字节的签名,不做换行规范化。任何一字节差异(包括 LF 与 CRLF 的差别)都会让校验失败。

`meta.json` 的字段:

| 字段 | 类型 | 说明 |
|:---:|:---:|:---:|
| `name` | string | 插件名,与 `datalog.json` 的 `plugin_name` 一致 |
| `version` | string | 三段语义化版本号,与目录名一致 |
| `license` | string | SPDX 标识符,例如 MIT |
| `description` | object | 至少包含 `zh-CN` 或 `en-US` 之一 |
| `author` | string | 作者名 |
| `repo_link` | string | 源码仓库链接 |
| `dependencies` | object | 仅允许 `dsc` 一个键,值为 semver range |

校验脚本强制 `name` 与 `version` 分别与 `datalog.json`、目录名一致;其余字段由分发规范 v2 要求,市场展示插件时读取。

## 清单

每层清单格式一致,JSON Schema 见 `schemas/manifest.schema.json`:

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "files": [
    { "path": "versions.json", "sha512": "<128 位小写十六进制>" }
  ]
}
```

- `path` 相对清单所在目录,正斜杠分隔,不含 `..`,不指向清单自身。
- `revision` 每层独立:该层文件集合或内容变化时加一,不变时沿用旧值;上一份值按层从已发布站点的同名 `manifest.json` 读取,取不到时从 1 开始。
- pages 包内的清单与签名由构建生成,不提交到仓库。

## 目录示例

```text
plugins/
  alice/
    author_pub.pem
    plugin_manifest.json
    manifest.json
    manifest.json.sig
    dsc-demo/
      versions.json
      manifest.json
      manifest.json.sig
      1.0.0/
        meta.json
        plugin.js
        plugin.js.sig
        plugin.js.author.sig
```

pages 包根目录另有 `meta.json`、`tags.json`、`datalog.json`,以及 L1 清单 `manifest.json` 与 `manifest.json.sig`,含义见根目录 [README](../README.md)。仓库内不存放 `eec.pem`,合集证书只在 `certs/awesome-dsc-plugin-eec.crt`。
