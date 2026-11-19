# JSON Schema

本目录存放本仓库的 JSON Schema,全部使用 [JSON Schema draft 2020-12](https://json-schema.org/draft/2020-12/schema)。Schema 只约束结构,不代替 CI 对证书、公钥格式、哈希与可达性的检查。

| Schema | 约束对象 | 要点 |
|:---:|:---:|:---:|
| [manifest.schema.json](manifest.schema.json) | 三层哈希清单 `manifest.json` | `schemaVersion`、`revision`、`files` 三项;`path` 相对清单所在目录,正斜杠;`sha512` 为 128 位小写十六进制 |
| [catalog-author.schema.json](catalog-author.schema.json) | `catalog/<作者>/author.json` | `username` 与 `profile` 必填、非空;不接受额外字段 |
| [catalog-plugin.schema.json](catalog-plugin.schema.json) | `catalog/<作者>/<插件>/plugin.json` | `name`、`description`、`license`、`repo_link`、`base_url` 五个字段必填;`base_url` 为 http 或 https 开头的绝对地址且以斜杠结尾 |

## 约束范围

- `manifest.schema.json` 是分发清单的结构约定,覆盖范围、哈希比对与清单签名由 CI 和 `scripts/` 里的校验逻辑执行。
- 两份 catalog schema 是收录登记的结构约定,字段语义与提交流程见 [catalog/README.md](../catalog/README.md)。
- 结构合法不等于收录通过:公钥格式、`base_url` 可达性、版本发现与重新签名都在结构校验之外。
