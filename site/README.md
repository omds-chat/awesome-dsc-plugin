# 站点工程

本目录是 awesome-dsc-plugin 的静态展示站点,负责把 pages 包里的收录数据渲染成页面。站点只读同源文件,不跨站拉取,不做任何密码学计算。

## 合集设置

本目录同时是合集设置的唯一位置:

| 文件 | 作用 | 去向 |
|:---:|:---:|:---:|
| `meta.json` | 合集元数据,含下载计数开关 | 由 `scripts/build-from-catalog.mjs` 原样复制到 pages 包根目录 |
| `tags.json` | 预设标签清单,收录登记里的标签只能取自这里 | 同上 |

仓库根不再存放这两个文件,也不放任何分发包索引文件。站点自身的构建产物只有 `index.html`、`.nojekyll` 与 `assets/`,不含上述设置。

`site/meta.json` 的字段(构建时原样复制为 pages 包根目录的 `meta.json`):

| 字段 | 本合集取值 | 说明 |
|:---:|:---:|:---:|
| `DOWNLOAD_COUNT_ENABLE` | `false` | 为 `true` 时插件市场每次下载都会向计数接口发送一次不等待回复的 POST 请求,并提示用户该来源启用了计数 |
| `DOWNLOAD_COUNT_API` | 缺省 | 计数接口地址,仅在启用计数时需要 |
| `API_NEED_IP` | `false` | 计数请求是否携带请求来源的公网 IP |

本合集不启用下载计数。

## 数据来源

页面在浏览器里按下列顺序读取同源文件,路径都相对 pages 包根目录:

| 步骤 | 路径 | 用途 | 缺失时 |
|:---:|:---:|:---:|:---:|
| 1 | `catalog/index.json` | 可选的登记索引,提供作者、主页与插件展示字段,字段优先于第 5 步 | 回落到第 2 步 |
| 2 | `plugins/author_manifest.json` | 作者清单,含 `username` 与 `profile` | 回落到第 3 步 |
| 3 | `plugins.json` | 插件目录索引,兜底清单,只提供 `author` 与 `plugin_name` | 页面提示没有读到作者 |
| 4 | `plugins/<作者>/plugin_manifest.json` | 该作者的插件名数组 | 用 `plugins.json` 里该作者的条目 |
| 5 | `catalog/<作者>/<插件>/plugin.json` | 插件描述、许可证、仓库链接 | 用最新版本 `meta.json` |
| 6 | `plugins/<作者>/<插件>/versions.json` | 版本列表与当前版本 `latest` | 显示为没有版本 |

签名材料只探测文件是否存在,请求方式是 `HEAD`,不读取内容,也不做任何密码学运算:

| 项 | 路径 |
|:---:|:---:|
| L1 清单 | `manifest.json` |
| L1 清单签名 | `manifest.json.sig` |
| L2 清单 | `plugins/<作者>/manifest.json` |
| L2 清单签名 | `plugins/<作者>/manifest.json.sig` |
| 作者公钥 | `plugins/<作者>/author_pub.pem` |
| L3 清单 | `plugins/<作者>/<插件>/manifest.json` |
| L3 清单签名 | `plugins/<作者>/<插件>/manifest.json.sig` |
| 产物签名 | `plugins/<作者>/<插件>/<版本>/plugin.js.sig` |
| 作者签名 | `plugins/<作者>/<插件>/<版本>/plugin.js.author.sig` |

- 404 记为「缺失」,网络失败或非 2xx 记为「未探测」,两者在界面上区分显示。
- 界面措辞只写「存在」「缺失」「未探测」,并注明未做密码学计算,不代表已验签;作者公钥与作者签名两侧缺一,只算未校验,不算通过。

`catalog/index.json` 由 `scripts/build-from-catalog.mjs` 在每次构建时生成,按本次实际收录范围列出作者与插件,结构以 [catalog-index.schema.json](../schemas/catalog-index.schema.json) 为准。

这个文件只供本站展示:它不是插件市场省请求的入口,市场不得依赖它加载目录数据,也不要用聚合索引替代按层取件。聚合索引是构建生成的派生数据,不进任何清单、不参与验签;市场按 `plugins.json` 与三层清单逐层取件,才能对上「这一层有哪些文件、摘要是什么」。

逐文件的生成者、消费者、签名归属与体积增长来源见 [../docs/design/pages-artifacts.md](../docs/design/pages-artifacts.md)。

```json
{
  "schemaVersion": 1,
  "collection": { "name": "awesome-dsc-plugin", "release": "v2.0.0" },
  "authors": [
    {
      "username": "omds-chat",
      "profile": "https://github.com/omds-chat",
      "plugin_count": 1,
      "plugins": [
        {
          "name": "dsc-demo",
          "description": "一句话说明",
          "license": "Apache-2.0",
          "repo_link": "https://github.com/omds-chat/dsc-demo",
          "base_url": "https://omds-chat.github.io/dsc-demo/"
        }
      ]
    }
  ],
  "plugins": [
    {
      "author": "omds-chat",
      "name": "dsc-demo",
      "description": "一句话说明",
      "license": "Apache-2.0",
      "repo_link": "https://github.com/omds-chat/dsc-demo",
      "base_url": "https://omds-chat.github.io/dsc-demo/",
      "current_version": "1.0.0",
      "tags": ["ui-enhance"],
      "version_count": 1
    }
  ]
}
```

页面把它当可选加速项:读得到就用第 1 步,读不到自动回落到第 2 步。这个加速只在站点内部成立,不构成对市场的取数约定。

## 构建

```bash
# 在仓库根目录执行
pnpm build:site

# 等价于在 site 目录执行
pnpm build
```

构建脚本 `build.mjs` 只用 Node 内置模块,不引入任何第三方依赖,不做打包:

1. 清空并重建 `dist/`;
2. 把 `src/assets/` 原样复制到 `dist/assets/`,原生 ES 模块直接由浏览器加载;
3. 把 `src/index.html` 里的 `__ASSETS__` 占位改写为 `./assets/`;
4. 写入 `dist/.nojekyll`;
5. 校验产物:顶层只有 `index.html`、`.nojekyll` 与 `assets/`,每个文件的扩展名都在静态文件白名单内,每个 ES 模块的相对 import 都指向存在的文件。

## 产物

构建产物目录为 `site/dist`,固定包含:

```text
site/dist/
├── index.html
├── .nojekyll
└── assets/
    ├── main.js     页面入口
    ├── data.js     同源数据读取与存在性探测
    ├── view.js     表格与详情渲染
    ├── format.js   版本比较与状态汇总
    └── styles.css  样式
```

流水线读取 `vars.SITE_DIR`,默认 `site/dist`,把该目录整体复制进 pages 包根目录;`plugins/`、`catalog/`、`certs/`、`meta.json`、`tags.json`、`plugins.json`、清单与 `eec.pem` 这些顶层名字由流水线独占,站点产物不得占用。产物是纯静态文件,不需要服务端,也没有任何运行时依赖。

## 约定

- 不使用浏览器原生弹窗与确认框,所有提示都渲染在页面里。
- 表格与选择控件的文本水平居中;侧边滚动条默认隐藏;760 px 以下表格改为卡片式堆叠,页面不横向溢出。
- 样式只用一份手写 CSS,不引入框架,不引入网络字体。
- 站点不写死任何作者或插件,全部内容来自同源文件。
