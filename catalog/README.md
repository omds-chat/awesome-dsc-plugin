# 收录登记

本目录是本合集唯一的收录入口。作者在这里登记身份、公钥与插件发布站点;插件产物不进本仓库,CI 按 `base_url` 到作者自己的站点取。

## 目录结构

```text
catalog/
├── README.md
└── <作者>/
    ├── author.json          作者身份
    ├── author_pub.pem       作者公钥,OpenSSL PEM
    └── <插件>/
        ├── plugin.json      插件登记
        └── <版本>/          占位,当前不用于登记
```

- `<作者>` 是目录名,必须与 `author.json` 的 `username` 逐字符一致,也是分发站点里 `plugins/<作者>/` 的目录名。
- `<插件>` 是目录名,建议与 `plugin.json` 的 `name` 保持一致。
- 目录与文件名固定,大小写敏感,不要改名。
- 顶层出现 `I_AM_AN_AUTHOR` 这样的目录是占位层级,不是真实登记,不要照抄。

## author.json

每位作者一份,只描述作者本人,不描述插件。

| 字段 | 类型 | 说明 |
|:---:|:---:|:---:|
| `username` | string | 必填,非空。作者用户名,与所在目录名一致,也是分发站点里 `plugins/<作者>/` 的目录名 |
| `profile` | string | 必填,非空。作者主页的完整绝对地址,例如 `https://github.com/omdsc-dev`,插件市场用它链接回作者 |

```json
{
  "username": "omdsc-dev",
  "profile": "https://github.com/omdsc-dev"
}
```

多写字段会被拒绝,结构以 [catalog-author.schema.json](../schemas/catalog-author.schema.json) 为准。

## author_pub.pem

作者公钥,PEM 格式,与 `author.json` 同目录,文件名固定为 `author_pub.pem`。

- 密钥对由作者自己生成,私钥自己保管,不进本仓库;只提交公钥。
- 用 OpenSSL 生成:

```bash
openssl genpkey -algorithm Ed25519 -out author_secret.pem
openssl pkey -in author_secret.pem -pubout -out author_pub.pem
```

- 公钥用于校验作者自签名 `plugin.js.author.sig`。即使不打作者签名也要提交公钥,目录里缺公钥不会被收录。
- 公钥由 L2 清单覆盖,分发时原样复制到 `plugins/<作者>/author_pub.pem`。

## plugin.json

一个插件一份,放在 `catalog/<作者>/<插件>/` 下。

| 字段 | 类型 | 说明 |
|:---:|:---:|:---:|
| `name` | string | 必填,非空。插件名,建议符合 `dsc-xxx` 或 `@scope/dsc-xxx`,并与版本目录里的 `meta.json` 一致 |
| `description` | string | 必填,非空。一句话说明插件做什么,用于市场列表展示 |
| `license` | string | 必填,非空。插件许可证,建议写 SPDX 标识,例如 `Apache-2.0` |
| `repo_link` | string | 必填,非空。插件源码仓库地址,写完整绝对地址 |
| `base_url` | string | 必填,非空。插件自己发布的站点基址,`http` 或 `https` 开头的绝对地址,必须以斜杠结尾 |

```json
{
  "name": "dsc-plugin-gallery",
  "description": "把对话里的图片整理成画廊视图。",
  "license": "Apache-2.0",
  "repo_link": "https://github.com/omdsc-dev/dsc-plugin-gallery",
  "base_url": "https://omdsc-dev.github.io/dsc-plugin-gallery/"
}
```

- 五个字段全部必填,多写字段会被拒绝,结构以 [catalog-plugin.schema.json](../schemas/catalog-plugin.schema.json) 为准。
- `base_url` 只写站点根,不写具体文件,不带查询串或锚点;少写结尾斜杠会被拒绝。

## base_url 指向什么

`base_url` 是插件自己发布的站点基址,该站点托管作者自己的 Pages,按本合集 pages 包的路径约定发布插件产物。CI 只认这个地址:

- 不从 GitHub Release 取任何东西,Release 不放资产。
- 站点必须公开可访问,静态资源可跨域读取。
- 站点上每个版本目录需要 `meta.json` 与 `plugin.js`;作者自签名 `plugin.js.author.sig` 可选,CI 会原样保留。

## 版本层暂不使用

`catalog/<作者>/<插件>/<版本>/` 这一层保留为占位,当前不用于登记:

- 版本不在本目录登记,由 CI 从 `base_url` 自动发现,作者站点上发布了哪个版本,合集就收录哪个版本。
- 不要创建版本目录,也不要在其中放 `meta.json`、`plugin.js` 或签名。这些文件由 CI 写入分发的 pages 包,不进本仓库的 catalog。

## 收录后会发生什么

合并 PR 后,CI 构建 pages 包时:

1. 用 [catalog-author.schema.json](../schemas/catalog-author.schema.json) 与 [catalog-plugin.schema.json](../schemas/catalog-plugin.schema.json) 校验登记文件,并检查公钥格式;不合规的条目直接报错,整个构建以非零退出码中止,不会跳过该条目继续发布其余内容。
2. 到 `base_url` 拉取该插件的全部版本与产物。
3. 用合集 EEC 给每个版本的 `plugin.js` 重新签名,产出 `plugin.js.sig`;作者的 `plugin.js.author.sig` 原样保留。
4. 把公钥、版本列表、各版本元数据写入 pages 包的 `plugins/` 目录,把 `catalog` 与 `certs` 原样复制进 pages,再生成 L1、L2、L3 三层清单与清单签名。
5. 每次 Release 全量重建 pages 并直接替换,不做版本留存;L1 的 `revision` 从已发布站点的 `manifest.json` 读上一次的值加一,取不到时从 1 开始。
6. `catalog` 与 `certs` 随 pages 分发,但不进任何一层清单,它们是登记信息与信任材料。

`datalog.json` 的 `tag` 当前恒为空数组:标签暂不生效,`plugin.json` 没有标签字段,`tags.json` 只作为预设标签清单随包分发。

插件市场按 pages 包的路径取用插件,作者不需要为分发再做别的准备。

## 下架

- 下架某个插件:删除 `catalog/<作者>/<插件>/` 整个目录并提交 PR。
- 整体退出:删除 `catalog/<作者>/` 整个目录并提交 PR。
- 直接删干净,不要留空目录或 TODO 文件占位;下次 Release 重建 pages 后,被删除的条目从分发内容里消失。

## 提交校验

两份 schema 只约束结构,字段含义见 [schemas/README.md](../schemas/README.md)。CI 除结构外还会检查公钥格式与 `base_url` 可达性,结构合法不等于收录通过。收录不等于认证,签名只证明分发内容与签名者一致。
