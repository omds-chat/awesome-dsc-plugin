# 签名体系设计:OpenSSL PKI 与 CMS 分离签名

> 本文说明本合集的签名约定与证书链设计:谁签名、签什么、用什么命令签、作者自签名如何并存、EEC 如何申请与更换。
> 事实以 `scripts/pki.mjs` 与 `scripts/lib/collection-verify.mjs` 为准;逐文件的签名归属见 [pages-artifacts.md](pages-artifacts.md),校验命令与 pages 包校验规则见 [../maintenance.md](../maintenance.md),作者公钥的登记入口见 [../../catalog/README.md](../../catalog/README.md)。
> 本文不涉及证书材料的生成、签发、续签或替换操作本身。

## 一、三个角色

签名体系基于 OpenSSL PKI,由三个角色各持一把密钥,谁签发什么一目了然。

| 角色 | 承担者 | 持有物 | 签发对象 |
|:---:|:---:|:---:|:---:|
| 根证书机构(CA) | `DeepSeek-Chat-Enhanced` 仓库(组织主线仓库) | 根私钥(离线,不入库)、根证书 | 终端签名证书 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` |
| 终端签名方(EEC) | 本仓库 | EEC 私钥(CI secret `AWESOME_DSC_PLUGIN_EEC_SECRET`)、`certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` | 三层清单与每个版本的 `plugin.js` 的 CMS 分离签名 |
| 独立签名方 | 插件作者,含 omds-chat 自身 | 作者密钥对 | `plugin.js` 的裸公钥分离签名 |

## 二、证书链

信任从根证书开始,一路收到清单与插件文件的字节。

```text
DeepSeek-Chat-Enhanced 仓库(根 CA,离线)
  root_ca.crt
      │  签发
      ▼
  本仓库 certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt(终端签名证书 EEC)
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
| 作者签名 | 裸公钥分离签名,`openssl pkeyutl -sign -rawin`,作者密钥为 Ed25519;验签失败只警告,不阻断收录 |

两条曲线都是硬约束,不是偏好:换成 Ed25519 会让证书链校验或 CMS 验签在目标浏览器与 OpenSSL 上直接失败。

## 三、签什么

| 签名 | 覆盖对象 | 产物 |
|:---:|:---:|:---:|
| 合集 CMS 签名 | L1、L2、L3 各一份清单 | `manifest.json.sig`,每层一份 |
| 合集 CMS 签名 | 每个版本的 `plugin.js` | `plugin.js.sig` |
| 作者裸公钥签名 | `plugin.js`,可选 | `plugin.js.author.sig` |

`meta.json` 不再单独签名,由 L3 清单的 SHA-512 覆盖;作者公钥由 L2 清单覆盖。逐文件的签名归属见 [pages-artifacts.md](pages-artifacts.md)。

## 四、命令

合集签名与验签,三层清单与 `plugin.js` 用同一条命令,只是文件名不同:

```bash
openssl cms -sign -binary -md sha512 -outform DER -in manifest.json -out manifest.json.sig -signer certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt -inkey eec_secret.pem -nocerts -noattr
openssl cms -verify -binary -md sha512 -inform DER -in manifest.json.sig -content manifest.json -CAfile root_ca.crt -certfile certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt
```

`-md sha512` 固定摘要算法,不依赖 OpenSSL 的默认值;`-outform DER` 不可省略。默认输出是 S/MIME `multipart/signed` 包装,浏览器无法解析,而插件市场要在浏览器里验签,所以 DER 是跨仓库统一格式:签名方固定 `-outform DER`,验签方固定 `-inform DER`,任何一方改用默认格式都会验签失败。产物可用 `openssl asn1parse -inform DER -in manifest.json.sig` 确认为 DER。

启用吊销检查时,把根证书与 CRL 拼进同一个 `-CAfile` 再追加 `-crl_check`:`cat root_ca.crt crl.pem > ca_with_crl.pem`。OpenSSL 3.5 的 `cms` 子命令没有 `-CRLfile` 选项,CRL 只能随 `-CAfile` 一起传入。

## 五、作者自签名

插件作者是独立签名方,不经本仓库,也不依赖证书链。作者用裸公钥分离签名给插件产物签名,本仓库只负责把产物与公钥原样收录:

- 作者公钥随产物提供,收录为 `plugins/<author>/author_pub.pem`(Ed25519,OpenSSL PEM),由 L2 清单覆盖;公钥生成命令与登记要求见 [../../catalog/README.md](../../catalog/README.md)。
- 作者构建产出的 `plugin.js.sig` 收录为 `plugin.js.author.sig`,与合集的 CMS 签名 `plugin.js.sig` 并存,文件名区分签名者。
- 作者对 `meta.json` 的签名不再收录:`meta.json` 由 L3 清单覆盖并由合集 EEC 绑定。

作者签名是可选项。作者不签名时,该版本只有本仓库的 EEC 签名。

作者签名从不阻断收录:验签失败、公钥与签名两侧不齐,都只在报告与日志里警告。理由是作者层只是附加证据——合集已经在登记侧审核过作者与插件,依据是 `catalog/` 的 PR 审核与仓库级校验;作者签名回答的是「作者是否签过这一份」,不改变收录结论。既然它不参与收录判定,就没有理由用它把已经审核过的内容拦下来。

公钥与签名两侧缺一不可:只有 `plugin.js.author.sig` 没有 `author_pub.pem`,或只有 `author_pub.pem` 没有 `plugin.js.author.sig`,都判为「未校验」,不计为通过。前者是有签名但无公钥,验不了;后者是有公钥但无签名,没得验。两种情形都没有可用证据,不能把「没验过」写成「验过了」。

## 六、如何申请 EEC

EEC 证书由 DeepSeek-Chat-Enhanced 仓库的根证书机构签发,本仓库不能自签,也不能为其他合集签发。

1. 本地生成 EEC 私钥与证书签名请求(CSR),`CN` 取合集名:

   ```bash
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out eec_secret.pem
   openssl req -new -key eec_secret.pem -out eec.csr -subj '/O=omds-chat/CN=awesome-dsc-plugin'
   ```

2. 把 `eec.csr` 提交给 DeepSeek-Chat-Enhanced 仓库(根 CA 维护方),说明用途、有效期与联系人。
3. 拿回签发好的证书,写入本仓库的 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt`,根目录不再有 `eec.pem`。
4. 把 `eec_secret.pem` 的内容放入 GitHub Actions secret `AWESOME_DSC_PLUGIN_EEC_SECRET`,不要提交到仓库。
5. 合并后 CI 用根证书校验 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` 的签发链,链不通、证书过期、`keyUsage` 或 `basicConstraints` 不符都会中止构建。

根证书私钥属于 DeepSeek-Chat-Enhanced 仓库的离线环境,本仓库与 CI 都拿不到,也不需要。仓库内提交的 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` 只含公钥材料,由该根 CA 签发;CI 也支持用 secret `AWESOME_DSC_PLUGIN_EEC` 临时覆盖它,覆盖后同样要先过证书链校验。

## 七、私钥管理

- 私钥只放 CI secrets 与本地环境变量,不要提交。EEC 私钥放在 secret `AWESOME_DSC_PLUGIN_EEC_SECRET`,根证书私钥永远不进本仓库;仓库根 `.gitignore` 已排除 `.env`。
- 更换 EEC 密钥对必须同时更换 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt`,并向 DeepSeek-Chat-Enhanced 仓库重新申请签发;旧证书签出的 CMS 签名将无法再验证。
- 签名覆盖文件原始字节,换行、缩进或空白的任何改动都会让校验失败:仓库统一使用 LF,作者产物也必须是 LF(见 [.github/bundle-layout.README.md](../../.github/bundle-layout.README.md))。
