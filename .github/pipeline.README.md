# 构建流水线说明

本仓库负责把 catalog 里登记的插件拉取、重新签名并组装成可直接部署的 Pages 分发包。
分发模型只有一种来源:插件作者自己发布的 Pages 站点(base_url),Release 不放任何资产。

## 一、仓库结构

仓库根只有 `catalog/`、`certs/`、`schemas/`、`scripts/`、`site/` 五个目录与 `.github/`,加上工程文件(`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.gitignore`、`.gitattributes`、`README.md`、`README.en-US.md`、`LICENSE`)。

合集设置与站点设置都在 `site/`:合集元数据是 `site/meta.json`,预设标签是 `site/tags.json`,站点工程就是 `site/` 本身,构建产物落在 `site/dist`。

仓库根不再存放 `plugins.json`、`manifest.json`、`manifest.json.sig` 与 `plugins/`:它们是 pages 包的构建产物,只在构建出的 pages 包里出现,也不再有「空基线」。因此仓库级校验只看 `catalog/` 与 `certs/`(`pnpm verify:catalog`),pages 包的校验用 `pnpm verify:bundle`。

`ci-memory` 是与之并列的孤立并行分支,存三层清单的上一版;流水线把它检出到 `single-branch/ci-memory/`,本地工作区也用同一路径,该目录自带 `.git`,主仓库 `.gitignore` 已忽略它,分支内容不进 `main`。

## 二、证书位置

合集终端签名证书(EEC)的固定位置是 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt`,对应私钥只从 CI secret `EEC_SECRET_KEY` 注入。
`certs/` 下只允许来源文件夹,证书与公钥放在 `certs/<来源 id>/<文件名>` 下,文件夹名即来源 id,文件名以 `<来源 id>-` 开头:证书是 `<来源 id>-eec.crt`,配对公钥是 `<来源 id>-eec-secret.pub`。私钥一律不入库,仓库级校验会拦住散落在 `certs/` 根上的文件、命名不合规的文件与非证书非公钥的材料。
pages 根目录不放 `eec.pem`,也不放任何私钥。根证书由 CI 通过 `secrets.ROOT_CA_PEM` 或 `vars.ROOT_CA_URL` 提供,只用于自检。

三层清单签名与每个 `plugin.js.sig` 都用同一张 EEC,命令固定为
`openssl cms -sign -binary -md sha512 -outform DER -nocerts -noattr`,验签必须带 `-inform DER`。

## 三、pages 包结构

| 位置 | 来源 |
|:---:|:---:|
| `index.html`、`assets/` | site 构建产物 |
| `meta.json`、`tags.json` | 取自 `site/meta.json` 与 `site/tags.json`,原样复制 |
| `plugins.json` | 插件目录索引,由 `scripts/build-from-catalog.mjs` 按 catalog 生成 |
| `manifest.json`、`manifest.json.sig` | L1 清单及其签名 |
| `catalog/` | main 分支的 catalog 目录复制进来的登记文件,含根目录的 `README.md` 与 `removed.json`,本次剔除的作者与插件不复制;另加构建生成的 `index.json`(汇总索引,只供本站展示,不作为市场省请求的入口)与 `anomalies.json`(剔除清单) |
| `certs/` | main 分支的 certs 目录,原样复制;下只含来源文件夹 `certs/<来源 id>/` |
| `plugins/` | 由 CI 依据 catalog 拉取并构建 |

plugins 树:

```
plugins/author_manifest.json
plugins/<作者>/author_pub.pem
plugins/<作者>/plugin_manifest.json
plugins/<作者>/manifest.json
plugins/<作者>/manifest.json.sig
plugins/<作者>/<插件>/versions.json
plugins/<作者>/<插件>/manifest.json
plugins/<作者>/<插件>/manifest.json.sig
plugins/<作者>/<插件>/<版本>/meta.json
plugins/<作者>/<插件>/<版本>/plugin.js
plugins/<作者>/<插件>/<版本>/plugin.js.sig
plugins/<作者>/<插件>/<版本>/plugin.js.author.sig   可选,作者自签名原样保留;验签失败只警告,不阻断发布
```

`plugins.json` 与 `catalog/index.json` 是给作者自查、速览与第三方搜索用的统计清单,不是宿主读取插件信息的通道:宿主先按 `plugins.json` 枚举插件,再按三层清单逐层取件,插件信息(版本、元数据、摘要)只从层里来。`plugins.json` 被 L1 清单覆盖,`catalog/index.json` 与 `catalog/anomalies.json` 不进任何清单,改动后者不会有任何校验发现。逐文件的生成者、消费者与签名归属见 [../docs/design/pages-artifacts.md](../docs/design/pages-artifacts.md)。

## 四、清单覆盖范围

| 层 | 目录 | 覆盖文件 |
|:---:|:---:|:---:|
| L1 | pages 根 | `meta.json`、`plugins.json`、`tags.json`、`plugins/author_manifest.json` |
| L2 | `plugins/<作者>` | `author_pub.pem`、`plugin_manifest.json` |
| L3 | `plugins/<作者>/<插件>` | `versions.json` 与各版本的 `meta.json` |

catalog 与 certs 不纳入任何清单,它们是登记信息与信任材料。
清单格式沿用仓库既有的 `schemaVersion`、`revision`、`files` 三项,哈希算法 SHA-512。

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

## 六、本地复现

```bash
# 仓库级校验:只读 catalog/ 与 certs/,不需要任何构建产物
pnpm verify:catalog

# 语法自检与站点构建
pnpm type
pnpm build:site

# 组装 pages 包:需要 EEC_SECRET_KEY 与 ROOT_CA_PATH
# --ci-memory 指向 ci-memory 分支的本地工作区,构建从这里读回上一版 revision(分支优先)
# --published-base 是过渡回退:只有分支里读不到该层清单时才会读线上
EEC_SECRET_KEY=... ROOT_CA_PATH=root_ca.crt \
  node scripts/build-from-catalog.mjs \
  --catalog catalog --certs certs --site site/dist --out dist/pages \
  --ci-memory single-branch/ci-memory \
  --published-base https://omds-chat.github.io/awesome-dsc-plugin/

# pages 包校验:三层清单、清单签名、产物签名、产物网络扫描与收录信息交叉一致性
pnpm verify:bundle --root-ca root_ca.crt

# 独立验签
openssl cms -verify -binary -md sha512 -inform DER \
  -in dist/pages/manifest.json.sig -content dist/pages/manifest.json \
  -CAfile root_ca.crt -certfile dist/pages/certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt

# 全部校验通过之后才写回:把三层清单与签名镜像到 ci-memory 工作区(只做文件,不提交)
node scripts/write-ci-memory.mjs --bundle dist/pages --ci-memory single-branch/ci-memory
```

流水线步骤依次为:安装依赖、检出 `main` 与 `ci-memory` 两条分支、仓库级校验(`verify:catalog`)、构建 site、拉取插件、产物网络自审(命中即剔除该插件)、用 EEC 重新签名 `plugin.js`、按层读回上一版并生成与签名三层清单、
组装 pages 包、pages 包校验(`verify:bundle`,含交叉校验)、用 openssl 独立验签、结构自检、写回 `ci-memory` 并推送、上报剔除项、上传并部署。

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

## 七、异常插件与上报

构建把两类问题严格分开,边界在 `scripts/build-from-catalog.mjs` 里实现:

| 类别 | 判定 | 构建行为 |
|:---:|:---:|:---:|
| 登记不合规 | `catalog/` 里的文件本身不合法(缺字段、`name` 与目录不符、`tags` 结构或取值不合规、公钥不可解析) | 登记错误,构建以非零退出码中止,不发布任何插件 |
| 运行期异常 | 作者站点拉取失败、远端 `versions.json` 不合法、远端 `meta.json` 与登记不符、`plugin.js` 为空 | 只剔除该插件,其余插件照常发布;剔除项写入 `catalog/anomalies.json` |

剔除项由 `scripts/report-build-anomalies.mjs` 上报到本仓库 Issue:

- 只用 GitHub REST API,全部请求通过 `curl` 命令行发出,鉴权用 workflow 自带的 `GITHUB_TOKEN`,因此 workflow 需要 `issues: write` 权限。
- 追踪 Issue 的标题固定为 `[自动] 插件剔除追踪`:已存在就往该 Issue 追加一条评论,不存在就新建一个。
- 正文包含本次发布的 tag、异常条目表格(作者、插件、阶段、失败原因)与「已自动剔除、未阻塞发布」的说明。
- 上报失败(令牌缺失、权限不足、API 报错)只打印警告并以 0 退出,不阻塞发布;工作流步骤另有 `continue-on-error` 兜底。
- 本地可用 `--dry-run --api-base <任意地址>` 只打印请求体,不发任何真实请求。
