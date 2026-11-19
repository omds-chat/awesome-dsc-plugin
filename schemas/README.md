# JSON Schema

本目录存放本仓库的 JSON Schema,全部使用 [JSON Schema draft 2020-12](https://json-schema.org/draft/2020-12/schema)。Schema 只约束结构,不代替 CI 对证书、公钥格式、哈希与可达性的检查。

| Schema | 约束对象 | 要点 |
|:---:|:---:|:---:|
| [manifest.schema.json](manifest.schema.json) | 三层哈希清单 `manifest.json` | `schemaVersion`、`revision`、`files` 三项;`path` 相对清单所在目录,正斜杠;`sha512` 为 128 位小写十六进制 |
| [plugins.schema.json](plugins.schema.json) | pages 包根目录的插件目录索引 `plugins.json` | 顶层数组;每条含 `plugin_name`、`author`、`tag`,不接受额外字段;与同目录的 `plugins/` 插件树成对 |
| [catalog-author.schema.json](catalog-author.schema.json) | `catalog/<作者>/author.json` | `username` 与 `profile` 必填、非空;`username` 符合 GitHub 用户名规则(字母、数字与连字符,首尾不是连字符,长度 1 到 39);不接受额外字段 |
| [catalog-plugin.schema.json](catalog-plugin.schema.json) | `catalog/<作者>/<插件>/plugin.json` | `name`、`description`、`license`、`repo_link`、`base_url` 五个字段必填;`name` 必须以 `dsc-` 为前缀,写成 `dsc-xxx` 或 `@scope/dsc-xxx`;`tags` 可选,字符串数组、元素非空且不重复;`base_url` 为 http 或 https 开头的绝对地址且以斜杠结尾 |
| [catalog-removed.schema.json](catalog-removed.schema.json) | `catalog/removed.json` | 已解除托管的插件清单;`name`、`base_url`、`removed_in` 必填,`note` 可选;不接受额外字段 |
| [catalog-index.schema.json](catalog-index.schema.json) | pages 包 `catalog/index.json` | 构建生成的汇总索引:作者列表含 `username`、`profile`、`plugin_count` 与内嵌插件登记;插件列表含作者、名称、描述、许可证、仓库链接、当前版本、标签与版本数 |

## 约束范围

- `manifest.schema.json` 是分发清单的结构约定,覆盖范围、哈希比对与清单签名由 CI 和 `scripts/` 里的校验逻辑执行。
- `plugins.schema.json` 约束构建产出的插件目录索引 `plugins.json`,该文件由 `scripts/build-from-catalog.mjs` 生成,不入库;条目与 `plugins/` 树、`catalog/index.json` 的一致性由 `scripts/verify-catalog-consistency.mjs` 检查。
- 三份 catalog schema 中,`catalog-author`、`catalog-plugin` 与 `catalog-removed` 约束仓库内的登记文件,字段语义与提交流程见 [catalog/README.md](../catalog/README.md)。
- `catalog-index.schema.json` 约束构建产出的 `catalog/index.json`,该文件由 `scripts/build-from-catalog.mjs` 生成,不入库。
- 结构合法不等于收录通过:公钥格式、标签是否属于预设清单、`base_url` 可达性、版本发现与重新签名都在结构校验之外。
- 本目录的 schema 是本仓库自用的实例副本,不与模板仓库 `awesome-dsc-plugin-set-template` 下的同名文件逐字一致:`$id` 指向各自的站点,且本仓库另有 catalog 层的 schema 是模板里没有的。两边若同时改动同一条规则,以模板仓库为规范来源,本仓库跟随。
