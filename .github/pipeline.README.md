# 构建流水线说明

本仓库负责把 catalog 里登记的插件拉取、重新签名并组装成可直接部署的 Pages 分发包。
分发模型只有一种来源:插件作者自己发布的 Pages 站点(base_url),Release 不放任何资产。

## 一、仓库结构

仓库根只有 `catalog/`、`certs/`、`schemas/`、`scripts/`、`site/` 五个目录与 `.github/`,加上工程文件(`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.gitignore`、`.gitattributes`、`README.md`、`README.en-US.md`、`LICENSE`)。

合集设置与站点设置都在 `site/`:合集元数据是 `site/meta.json`,预设标签是 `site/tags.json`,站点工程就是 `site/` 本身,构建产物落在 `site/dist`。

仓库根不再存放 `plugins.json`、`manifest.json`、`manifest.json.sig` 与 `plugins/`:它们是 pages 包的构建产物,只在构建出的 pages 包里出现,也不再有「空基线」。因此仓库级校验只看 `catalog/` 与 `certs/`(`pnpm verify:catalog`),pages 包的校验用 `pnpm verify:bundle`。

## 二、证书位置

合集终端签名证书(EEC)的固定位置是 `certs/awesome-dsc-plugin-eec.crt`,对应私钥只从 CI secret `EEC_SECRET_KEY` 注入。
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
| `catalog/` | main 分支的 catalog 目录复制进来的登记文件,含根目录的 `README.md` 与 `removed.json`,本次剔除的作者与插件不复制;另加构建生成的 `index.json`(汇总索引)与 `anomalies.json`(剔除清单) |
| `certs/` | main 分支的 certs 目录,原样复制 |
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
plugins/<作者>/<插件>/<版本>/plugin.js.author.sig   可选,作者自签名原样保留
```

## 四、清单覆盖范围

| 层 | 目录 | 覆盖文件 |
|:---:|:---:|:---:|
| L1 | pages 根 | `meta.json`、`plugins.json`、`tags.json`、`plugins/author_manifest.json` |
| L2 | `plugins/<作者>` | `author_pub.pem`、`plugin_manifest.json` |
| L3 | `plugins/<作者>/<插件>` | `versions.json` 与各版本的 `meta.json` |

catalog 与 certs 不纳入任何清单,它们是登记信息与信任材料。
清单格式沿用仓库既有的 `schemaVersion`、`revision`、`files` 三项,哈希算法 SHA-512。

## 五、revision 语义

pages 不做版本留存,每个 Release 全量重建并直接替换。
L1 的 revision 从已发布站点的 `manifest.json` 读取上一次的值:L2、L3 同理由 `plugins/<作者>/manifest.json`、
`plugins/<作者>/<插件>/manifest.json` 读取。该层文件集合与哈希都没变时沿用旧值,有变化时加一,取不到时从 1 开始。

## 六、本地复现

```bash
# 仓库级校验:只读 catalog/ 与 certs/,不需要任何构建产物
pnpm verify:catalog

# 语法自检与站点构建
pnpm type
pnpm build:site

# 组装 pages 包:需要 EEC_SECRET_KEY 与 ROOT_CA_PATH
EEC_SECRET_KEY=... ROOT_CA_PATH=root_ca.crt \
  node scripts/build-from-catalog.mjs \
  --catalog catalog --certs certs --site site/dist --out dist/pages \
  --published-base https://omdsc-dev.github.io/awesome-dsc-plugin/

# pages 包校验:三层清单、清单签名、产物签名与收录信息交叉一致性
pnpm verify:bundle --root-ca root_ca.crt

# 独立验签
openssl cms -verify -binary -md sha512 -inform DER \
  -in dist/pages/manifest.json.sig -content dist/pages/manifest.json \
  -CAfile root_ca.crt -certfile dist/pages/certs/awesome-dsc-plugin-eec.crt
```

流水线步骤依次为:安装依赖、仓库级校验(`verify:catalog`)、构建 site、拉取插件、用 EEC 重新签名 `plugin.js`、生成并签名三层清单、
组装 pages 包、pages 包校验(`verify:bundle`,含交叉校验)、用 openssl 独立验签、结构自检、上报剔除项、上传并部署。

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
