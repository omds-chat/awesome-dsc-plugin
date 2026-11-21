# ci-memory

本分支是孤立的并行分支:与 `main` 无公共祖先,不派生自 `main`,也不合并回 `main`。它只承载跨构建需要延续的状态,不承载源码、构建脚本、依赖清单与任何分发内容。

| 项 | 内容 |
|:---:|:---|
| 职责 | 保存三层清单的上一版,供下一次构建按层沿用 `revision` |
| 内容 | 只有 `layer-manifests/`:三层 `manifest.json` 与同名 `manifest.json.sig`,按与分发目录相同的路径镜像,规则见 `layer-manifests/README.md` |
| 谁写 | 流水线。本次构建与全部校验通过后写回;人工只在建立分支与排查时提交 |
| 谁读 | 只有流水线。客户端、站点与插件市场都不读本分支 |
| 是否发布到 Pages | 否。本分支内容不进任何 pages 包,不参与部署 |
| 与 `main` 的关系 | 无公共祖先;不从 `main` 派生,不合并回 `main` |
| 本地工作区 | `single-branch/ci-memory/`,自带 `.git`,主仓库 `.gitignore` 忽略该目录 |

## 写回与读回

| 项 | 结论 |
|:---:|:---|
| 写回时机 | 三层清单生成并签名、pages 包校验与独立验签全部通过之后,部署之前 |
| 写回内容 | 每层一份 `manifest.json` 与一份 `manifest.json.sig`,路径与 pages 包一致,规则见 `layer-manifests/README.md` |
| 写回失败 | 中止本次发布,CI 报错,不沿用旧 `revision` 继续发布 |
| 读回时机 | 构建开始前按层读回上一版清单,只用于沿用 `revision` |
| 读回现状 | 当前实现仍按层从已发布站点的同名 `manifest.json` 读回;改为从本分支 `layer-manifests/` 读回属下一步实现 |
| 只留上一版 | 每次写回整体替换该层的两份文件,不留历史版本;需要历史时用归档 tag |

## 边界

- 不放 pages 包本体,不放 `plugin.js`、`plugins.json`、`meta.json` 等分发内容。
- 不放私钥、作者公钥与证书;本分支里的 `manifest.json.sig` 是清单签名,不是证书材料。
- 不手工编辑清单:清单只能由流水线生成,人工提交会破坏 `revision` 的单调性。
- 分支缺失时流水线报错中止,不代为创建。
- 本分支上的归档 tag 按「发行 tag + 短横线 + 分支名」命名,例如 `dsc-1.0.0-ci-memory`。
- 分支内按功用分扁平文件夹,不再往下分层;需要按路径组织的状态按其天然路径镜像,当前只有 `layer-manifests/`。
