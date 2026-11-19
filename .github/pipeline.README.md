# 构建流水线说明

本仓库负责把 catalog 里登记的插件拉取、重新签名并组装成可直接部署的 Pages 分发包。
分发模型只有一种来源:插件作者自己发布的 Pages 站点(base_url),Release 不放任何资产。

## 一、证书位置

合集终端签名证书(EEC)的固定位置是 `certs/awesome-dsc-plugin-eec.crt`,对应私钥只从 CI secret `EEC_SECRET_KEY` 注入。
pages 根目录不放 `eec.pem`,也不放任何私钥。根证书由 CI 通过 `secrets.ROOT_CA_PEM` 或 `vars.ROOT_CA_URL` 提供,只用于自检。

三层清单签名与每个 `plugin.js.sig` 都用同一张 EEC,命令固定为
`openssl cms -sign -binary -md sha512 -outform DER -nocerts -noattr`,验签必须带 `-inform DER`。

## 二、pages 包结构

| 位置 | 来源 |
| --- | --- |
| `index.html`、`assets/` | site 构建产物 |
| `meta.json`、`tags.json`、`datalog.json` | 由 `scripts/build-from-catalog.mjs` 生成 |
| `manifest.json`、`manifest.json.sig` | L1 清单及其签名 |
| `catalog/` | main 分支的 catalog 目录,原样复制 |
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

## 三、清单覆盖范围

| 层 | 目录 | 覆盖文件 |
| --- | --- | --- |
| L1 | pages 根 | `meta.json`、`datalog.json`、`tags.json`、`plugins/author_manifest.json` |
| L2 | `plugins/<作者>` | `author_pub.pem`、`plugin_manifest.json` |
| L3 | `plugins/<作者>/<插件>` | `versions.json` 与各版本的 `meta.json` |

catalog 与 certs 不纳入任何清单,它们是登记信息与信任材料。
清单格式沿用仓库既有的 `schemaVersion`、`revision`、`files` 三项,哈希算法 SHA-512。

## 四、revision 语义

pages 不做版本留存,每个 Release 全量重建并直接替换。
L1 的 revision 从已发布站点的 `manifest.json` 读取上一次的值:L2、L3 同理由 `plugins/<作者>/manifest.json`、
`plugins/<作者>/<插件>/manifest.json` 读取。该层文件集合与哈希都没变时沿用旧值,有变化时加一,取不到时从 1 开始。

## 五、本地复现

```bash
# 只做签名与组装,需要设置 EEC_SECRET_KEY 与 ROOT_CA_PATH
EEC_SECRET_KEY=... ROOT_CA_PATH=root_ca.crt \
  node scripts/build-from-catalog.mjs \
  --catalog catalog --certs certs --site site/dist --out dist/pages \
  --published-base https://omdsc-dev.github.io/awesome-dsc-plugin/

# 独立验签
openssl cms -verify -binary -md sha512 -inform DER \
  -in dist/pages/manifest.json.sig -content dist/pages/manifest.json \
  -CAfile root_ca.crt -certfile dist/pages/certs/awesome-dsc-plugin-eec.crt
```

流水线步骤依次为:安装依赖、校验源码树、构建 site、拉取插件、用 EEC 重新签名 `plugin.js`、生成并签名三层清单、
组装 pages 包、用 openssl 独立验签、结构自检、上传并部署。
