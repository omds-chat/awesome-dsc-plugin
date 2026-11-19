# 站点工程

本目录是 awesome-dsc-plugin 的静态展示站点,负责把 pages 包里的收录数据渲染成页面。站点只读同源文件,不跨站拉取,不做任何密码学计算。

## 数据来源

页面在浏览器里按下列顺序读取同源文件,路径都相对 pages 包根目录:

| 步骤 | 路径 | 用途 | 缺失时 |
|:---:|:---:|:---:|:---:|
| 1 | `catalog/index.json` | 可选的登记索引,提供作者、主页与插件展示字段,字段优先于第 5 步 | 回落到第 2 步 |
| 2 | `plugins/author_manifest.json` | 作者清单,含 `username` 与 `profile` | 回落到第 3 步 |
| 3 | `datalog.json` | 兜底清单,只提供 `author` 与 `plugin_name` | 页面提示没有读到作者 |
| 4 | `plugins/<作者>/plugin_manifest.json` | 该作者的插件名数组 | 用 `datalog.json` 里该作者的条目 |
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
- 界面措辞只写「存在」「缺失」「未探测」,并注明未做密码学计算,不代表已验签。

`catalog/index.json` 是可选加速项,当前流水线不产出该文件,页面会自动走第 2 步。若后续由流水线生成,结构为:

```json
{
  "authors": [
    {
      "username": "omdsc-dev",
      "profile": "https://github.com/omdsc-dev",
      "plugins": [
        {
          "name": "dsc-demo",
          "description": "一句话说明",
          "license": "Apache-2.0",
          "repo_link": "https://github.com/omdsc-dev/dsc-demo",
          "base_url": "https://omdsc-dev.github.io/dsc-demo/"
        }
      ]
    }
  ]
}
```

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

流水线读取 `vars.SITE_DIR`,默认 `site/dist`,把 `index.html` 与 `assets/` 复制进 pages 包根目录。产物是纯静态文件,不需要服务端,也没有任何运行时依赖。

## 约定

- 不使用浏览器原生弹窗与确认框,所有提示都渲染在页面里。
- 表格与选择控件的文本水平居中;侧边滚动条默认隐藏;760 px 以下表格改为卡片式堆叠,页面不横向溢出。
- 样式只用一份手写 CSS,不引入框架,不引入网络字体。
- 站点不写死任何作者或插件,全部内容来自同源文件。
