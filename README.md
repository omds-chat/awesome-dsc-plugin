# awesome-dsc-plugin

dsc 的社区插件合集。插件在这里按分发规范 v2 收录、签名并分发,插件市场读取本合集 pages 包里的三层哈希清单、合集证书与签名来取用插件。

[English](README.en-US.md)

## 定位与收录范围

本合集面向 dsc 的运行时插件,由 omdsc-dev 维护。本仓库是 omdsc-dev 的终端签名方(EEC),持有由 DeepSeek-Chat-Enhanced 仓库的根证书机构签发的终端签名证书,并用它为三层清单与每个版本的插件产物生成 CMS 分离签名。

收录条件:

- 插件产物是单个浏览器 ESM 脚本,导出 `activate(context)`,不依赖 Node 内置模块与后端接口。
- 提供可构建的源码仓库或可访问的产物地址,CI 能按 `base_url` 拉取并复核产物。
- 插件运行时元数据 `meta.json` 字段完整,插件名符合 `dsc-xxx` 或 `@scope/dsc-xxx`。

不收录需要后端服务、需要原生模块、或无法在 CI 中重建产物的插件。

收录不等于认证。本合集只保证分发内容与签名一致,不审查插件行为。

## 分发结构

合集以 pages 包的形式发布:每次 Release 由 CI 按 `catalog/` 到作者自己的 `base_url` 拉取插件、用合集 EEC 重新签名,全量重建 pages 包并直接替换,不做版本留存。插件在 `plugins/` 下按「作者 / 插件 / 版本」三层组织,每层一份 `manifest.json` 与一份 `manifest.json.sig`:清单记录本层文件的 SHA-512,签名由根 CA 签发的终端签名证书(EEC)生成。层与层之间互不引用,任何一层都可以单独发布、单独校验、单独重签。

```text
<collection>/                          # pages 包根目录,每次 Release 全量重建
├── index.html                         # 站点构建产物
├── assets/                            # 站点构建产物:页面脚本与样式
├── meta.json                          # L1,合集元数据,含下载计数开关
├── tags.json                          # L1,预设标签
├── datalog.json                       # L1,插件目录,由 catalog 生成
├── manifest.json                      # L1 清单
├── manifest.json.sig                  # L1 清单签名
├── catalog/                           # 收录登记复制,另含构建生成的 index.json 与 anomalies.json,不进任何清单
├── certs/                             # 信任材料,原样复制,不进任何清单
│   └── awesome-dsc-plugin-eec.crt     # 合集终端签名证书(EEC),由根 CA 签发
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

根目录不再有 `eec.pem`:合集证书的固定位置是 `certs/awesome-dsc-plugin-eec.crt`,随 pages 包分发,不进任何清单;根证书同样不进分发内容。

合集设置放在 `site/`:`site/meta.json` 与 `site/tags.json` 是 pages 包同名文件的唯一来源,内容原样进入 pages 包。`datalog.json`、`manifest.json`、`manifest.json.sig` 与 `plugins/` 是构建产物,只在构建出的 pages 包里出现,仓库根不再存放它们,也没有空基线。

| 层 | 位置 | 覆盖的文件(相对该层目录) |
|:---:|:---:|:---:|
| L1 | pages 包根 | `meta.json`、`datalog.json`、`tags.json`、`plugins/author_manifest.json`,其中 `tags.json` 存在时覆盖 |
| L2 | `plugins/<作者>/` | `author_pub.pem`、`plugin_manifest.json`,文件存在才覆盖 |
| L3 | `plugins/<作者>/<插件>/` | `versions.json`、各版本目录下的 `meta.json` |

`catalog/` 与 `certs/` 不纳入任何清单:前者是收录登记,后者是信任材料。

清单格式,JSON Schema 见 `schemas/manifest.schema.json`:

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "files": [
    { "path": "datalog.json", "sha512": "<128 位小写十六进制>" }
  ]
}
```

- `path` 相对清单所在目录,使用正斜杠,不得是绝对路径,不得出现 `.` 或 `..` 段,不得指向清单自身,不得重复。
- 哈希算法 SHA-512,十六进制小写,固定 128 位。
- `revision` 是每层独立的正整数:该层文件集合或内容变化时加一,不变时沿用旧值;pages 包每次全量重建,上一份值按层从已发布站点的同名 `manifest.json` 读取,取不到时从 1 开始。
- L3 不覆盖 `plugin.js` 与 `plugin.js.sig`:产物本体由每个版本的 `plugin.js.sig` 独立签名,清单只描述元数据。
- `tags.json` 可选:存在就必须被 L1 清单覆盖,不存在则不报错、也不进清单。
- `meta.json.sig` 与 `meta.json.author.sig` 已取消:版本目录里的合集签名只剩 `plugin.js.sig`,`plugin.js.author.sig` 可选保留。`meta.json` 由 L3 清单覆盖并由合集 EEC 绑定,作者公钥本身由 L2 覆盖。`dsc-plugin-template` 仓库仍在产出 `meta.json.author.sig`,待同步。

三层之间不做收束:L1 不引用 L2,L2 不引用 L3,任何一层都可以单独发布、单独校验、单独重签。取舍是放弃「一次校验拿到全树摘要」,换取按插件增量更新:改一个插件只需 L3 的 `revision` 加一,L2 与 L1 的 `revision` 不变,客户端也只重新拉取这一层的清单与签名。若把三层收束成一份根清单,任何插件发版都会改动根清单,所有客户端都得重拉整份摘要。

pages 包是构建产物,不提交回仓库:每次 Release 全量重建并整体替换,仓库里不保留 `datalog.json`、`plugins/` 下的插件数据、`manifest.json` 与 `manifest.json.sig`,也不放空基线来喂仓库级校验。因此每层的 `revision` 不能在源码树里沿用,只能按层从已发布站点的同名 `manifest.json` 读取:文件集合与哈希都没变时沿用旧值,有变化时加一。

## 必需文件

pages 包内各位置的必需与可选文件如下。它们只存在于构建出的 pages 包里,仓库根一份都不存放:

| 位置 | 必需 | 可选 |
|:---:|:---:|:---:|
| pages 包根 | `meta.json`、`datalog.json`、`plugins/author_manifest.json`、`manifest.json`、`manifest.json.sig` | `tags.json` |
| `certs/` | `awesome-dsc-plugin-eec.crt`,不进任何清单 | `awesome-dsc-plugin-secret.pub`,同样不进清单 |
| `catalog/` | 每位作者的 `author.json`、`author_pub.pem` 与 `<插件>/plugin.json`,原样复制,不进任何清单 | 无 |
| `plugins/<作者>/` | `plugin_manifest.json`、`manifest.json`、`manifest.json.sig` | `author_pub.pem` |
| `plugins/<作者>/<插件>/` | `versions.json`、`manifest.json`、`manifest.json.sig` | 无 |
| `plugins/<作者>/<插件>/<x.y.z>/` | `meta.json`、`plugin.js`、`plugin.js.sig` | `plugin.js.author.sig` |

目录命名、`versions.json` 结构与 `meta.json` 字段见 [.github/bundle-layout.README.md](.github/bundle-layout.README.md)。合集证书只在 `certs/awesome-dsc-plugin-eec.crt`,根目录不再有 `eec.pem`;它只证明签名者身份,不进任何清单。根证书不进分发内容,由 online-data 分支分发,网页用内嵌的根证书指纹核对。

## 签名与校验

### 三个角色

签名体系基于 OpenSSL PKI,由三个角色各持一把密钥,谁签发什么一目了然。

| 角色 | 承担者 | 持有物 | 签发对象 |
|:---:|:---:|:---:|:---:|
| 根证书机构(CA) | `DeepSeek-Chat-Enhanced` 仓库(组织主线仓库) | 根私钥(离线,不入库)、根证书 | 终端签名证书 `certs/awesome-dsc-plugin-eec.crt` |
| 终端签名方(EEC) | 本仓库 | EEC 私钥(CI secret `EEC_SECRET_KEY`)、`certs/awesome-dsc-plugin-eec.crt` | 三层清单与每个版本的 `plugin.js` 的 CMS 分离签名 |
| 独立签名方 | 插件作者,含 omdsc-dev 自身 | 作者密钥对 | `plugin.js` 的裸公钥分离签名 |

### 证书链

信任从根证书开始,一路收到清单与插件文件的字节。

```text
DeepSeek-Chat-Enhanced 仓库(根 CA,离线)
  root_ca.crt
      │  签发
      ▼
  本仓库 certs/awesome-dsc-plugin-eec.crt(终端签名证书 EEC)
      │  openssl cms -sign -binary -md sha512 -outform DER -nocerts -noattr
      ▼
  manifest.json.sig          L1 清单签名
  plugins/<author>/manifest.json.sig              L2 清单签名
  plugins/<author>/<plugin>/manifest.json.sig     L3 清单签名
  plugins/<author>/<plugin>/<x.y.z>/plugin.js.sig 产物签名
```

| 项 | 约定 |
|:---:|:---:|
| 根 CA 密钥 | ECDSA P-256,OpenSSL 原生 PEM;浏览器 WebCrypto 对 P-256 支持最广,证书链校验要在浏览器里做,Ed25519 在目标浏览器下限不可用 |
| 根证书 | X.509 自签名,`keyUsage=critical,keyCertSign,cRLSign`,`basicConstraints=critical,CA:TRUE,pathlen:0`,有效期 3650 天 |
| EEC 密钥 | ECDSA P-256;OpenSSL 的 CMS 实现对 Ed25519 报 `provider signature failure`,不可用 |
| EEC 证书 | 由根 CA 签发,`keyUsage=critical,digitalSignature`,`basicConstraints=critical,CA:FALSE`,有效期 365 天 |
| 合集签名 | CMS 分离签名,`openssl cms -sign -binary -md sha512 -outform DER -nocerts -noattr`,产物为同名的 `.sig` 文件;签名与验签都带 `-binary`,按原始字节处理,不经换行规范化;产物固定为 DER,验签带 `-inform DER` |
| 作者签名 | 裸公钥分离签名,`openssl pkeyutl -sign -rawin`,作者密钥为 Ed25519 |

两条曲线都是硬约束,不是偏好:换成 Ed25519 会让证书链校验或 CMS 验签在目标浏览器与 OpenSSL 上直接失败。

### 签什么

| 签名 | 覆盖对象 | 产物 |
|:---:|:---:|:---:|
| 合集 CMS 签名 | L1、L2、L3 各一份清单 | `manifest.json.sig`,每层一份 |
| 合集 CMS 签名 | 每个版本的 `plugin.js` | `plugin.js.sig` |
| 作者裸公钥签名 | `plugin.js`,可选 | `plugin.js.author.sig` |

`meta.json` 不再单独签名,由 L3 清单的 SHA-512 覆盖;作者公钥由 L2 清单覆盖。

### 命令

合集签名与验签,三层清单与 `plugin.js` 用同一条命令,只是文件名不同:

```bash
openssl cms -sign -binary -md sha512 -outform DER -in manifest.json -out manifest.json.sig -signer certs/awesome-dsc-plugin-eec.crt -inkey eec_secret.pem -nocerts -noattr
openssl cms -verify -binary -md sha512 -inform DER -in manifest.json.sig -content manifest.json -CAfile root_ca.crt -certfile certs/awesome-dsc-plugin-eec.crt
```

`-md sha512` 固定摘要算法,不依赖 OpenSSL 的默认值;`-outform DER` 不可省略。默认输出是 S/MIME `multipart/signed` 包装,浏览器无法解析,而插件市场要在浏览器里验签,所以 DER 是跨仓库统一格式:签名方固定 `-outform DER`,验签方固定 `-inform DER`,任何一方改用默认格式都会验签失败。产物可用 `openssl asn1parse -inform DER -in manifest.json.sig` 确认为 DER。

启用吊销检查时,把根证书与 CRL 拼进同一个 `-CAfile` 再追加 `-crl_check`:`cat root_ca.crt crl.pem > ca_with_crl.pem`。OpenSSL 3.5 的 `cms` 子命令没有 `-CRLfile` 选项,CRL 只能随 `-CAfile` 一起传入。

### 作者自签名

插件作者是独立签名方,不经本仓库,也不依赖证书链。作者用裸公钥分离签名给插件产物签名,本仓库只负责把产物与公钥原样收录:

- 作者公钥随产物提供,收录为 `plugins/<author>/author_pub.pem`(Ed25519,OpenSSL PEM),由 L2 清单覆盖。
- 作者的 `dist/plugin.js.sig` 收录为 `plugin.js.author.sig`,与合集的 CMS 签名 `plugin.js.sig` 并存,文件名区分签名者。
- 作者对 `meta.json` 的签名不再收录:`meta.json` 由 L3 清单覆盖并由合集 EEC 绑定。

作者签名是可选项。作者不签名时,该版本只有本仓库的 EEC 签名。

### 校验规则

`pnpm verify:bundle` 对构建出的 pages 包逐项检查,任一错误都以非零退出码结束并一次性列出全部问题,每条都带层号与文件路径。

| 编号 | 规则 |
|:---:|:---:|
| 1 | 合集证书 `certs/awesome-dsc-plugin-eec.crt` 存在(根目录不再有 `eec.pem`),由给定根证书签发(`--root-ca` 或 `ROOT_CA_PATH`),未过期,`keyUsage` 含 `digitalSignature`,`basicConstraints` 非 CA |
| 2 | `datalog.json` 中的每个插件都在 `plugins/<author>/plugin_manifest.json` 中出现,且插件目录存在 |
| 3 | 每个插件目录有 `versions.json`,`latest` 必须在 `versions` 列表内 |
| 4 | 每个版本目录有 `meta.json`、`plugin.js`、`plugin.js.sig`,并用 `openssl cms -verify -binary -md sha512 -inform DER -CAfile <根证书> -certfile certs/awesome-dsc-plugin-eec.crt` 验签,失败即报错 |
| 5 | 若版本目录存在 `plugin.js.author.sig`,则 `plugins/<author>/author_pub.pem` 必须存在,并用 `openssl pkeyutl -verify` 验证,失败即报错;其它 `*.author.sig` 不参与校验 |
| 6 | `tags.json` 存在时,`datalog.json` 的 `tag` 必须取自其中 |
| 7 | 三层清单存在且结构合法:`schemaVersion` 为 1,`revision` 为正整数,`files` 为非空数组,条目只含 `path` 与 `sha512` |
| 8 | 清单条目的 `path` 合法:正斜杠、相对路径、不含 `..`、不指向清单自身、不重复 |
| 9 | 覆盖范围与该层应有的文件严格相等:该有的都在清单里,清单里没有多余项,L3 不得出现 `plugin.js` 与 `plugin.js.sig` |
| 10 | 清单记录的每个 SHA-512 与文件实际内容一致,不一致时报出层号与具体文件 |
| 11 | 每层 `manifest.json.sig` 用根证书与 `certs/awesome-dsc-plugin-eec.crt` 验签,失败即报错 |

### 校验语义

- 本仓库发布前的校验是强校验:`scripts/build-from-catalog.mjs` 与 CI 的每一步遇到错误都以非零退出码中止,不合规的内容不会被分发。仓库级校验 `pnpm verify:catalog` 只查 `catalog/` 与 `certs/` 的结构与证书材料,不要求任何构建产物;pages 包的强校验是 `pnpm verify:bundle`,三层清单、清单签名、产物签名与收录信息交叉一致性都在这一步检查,不给根证书时证书链与签名降级为警告,结构与哈希照常校验。要临时放开清单缺失,可对 `scripts/verify-collection.mjs` 直接加 `--allow-missing-manifest`。
- 分发出去之后的校验是弱校验:插件市场对网页文件签名、插件签名、证书链校验失败只警告,不阻断,不做兜底。警告由用户决定是否继续,市场不会替用户静默放行。
- 签名覆盖文件原始字节。换行、缩进或空白的任何改动都会让校验失败,仓库统一使用 LF。

### 如何申请 EEC

EEC 证书由 DeepSeek-Chat-Enhanced 仓库的根证书机构签发,本仓库不能自签,也不能为其他合集签发。

1. 本地生成 EEC 私钥与证书签名请求(CSR),`CN` 取合集名:

   ```bash
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out eec_secret.pem
   openssl req -new -key eec_secret.pem -out eec.csr -subj '/O=omdsc-dev/CN=awesome-dsc-plugin'
   ```

2. 把 `eec.csr` 提交给 DeepSeek-Chat-Enhanced 仓库(根 CA 维护方),说明用途、有效期与联系人。
3. 拿回签发好的证书,写入本仓库的 `certs/awesome-dsc-plugin-eec.crt`,根目录不再有 `eec.pem`。
4. 把 `eec_secret.pem` 的内容放入 GitHub Actions secret `EEC_SECRET_KEY`,不要提交到仓库。
5. 合并后 CI 用根证书校验 `certs/awesome-dsc-plugin-eec.crt` 的签发链,链不通、证书过期、`keyUsage` 或 `basicConstraints` 不符都会中止构建。

根证书私钥属于 DeepSeek-Chat-Enhanced 仓库的离线环境,本仓库与 CI 都拿不到,也不需要。仓库内提交的 `certs/awesome-dsc-plugin-eec.crt` 只含公钥材料,由该根 CA 签发;CI 也支持用 secret `EEC_CERT_PEM` 临时覆盖它,覆盖后同样要先过证书链校验。

## 仓库结构

```text
awesome-dsc-plugin/
├── .github/
│   ├── bundle-layout.README.md         插件树说明:三层目录、必需文件与 meta.json 字段
│   ├── pipeline.README.md              构建流水线说明:证书位置、pages 包结构、清单覆盖范围与异常上报
│   └── workflows/build-and-deploy.yml  仓库级校验、拉取插件、重新签名、组装 pages 包、独立验签、上报异常、发布
├── .gitattributes                      统一 LF 换行
├── .gitignore
├── LICENSE
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
├── certs/                              合集证书,随 pages 包分发,不进任何清单
│   ├── awesome-dsc-plugin-eec.crt      合集终端签名证书(EEC),由根 CA 签发
│   └── awesome-dsc-plugin-secret.pub   与 EEC 私钥配对的公钥材料
├── schemas/                            本仓库全部 JSON Schema
│   ├── README.md                       schema 索引
│   ├── manifest.schema.json            三层清单的 JSON Schema
│   ├── catalog-author.schema.json      author.json 的 JSON Schema
│   ├── catalog-plugin.schema.json      plugin.json 的 JSON Schema
│   ├── catalog-removed.schema.json     removed.json 的 JSON Schema
│   └── catalog-index.schema.json       pages 包 catalog/index.json 的 JSON Schema
├── scripts/                            校验与构建脚本,只读输入、按需产出 dist/pages
│   ├── pki.mjs                         OpenSSL PKI 封装,只调用命令行不做密码学
│   ├── lib/collection-verify.mjs       三层清单与签名的校验逻辑
│   ├── lib/catalog.mjs                 读取 catalog 登记并按 base_url 拉取版本与产物
│   ├── lib/catalog-index.mjs           生成 catalog/index.json 与 catalog/anomalies.json
│   ├── lib/layer-manifests.mjs         按层生成并签名三层清单
│   ├── build-from-catalog.mjs          按 catalog 组装 pages 包,CI 主入口
│   ├── build-collection.mjs            对已构建的合集目录重签或重新生成三层清单
│   ├── verify-catalog.mjs              仓库级校验:catalog/ 与 certs/ 的结构与证书材料
│   ├── verify-collection.mjs           pages 包的结构、清单与签名校验
│   ├── verify-catalog-consistency.mjs  pages 包的收录信息交叉校验
│   ├── verify-bundle.mjs               把上面两条 pages 包校验合成一个入口
│   ├── check-syntax.mjs                全部脚本与站点源码的语法自检
│   └── report-build-anomalies.mjs      把剔除的插件上报到本仓库 Issue,失败不阻塞发布
└── site/                               合集设置与静态展示站点工程,构建产物进入 pages 包根目录
    ├── README.md                       站点说明:数据来源、构建与产物
    ├── build.mjs                       构建脚本,只用 Node 内置模块
    ├── package.json
    ├── meta.json                       合集元数据,含下载计数开关,是 pages 包 meta.json 的来源
    ├── tags.json                       预设标签清单(含 ui-enhance),是 pages 包 tags.json 的来源
    └── src/                            站点源码:index.html 与 assets/
```

仓库根只有 `catalog/`、`certs/`、`schemas/`、`scripts/`、`site/` 五个目录与工程文件;`datalog.json`、`manifest.json`、`manifest.json.sig` 与 `plugins/` 都不入库,它们只在构建出的 pages 包里出现,页面数据、清单与签名一律在 Release 时由 CI 生成。合集设置与站点设置都在 `site/`:合集元数据是 `site/meta.json`,预设标签是 `site/tags.json`,站点工程就是 `site/`。`dist/`、`site/dist/` 与 `temp/` 是纯生成目录,不入库。`scripts/lib/collection-verify.mjs` 与 `scripts/pki.mjs` 的校验语义与 [awesome-dsc-plugin-set-template](https://github.com/omdsc-dev/awesome-dsc-plugin-set-template) 保持一致,修改脚本请先改模板再同步本仓库,避免两个仓库的校验语义分叉。

## 合集元数据

`site/meta.json` 只声明下载计数的开关,构建时原样进入 pages 包根目录:

| 字段 | 本合集取值 | 说明 |
|:---:|:---:|:---:|
| `DOWNLOAD_COUNT_ENABLE` | `false` | 为 `true` 时插件市场每次下载都会向计数接口发送一次不等待回复的 POST 请求,并提示用户该来源启用了计数 |
| `DOWNLOAD_COUNT_API` | 缺省 | 计数接口地址,仅在启用计数时需要 |
| `API_NEED_IP` | `false` | 计数请求是否携带请求来源的公网 IP |

本合集不启用下载计数。

## 收录流程

1. 提交 PR,在 `catalog/` 登记插件:`catalog/<作者>/author.json`、`catalog/<作者>/author_pub.pem`、`catalog/<作者>/<插件>/plugin.json`。字段、schema 与提交校验见 [catalog/README.md](catalog/README.md)。
2. 合并后,CI 在 Release 时按登记逐条拉取:从 `base_url` 取 `versions.json` 以及每个版本的 `meta.json`、`plugin.js` 与可选 `plugin.js.author.sig`,写入 pages 包的 `plugins/` 目录,并用合集 EEC 为每个 `plugin.js` 重新签名。
3. 组装 pages 包:站点产物放根目录,`meta.json` 与 `tags.json` 取自 `site/`,`datalog.json` 与 `catalog/index.json` 由 catalog 生成,`catalog/` 与 `certs/` 复制进来,再按层生成并签名 L1、L2、L3 三层清单。
4. 交叉校验:`scripts/verify-catalog-consistency.mjs` 比对 `catalog/index.json`、`datalog.json`、`plugins/author_manifest.json`、`catalog/` 副本与 `plugins/` 树,任何不一致都以非零退出码中止并列出差异。
5. 发布:CI 先用 `openssl` 独立验签三层清单与每个 `plugin.js`,再检查 pages 包结构,全部通过后整体替换已发布站点,不做版本留存。

构建把两类问题分开处理,边界写在 `scripts/build-from-catalog.mjs` 的实现与 [catalog/README.md](catalog/README.md) 里:

| 类别 | 判定 | 构建行为 |
|:---:|:---:|:---:|
| 登记不合规 | `catalog/` 里的登记文件本身不合法:缺字段、`name` 与目录不符、`tags` 结构不合法或标签不在 `tags.json` 预设清单内 | 登记错误,构建以非零退出码中止,一个插件都不发布,等待作者修正后再发布 |
| 运行期异常 | 作者站点拉取失败(网络、HTTP 4xx/5xx)、远端 `versions.json` 不合法、远端 `meta.json` 与登记不符、`plugin.js` 为空 | 只把该插件从本次发布剔除,其余插件照常构建与发布;剔除项写入 `catalog/anomalies.json` 并上报到仓库 Issue |

签名失败、清单生成失败与分发自检失败既不是某位作者的登记错误,也不是单个插件的运行期问题,仍按构建失败处理。

`datalog.json` 的 `tag` 取自每个插件 `plugin.json` 的 `tags`,`tags` 省略时为空数组。标签取值必须来自 `site/tags.json` 的预设清单;不在清单内的标签会让构建中止,并在报错里指出是哪个插件、哪个标签。

## 如何收录插件

收录登记在 `catalog/` 目录,一位作者一个目录、一个插件一份 `plugin.json`,插件产物不进本仓库。提交一个新增下面这三个文件的 PR 就完成登记,不需要改脚本或 `.github/`:

```text
catalog/<作者>/
├── author.json        作者身份:username 与 profile
├── author_pub.pem     作者公钥,OpenSSL PEM,Ed25519
└── <插件>/
    └── plugin.json    插件登记:name、description、license、repo_link、base_url、可选 tags
```

- `base_url` 指向插件自己发布的站点基址,CI 到该地址拉取该插件的全部版本与产物,用合集 EEC 重新签名后写进 pages 包;Release 不放任何资产,也不从 Release 取。
- 即使不打作者签名,也必须提交 `author_pub.pem`:目录里缺公钥不会被收录。
- 版本不在 `catalog/` 登记,由 CI 从 `base_url` 自动发现:`catalog/<作者>/<插件>/` 下只放 `plugin.json`,不要创建版本目录或占位目录。
- 下架时删除自己的 `catalog/<作者>/` 目录,并在 `catalog/removed.json` 追加一条记录,然后提交 PR。

字段含义、公钥生成命令、收录后的处理与结构 schema 见 [catalog/README.md](catalog/README.md)。

## 插件市场如何消费本合集

市场先读合集元数据与插件目录,再逐层取清单、用根证书把 `certs/awesome-dsc-plugin-eec.crt` 收进信任锚,校验清单签名后再取插件文件与产物签名。下表是本仓库对外承诺的路径契约,市场按 `base_url` 依次取用。

| 步骤 | 路径 | 用途 |
|:---:|:---:|:---:|
| 1 | `<base_url>/meta.json` | 判断该来源是否启用下载计数 |
| 2 | `<base_url>/datalog.json` | 列出全部插件、作者与标签 |
| 3 | `<base_url>/certs/awesome-dsc-plugin-eec.crt` | 取合集终端签名证书,用根证书校验证书链;根目录没有 `eec.pem` |
| 4 | `<base_url>/manifest.json` 与 `manifest.json.sig` | 校验 L1 清单签名与其中记录的 SHA-512 |
| 5 | `<base_url>/plugins/<author>/manifest.json` 与 `manifest.json.sig` | 校验 L2 清单,拿到作者公钥与插件清单 |
| 6 | `<base_url>/plugins/<author>/<plugin>/manifest.json` 与 `manifest.json.sig` | 校验 L3 清单,拿到 `versions.json` 与各版本 `meta.json` 的摘要 |
| 7 | `<base_url>/plugins/<author>/<plugin>/versions.json` | 取版本列表与最新版本号 |
| 8 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/meta.json` | 取插件元数据,与 L3 清单记录的摘要比对 |
| 9 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/plugin.js` 与 `plugin.js.sig` | 取插件运行时脚本,用合集证书验签 |
| 10 | `<base_url>/plugins/<author>/author_pub.pem` 与 `plugin.js.author.sig` | 有作者签名时,取作者公钥与签名 |

任何一项校验失败只提示警告,不阻断插件加载,与「校验语义」一节的弱校验一致。

`catalog/index.json` 是给站点与外部查阅用的汇总索引:作者列表(`username`、`profile`、插件数)与插件列表(作者、名称、描述、许可证、仓库链接、当前版本、标签、版本数)。它由构建按本次实际收录范围生成,不属于分发完整性的一部分,也不进任何清单;市场可以直接读它,也可以继续按上表逐层取用。

## 跨域访问

本合集托管在 GitHub Pages。Pages 对静态资源默认返回 `Access-Control-Allow-Origin: *`,因此分发内容天然可以被跨域读取,托管侧无法把来源收窄到白名单。这是托管平台的既定行为,不是本仓库的配置。

规范要求跨域来源仅开放信任的来源,至少包含 `https://omdsc-dev.github.io`。若把分发内容改放到其他托管,需要自行配置 CORS 白名单,至少放行该来源。

## 本地校验

两条校验针对不同对象,用途也不同。

| 命令 | 校验对象 | 何时运行 |
|:---:|:---:|:---:|
| `pnpm verify:catalog` | `catalog/` 与 `certs/` 的结构、字段、公钥格式、标签取值与合集证书材料 | 提交登记 PR 前,不需要任何构建产物;`pnpm verify` 与它等价 |
| `pnpm verify:bundle` | 构建出的 pages 包:三层清单、清单签名、产物签名与收录信息交叉一致性 | 构建之后、发布之前,需要 `dist/pages` 已存在 |

```bash
pnpm install
pnpm type            # 语法自检:全部脚本与站点源码都能被 Node 解析
pnpm verify:catalog  # 仓库级校验,只读 catalog/ 与 certs/
pnpm build:site      # 构建站点到 site/dist,产物进入 pages 包根目录
pnpm build           # 需要 EEC_SECRET_KEY 与 ROOT_CA_PATH:按 catalog 组装 pages 包到 dist/pages
pnpm verify:bundle --root-ca root_ca.crt   # pages 包校验
```

- 没有根证书时,`pnpm verify:bundle` 仍会校验结构与逐个文件的 SHA-512,只把证书链与签名降级为警告;设置 `ROOT_CA_PATH` 或传 `--root-ca` 才是完整校验。
- `pnpm build` 等价于直接调用 `scripts/build-from-catalog.mjs`,本地复现的完整形式:

  ```bash
  EEC_SECRET_KEY=... ROOT_CA_PATH=root_ca.crt \
    node scripts/build-from-catalog.mjs \
    --catalog catalog --certs certs --site site/dist --out dist/pages \
    --published-base https://omdsc-dev.github.io/awesome-dsc-plugin/
  ```

- 单独跑某一步:`pnpm verify:consistency` 交叉校验 `dist/pages` 的收录信息;`node scripts/report-build-anomalies.mjs --dry-run` 只打印上报请求体,不发真实请求,补报时去掉 `--dry-run` 并设置 `GITHUB_TOKEN`。
- 本机需要 OpenSSL 3.0 及以上,脚本只调用 `openssl` 命令行,不实现任何密码学运算。

## 安全提示

- 签名不通过时插件市场会警告用户并建议重新下载,不会静默运行。
- 收录不等于认证。签名只证明分发内容与签名者一致,不代表插件行为经过审查。
- 私钥只放 CI secrets 与本地环境变量,不要提交。EEC 私钥放在 `EEC_SECRET_KEY`,根证书私钥永远不进本仓库。`.gitignore` 已排除 `.env`。
- 更换 EEC 密钥对必须同时换 `certs/awesome-dsc-plugin-eec.crt` 并向 DeepSeek-Chat-Enhanced 仓库重新申请签发;旧证书签出的 CMS 签名将无法再验证。
- 清单签名与产物签名覆盖文件字节。换行、缩进或空白的任何改动都会让校验失败,仓库统一使用 LF,作者产物也必须是 LF。
- 插件产物建议行压缩,既减小体积,也避免无意义的空白差异。

## 许可

Apache License 2.0,见 [LICENSE](LICENSE)。
