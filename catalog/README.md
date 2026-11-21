# 收录登记

本目录是本合集唯一的收录入口。作者在这里登记身份、公钥与插件发布站点;插件产物不进本仓库,CI 按 `base_url` 到作者自己的站点取。

## 目录结构

```text
catalog/
├── README.md
├── removed.json              已解除托管的插件清单
└── <作者>/
    ├── author.json           作者身份
    ├── author_pub.pem        作者公钥,OpenSSL PEM
    └── <插件>/
        └── plugin.json       插件登记
```

- `<作者>` 是目录名,必须与 `author.json` 的 `username` 逐字符一致,也是分发站点里 `plugins/<作者>/` 的目录名。
- `<作者>` 按 GitHub 用户名规则校验,字母不区分大小写:只允许字母、数字与连字符,不得以连字符开头或结尾,长度 1 到 39 字符。不合法时仓库级校验与构建都报错,并指出是哪个目录。同一个用户的目录只能出现一次:`Alice` 与 `alice` 仅大小写不同,属同一个 GitHub 用户,仓库级校验与构建都会报错并点名冲突的两个目录。
- `<插件>` 是目录名,必须是 `plugin.json` 的 `name` 去掉 `@scope/` 后的部分:`dsc-demo` 与 `@alice/dsc-demo` 都写作 `dsc-demo`,两者不一致会被拒绝。
- 目录与文件名固定,不要改名。作者名的合法字符不区分大小写,但 `author.json` 的 `username` 必须与目录名逐字符一致(含大小写),改名时两处要一起改。
- 结构就是上面这四层,不要创建占位目录、空目录或版本目录:版本不进 catalog,由 CI 从 `base_url` 发现。

## author.json

每位作者一份,只描述作者本人,不描述插件。

| 字段 | 类型 | 说明 |
|:---:|:---:|:---:|
| `username` | string | 必填,非空。作者用户名,与所在目录名逐字符一致,也是分发站点里 `plugins/<作者>/` 的目录名;按 GitHub 用户名规则校验,只允许字母、数字与连字符,首尾不得是连字符,长度 1 到 39 |
| `profile` | string | 必填,非空。作者主页的完整绝对地址,例如 `https://github.com/omds-chat`,插件市场用它链接回作者 |

```json
{
  "username": "omds-chat",
  "profile": "https://github.com/omds-chat"
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
- 作者签名本身是可选项,从不阻断收录:验签失败只在报告与日志里警告。作者层只是附加证据,合集已经在登记侧审核过作者与插件,判定依据是 `catalog/` 的 PR 审核与仓库级校验,没有理由用作者签名把已审核的内容拦下来。
- 公钥与签名两侧缺一不可:只有 `plugin.js.author.sig` 没有公钥、或只有公钥没有 `plugin.js.author.sig`,都判为「未校验」,不计为通过。
- 公钥由 L2 清单覆盖,分发时原样复制到 `plugins/<作者>/author_pub.pem`。

## plugin.json

一个插件一份,放在 `catalog/<作者>/<插件>/` 下。

| 字段 | 类型 | 说明 |
|:---:|:---:|:---:|
| `name` | string | 必填,非空。插件名,必须以 `dsc-` 为前缀,写成 `dsc-xxx` 或 `@scope/dsc-xxx`,并与版本目录里的 `meta.json` 一致;所在目录名取其去掉 `@scope/` 之后的部分 |
| `description` | string | 必填,非空。一句话说明插件做什么,用于市场列表展示 |
| `license` | string | 必填,非空。插件许可证,建议写 SPDX 标识,例如 `Apache-2.0` |
| `repo_link` | string | 必填,非空。插件源码仓库地址,写完整绝对地址 |
| `base_url` | string | 必填,非空。插件自己发布的站点基址,`http` 或 `https` 开头的绝对地址,必须以斜杠结尾 |
| `tags` | string[] | 可选,省略等价于空数组。标签数组,元素非空、互不重复,取值必须来自下文「预设标签」 |

```json
{
  "name": "dsc-plugin-gallery",
  "description": "把对话里的图片整理成画廊视图。",
  "license": "Apache-2.0",
  "repo_link": "https://github.com/omds-chat/dsc-plugin-gallery",
  "base_url": "https://omds-chat.github.io/dsc-plugin-gallery/",
  "tags": ["ui-enhance"]
}
```

- 前五个字段必填,`tags` 可选,多写字段会被拒绝,结构以 [catalog-plugin.schema.json](../schemas/catalog-plugin.schema.json) 为准。
- `base_url` 只写站点根,不写具体文件,不带查询串或锚点;少写结尾斜杠会被拒绝。

## 预设标签

标签的预设清单是 [site/tags.json](../site/tags.json),构建时原样随 pages 包分发到 `<base_url>/tags.json`。仓库根不再存放 `tags.json`,合集设置统一放在 `site/`。插件只能使用清单里的标签:

| 标签 | 说明 |
|:---:|:---:|
| `ui` | 调整界面外观与交互布局。 |
| `ui-enhance` | 在不改动主界面的前提下增强现有界面能力,例如为消息、输入框或侧栏补充辅助操作。 |
| `workflow` | 改造对话流程与操作步骤。 |
| `tools` | 增加或扩展可调用的工具。 |
| `data` | 导入、导出或整理对话与本地数据。 |
| `integration` | 接入外部服务与第三方平台。 |
| `security` | 提升本地数据与通信安全的防护。 |

- 构建时插件目录索引 `plugins.json` 的 `tag` 直接取自各插件 `plugin.json` 的 `tags`,省略时为空数组。
- 标签不在预设清单内按构建错误处理:构建中止,并指出是哪个插件、哪个标签;不会静默丢弃或自动补标签。
- 要新增标签,先在 `site/tags.json` 里登记,再在插件里使用,两者在同一个 PR 里提交。

## base_url 指向什么

`base_url` 是插件自己发布的站点基址,该站点托管作者自己的 Pages,按本合集 pages 包的路径约定发布插件产物。CI 只认这个地址:

- 不从 GitHub Release 取任何东西,Release 不放资产。
- 站点必须公开可访问,静态资源可跨域读取。
- 站点上每个版本目录需要 `meta.json` 与 `plugin.js`;作者自签名 `plugin.js.author.sig` 可选,CI 会原样保留。

## 版本层不进 catalog

`catalog/<作者>/<插件>/` 下只放 `plugin.json`,不建版本目录:

- 版本不在本目录登记,由 CI 从 `base_url` 自动发现,作者站点上发布了哪个版本,合集就收录哪个版本。
- 不要创建版本目录,也不要在其中放 `meta.json`、`plugin.js` 或签名。这些文件由 CI 写入分发的 pages 包,不进本仓库的 catalog。

## 收录后会发生什么

合并 PR 后,CI 构建 pages 包时:

1. 用 [catalog-author.schema.json](../schemas/catalog-author.schema.json) 与 [catalog-plugin.schema.json](../schemas/catalog-plugin.schema.json) 校验登记文件,检查公钥格式,并确认每个标签都在 `site/tags.json` 的预设清单内。
2. 到 `base_url` 拉取该插件的全部版本与产物。
3. 用合集 EEC 给每个版本的 `plugin.js` 重新签名,产出 `plugin.js.sig`;作者的 `plugin.js.author.sig` 原样保留。
4. 把公钥、版本列表、各版本元数据写入 pages 包的 `plugins/` 目录,把 `catalog` 与 `certs` 复制进 pages,再生成 L1、L2、L3 三层清单与清单签名。
5. 生成 pages 包 `catalog/` 下的两份汇总文件:`index.json`(作者列表与插件列表,含当前版本、标签与版本数)与 `anomalies.json`(本次发布被剔除的插件)。
6. 用 `scripts/verify-catalog-consistency.mjs` 交叉校验 `catalog/index.json`、`plugins.json`、`plugins/author_manifest.json`、`catalog/` 副本与 `plugins/` 树,任何不一致都以非零退出码中止。
7. 每次 Release 全量重建 pages 并直接替换,不做版本留存;三层清单在发布前写回 `ci-memory` 分支的 `layer-manifests/`,写回失败即中止发布;L1 的 `revision` 当前从已发布站点的 `manifest.json` 读上一次的值加一,取不到时从 1 开始,读回来源改为 `ci-memory` 属下一步实现。
8. `catalog` 与 `certs` 随 pages 分发,但不进任何一层清单,它们是登记信息与信任材料。

### catalog/index.json 的边界

pages 包里的 `catalog/index.json` 只供本站站点自己展示,不作为插件市场省请求的入口:市场不得依赖它加载目录数据,应当按 `plugins.json` 与三层清单逐层取件。也不要用聚合索引替代按层取件——聚合索引是构建生成的派生数据,不进任何清单、不参与验签,一旦与三层清单不一致,市场就拿不到可用于校验的摘要;逐层取件才对得上「这一层有哪些文件、摘要是什么」。

站点读不到它时会回落到 `plugins/author_manifest.json` 与 `plugins.json`,所以它缺失也不影响站点把作者与插件列出来。

根级 `plugins.json` 与 `catalog/index.json` 同属统计清单,给作者自查、速览与第三方搜索用,不是宿主读取插件信息的通道:宿主按 `plugins.json` 与三层清单逐层取件。两者都只描述本次发布收录了什么,区别在于 `plugins.json` 被 L1 清单覆盖、`catalog/index.json` 不进任何清单。逐文件的生成者、消费者与签名归属见 [docs/design/pages-artifacts.md](../docs/design/pages-artifacts.md)。

### 登记错误与运行期异常的边界

构建把「作者要改的东西」和「运行期偶然失败」分开处理,这条边界在 `scripts/build-from-catalog.mjs` 里实现:

| 类别 | 判定 | 构建行为 |
|:---:|:---:|:---:|
| 登记不合规 | `catalog/` 里的文件本身不合法:缺字段、`name` 与目录不符、`tags` 结构不合法或标签不在预设清单内、公钥不可解析 | 登记错误,构建以非零退出码中止,一个插件都不发布,等待作者修正 |
| 运行期异常 | 作者站点拉取失败(网络、HTTP 4xx/5xx)、远端 `versions.json` 不合法、远端 `meta.json` 与登记不符、`plugin.js` 为空、`plugin.js` 命中网络自建扫描(`PLUGIN_NETWORK_SELFTALK`) | 只把该插件从本次发布剔除,其余插件照常发布;剔除项写入 `catalog/anomalies.json` 并上报到仓库 Issue |

剔除是「本次不发布」,不是「解除登记」:插件目录仍留在 `catalog/` 里,修好站点后下次 Release 会自动回到发布里。真要解除托管,见下节「下架」。

签名失败、清单生成失败与分发自检失败既不是登记错误,也不是单个插件的运行期问题,仍按构建失败处理。

插件市场按 pages 包的路径取用插件,作者不需要为分发再做别的准备。

## 下架

- 下架某个插件:删除 `catalog/<作者>/<插件>/` 整个目录,并在 [removed.json](removed.json) 追加一条记录,然后提交 PR。
- 整体退出:删除 `catalog/<作者>/` 整个目录,作者名下每个插件都要在 `removed.json` 各留一条记录,然后提交 PR。
- 直接删干净,不要留空目录或 TODO 文件占位;下次 Release 重建 pages 后,被删除的条目从分发内容里消失。
- `removed.json` 必须存在:没有任何记录时保持空数组 `[]`,缺少该文件仓库级校验会报错。
- `removed.json` 是顶层数组,每条记录的字段:

| 字段 | 类型 | 说明 |
|:---:|:---:|:---:|
| `name` | string | 必填,非空。被移除的插件名,与移除前的 `plugin.json` 一致 |
| `base_url` | string | 必填,非空。移除前的发布站点基址,便于外部查阅追认来源 |
| `removed_in` | string | 必填,非空。移除发生在哪个发布版本,写 release tag,例如 `v2.0.0` |
| `note` | string | 可选,非空。一句话说明移除原因或后续去向 |

```json
[
  {
    "name": "dsc-plugin-gallery",
    "base_url": "https://omds-chat.github.io/dsc-plugin-gallery/",
    "removed_in": "v2.0.0",
    "note": "作者改为独立分发,不再随本合集发布。"
  }
]
```

`removed.json` 随 pages 包分发到 `<base_url>/catalog/removed.json`,结构以 [catalog-removed.schema.json](../schemas/catalog-removed.schema.json) 为准。

## 提交校验

提交 PR 前先在本地跑一遍仓库级校验,它只读 `catalog/` 与 `certs/`,不需要构建产物:

```bash
pnpm verify:catalog
```

各份 schema 只约束结构,字段含义见 [schemas/README.md](../schemas/README.md)。CI 除结构外还会检查公钥格式、标签是否属于预设清单与 `base_url` 可达性,结构合法不等于收录通过。收录不等于认证,签名只证明分发内容与签名者一致。
