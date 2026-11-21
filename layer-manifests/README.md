# layer-manifests

本目录保存三层清单的上一版,由流水线在发布前写回,下一次构建按层读回以沿用 `revision`。目录内每个文件在 pages 包里都有一个同路径的对应文件。

## 镜像规则

| 分发路径(pages 包内) | 本分支路径 | 层 |
|:---:|:---:|:---:|
| `manifest.json` | `layer-manifests/manifest.json` | L1 |
| `manifest.json.sig` | `layer-manifests/manifest.json.sig` | L1 |
| `plugins/<作者>/manifest.json` | `layer-manifests/plugins/<作者>/manifest.json` | L2 |
| `plugins/<作者>/manifest.json.sig` | `layer-manifests/plugins/<作者>/manifest.json.sig` | L2 |
| `plugins/<作者>/<插件>/manifest.json` | `layer-manifests/plugins/<作者>/<插件>/manifest.json` | L3 |
| `plugins/<作者>/<插件>/manifest.json.sig` | `layer-manifests/plugins/<作者>/<插件>/manifest.json.sig` | L3 |

八条规则:

1. 相对 pages 包根的路径原样拼在 `layer-manifests/` 之后,不增删中间层级,不重命名。
2. 只镜像 `manifest.json` 与 `manifest.json.sig`;同目录的 `plugin_manifest.json`、`author_pub.pem`、`versions.json`、`meta.json`、`plugin.js` 与各自的签名都不镜像。
3. 目录名与分发目录逐字一致,含大小写;作者名与插件名不转义、不做小写化、不做哈希。
4. 清单与签名成对存在:任一层的两份文件缺一份,或两份来自不同一次构建,都视为写回失败。
5. 每层只保留上一版:写回时整体替换该层的两份文件,不留历史版本,也不留备份。
6. 某作者或某插件在本次构建中被剔除,或已从 `catalog/` 下架时,写回时删除对应的 `layer-manifests/plugins/<作者>/` 或 `layer-manifests/plugins/<作者>/<插件>/` 整个目录,避免残留的旧清单被下一次构建当成现行层。
7. 本目录的人工维护文件只有本 `README.md`;清单与签名只能由流水线生成,不手工编辑。
8. 读回只取 `manifest.json` 的 `schemaVersion`、`revision` 与 `files`,验签不参与读回;签名随清单一起保存,供人工排查时核对。

## 没有清单时

三层清单在流水线第一次写回后出现。在此之前按「取不到」处理,该层 `revision` 从 1 开始。
