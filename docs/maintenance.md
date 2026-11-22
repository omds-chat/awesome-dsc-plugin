# 维护者手册:流水线、校验与本地复现

> 本文是本合集维护者的操作手册:仓库结构、证书位置、pages 包结构、三层清单、pages 包校验规则、收录与构建流水线、异常上报、自查脚本、本地复现与离线联调。
> 事实以 `scripts/` 的实际行为与 `schemas/` 的结构约定为准;机制取舍见 [design/collection-pipeline.md](design/collection-pipeline.md),签名约定见 [design/signing.md](design/signing.md),逐文件职责见 [design/pages-artifacts.md](design/pages-artifacts.md),插件树布局见 [../.github/bundle-layout.README.md](../.github/bundle-layout.README.md)。

本仓库负责把 catalog 里登记的插件拉取、重新签名并组装成可直接部署的 Pages 分发包。
分发模型只有一种来源:插件作者自己发布的 Pages 站点(base_url),Release 不放任何资产。
`ci-memory` 是与之并列的孤立并行分支,存三层清单的上一版;流水线把它检出到 `single-branch/ci-memory/`,本地工作区也用同一路径,该目录自带 `.git`,主仓库 `.gitignore` 已忽略它,分支内容不进 `main`。

## 一、仓库结构

```text
awesome-dsc-plugin/
├── .github/
│   ├── bundle-layout.README.md         插件树说明:三层目录、必需文件与 meta.json 字段
│   └── workflows/build-and-deploy.yml  仓库级校验、拉取插件、重新签名、组装 pages 包、独立验签、上报异常、发布
├── .gitattributes                      统一 LF 换行
├── .gitignore
├── LICENSE
├── COPYRIGHT
├── README.md
├── README.en-US.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── catalog/                            收录登记:作者身份、公钥与插件站点
│   ├── README.md                       作者登记说明
│   ├── removed.json                    已解除托管的插件清单,随 pages 包分发
│   └── <作者>/                          一位作者一个目录,目录名即 username
│       ├── author.json                 作者身份
│       ├── author_pub.pem              作者公钥,Ed25519,OpenSSL PEM
│       └── <插件>/                      一个插件一个目录
│           └── plugin.json             插件登记,含 base_url 与可选 tags
├── certs/                              证书来源文件夹,随 pages 包分发,不进任何清单
│   └── awesome-dsc-plugin/             来源文件夹,与来源 id 同名,内含证书与配对公钥
│       ├── awesome-dsc-plugin-eec.crt
│       └── awesome-dsc-plugin-eec-secret.pub
├── docs/                               文档
│   ├── README.md                       文档索引
│   ├── maintenance.md                  本手册
│   └── design/                         设计说明:collection-pipeline.md、pages-artifacts.md、signing.md
├── schemas/                            本仓库全部 JSON Schema
│   ├── README.md                       schema 索引
│   ├── manifest.schema.json            三层清单的 JSON Schema
│   ├── catalog-author.schema.json      author.json 的 JSON Schema
│   ├── catalog-plugin.schema.json      plugin.json 的 JSON Schema
│   ├── catalog-removed.schema.json     removed.json 的 JSON Schema
│   ├── catalog-index.schema.json       pages 包 catalog/index.json 的 JSON Schema
│   └── plugins.schema.json             pages 包 plugins.json(插件目录索引)的 JSON Schema
├── scripts/                            校验与构建脚本,只读输入、按需产出 dist/pages(逐文件职责见 scripts/README.md)
└── site/                               合集设置与静态展示站点工程,构建产物进入 pages 包根目录
    ├── README.md                       站点说明:数据来源、构建与产物
    ├── build.mjs                       构建脚本,只用 Node 内置模块
    ├── package.json
    ├── meta.json                       合集元数据,含下载计数开关,是 pages 包 meta.json 的来源
    ├── tags.json                       预设标签清单(含 ui-enhance),是 pages 包 tags.json 的来源
    └── src/                            站点源码:index.html 与 assets/
```

仓库根只有 `catalog/`、`certs/`、`docs/`、`schemas/`、`scripts/`、`site/` 六个目录与工程文件;`plugins.json`、`manifest.json`、`manifest.json.sig` 与 `plugins/` 都不入库,它们只在构建出的 pages 包里出现,页面数据、清单与签名一律在 Release 时由 CI 生成。合集设置与站点设置都在 `site/`:合集元数据是 `site/meta.json`,预设标签是 `site/tags.json`,站点工程就是 `site/`。`dist/`、`site/dist/` 与 `temp/` 是纯生成目录,不入库;`single-branch/` 存放 `ci-memory` 分支的本地工作区,同样不入库。`scripts/lib/collection-verify.mjs` 与 `scripts/pki.mjs` 的校验语义与 [dsc-plugin-set-template](https://github.com/omds-chat/dsc-plugin-set-template) 保持一致,修改脚本请先改模板再同步本仓库,避免两个仓库的校验语义分叉。

### 分支结构

本仓有两条分支:`main` 承载源码、登记、校验与站点工程,顶层布局见上表;`ci-memory` 是与 `main` 无公共祖先的孤立并行分支,两者历史互不相交。孤立并行分支的组织级口径见组织仓库的 `.github/docs/repo-spec/side-branches.md`。

| 项 | `ci-memory` |
|:---:|:---|
| 职责 | 保存三层清单的上一版,供下一次构建按层沿用 `revision` |
| 内部结构 | 只有 `README.md` 与 `layer-manifests/`:每层一份 `manifest.json` 与同名 `manifest.json.sig`,相对 pages 包根的路径原样拼在 `layer-manifests/` 之后 |
| 谁写 | 只有流水线:`build-and-deploy.yml` 在 pages 包校验与独立验签全部通过后、上传部署之前,调 `scripts/write-ci-memory.mjs` 镜像写回并推送;人工只在建立分支与排查时提交 |
| 谁读 | 只有流水线:`build-from-catalog.mjs` 构建前从 `layer-manifests/` 读回上一版清单以沿用 `revision`;客户端、站点与插件市场都不读本分支 |
| 是否进 Pages | 否。本分支不进任何 pages 包,不参与部署 |
| 本地工作区 | `single-branch/ci-memory/`,自带 `.git`,主仓库 `.gitignore` 已忽略该目录 |
| 分支缺失时 | 检出失败即中止本次发布,流水线不代为创建分支 |

```text
ci-memory/
├── README.md                          # 分支职责说明
└── layer-manifests/                   # 三层清单的上一版,按分发路径镜像
    ├── manifest.json(.sig)            # L1
    └── plugins/
        ├── <作者>/manifest.json(.sig)              # L2
        └── <作者>/<插件>/manifest.json(.sig)       # L3
```

镜像规则、写回与读回的细节见 `ci-memory` 分支内的 `README.md` 与 `layer-manifests/README.md`(该分支与 `main` 无公共祖先,`main` 上没有这两份文件);机制取舍见 [design/collection-pipeline.md](design/collection-pipeline.md)。

## 二、证书位置

合集终端签名证书(EEC)的固定位置是 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt`,对应私钥只从 CI secret `AWESOME_DSC_PLUGIN_EEC_SECRET` 注入:工作流在调用构建脚本的那一步把该 secret 映射为环境变量 `EEC_SECRET_KEY`,脚本只读这个环境变量(PEM 文本或文件路径);本地复现时自行设置 `EEC_SECRET_KEY`。
`certs/` 下只允许来源文件夹,证书与公钥放在 `certs/<来源 id>/<文件名>` 下,文件夹名即来源 id,文件名以 `<来源 id>-` 开头:证书是 `<来源 id>-eec.crt`,配对公钥是 `<来源 id>-eec-secret.pub`。私钥一律不入库,仓库级校验会拦住散落在 `certs/` 根上的文件、命名不合规的文件与非证书非公钥的材料。
pages 根目录不放 `eec.pem`,也不放任何私钥。根证书由 CI 通过 `secrets.DS_CHAT_ROOT_CA` 或 `vars.ROOT_CA_URL` 提供,只用于自检。

三层清单签名与每个 `plugin.js.sig` 都用同一张 EEC,命令固定为
`openssl cms -sign -binary -md sha512 -outform DER -nocerts -noattr`,验签必须带 `-inform DER`。命令格式与取舍的完整说明见 [design/signing.md](design/signing.md)。

## 三、pages 包结构

| 位置 | 来源 |
|:---:|:---:|
| `index.html`、`assets/`、`.nojekyll` | site 构建产物 |
| `meta.json`、`tags.json` | 取自 `site/meta.json` 与 `site/tags.json`,原样复制 |
| `plugins.json` | 插件目录索引,由 `scripts/build-from-catalog.mjs` 按 catalog 生成 |
| `manifest.json`、`manifest.json.sig` | L1 清单及其签名 |
| `catalog/` | main 分支的 catalog 目录复制进来的登记文件,含根目录的 `README.md` 与 `removed.json`,本次剔除的作者与插件不复制;另加构建生成的 `index.json`(汇总索引,只供本站展示,不作为市场省请求的入口)与 `anomalies.json`(剔除清单) |
| `certs/` | main 分支的 certs 目录,原样复制;下只含来源文件夹 `certs/<来源 id>/` |
| `plugins/` | 由 CI 依据 catalog 拉取并构建 |

pages 包全貌:

```text
<collection>/                          # pages 包根目录,每次 Release 全量重建
├── index.html                         # 站点构建产物
├── .nojekyll                          # 站点构建产物:空文件,关闭 GitHub Pages 的 Jekyll 处理
├── assets/                            # 站点构建产物:页面脚本与样式
├── meta.json                          # L1,合集元数据,含下载计数开关
├── tags.json                          # L1,预设标签
├── plugins.json                       # L1,插件目录索引,由 catalog 生成
├── manifest.json                      # L1 清单
├── manifest.json.sig                  # L1 清单签名
├── catalog/                           # 收录登记复制(含 removed.json),另含构建生成的 index.json 与 anomalies.json,不进任何清单
├── certs/                             # 信任材料,原样复制,不进任何清单
│   └── awesome-dsc-plugin/            # 来源文件夹,与来源 id 同名,内含证书与配对公钥
│       ├── awesome-dsc-plugin-eec.crt          # 合集终端签名证书(EEC),由根 CA 签发
│       └── awesome-dsc-plugin-eec-secret.pub   # 与 EEC 私钥配对的公钥
└── plugins/
    ├── author_manifest.json           # L1
    └── <作者>/
        ├── author_pub.pem             # L2,作者公钥,OpenSSL PEM,Ed25519
        ├── plugin_manifest.json       # L2
        ├── manifest.json              # L2 清单
        ├── manifest.json.sig          # L2 清单签名
        └── <插件>/
            ├── versions.json          # L3
            ├── manifest.json          # L3 清单
            ├── manifest.json.sig      # L3 清单签名
            └── <版本>/
                ├── meta.json          # L3
                ├── plugin.js
                ├── plugin.js.sig        # 合集 CMS 签名,覆盖产物本体
                └── plugin.js.author.sig # 作者裸公钥签名,可选
```

根目录不再有 `eec.pem`:合集证书的固定位置是 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt`,随 pages 包分发,不进任何清单;根证书同样不进分发内容。`certs/` 下只放来源文件夹,证书与公钥都放在 `certs/<来源 id>/<文件名>` 下,文件夹名即来源 id,文件名以 `<来源 id>-` 开头,私钥一律不入库。

`plugins.json` 与 `catalog/index.json` 是给作者自查、速览与第三方搜索用的统计清单,不是宿主读取插件信息的通道:宿主先按 `plugins.json` 枚举插件,再按三层清单逐层取件,插件信息(版本、元数据、摘要)只从层里来。`plugins.json` 被 L1 清单覆盖,`catalog/index.json` 与 `catalog/anomalies.json` 不进任何清单,改动后者不会有任何校验发现。逐文件的生成者、消费者与签名归属见 [design/pages-artifacts.md](design/pages-artifacts.md)。

### 必需文件

pages 包内各位置的必需与可选文件如下。它们只存在于构建出的 pages 包里,仓库根一份都不存放:

| 位置 | 必需 | 可选 |
|:---:|:---:|:---:|
| pages 包根 | `meta.json`、`plugins.json`、`plugins/author_manifest.json`、`manifest.json`、`manifest.json.sig` | `tags.json` |
| `certs/<来源 id>/` | `<来源 id>-eec.crt`,不进任何清单 | `<来源 id>-eec-secret.pub`,同样不进清单 |
| `catalog/` | 每位作者的 `author.json`、`author_pub.pem` 与 `<插件>/plugin.json`,原样复制,不进任何清单 | 无 |
| `plugins/<作者>/` | `plugin_manifest.json`、`manifest.json`、`manifest.json.sig` | `author_pub.pem` |
| `plugins/<作者>/<插件>/` | `versions.json`、`manifest.json`、`manifest.json.sig` | 无 |
| `plugins/<作者>/<插件>/<x.y.z>/` | `meta.json`、`plugin.js`、`plugin.js.sig` | `plugin.js.author.sig` |

目录命名、`versions.json` 结构与 `meta.json` 字段见 [../.github/bundle-layout.README.md](../.github/bundle-layout.README.md)。合集证书只证明签名者身份,不进任何清单;根证书不进分发内容,由 DeepSeek-Chat-Enhanced 的 `certs` 分支分发,网页用内嵌的根证书指纹核对。

### 合集设置

合集设置放在 `site/`:`site/meta.json` 与 `site/tags.json` 是 pages 包同名文件的唯一来源,内容原样进入 pages 包;字段表见 [../site/README.md](../site/README.md)。

## 四、清单覆盖范围

| 层 | 目录 | 覆盖文件 |
|:---:|:---:|:---:|
| L1 | pages 根 | `meta.json`、`plugins.json`、`tags.json`、`plugins/author_manifest.json` |
| L2 | `plugins/<作者>` | `author_pub.pem`、`plugin_manifest.json` |
| L3 | `plugins/<作者>/<插件>` | `versions.json` 与各版本的 `meta.json` |

catalog 与 certs 不纳入任何清单,它们是登记信息与信任材料。
清单格式沿用仓库既有的 `schemaVersion`、`revision`、`files` 三项,哈希算法 SHA-512;结构约定见 `schemas/manifest.schema.json`,层间取舍见 [design/collection-pipeline.md](design/collection-pipeline.md) 第二节。

## 五、revision 语义

pages 不做版本留存,每个 Release 全量重建并直接替换,源码树里留不住上一份值,因此上一版清单存在 `ci-memory` 分支:
本仓库的一个孤立并行分支,与 `main` 无公共祖先,只承载跨构建延续的状态,不发布到 Pages,也不合并回 `main`。
三层清单在发布前写回该分支的 `layer-manifests/`,路径与分发目录一一镜像,每层一份 `manifest.json` 与一份 `manifest.json.sig`;
写回失败即中止本次发布,CI 报错,不沿用旧 `revision` 继续发布。写入与读取都只有流水线,人工不改分支内容;
分支缺失时流水线报错中止,不代为创建。

读回的来源优先级由高到低,每条路径都按分发目录镜像:

| 优先级 | 来源 | 读法 | 取不到时 |
|:---:|:---:|:---:|:---:|
| 1 | `ci-memory` 分支 | 按层读 `layer-manifests/<分发路径>/manifest.json`,L1 即 `layer-manifests/manifest.json` | 落到第 2 级 |
| 2 | 已发布站点 | 按层读 `<已发布基址>/<分发路径>/manifest.json`,过渡回退 | 落到第 3 级 |
| 3 | 没有旧清单 | 该层 `revision` 从 1 开始 | 记一条警告 |

L1、L2、L3 各自独立按上表读回:该层文件集合与哈希都没变时沿用旧值,有变化时加一,任何一层读不到都不影响其余层。
分支优先已实现,线上读回只是过渡回退——写回成功后,下一次构建的每一层都能在分支上找到上一版,不再走第 2 级。
读回由 `scripts/lib/ci-memory.mjs` 的 `readCiMemoryManifests` 完成,写回由 `scripts/write-ci-memory.mjs` 完成,两者都不读也不写任何分发内容。
`ci-memory` 工作区不存在或不是 git 工作区一律按「分支缺失」处理:构建在拉取插件之前就报错中止,不代为创建分支。

## 六、pages 包校验规则

`pnpm verify:bundle` 对构建出的 pages 包逐项检查,除第 12 条只警告外,任一错误都以非零退出码结束并一次性列出全部问题,每条都带层号与文件路径。

| 编号 | 规则 |
|:---:|:---:|
| 1 | 合集证书 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` 存在(根目录不再有 `eec.pem`),由给定根证书签发(`--root-ca` 或 `ROOT_CA_PATH`),未过期,`keyUsage` 含 `digitalSignature`,`basicConstraints` 非 CA |
| 2 | 插件目录索引 `plugins.json` 中的每个插件都在 `plugins/<author>/plugin_manifest.json` 中出现,且插件目录存在 |
| 3 | 每个插件目录有 `versions.json`,`latest` 必须在 `versions` 列表内 |
| 4 | 每个版本目录有 `meta.json`、`plugin.js`、`plugin.js.sig`,并用 `openssl cms -verify -binary -md sha512 -inform DER -CAfile <根证书> -certfile certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` 验签,失败即报错 |
| 5 | 作者签名是可选证据,只警告、不阻断:版本目录出现 `plugin.js.author.sig` 且 `plugins/<author>/author_pub.pem` 可用时,用 `openssl pkeyutl -verify -pubin -rawin -inkey <公钥> -in plugin.js -sigfile plugin.js.author.sig` 校验,失败只记警告;只有签名没有公钥、或只有公钥没有签名,都判为「未校验」,不计为通过;其它 `*.author.sig` 不参与校验 |
| 6 | `tags.json` 存在时,插件目录索引 `plugins.json` 的 `tag` 必须取自其中 |
| 7 | 三层清单存在且结构合法:`schemaVersion` 为 1,`revision` 为正整数,`files` 为非空数组,条目只含 `path` 与 `sha512` |
| 8 | 清单条目的 `path` 合法:正斜杠、相对路径、不含 `..`、不指向清单自身、不重复 |
| 9 | 覆盖范围与该层应有的文件严格相等:该有的都在清单里,清单里没有多余项,L3 不得出现 `plugin.js` 与 `plugin.js.sig` |
| 10 | 清单记录的每个 SHA-512 与文件实际内容一致,不一致时报出层号与具体文件 |
| 11 | 每层 `manifest.json.sig` 用根证书与 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` 验签,失败即报错 |
| 12 | 每个版本的 `plugin.js` 做网络自建静态扫描:出现全局 `fetch(`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`navigator.sendBeacon`,或以 `http://`、`https://`、`//` 开头的 `import(` 即报 `PLUGIN_NETWORK_SELFTALK` 警告,并给出命中的字面量与所在行、列;插件自行联网不符合约定,建议改用宿主提供的网络能力;这是收录契约,不是沙箱,命中只警告、不阻断收录。扫描规则与取舍的完整说明见 [design/collection-pipeline.md](design/collection-pipeline.md) 1.6 |

### 校验语义

- 本仓库发布前的校验是强校验:`scripts/build-from-catalog.mjs` 与 CI 的每一步遇到错误都以非零退出码中止,不合规的内容不会被分发。仓库级校验 `pnpm verify:catalog` 只查 `catalog/` 与 `certs/` 的结构与证书材料,不要求任何构建产物;pages 包的强校验是 `pnpm verify:bundle`,三层清单、清单签名、产物签名与收录信息交叉一致性都在这一步检查;作者签名不在强校验之内,验签失败与两侧不齐只警告,不改变退出码。要临时放开清单缺失,可对 `scripts/verify-collection.mjs` 直接加 `--allow-missing-manifest`。不给根证书时无法校验证书链,`verify-collection.mjs` 报 `ROOT_CA_MISSING` 错误并以非零退出码结束,结构与哈希检查照常执行;只做结构与哈希检查时加 `--allow-placeholder-eec`(骨架模式,证书链与签名降级为警告)。产物侧的网络自建扫描在构建的拉取阶段与 `pnpm verify:bundle` 两处都执行,命中只警告、不改变退出码。
- 分发出去之后的校验是弱校验:插件市场对网页文件签名、插件签名、证书链校验失败只警告,不阻断,不做兜底。作者签名同理,失败只警告。警告由用户决定是否继续,市场不会替用户静默放行。
- 签名覆盖文件原始字节。换行、缩进或空白的任何改动都会让校验失败,仓库统一使用 LF。

## 七、收录与构建流水线

收录流程五步:

1. 提交 PR,在 `catalog/` 登记插件:`catalog/<作者>/author.json`、`catalog/<作者>/author_pub.pem`、`catalog/<作者>/<插件>/plugin.json`。字段、schema 与提交校验见 [../catalog/README.md](../catalog/README.md)。
2. 合并后,CI 在 Release 时按登记逐条拉取:从 `base_url` 取 `versions.json` 以及每个版本的 `meta.json`、`plugin.js` 与可选 `plugin.js.author.sig`,写入 pages 包的 `plugins/` 目录,并用合集 EEC 为每个 `plugin.js` 重新签名。拉取到的 `plugin.js` 先做网络自建静态扫描,命中只记警告,插件照常收录。作者签名取不到或为空按没有签名处理,只记警告,不影响该插件收录。
3. 组装 pages 包:站点产物放根目录,`meta.json` 与 `tags.json` 取自 `site/`,插件目录索引 `plugins.json` 由 catalog 生成,`catalog/`(含 `removed.json`,本次剔除的作者与插件不在其中)与 `certs/` 复制进来,再在 `catalog/` 下写入 `index.json` 与 `anomalies.json`,并按层生成、签名 L1、L2、L3 三层清单。
4. 交叉校验:`scripts/verify-catalog-consistency.mjs` 比对 `catalog/index.json`、`plugins.json`、`plugins/author_manifest.json`、`catalog/` 副本与 `plugins/` 树,任何不一致都以非零退出码中止并列出差异。
5. 发布:CI 先用 `openssl` 独立验签三层清单与每个 `plugin.js`,再检查 pages 包结构,全部通过后把新清单与签名写回 `ci-memory` 分支并推送,最后整体替换已发布站点,不做版本留存。写回失败即中止本次发布。

构建把三类问题分开处理,边界写在 `scripts/build-from-catalog.mjs` 的实现与 [../catalog/README.md](../catalog/README.md) 里:

| 类别 | 判定 | 构建行为 |
|:---:|:---:|:---:|
| 登记不合规 | `catalog/` 里的登记文件本身不合法:缺字段、`name` 与目录不符、`tags` 结构不合法或标签不在 `tags.json` 预设清单内 | 登记错误,构建以非零退出码中止,一个插件都不发布,等待作者修正后再发布 |
| 运行期异常 | 作者站点拉取失败(网络、HTTP 4xx/5xx)、远端 `versions.json` 不合法、远端 `meta.json` 与登记不符、`plugin.js` 为空 | 只把该插件从本次发布剔除,其余插件照常构建与发布;剔除项写入 `catalog/anomalies.json` 并上报到仓库 Issue |
| 网络约定提示 | `plugin.js` 命中网络自建扫描(`PLUGIN_NETWORK_SELFTALK`) | 只记警告,插件照常构建与发布,不写入 `catalog/anomalies.json`;这是收录契约而不是沙箱 |

签名失败、清单生成失败与分发自检失败既不是某位作者的登记错误,也不是单个插件的运行期问题,仍按构建失败处理。

插件目录索引 `plugins.json` 的 `tag` 取自每个插件 `plugin.json` 的 `tags`,`tags` 省略时为空数组。标签取值必须来自 `site/tags.json` 的预设清单;不在清单内的标签会让构建中止,并在报错里指出是哪个插件、哪个标签。

流水线步骤依次为:安装依赖、检出 `main` 与 `ci-memory` 两条分支、仓库级校验(`verify:catalog`)、构建 site、拉取插件、产物网络自审(命中只警告,不剔除插件)、用 EEC 重新签名 `plugin.js`、按层读回上一版并生成与签名三层清单、组装 pages 包、pages 包校验(`verify:bundle`,含交叉校验)、用 openssl 独立验签、结构自检、写回 `ci-memory` 并推送、上报剔除项、上传并部署。

写回由 `scripts/write-ci-memory.mjs` 做文件镜像、由流水线用 `git` 提交并推送,命令与本地复现一致:

```bash
node scripts/write-ci-memory.mjs --bundle dist/pages --ci-memory single-branch/ci-memory
git -C single-branch/ci-memory add -A
git -C single-branch/ci-memory commit -m "chore(ci-memory): layer manifests for <tag>"
git -C single-branch/ci-memory push origin HEAD:ci-memory
```

写回排在全部校验通过之后、上传与部署之前:镜像、提交、推送任一步失败都会以非零退出码结束,部署作业依赖构建作业,本次发布因此中止,
不会带着旧 `revision` 继续发布;清单与分支现有内容一致时不产生提交,也不推送。
`ci-memory` 工作区由 `actions/checkout` 按 `ref: ci-memory` 检出,分支缺失时该步骤直接失败,不代为创建;
工作流权限因此从 `contents: read` 改为 `contents: write`,`pages` 与 `issues` 的权限不变。

## 八、异常插件与上报

构建把三类问题严格分开,边界在 `scripts/build-from-catalog.mjs` 里实现:

| 类别 | 判定 | 构建行为 |
|:---:|:---:|:---:|
| 登记不合规 | `catalog/` 里的文件本身不合法(缺字段、`name` 与目录不符、`tags` 结构或取值不合规、公钥不可解析) | 登记错误,构建以非零退出码中止,不发布任何插件 |
| 运行期异常 | 作者站点拉取失败、远端 `versions.json` 不合法、远端 `meta.json` 与登记不符、`plugin.js` 为空 | 只剔除该插件,其余插件照常发布;剔除项写入 `catalog/anomalies.json` |
| 网络约定提示 | `plugin.js` 命中网络自建扫描(`PLUGIN_NETWORK_SELFTALK`) | 只记警告,插件照常发布,不写入 `catalog/anomalies.json`;这是收录契约而不是沙箱 |

剔除项由 `scripts/report-build-anomalies.mjs` 上报到本仓库 Issue:

- 只用 GitHub REST API,全部请求通过 `curl` 命令行发出,鉴权用 workflow 自带的 `GITHUB_TOKEN`,因此 workflow 需要 `issues: write` 权限。
- 追踪 Issue 的标题固定为 `[自动] 插件剔除追踪`:已存在就往该 Issue 追加一条评论,不存在就新建一个。
- 正文包含本次发布的 tag、异常条目表格(作者、插件、阶段、失败原因)与「已自动剔除、未阻塞发布」的说明。
- 上报失败(令牌缺失、权限不足、API 报错)只打印警告并以 0 退出,不阻塞发布;工作流步骤另有 `continue-on-error` 兜底。
- 本地可用 `--dry-run --api-base <任意地址>` 只打印请求体,不发任何真实请求。

## 九、维护者自查脚本

`scripts/` 下有一组可独立运行的自查脚本,供维护者在 CI 之前自己把整仓交叉检查一遍。它们不重复实现规则:`lib/catalog-checks.mjs`、`lib/collection-verify.mjs`、`lib/consistency-verify.mjs`、`lib/collection-meta.mjs` 就是 `pnpm verify:catalog` 与 `pnpm verify:bundle` 用的同一批模块,自查脚本只做编排与 JSON 输出。逐文件职责见 [../scripts/README.md](../scripts/README.md)。

| 脚本 | 检查项 | 需要构建产物 |
|:---:|:---:|:---:|
| `check-authors.mjs` | 作者目录名是否符合 GitHub 用户名规则,以及大小写不敏感唯一性(`Alice` 与 `alice` 属同一个用户) | 否 |
| `check-plugins.mjs` | 插件名规则、同名插件全局唯一性,以及跨作者共用裸目录名的告警 | 否 |
| `check-versions.mjs` | `versions.json` 与 `plugins/` 树一致:latest 在列表内、版本目录与必需文件齐全、`meta.json` 对齐 | 是 |
| `check-manifests.mjs` | 三层清单的覆盖范围与 SHA-512,含清单签名 | 是 |
| `check-certs.mjs` | `certs/` 的终端签名证书与签发链 | 否 |
| `check-removed.mjs` | `removed.json` 的结构,以及「已下架却仍有登记」的矛盾 | 否 |
| `check-site.mjs` | `site/tags.json`、`site/meta.json` 与 `catalog/` 的一致性 | 否 |
| `check-all.mjs` | 依次跑完上面七项,输出一个总 JSON | 视检查项 |

用法:

```bash
# 一项一项跑,人读输出;有 error 级问题时退出码为 1
node scripts/check-authors.mjs
node scripts/check-manifests.mjs --dir dist/pages --root-ca root_ca.crt

# 输出单个 JSON 对象,便于脚本处理
node scripts/check-authors.mjs --json > authors.json

# 组合调用:管道合并多个检查结果
node scripts/check-authors.mjs --json | node scripts/summarize.mjs
node scripts/summarize.mjs authors.json certs.json

# 一次跑完全部检查,输出一个总 JSON;退出码按是否全部通过决定
pnpm check
```

`check-versions.mjs` 与 `check-manifests.mjs` 只看构建出的 pages 包:目录不存在时记一条 `BUNDLE_MISSING` 告警并跳过,退出码仍为 0。其余检查只读仓库源文件,不需要任何构建产物。

### JSON 字段

单检查结果与汇总结果都是单个 JSON 对象,不是逐行文本,可以直接 `JSON.parse`:

| 字段 | 类型 | 说明 |
|:---:|:---:|:---:|
| `ok` | boolean | 是否通过;只看 `error` 级问题,有 `error` 即 `false` |
| `check` | string | 检查项标识,如 `authors`;汇总结果为 `all` |
| `title` | string | 检查项名称 |
| `target` | string 或 null | 本次检查的对象(目录或文件) |
| `counts` | object | `errors`、`warnings`、`problems` 三个计数 |
| `problems` | array | 问题列表,每项含 `code`、`path`、`message`、`level`;汇总结果每项另含 `check` |
| `stats` | object | 该检查项的统计数字,随检查项不同 |
| `checks` | array | 仅汇总结果:每个检查项的 `check`、`title`、`ok`、`target`、`counts` |

退出码:0 通过,1 有 `error` 级问题,2 参数错误或运行失败。

## 十、本地校验与复现

两条校验针对不同对象,用途也不同。

| 命令 | 校验对象 | 何时运行 |
|:---:|:---:|:---:|
| `pnpm verify:catalog` | `catalog/` 与 `certs/` 的结构、字段、公钥格式、标签取值、npm 包名一致性(查询 registry)与合集证书材料 | 提交登记 PR 前,不需要任何构建产物;`pnpm verify` 与它等价 |
| `pnpm verify:bundle` | 构建出的 pages 包:三层清单、清单签名、产物签名与收录信息交叉一致性 | 构建之后、发布之前,需要 `dist/pages` 已存在 |
| `node scripts/preflight.mjs` | 发版前预检:catalog 登记、certs、npm 包名、三层清单与签名占位、产物扫描,汇总输出 | 提 PR 前自查,也是 CI PR 预检作业跑的同一份脚本;不联网时 npm 检查自动降级为「跳过在线检查」警告 |

```bash
pnpm install
pnpm type            # 语法自检:全部脚本与站点源码都能被 Node 解析
pnpm verify:catalog  # 仓库级校验,只读 catalog/ 与 certs/,含 npm 包名在线检查
node scripts/preflight.mjs  # 发版前预检,PR 预检作业跑的同一份脚本
pnpm build:site      # 构建站点到 site/dist,产物进入 pages 包根目录
pnpm build           # 需要 EEC_SECRET_KEY 与 ROOT_CA_PATH:按 catalog 组装 pages 包到 dist/pages
pnpm verify:bundle --root-ca root_ca.crt   # pages 包校验
```

- 没有根证书时,证书链无法校验,`verify-collection.mjs` 报 `ROOT_CA_MISSING` 错误并以非零退出码结束,结构与逐个文件的 SHA-512 检查照常完成;要让证书链与签名降级为警告,对 `scripts/verify-collection.mjs` 加 `--allow-placeholder-eec`(骨架模式)。设置 `ROOT_CA_PATH` 或传 `--root-ca` 才是完整校验。
- 作者签名不改变退出码:验签失败、公钥与签名两侧不齐都只警告,不影响 `verify:bundle` 的通过与否。
- `pnpm build` 等价于直接调用 `scripts/build-from-catalog.mjs`,本地复现的完整形式:

  ```bash
  EEC_SECRET_KEY=... ROOT_CA_PATH=root_ca.crt \
    node scripts/build-from-catalog.mjs \
    --catalog catalog --certs certs --site site/dist --out dist/pages \
    --ci-memory single-branch/ci-memory \
    --published-base https://omds-chat.github.io/awesome-dsc-plugin/
  ```

- 写回单独成步,只做文件镜像,提交与推送由流水线用 git 完成(命令见第七节)。
- 单独跑某一步:`pnpm verify:consistency` 交叉校验 `dist/pages` 的收录信息;`node scripts/report-build-anomalies.mjs --dry-run` 只打印上报请求体,不发真实请求,补报时去掉 `--dry-run` 并设置 `GITHUB_TOKEN`。
- 本地需要 OpenSSL 3.0 及以上,脚本只调用 `openssl` 命令行,不实现任何密码学运算。

## 十一、离线联调 npm 校验

组织仓库的 `tools/dev-local-npmjs/dev-local-npmjs.mjs`(用法见该工具目录自己的 README,联调端口表见 `tools/dev-static-server/README.md`)是本地 npm registry 模拟器:零依赖 Node http 服务,只模拟包的发布登记(PUT)与元数据查询(GET),不实现 tarball,也不实现 npm 生态的认证。它是联调用具,不是 registry 实现;数据存运行目录下的 `packages/` 目录(`.gitignore` 已排除)。端口默认 61116(61117-61122 已分配给其他联调服务,端口表以 `tools/dev-static-server/README.md` 为准),`--port` 可调,只监听本地回环 `127.0.0.1`。

`verify-catalog`、`verify-collection`、`preflight` 的 `--registry` 默认值按「命令行 `--registry` → 环境变量 `NPM_REGISTRY_URL`(含仓库根 `.env`)→ 官方源」取值。`.env` 模板见 `.env.example`,登记 `NPM_REGISTRY_URL=http://127.0.0.1:61116/` 后校验的在线查询走本地回环,不触外网;留空或删除该条则回落官方源。

收录时序两种场景的预期结果:

| 场景 | 操作顺序 | 预期结果 |
|:---:|:---:|:---:|
| 先收录后发布 | 先在 `catalog/` 登记 dsc-xxx,跑校验,再向模拟器发布 dsc-xxx | 发布前校验报 `NPM_PACKAGE_NOT_FOUND` 错误、不收录;发布后同一命令看到「包存在且一致」,校验通过 |
| 先发布后收录 | 先向模拟器发布 dsc-xxx,再登记 `catalog/` 并跑校验 | 校验直接通过;`DELETE` 下架后同一命令报 `NPM_PACKAGE_NOT_FOUND`——「曾发布后下架」与从未发布同判,一律不收录 |

完整流程(模拟器与校验都在本机,全部请求走 `127.0.0.1`,不触外网):

```bash
# 1. 起模拟器(前台运行,Ctrl+C 停止;路径按组织仓库的检出位置调整)
node tools/dev-local-npmjs/dev-local-npmjs.mjs

# 2. 发布两个模拟包(shasum 缺省时由模拟器按包名与版本计算)
curl -X PUT http://127.0.0.1:61116/dsc-demo-alpha -d '{"version":"1.0.0"}'
curl -X PUT http://127.0.0.1:61116/dsc-demo-beta -d '{"version":"0.1.0"}'

# 3. 跑仓库级校验:登记包存在且与插件名一致,catalog 校验通过
node scripts/verify-catalog.mjs --registry http://127.0.0.1:61116/

# 4. 模拟下架一个包,再跑校验:该包报 NPM_PACKAGE_NOT_FOUND
curl -X DELETE http://127.0.0.1:61116/dsc-demo-alpha/1.0.0
node scripts/verify-catalog.mjs --registry http://127.0.0.1:61116/

# 5. 不改 .env 时,用环境变量覆盖官方源(与 --registry 等价)
NPM_REGISTRY_URL=http://127.0.0.1:61116/ node scripts/verify-catalog.mjs
```

不联网且不起模拟器时,校验对「registry 不可达」降级为「跳过在线检查」警告(NPM_CHECK_OFFLINE),不把网络故障当登记错误;CI 联网时查不到包按错误拦截。
