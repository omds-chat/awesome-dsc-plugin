# pages 包产物职责说明

> 本文逐个说明 pages 包里每个文件的生成者、消费者、签名归属、发布更新与体积增长来源，并按「谁在读它」分三组。写给需要判断「某个文件能不能当作插件信息入口」的人：合集维护者、站点维护者、插件市场与第三方工具作者。
> 事实以 `scripts/build-from-catalog.mjs`、`scripts/lib/` 下的模块与各 README 为准；本文只归纳职责，不重复字段表，也不复述构建步骤。

## 一、判定口径

三类分组按「第一消费者」划分。同一个文件被多类读取时，归入其主要用途那一组，并在「消费者」一列把其余读者一并写出。

| 组 | 第一消费者 | 纳入判据 |
|:---:|:---:|:---:|
| 面向宿主侧 | 插件市场与插件引擎 | 市场取件表里的路径、校验证书链与签名所需材料、引擎加载的产物 |
| 面向第三方工具与作者自查 | 站点、校验脚本、外部查阅者 | 派生统计清单、登记副本，以及只被校验脚本与页面读取的层内文件 |
| 面向站点自身 | 浏览器与静态托管 | 由 `site/` 构建出的页面文件 |

每个文件写六项：路径、生成者、消费者、是否参与签名、是否随发布更新、体积随什么增长。

四条贯穿全表的事实：

- 每次发布全量重建 pages 包并整体替换，不做版本留存。因此「随发布更新」几乎是全表默认值，真正的差别在于字节是否变化：有的随发布标识变化，有的只在其输入或轮换时才变。
- `catalog/` 与 `certs/` 随包分发，但不进任何清单。前者是收录登记，后者是信任材料：登记由仓库级校验与 PR 审核保证，信任材料如果被它自己要参与验证的清单覆盖，就会形成自指。
- 签名有两种归属。清单覆盖指被某一层 `manifest.json` 的 SHA-512 记录收进去；产物独立签名指 `plugin.js` 只由同目录的 `plugin.js.sig` 覆盖。清单本身只被同名 `.sig` 覆盖，不被任何清单覆盖。
- 三层清单在构建、校验与 pages 包上传成功后写回本仓库的 `ci-memory` 分支的 `layer-manifests/`，只用于下一次构建沿用 `revision`；该分支不保存 pages 包本体，也不发布到 Pages，写回失败即中止发布。清单内容一致时不产生提交，仅 `.sig` 重签字节不同不算变更。机制与镜像规则见 [collection-pipeline.md](collection-pipeline.md) 的 2.4 与分支内的 `layer-manifests/README.md`。

## 二、面向宿主侧（市场与引擎）

宿主 = 插件市场与插件引擎。市场按本节的取件表逐层取件，引擎加载 `plugin.js`。这一组是宿主取数与校验的通道。

### 市场取件顺序

市场先读合集元数据与插件目录，再逐层取清单、用根证书把 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` 收进信任锚，校验清单签名后再取插件文件与产物签名。下表是对外承诺的路径契约，市场按 `base_url` 依次取用。

| 步骤 | 路径 | 用途 |
|:---:|:---:|:---:|
| 1 | `<base_url>/meta.json` | 判断该来源是否启用下载计数 |
| 2 | `<base_url>/plugins.json` | 插件目录索引:列出全部插件、作者与标签 |
| 3 | `<base_url>/certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` | 取合集终端签名证书,用根证书校验证书链;根目录没有 `eec.pem` |
| 4 | `<base_url>/manifest.json` 与 `manifest.json.sig` | 校验 L1 清单签名与其中记录的 SHA-512 |
| 5 | `<base_url>/plugins/<author>/manifest.json` 与 `manifest.json.sig` | 校验 L2 清单,拿到作者公钥与插件清单 |
| 6 | `<base_url>/plugins/<author>/<plugin>/manifest.json` 与 `manifest.json.sig` | 校验 L3 清单,拿到 `versions.json` 与各版本 `meta.json` 的摘要 |
| 7 | `<base_url>/plugins/<author>/<plugin>/versions.json` | 取版本列表与最新版本号 |
| 8 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/meta.json` | 取插件元数据,与 L3 清单记录的摘要比对 |
| 9 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/plugin.js` 与 `plugin.js.sig` | 取插件运行时脚本,用合集证书验签 |
| 10 | `<base_url>/plugins/<author>/author_pub.pem` 与 `plugin.js.author.sig` | 有作者签名时,取作者公钥与签名;校验失败只警告,不计为通过 |

任何一项校验失败只提示警告,不阻断插件加载:分发出去之后的校验是弱校验,作者签名同理,失败只警告;警告由用户决定是否继续,市场不会替用户静默放行。

| 路径 | 生成者 | 消费者 | 是否参与签名 | 是否随发布更新 | 体积随什么增长 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| `meta.json` | `build-from-catalog.mjs`，取 `site/meta.json` 经 `readCollectionMeta` 校验后写出 | 市场（取件表第 1 步，判断是否启用下载计数） | 参与，L1 清单覆盖 | 是，每次发布重写；字节只在 `site/meta.json` 改动时变 | 常数级，随字段个数而非收录规模 |
| `plugins.json` | `build-from-catalog.mjs` 的 `buildPluginsIndex` | 市场（第 2 步，枚举插件、作者与标签）；`collection-verify.mjs`；`consistency-verify.mjs`；站点兜底（第 3 步） | 参与，L1 清单覆盖 | 是，每次发布重建 | 随收录插件数线性增长；每条只有 `plugin_name`、`author`、`tag`，不含版本、描述与摘要 |
| `manifest.json` 与 `manifest.json.sig`（L1） | `layer-manifests.mjs` 的 `buildLayerManifests`，签名走 `pki.mjs` 的 `signManifest` | 市场（第 4 步验 L1 清单签名）；CI 的 openssl 独立验签；`collection-verify.mjs`；站点只做存在性探测 | 清单本身不进任何清单，只被同名 `.sig` 覆盖 | 是，每次发布重写；`revision` 只在该层文件集合或哈希变化时加一 | 常数级，条目固定为 `meta.json`、`plugins.json`、`plugins/author_manifest.json` 与存在时的 `tags.json` |
| `certs/<来源 id>/<来源 id>-eec.crt` | 从仓库 `certs/` 原样复制；CI 可用 `secrets.AWESOME_DSC_PLUGIN_EEC` 覆盖来源 | 市场（校验证书链，并作为 `-certfile` 验 CMS）；CI 独立验签；`collection-verify.mjs` | 不参与，任何清单都不覆盖 | 是，每次发布复制；只有证书轮换时字节才变 | 常数级，单张证书 |
| `certs/<来源 id>/<来源 id>-eec-secret.pub` | 同上，从仓库 `certs/` 原样复制 | 仓库级校验（`catalog-checks.mjs` 要求它可解析为 EC 公钥）；与私钥是否配对只在构建期由 `certMatchesKey` 核对；市场不读 | 不参与 | 是，每次发布复制 | 常数级，单把公钥 |
| `plugins/<作者>/manifest.json` 与 `manifest.json.sig`（L2） | `layer-manifests.mjs` | 市场（第 5 步）；CI 独立验签；`collection-verify.mjs`；站点只探测存在性 | 清单本身不进任何清单，只被同名 `.sig` 覆盖 | 是，每次发布重写；`revision` 按层独立计算 | 常数级，最多两条：`author_pub.pem` 与 `plugin_manifest.json` |
| `plugins/<作者>/author_pub.pem` | `build-from-catalog.mjs` 从 `catalog/<作者>/author_pub.pem` 复制 | 市场（第 10 步校验作者签名）；`collection-verify.mjs`；站点只探测存在性 | 参与，L2 清单覆盖 | 是，每次发布复制 | 常数级，单把公钥 |
| `plugins/<作者>/plugin_manifest.json` | `build-from-catalog.mjs`，按收录结果写作者插件名数组 | 市场（随 L2 清单取作者插件清单）；`collection-verify.mjs`；`consistency-verify.mjs`；站点第 4 步 | 参与，L2 清单覆盖 | 是，每次发布重建 | 随该作者插件数增长，每条一个名字 |
| `plugins/<作者>/<插件>/manifest.json` 与 `manifest.json.sig`（L3） | `layer-manifests.mjs` | 市场（第 6 步）；CI 独立验签；`collection-verify.mjs`；`consistency-verify.mjs`；站点探测 | 清单本身不进任何清单，只被同名 `.sig` 覆盖 | 是，每次发布重写；版本增删才改变条目集合 | 随该插件版本数增长，每版本一条 `meta.json` 记录；不含 `plugin.js` |
| `plugins/<作者>/<插件>/versions.json` | `build-from-catalog.mjs`，取自作者站点同名文件 | 市场（第 7 步取版本列表与 `latest`）；`collection-verify.mjs`；`consistency-verify.mjs`；站点第 6 步 | 参与，L3 清单覆盖 | 是，每次发布重写 | 随版本数增长，每版本一个版本号字符串 |
| `plugins/<作者>/<插件>/<x.y.z>/meta.json` | `build-from-catalog.mjs`，从作者站点拉取后原样写出，不改写字段 | 市场（第 8 步展示字段并比对 L3 摘要）；站点详情；`dependencies` 等字段按分发规范 v2 由宿主侧读取 | 参与，L3 清单覆盖 | 是，每次发布重写 | 常数级，随字段个数与描述文本长度 |
| `plugins/<作者>/<插件>/<x.y.z>/plugin.js` | `build-from-catalog.mjs`，从作者站点拉取原始字节；拉取后由 `plugin-network-scan.mjs` 做网络自建静态扫描，命中只警告、插件照常收录；这是收录契约，不是沙箱 | 引擎（加载执行）；市场（下载） | 不进任何清单，只由同目录 `plugin.js.sig` 覆盖 | 是，每次发布重写 | 随插件代码规模增长（宿主上限 2 MB，合集不自设更严上限） |
| `plugins/<作者>/<插件>/<x.y.z>/plugin.js.sig` | `build-from-catalog.mjs` 的 `signPlugins`，用合集 EEC 对原始字节重新签名 | 市场（第 9 步）；引擎加载前校验；CI openssl 独立验签 | 本身是签名 | 是，每次发布重签 | 常数级，CMS DER 签名与载荷大小无关 |
| `plugins/<作者>/<插件>/<x.y.z>/plugin.js.author.sig` | 作者站点原样复制，缺失或为空只记警告 | 市场（第 10 步）；`collection-verify.mjs` 的弱校验 | 本身是作者签名；不进任何清单，也不受 EEC 覆盖 | 是，随发布复制 | 常数级，上限 64 KiB |

市场取件表里的每一步都落在上表某个文件上，反过来，上表没有出现「一次取一份聚合文件就能拿到全部插件信息」的路径：插件名与作者来自 L1 覆盖的 `plugins.json`，版本、元数据与摘要必须按 L2、L3 逐层取。这也解释了为什么 `catalog/index.json` 不在这张表里。

## 三、面向第三方工具与作者自查

这一组的分工是「看清这次发布收录了什么」。它们随包分发、可被外部读取，但不承担宿主的取数与校验职责。

| 路径 | 生成者 | 消费者 | 是否参与签名 | 是否随发布更新 | 体积随什么增长 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| `catalog/index.json` | `build-from-catalog.mjs` 调 `catalog-index.mjs` 的 `buildCatalogIndex` | 站点第 1 步（可选加速项）；`consistency-verify.mjs`；第三方搜索与速览；作者自查 | 不参与，不进任何清单 | 是，每次发布重建；内容含本次发布标识，标识变化时字节随之变化 | 随作者数与插件数增长，且每条含描述、许可证、仓库链接、基址等长文本，是包内增长最快的一份 |
| `catalog/anomalies.json` | `build-from-catalog.mjs` 调 `catalog-index.mjs` 的 `buildAnomalyReport` | `report-build-anomalies.mjs`（上报 Issue）；`consistency-verify.mjs`（统计被剔除数）；第三方排查 | 不参与，不进任何清单 | 是，每次发布重建；内容含本次发布标识 | 随本次被剔除的插件数；没有剔除时是空清单，体积回到常数级 |
| `plugins/author_manifest.json` | `build-from-catalog.mjs`，按实际收录的作者写出 | 站点第 2 步（作者清单与主页）；`collection-verify.mjs`；`consistency-verify.mjs` | 参与，L1 清单覆盖 | 是，每次发布重建 | 随作者数增长，每条 `username` 与 `profile` |
| `tags.json` | `build-from-catalog.mjs`，取 `site/tags.json` 校验后写出 | `collection-verify.mjs`（校验 `plugins.json` 的标签必须已声明）；`consistency-verify.mjs`；站点不读它 | 参与，存在时被 L1 清单覆盖 | 是，每次发布重写 | 随预设标签数增长 |
| `catalog/README.md` | `copyCatalogTree`，从仓库 `catalog/` 原样复制 | 人工查阅；第三方核对登记规则 | 不参与 | 是，随发布复制 | 不随收录规模增长，只在文档本身改动时变 |
| `catalog/removed.json` | `copyCatalogTree`，从仓库 `catalog/` 原样复制 | 人工查阅与下架追溯；仓库级校验在源文件上检查结构；CI 布局自检要求它存在 | 不参与 | 是，随发布复制 | 随已下架插件的条数增长 |
| `catalog/<作者>/author.json` | `copyCatalogTree` | 站点第 2 步（作者主页地址）；`consistency-verify.mjs` 比对目录结构；第三方核对登记 | 不参与 | 是，随发布复制 | 常数级 |
| `catalog/<作者>/author_pub.pem` | `copyCatalogTree` | 登记副本；`consistency-verify.mjs` 要求它与 `plugins/<作者>/author_pub.pem` 同时存在；实际验签用的是 `plugins/` 下那一份 | 不参与 | 是，随发布复制 | 常数级 |
| `catalog/<作者>/<插件>/plugin.json` | `copyCatalogTree` | 站点第 5 步（描述、许可证、仓库链接）；`consistency-verify.mjs` 与 `catalog/index.json` 逐字段比对 | 不参与 | 是，随发布复制 | 常数级 |

这一组里被 L1 覆盖的三份文件（`plugins/author_manifest.json`、`tags.json` 与同层的 `plugins.json`）与 `catalog/index.json` 有一个关键区别：前者被清单记录，改动会被 L1 的摘要发现；`catalog/index.json` 与 `catalog/anomalies.json` 不进任何清单，改动它不会让任何校验失败。因此它们能用来「看」，不能用来「验」。

## 四、面向站点自身

站点是展示层，只读同源文件，只探测签名材料是否存在，不做任何密码学计算。这一组文件不进任何清单，也不被合集 EEC 签名。

| 路径 | 生成者 | 消费者 | 是否参与签名 | 是否随发布更新 | 体积随什么增长 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| `index.html` | `site/build.mjs`，由 `site/src/index.html` 把资源占位改写成 `./assets/` | 浏览器；静态托管 | 不参与 | 是，每次发布随站点重建 | 常数级，随页面结构而非收录规模 |
| `assets/main.js`、`assets/data.js`、`assets/view.js`、`assets/format.js`、`assets/styles.css` | `site/build.mjs`，从 `site/src/assets/` 原样复制，原生 ES 模块不打包 | 浏览器 | 不参与 | 是，每次发布随站点重建 | 随页面源码规模增长，与收录了多少插件无关 |
| `.nojekyll` | `site/build.mjs` 写空文件 | 静态托管（关闭 Jekyll 处理） | 不参与 | 是，每次发布重新写入 | 恒为 0 字节 |

站点读的是同源数据文件而不是这些页面资源：它按固定顺序读 `catalog/index.json`、`plugins/author_manifest.json`、`plugins.json`、作者插件清单、登记副本与 `versions.json`，读不到才回落到后一步。页面资源本身不含任何收录数据，所以站点重建不会改变数据内容，反过来改数据也不需要重建站点。

## 五、原则：统计清单不是宿主的取件通道

> 根级 `plugins.json` 与 `catalog/index.json` 是给作者自查、速览与第三方搜索用的统计清单，不是宿主读取插件信息的通道；宿主按层取件。

与既有文档保持同一措辞：这两份文件只回答「这次发布收录了什么」，前者是插件名、作者与标签的定位清单，后者是含描述与版本数的展示用汇总。宿主要拿到版本、元数据与摘要，只能按 L2、L3 与 `plugin.js.sig` 逐层取件——`versions.json` 给版本列表，`meta.json` 给元数据，三层清单给 SHA-512，`plugin.js.sig` 给产物签名。

这样定的三个理由：

| 理由 | 说明 |
|:---:|:---:|
| 签名归属对不上 | 两份清单都不提供可用于验签的插件级摘要。`catalog/index.json` 与 `catalog/anomalies.json` 连清单覆盖都没有；`plugins.json` 虽被 L1 覆盖，但 L1 只证明「这一层有哪些文件、摘要是什么」，不提供任何插件的版本与元数据摘要 |
| 不一致时无从比对 | 聚合索引是构建生成的派生数据。一旦它与三层清单不一致，宿主手上没有任何可校验的摘要可以判定谁对；逐层取件才能同时拿到「这一层有哪些文件」与「摘要是什么」 |
| 把派生数据变成必经入口，就是被否决的方案 | 让合集多维护一份供市场省请求的简介索引，登记、构建与校验三处都要跟着改，收益不足以抵偿复杂度（见 `collection-pipeline.md` 第七节） |

允许的用法与禁止的用法：

| 用法 | 结论 | 说明 |
|:---:|:---:|:---:|
| 作者自查收录结果 | 允许 | 看自己与同批作者是否在本次发布里，版本数与标签是否符合预期 |
| 速览与人工核对 | 允许 | 站点展示、维护者巡检、发布后抽查 |
| 第三方搜索与索引 | 允许 | 外部工具可以做发现与检索，但不得据此给出「已验证」结论 |
| 宿主据此加载目录数据 | 禁止 | 市场不得依赖 `catalog/index.json` 取插件信息 |
| 宿主据此跳过 L2 或 L3 | 禁止 | `plugins.json` 没有版本、描述与摘要，跳过层就等于跳过校验 |
| 用聚合索引替代逐层取件 | 禁止 | 聚合索引不进任何清单、不参与验签，替代之后宿主失去可用摘要 |

站点是这条原则的例外而非反例：它读 `catalog/index.json` 只是可选加速，读不到就回落到 `plugins/author_manifest.json` 与 `plugins.json`，而这两份都被 L1 覆盖。站点也不做密码学计算，它对签名材料只写「存在」「缺失」「未探测」。

## 六、签名覆盖关系

按层把「谁覆盖谁」单独列一遍，便于回答「这个文件改了会不会被发现」。

| 层 | 位置 | 清单覆盖的文件 | 清单签名 | 明确不覆盖的文件 |
|:---:|:---:|:---:|:---:|:---:|
| L1 | pages 包根 | `meta.json`、`plugins.json`、`plugins/author_manifest.json`，`tags.json` 存在时一并覆盖 | 根目录 `manifest.json.sig` | `index.html`、`assets/`、`catalog/`、`certs/`、`manifest.json` 自身 |
| L2 | `plugins/<作者>/` | `author_pub.pem`、`plugin_manifest.json`，文件存在才覆盖 | 同目录 `manifest.json.sig` | 同目录 `manifest.json` 自身 |
| L3 | `plugins/<作者>/<插件>/` | `versions.json`、各版本 `meta.json` | 同目录 `manifest.json.sig` | `plugin.js`、`plugin.js.sig`、`plugin.js.author.sig` |
| 产物 | `plugins/<作者>/<插件>/<x.y.z>/` | 不进任何清单 | `plugin.js.sig`（合集 EEC）；`plugin.js.author.sig`（作者公钥，可选） | `meta.json` 已由 L3 覆盖，不再单独签名 |

两条推论：

- 改 `catalog/index.json`、`catalog/anomalies.json`、`catalog/` 副本、`certs/` 或站点资源，不会有任何清单或签名发现。这些位置的可信度分别由 PR 审核、证书链与托管平台承担，不由清单承担。
- 只验清单不能证明产物完整，客户端必须另取 `plugin.js.sig`；反过来，只验产物也证明不了元数据未被改动。

## 七、Pages 环境文件结构与部署形态

> 本节回答「部署出去的站点到底长什么样」。来源以 `.github/workflows/build-and-deploy.yml` 与 `scripts/build-from-catalog.mjs` 的实际行为为准；每个位置的逐文件职责见前几节的表格，必需与可选文件清单见 `docs/maintenance.md` 第三节。

### 站点根与入口地址

CI 把组装完的 pages 包整体作为 GitHub Pages 的站点根上传部署（`build-and-deploy.yml` 的 Upload artifact 与 Deploy to Pages 两步，包目录固定为 `dist/pages`）。站点根就是 pages 包根，两者之间没有额外的包装层。入口地址默认是 `https://omds-chat.github.io/awesome-dsc-plugin/`，可用仓库变量 `vars.PUBLISHED_BASE_URL` 覆盖；市场取件表里的 `<base_url>` 即这个入口地址。

### 部署后的站点树

```text
<base_url>/                            # 站点根 = pages 包根，每次 Release 全量重建并整体替换
├── index.html                         # 构建产物：站点入口页面，由 site/src/index.html 改写资源路径
├── .nojekyll                          # 构建产物：空文件，关闭 GitHub Pages 的 Jekyll 处理
├── assets/                            # 构建产物：页面 ES 模块与样式，不含任何收录数据
├── meta.json                          # 清单覆盖（L1）：合集元数据，取自 site/meta.json
├── tags.json                          # 清单覆盖（L1）：预设标签，取自 site/tags.json
├── plugins.json                       # 清单覆盖（L1）：插件目录索引，由 catalog 生成
├── manifest.json(.sig)                # 清单与签名文件：L1 清单及其 EEC 签名
├── catalog/                           # 索引与登记副本：index.json 与 anomalies.json 是构建生成的汇总索引；其余是 catalog/ 登记复制，全部不进任何清单
├── certs/                             # 信任材料：合集 EEC 证书与配对公钥，原样复制，不进任何清单
└── plugins/                           # 清单覆盖（L1/L2/L3）+ 产物签名：author_manifest.json、各层 manifest.json(.sig) 与各版本 meta.json、plugin.js(.sig)
```

### 版本化路径

本仓没有版本目录：每次 Release 全量重建 pages 包并整体替换，不做版本留存（`build-and-deploy.yml` 开头的分发模型注释与本文第一节第一条事实）。部署后的站点里不存在 `/version/<tag>/` 这样的版本快照路径，需要旧版产物时只能回到触发那次发布的 Release。组织主线仓库把归档分支的 `version/` 释放合并进站点、以 `/version/<tag>/` 提供版本快照的机制属于主线仓库的分支结构；本仓没有归档分支，不涉及该机制。

## 八、维护约定

- 新增或删除 pages 包里的文件，先在本文登记三件事：谁生成、谁读、有没有签名归属。三者写不清的产物不应进入 pages 包。
- 任何产物的签名归属发生变化，同时更新本文与 `collection-pipeline.md` 第二节、`maintenance.md` 的 pages 包结构与校验规则。
- 本文与脚本冲突时以脚本为准，并回改本文：生成者以 `scripts/build-from-catalog.mjs` 与 `scripts/lib/` 为准，消费者以本文的市场取件顺序、`site/src/assets/data.js` 的读取路径与 `scripts/lib/` 的校验代码为准。
