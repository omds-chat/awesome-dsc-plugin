# awesome-dsc-plugin

dsc 的社区插件合集。插件在这里按分发规范 v2 收录、签名并分发,插件市场读取本合集的三层哈希清单、终端签名证书与签名来取用插件。

[English](README.en-US.md)

## 定位与收录范围

本合集面向 dsc 的运行时插件,由 omdsc-dev 维护。本仓库是 omdsc-dev 的终端签名方(EEC),持有由 DeepSeek-Chat-Enhanced 仓库的根证书机构签发的终端签名证书,并用它为三层清单与每个版本的插件产物生成 CMS 分离签名。

收录条件:

- 插件产物是单个浏览器 ESM 脚本,导出 `activate(context)`,不依赖 Node 内置模块与后端接口。
- 提供可构建的源码仓库或可访问的产物地址,且能通过 `pnpm build` 复核。
- 插件运行时元数据 `meta.json` 字段完整,插件名符合 `dsc-xxx` 或 `@scope/dsc-xxx`。

不收录需要后端服务、需要原生模块、或无法在 CI 中重建产物的插件。

收录不等于认证。本合集只保证分发内容与签名一致,不审查插件行为。

## 分发结构

分发内容是三层哈希清单。每层一份 `manifest.json` 与一份 `manifest.json.sig`,清单记录本层文件的 SHA-512,签名由根 CA 签发的终端签名证书(EEC)生成。层与层之间互不引用,任何一层都可以单独发布、单独校验、单独重签。

```text
<collection>/
├── eec.pem                    # 终端签名证书,随 Pages 分发,不进任何清单
├── meta.json                  # L1
├── datalog.json               # L1
├── tags.json                  # L1
├── manifest.json              # L1 清单
├── manifest.json.sig          # L1 清单签名
└── plugins/
    ├── author_manifest.json   # L1
    └── <author>/
        ├── author_pub.pem         # L2,作者公钥,OpenSSL PEM,Ed25519
        ├── plugin_manifest.json   # L2
        ├── manifest.json          # L2 清单
        ├── manifest.json.sig      # L2 清单签名
        └── <plugin>/
            ├── versions.json      # L3
            ├── manifest.json      # L3 清单
            ├── manifest.json.sig  # L3 清单签名
            └── <x.y.z>/
                ├── meta.json          # L3
                ├── plugin.js
                ├── plugin.js.sig        # 合集 CMS 签名,覆盖产物本体
                └── plugin.js.author.sig # 作者裸公钥签名,可选
```

| 层 | 位置 | 覆盖的文件(相对该层目录) |
|:---:|:---:|:---:|
| L1 | 合集根 | `meta.json`、`datalog.json`、`plugins/author_manifest.json` 必需,`tags.json` 存在时覆盖 |
| L2 | `plugins/<作者>/` | `author_pub.pem`、`plugin_manifest.json`,文件存在才覆盖 |
| L3 | `plugins/<作者>/<插件>/` | `versions.json`、各版本目录下的 `meta.json` |

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
- `revision` 是每层独立的正整数:该层文件集合或内容变化时加一,不变时沿用旧值,没有旧清单时从 1 开始。
- L3 不覆盖 `plugin.js` 与 `plugin.js.sig`:产物本体由每个版本的 `plugin.js.sig` 独立签名,清单只描述元数据。
- `tags.json` 可选:存在就必须被 L1 清单覆盖,不存在则不报错、也不进清单。
- `meta.json.sig` 与 `meta.json.author.sig` 已取消:版本目录里的合集签名只剩 `plugin.js.sig`,`plugin.js.author.sig` 可选保留。`meta.json` 由 L3 清单覆盖并由合集 EEC 绑定,作者公钥本身由 L2 覆盖。`dsc-plugin-template` 仓库仍在产出 `meta.json.author.sig`,待同步。

三层之间不做收束:L1 不引用 L2,L2 不引用 L3,任何一层都可以单独发布、单独校验、单独重签。取舍是放弃「一次校验拿到全树摘要」,换取按插件增量更新:改一个插件只需 L3 的 `revision` 加一,L2 与 L1 的 `revision` 不变,客户端也只重新拉取这一层的清单与签名。若把三层收束成一份根清单,任何插件发版都会改动根清单,所有客户端都得重拉整份摘要。

三层 `manifest.json` 与 `manifest.json.sig` 必须随源码提交入库。`revision` 从该层上一份清单读出,不提交就会在每次全新 checkout 时退回 1,跨 CI 的 `revision` 沿用随之失效;清单与签名本身就是分发内容,缺失时 `pnpm build` 会把它们补出来,但补不出正确的历史 `revision`。

## 必需文件

| 位置 | 必需 | 可选 |
|:---:|:---:|:---:|
| 合集根 | `eec.pem`、`meta.json`、`datalog.json`、`plugins/author_manifest.json`、`manifest.json`、`manifest.json.sig` | `tags.json` |
| `plugins/<作者>/` | `plugin_manifest.json`、`manifest.json`、`manifest.json.sig` | `author_pub.pem` |
| `plugins/<作者>/<插件>/` | `versions.json`、`manifest.json`、`manifest.json.sig` | 无 |
| `plugins/<作者>/<插件>/<x.y.z>/` | `meta.json`、`plugin.js`、`plugin.js.sig` | `plugin.js.author.sig` |

目录命名、`versions.json` 结构与 `meta.json` 字段见 [plugins/README.md](plugins/README.md)。`eec.pem` 只证明签名者身份,不进任何清单;根证书不进分发内容,由 online-data 分支分发,网页用内嵌的根证书指纹核对。

## 签名与校验

### 三个角色

签名体系基于 OpenSSL PKI,由三个角色各持一把密钥,谁签发什么一目了然。

| 角色 | 承担者 | 持有物 | 签发对象 |
|:---:|:---:|:---:|:---:|
| 根证书机构(CA) | `DeepSeek-Chat-Enhanced` 仓库(组织主线仓库) | 根私钥(离线,不入库)、根证书 | 终端签名证书 `eec.pem` |
| 终端签名方(EEC) | 本仓库 | EEC 私钥(CI secret `EEC_SECRET_KEY`)、`eec.pem` | 三层清单与每个版本的 `plugin.js` 的 CMS 分离签名 |
| 独立签名方 | 插件作者,含 omdsc-dev 自身 | 作者密钥对 | `plugin.js` 的裸公钥分离签名 |

### 证书链

信任从根证书开始,一路收到清单与插件文件的字节。

```text
DeepSeek-Chat-Enhanced 仓库(根 CA,离线)
  root_ca.crt
      │  签发
      ▼
  本仓库 eec.pem(终端签名证书 EEC)
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
openssl cms -sign -binary -md sha512 -outform DER -in manifest.json -out manifest.json.sig -signer eec.pem -inkey eec_secret.pem -nocerts -noattr
openssl cms -verify -binary -md sha512 -inform DER -in manifest.json.sig -content manifest.json -CAfile root_ca.crt -certfile eec.pem
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

`pnpm verify` 逐项检查,任一错误都以非零退出码结束并一次性列出全部问题,每条都带层号与文件路径。

| 编号 | 规则 |
|:---:|:---:|
| 1 | 根目录 `eec.pem` 存在,由给定根证书签发(`--root-ca` 或 `ROOT_CA_PATH`),未过期,`keyUsage` 含 `digitalSignature`,`basicConstraints` 非 CA |
| 2 | `datalog.json` 中的每个插件都在 `plugins/<author>/plugin_manifest.json` 中出现,且插件目录存在 |
| 3 | 每个插件目录有 `versions.json`,`latest` 必须在 `versions` 列表内 |
| 4 | 每个版本目录有 `meta.json`、`plugin.js`、`plugin.js.sig`,并用 `openssl cms -verify -binary -md sha512 -inform DER -CAfile <根证书> -certfile eec.pem` 验签,失败即报错 |
| 5 | 若版本目录存在 `plugin.js.author.sig`,则 `plugins/<author>/author_pub.pem` 必须存在,并用 `openssl pkeyutl -verify` 验证,失败即报错;其它 `*.author.sig` 不参与校验 |
| 6 | `tags.json` 存在时,`datalog.json` 的 `tag` 必须取自其中 |
| 7 | 三层清单存在且结构合法:`schemaVersion` 为 1,`revision` 为正整数,`files` 为非空数组,条目只含 `path` 与 `sha512` |
| 8 | 清单条目的 `path` 合法:正斜杠、相对路径、不含 `..`、不指向清单自身、不重复 |
| 9 | 覆盖范围与该层应有的文件严格相等:该有的都在清单里,清单里没有多余项,L3 不得出现 `plugin.js` 与 `plugin.js.sig` |
| 10 | 清单记录的每个 SHA-512 与文件实际内容一致,不一致时报出层号与具体文件 |
| 11 | 每层 `manifest.json.sig` 用根证书与 `eec.pem` 验签,失败即报错 |

### 校验语义

- 本仓库发布前的校验是强校验:`pnpm build` 与 CI 的每一步遇到错误都以非零退出码中止,不合规的内容不会被分发。`pnpm verify` 默认带 `--allow-placeholder-eec`,用于空合集与本地开发:根证书缺失、`eec.pem` 未由根 CA 签发、三层清单或清单签名尚未生成时降级为警告;`--allow-missing-manifest` 只放开清单与清单签名缺失,结构与哈希检查照常执行。
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
3. 拿回签发好的证书,覆盖本仓库根目录的 `eec.pem`。
4. 把 `eec_secret.pem` 的内容放入 GitHub Actions secret `EEC_SECRET_KEY`,不要提交到仓库。
5. 合并后 CI 用根证书校验 `eec.pem` 的签发链,链不通、证书过期、`keyUsage` 或 `basicConstraints` 不符都会中止构建。

根证书私钥属于 DeepSeek-Chat-Enhanced 仓库的离线环境,本仓库与 CI 都拿不到,也不需要。仓库内提交的 `eec.pem` 是占位证书:不是由根 CA 签发,不能用于任何真实签名,正式分发前必须覆盖。

## 仓库结构

```text
awesome-dsc-plugin/
├── .github/
│   ├── plugins-sources.json            收录来源清单,改这里就是改收录结果
│   ├── plugins-sources.README.md       清单字段说明
│   └── workflows/build-and-deploy.yml  收录、校验证书链、签名三层清单、自检、发布
├── .gitattributes                      统一 LF 换行
├── .gitignore
├── LICENSE
├── README.md
├── README.en-US.md
├── eec.pem                             终端签名证书,由 DeepSeek-Chat-Enhanced 仓库的根 CA 签发后覆盖
├── meta.json                           合集元数据,含下载计数开关
├── datalog.json                        插件目录数组,每项一个插件(plugin_name、author、tag)
├── tags.json                           预设标签
├── manifest.json                       L1 清单,随源码入库
├── manifest.json.sig                   L1 清单签名,随源码入库
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── catalog/                            收录登记:作者身份、公钥与插件站点
│   ├── README.md                       作者登记说明
│   └── <作者>/                           一位作者一个目录,目录名即 username
│       ├── author.json                 作者身份
│       ├── author_pub.pem              作者公钥,Ed25519,OpenSSL PEM
│       └── <插件>/                       一个插件一个目录
│           └── plugin.json             插件登记,含 base_url
├── schemas/                            本仓库全部 JSON Schema
│   ├── README.md                       schema 索引
│   ├── manifest.schema.json            三层清单的 JSON Schema
│   ├── catalog-author.schema.json      author.json 的 JSON Schema
│   └── catalog-plugin.schema.json      plugin.json 的 JSON Schema
├── plugins/
│   ├── author_manifest.json            登记的作者清单
│   ├── manifest.json                   L2 清单由脚本按作者目录生成
│   └── <author>/
│       ├── author_pub.pem              该作者的 Ed25519 公钥
│       ├── plugin_manifest.json        该作者的插件清单
│       ├── manifest.json               L2 清单
│       ├── manifest.json.sig           L2 清单签名
│       └── <plugin>/
│           ├── versions.json           版本列表
│           ├── manifest.json           L3 清单
│           ├── manifest.json.sig       L3 清单签名
│           └── <x.y.z>/
│               ├── meta.json           插件运行时元数据
│               ├── plugin.js           插件运行时脚本
│               ├── plugin.js.sig       合集 CMS 签名
│               └── plugin.js.author.sig  作者裸公钥签名(可选)
└── scripts/
    ├── pki.mjs                         OpenSSL PKI 封装,只调用命令行不做密码学
    ├── lib/collection-verify.mjs       两个脚本共用的校验逻辑
    ├── build-collection.mjs            生成并签名三层清单、校验并产出 dist/
    ├── verify-collection.mjs           只读自洽性校验
    └── import-plugins.mjs              按来源清单构建并收录插件
```

`scripts/` 下的脚本与 [awesome-dsc-plugin-set-template](https://github.com/omdsc-dev/awesome-dsc-plugin-set-template) 保持逐字节一致,修改脚本请先改模板再同步本仓库,避免两个仓库的校验语义分叉。`dist/` 与 `temp/` 是生成目录,不入库:前者由 `pnpm build` 产出,后者是收录时的临时工作区。

## 合集元数据

根目录 `meta.json` 只声明下载计数的开关:

| 字段 | 本合集取值 | 说明 |
|:---:|:---:|:---:|
| `DOWNLOAD_COUNT_ENABLE` | `false` | 为 `true` 时插件市场每次下载都会向计数接口发送一次不等待回复的 POST 请求,并提示用户该来源启用了计数 |
| `DOWNLOAD_COUNT_API` | 缺省 | 计数接口地址,仅在启用计数时需要 |
| `API_NEED_IP` | `false` | 计数请求是否携带请求来源的公网 IP |

本合集不启用下载计数。

## 收录流程

1. 提交 PR 修改 `.github/plugins-sources.json`,每个插件一项,写明 `repo`、`author` 与 `plugin`,可选 `ref` 与 `profile`。字段见 [plugins-sources.README.md](.github/plugins-sources.README.md)。
2. 合并后 CI 按来源清单收录:取得源码、执行 `pnpm install --frozen-lockfile` 与 `pnpm build`,把产物与作者签名写入 `plugins/<author>/<plugin>/<version>/`,再更新该插件的 `versions.json`、该作者的 `plugin_manifest.json` 与根目录 `datalog.json`。逐文件映射见 [plugins-sources.README.md](.github/plugins-sources.README.md)。
3. 人工补充标签。新条目在 `datalog.json` 里的 `tag` 初始为空数组,需要从 `tags.json` 的预设标签中挑选后提交。未在 `tags.json` 中声明的标签会被校验拒绝。
4. 合并并分发。CI 解析根证书、用 `openssl verify` 校验 `eec.pem` 链、用 `EEC_SECRET_KEY` 为每个版本的 `plugin.js` 签名并生成三层清单与清单签名、对 `dist/` 再校验一遍并用根证书自检三层清单签名,然后把 `plugins/`、`datalog.json` 与各层 `manifest.json`、`manifest.json.sig` 的变更提交回仓库,同时把 `dist/` 发布到 Pages。

收录环节任何一步失败只跳过该插件并在日志里写明原因,其余插件照常处理。签名与校验环节失败则整个构建中止。

## 如何收录插件

收录登记在 `catalog/` 目录,一位作者一个目录、一个插件一份 `plugin.json`,插件产物不进本仓库。提交一个新增下面这三个文件的 PR 就完成登记,不需要改脚本或 `.github/`:

```text
catalog/<作者>/
├── author.json        作者身份:username 与 profile
├── author_pub.pem     作者公钥,OpenSSL PEM,Ed25519
└── <插件>/
    └── plugin.json    插件登记:name、description、license、repo_link、base_url
```

- `base_url` 指向插件自己发布的站点基址,CI 到该地址拉取该插件的全部版本与产物,用合集 EEC 重新签名后写进 pages 包;Release 不放任何资产,也不从 Release 取。
- 版本不在 `catalog/` 登记,由 CI 从 `base_url` 自动发现,`catalog/<作者>/<插件>/<版本>/` 只是占位层级。
- 下架时删除自己的 `catalog/<作者>/` 目录并提交 PR。

字段含义、公钥生成命令、收录后的处理与结构 schema 见 [catalog/README.md](catalog/README.md)。

## 插件市场如何消费本合集

市场先读合集元数据与插件目录,再逐层取清单、用根证书把 `eec.pem` 收进信任锚,校验清单签名后再取插件文件与产物签名。下表是本仓库对外承诺的路径契约,市场按 `base_url` 依次取用。

| 步骤 | 路径 | 用途 |
|:---:|:---:|:---:|
| 1 | `<base_url>/meta.json` | 判断该来源是否启用下载计数 |
| 2 | `<base_url>/datalog.json` | 列出全部插件、作者与标签 |
| 3 | `<base_url>/eec.pem` | 取终端签名证书,用根证书校验证书链 |
| 4 | `<base_url>/manifest.json` 与 `manifest.json.sig` | 校验 L1 清单签名与其中记录的 SHA-512 |
| 5 | `<base_url>/plugins/<author>/manifest.json` 与 `manifest.json.sig` | 校验 L2 清单,拿到作者公钥与插件清单 |
| 6 | `<base_url>/plugins/<author>/<plugin>/manifest.json` 与 `manifest.json.sig` | 校验 L3 清单,拿到 `versions.json` 与各版本 `meta.json` 的摘要 |
| 7 | `<base_url>/plugins/<author>/<plugin>/versions.json` | 取版本列表与最新版本号 |
| 8 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/meta.json` | 取插件元数据,与 L3 清单记录的摘要比对 |
| 9 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/plugin.js` 与 `plugin.js.sig` | 取插件运行时脚本,用 `eec.pem` 验签 |
| 10 | `<base_url>/plugins/<author>/author_pub.pem` 与 `plugin.js.author.sig` | 有作者签名时,取作者公钥与签名 |

任何一项校验失败只提示警告,不阻断插件加载,与「校验语义」一节的弱校验一致。

## 跨域访问

本合集托管在 GitHub Pages。Pages 对静态资源默认返回 `Access-Control-Allow-Origin: *`,因此分发内容天然可以被跨域读取,托管侧无法把来源收窄到白名单。这是托管平台的既定行为,不是本仓库的配置。

规范要求跨域来源仅开放信任的来源,至少包含 `https://omdsc-dev.github.io`。若把分发内容改放到其他托管,需要自行配置 CORS 白名单,至少放行该来源。

## 本地校验

```bash
pnpm install
pnpm verify        # 只读自洽性校验,无根证书时证书链、清单与签名降级为警告
pnpm build         # 校验通过后生成三层清单与 dist/,并写入 build-info.json 作为分发索引
pnpm run import    # 按来源清单收录插件
```

- `pnpm verify` 与 `pnpm build` 在合集尚无可用证书链时按骨架模式放行并警告,适合空合集与本地开发。拿到根证书后可做严格校验:

  ```bash
  pnpm verify:strict --root-ca root_ca.crt
  ROOT_CA_PATH=root_ca.crt pnpm verify:strict
  ```

- `pnpm build` 不带 `--sign` 时只生成清单、不生成签名:清单内容一旦变化,脚本会删除该层失效的旧 `manifest.json.sig`,避免分发一份必然验不过的清单。需要签名时用 `pnpm sign`,它读取 `EEC_SECRET_KEY`,为每个版本的 `plugin.js` 与三层清单签名,并先确认私钥与 `eec.pem` 配对;签名后的校验需要根证书,用 `ROOT_CA_PATH=root_ca.crt pnpm sign`,或直接调用脚本并加 `--root-ca`。
- 收录请用 `pnpm run import`。`pnpm import` 是 pnpm 自带命令,不是本仓库的收录脚本。
- 本机需要 OpenSSL 3.0 及以上,脚本只调用 `openssl` 命令行,不实现任何密码学运算。

## 安全提示

- 签名不通过时插件市场会警告用户并建议重新下载,不会静默运行。
- 收录不等于认证。签名只证明分发内容与签名者一致,不代表插件行为经过审查。
- 私钥只放 CI secrets 与本地环境变量,不要提交。EEC 私钥放在 `EEC_SECRET_KEY`,根证书私钥永远不进本仓库。`.gitignore` 已排除 `.env`。
- 更换 EEC 密钥对必须同时换 `eec.pem` 并向 DeepSeek-Chat-Enhanced 仓库重新申请签发;旧证书签出的 CMS 签名将无法再验证。
- 清单签名与产物签名覆盖文件字节。换行、缩进或空白的任何改动都会让校验失败,仓库统一使用 LF,作者产物也必须是 LF。
- 插件产物建议行压缩,既减小体积,也避免无意义的空白差异。

## 许可

Apache License 2.0,见 [LICENSE](LICENSE)。
