# 插件树(本仓增量)

本文只写本仓相对权威出处的增量,布局条文以权威文为准。权威文是模板仓 `dsc-plugin-set-template` 的 `template/plugins/README.md`(位于组织工作区):作者、插件、版本三层目录的命名与每层必需文件、作者名规则、插件名规则、清单格式与空基线约定,都以该文为准,本文不再重复;增量与权威文冲突时以权威文为准。

`plugins/` 是构建产物:仓库根没有这个目录,分发包每次 Release 全量重建,本仓库只保留这份说明。三层的目录名、必需文件与清单签名者都见权威文,本文不重复。

## 作者目录(增量)

- 作者目录名允许大小写字母;判定两个作者名是否同一名称时大小写不敏感:仅大小写不同的两个目录视为同名,收录与校验都按重复处理。构建与仓库级校验对这种重复报 `AUTHOR_NAME_COLLISION`,要求只保留一个目录后重新提交。
- 作者公钥由插件作者提供,登记在本仓 `catalog/<作者>/author_pub.pem`,构建时复制到 pages 包的 `plugins/<作者>/author_pub.pem`;不要在合集里手工生成。缺失时校验只给警告,该作者带 `plugin.js.author.sig` 的版本判为未校验。
- 作者层只是附加证据:合集已在登记侧审核过作者与插件,作者签名从不阻断收录,验签失败也只警告。公钥与签名两侧缺一不可,只有一侧不算通过。

## 版本目录(增量)

`meta.json` 由 L3 清单覆盖、不接受单独签名,这一条权威文已约定;本仓增量是它的字段表:

| 字段 | 类型 | 说明 |
|:---:|:---:|:---:|
| `name` | string | 插件名,与 `plugins.json` 的 `plugin_name` 一致 |
| `version` | string | 三段语义化版本号,与目录名一致 |
| `license` | string | SPDX 标识符,例如 MIT |
| `description` | object | 至少包含 `zh-CN` 或 `en-US` 之一 |
| `author` | string | 作者名 |
| `repo_link` | string | 源码仓库链接 |
| `dependencies` | object | 仅允许 `dsc` 一个键,值为 semver range |

挂载点 `mounts` 不在 `meta.json` 里:它是插件导出清单(manifest)的字段,值为挂载点名字数组、不得重复,当前只有 `session:changed`;本仓库只分发产物,不读取也不校验该字段。

校验脚本强制 `name` 与 `version` 分别与 `plugins.json`、目录名一致;其余字段由分发规范 v2 要求,市场展示插件时读取。

`meta.json.sig` 与 `meta.json.author.sig` 已取消:版本目录里的合集签名只剩 `plugin.js.sig`。`meta.json` 由 L3 清单覆盖并由合集 EEC 绑定,作者公钥本身由 L2 覆盖;若作者沿用 `dsc-plugin-template` 的产物,该模板会一并产出 `meta.json.author.sig`,本仓库不收录这个文件。

`plugin.js.sig` 由本仓 CI 的 `scripts/build-from-catalog.mjs` 按 catalog 拉取后对 `plugin.js` 原始字节重新生成;CMS 签名与作者签名都是对文件原始字节的签名,不做换行规范化,任何一字节差异(包括 LF 与 CRLF 的差别)都会让校验失败。

## 证书与 certs 目录(增量)

- 合集证书的固定位置是 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt`,配对公钥是 `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec-secret.pub`;pages 根目录不放 `eec.pem`。
- `certs/` 下只放来源文件夹:文件夹名即来源 id,证书与公钥都在 `certs/<来源 id>/<文件名>` 下,文件名以 `<来源 id>-` 开头。

## 清单 revision 的读回(增量)

每层清单的格式见 `schemas/manifest.schema.json`,覆盖范围与空基线约定以权威文为准。本仓增量是 `revision` 的读回与写回:上一份值按层从 `ci-memory` 分支的 `layer-manifests/` 读回,分支里没有该层时才回退到已发布站点的同名 `manifest.json`,仍取不到时从 1 开始;本次清单在 pages 包上传成功后写回并推送该分支,写回失败即中止发布;清单内容与分支一致时不产生提交,仅 .sig 重签字节不同不算变更,保留旧签名。pages 包内的清单与签名由构建生成,不提交到仓库。
