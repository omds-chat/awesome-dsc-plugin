# awesome-dsc-plugin

dsc 的社区插件合集。插件在这里按分发规范 v2 收录、签名并分发,插件市场读取本合集 pages 包里的三层哈希清单、合集证书与签名来取用插件。

[English](README.en-US.md)

## 定位与收录范围

本合集面向 dsc 的运行时插件,由 omds-chat 维护。本仓库是 omds-chat 的终端签名方(EEC),持有由 DeepSeek-Chat-Enhanced 仓库的根证书机构签发的终端签名证书,并用它为三层清单与每个版本的插件产物生成 CMS 分离签名。

收录条件:

- 插件产物是单个浏览器 ESM 脚本,导出 `activate(context)`,不依赖 Node 内置模块与后端接口。
- 提供可构建的源码仓库或可访问的产物地址,CI 能按 `base_url` 拉取并复核产物。
- 插件运行时元数据 `meta.json` 字段完整,插件名符合 `dsc-xxx` 或 `@scope/dsc-xxx`。
- 插件必须先发布到 npm,且 npm 包名与插件名一致:`dsc-xxx` 对应 npm 包 `dsc-xxx`,`@scope/dsc-xxx` 对应 `@scope/dsc-xxx`。仓库级校验 `pnpm verify:catalog`、PR 触发的 preflight 预检作业与 Release CI 都会查询 npm registry,包不存在或登记包名与插件名不一致都以错误拦截,PR 与 CI 双重拦截,没有发布就不会被收录。

不收录需要后端服务、需要原生模块、或无法在 CI 中重建产物的插件。

收录不等于认证。本合集只保证分发内容与签名一致,不审查插件行为。

## 你能拿到什么

每次 Release 发布一个 pages 包,部署在 `https://omds-chat.github.io/awesome-dsc-plugin/`:

- 全部收录插件的可安装产物:插件市场按三层清单逐层取件、验签后安装;分发出去之后的校验是弱校验,验签失败只警告、不阻断,由用户决定是否继续,市场不会替用户静默放行,签名不通过时会提示并建议重新下载。
- 静态展示站点:浏览收录的作者、插件、版本与签名材料的存在性(站点只探测,不做密码学计算)。
- 收录登记与信任材料:`catalog/` 副本与 `certs/` 证书随包分发,第三方可自行核对。

## 最小可用步骤

### 插件作者:收录一个插件

1. 把插件发布到 npm,包名与插件名一致。
2. 在自己的 Pages 站点上按版本目录发布 `meta.json` 与 `plugin.js`,可选附 `plugin.js.author.sig` 作者签名。
3. 提交一个 PR,在 `catalog/` 下新增三个文件:`author.json`、`author_pub.pem` 与 `<插件>/plugin.json`,提交前本地跑 `pnpm verify:catalog` 自查。

字段表、公钥生成命令、收录后的处理与下架流程见 [catalog/README.md](catalog/README.md)。

### 插件市场:消费本合集

市场按 `base_url` 依次取合集元数据、插件目录索引、合集证书、三层清单与签名、各版本元数据与产物。完整的取件路径契约见 [docs/design/pages-artifacts.md](docs/design/pages-artifacts.md) 的「市场取件顺序」。

### 维护者:构建与发布

构建流水线、pages 包校验规则、自查脚本与本地复现见 [docs/maintenance.md](docs/maintenance.md);签名约定与证书链见 [docs/design/signing.md](docs/design/signing.md);机制取舍见 [docs/design/collection-pipeline.md](docs/design/collection-pipeline.md)。

## 分发结构概览

合集以 pages 包的形式发布:CI 按 `catalog/` 到作者自己的 `base_url` 拉取插件、用合集 EEC 重新签名,全量重建并直接替换,不做版本留存。插件在 `plugins/` 下按「作者 / 插件 / 版本」三层组织,每层一份 `manifest.json` 与一份 `manifest.json.sig`:清单记录本层文件的 SHA-512,签名由根 CA 签发的终端签名证书(EEC)生成。层与层之间互不引用,任何一层都可以单独发布、单独校验、单独重签。

```text
<collection>/                    # pages 包根目录,每次 Release 全量重建
├── index.html、assets/          # 站点构建产物
├── meta.json、tags.json         # L1,合集元数据与预设标签,取自 site/
├── plugins.json                 # L1,插件目录索引,由 catalog 生成
├── manifest.json(.sig)          # L1 清单与签名
├── catalog/                     # 收录登记副本与构建生成的汇总,不进任何清单
├── certs/                       # 信任材料(合集 EEC 证书与配对公钥),不进任何清单
└── plugins/                     # 插件树:作者 / 插件 / 版本三层,各层清单与签名
```

pages 包全貌、各位置的必需与可选文件、清单覆盖范围与 `revision` 语义见 [docs/maintenance.md](docs/maintenance.md);插件树的目录命名、`versions.json` 结构与 `meta.json` 字段见 [.github/bundle-layout.README.md](.github/bundle-layout.README.md);`catalog/` 与 `certs/` 不纳入任何清单,前者是收录登记,后者是信任材料。部署出去的站点树、入口地址与版本留存形态见 [docs/design/pages-artifacts.md](docs/design/pages-artifacts.md) 的「Pages 环境文件结构与部署形态」。

## 仓库目录结构

```text
awesome-dsc-plugin/
├── .github/        # CI 工作流与插件树布局说明
├── catalog/        # 收录登记:作者身份、公钥与插件站点
├── certs/          # 合集终端签名证书与配对公钥,随 pages 包分发
├── docs/           # 文档索引、维护者手册与设计说明
├── schemas/        # 本仓库全部 JSON Schema
├── scripts/        # 校验与构建脚本
└── site/           # 合集设置与静态展示站点工程
```

各目录的内部结构见各自的说明:`catalog/README.md`、`docs/README.md`、`schemas/README.md`、`scripts/README.md`、`site/README.md`。工程文件是 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.gitattributes`(统一 LF 换行)与 `.gitignore`。`plugins.json`、`manifest.json`、`manifest.json.sig` 与 `plugins/` 不入库,它们只在构建出的 pages 包里出现。分支结构(`main` 与孤立并行分支 `ci-memory`)见 [docs/maintenance.md](docs/maintenance.md) 的「分支结构」。

## 跨域访问

本合集托管在 GitHub Pages。Pages 对静态资源默认返回 `Access-Control-Allow-Origin: *`,因此分发内容天然可以被跨域读取,托管侧无法把来源收窄到白名单。这是托管平台的既定行为,不是本仓库的配置。

规范要求跨域来源仅开放信任的来源,至少包含 `https://omds-chat.github.io`。若把分发内容改放到其他托管,需要自行配置 CORS 白名单,至少放行该来源。

## 文档

全部文档的索引、冲突时以谁为准与维护约定见 [docs/README.md](docs/README.md)。

## 许可

Apache License 2.0,见 [LICENSE](LICENSE)。
