# Awesome dsc Plugin

[English](README.en-US.md)

dsc 社区精选插件合集: 为 DeepSeek-Chat-Enhanced(下称 dsce)的内置市场提供插件索引与分发入口。

## 项目定位

本仓库只承担两件事:

- 维护插件索引 `index.json`,记录每个收录插件的标识、名称、版本、说明、作者、主页与分发地址。
- 在创建 Release 时由 CI 拉取声明了仓库地址的插件源码并构建产物,与索引文件一并部署到 Pages 环境。

本仓库不保存插件源码,不代管插件仓库,不对插件实现做审计。

## 索引如何被 dsce 市场消费

dsce 的内置插件 `dsc-market` 默认拉取:

```text
https://omdsc-dev.github.io/awesome-dsc-plugin/index.json
```

索引结构(片段示例,仅说明格式。示例中的 `dsc-demo-log` 是格式占位,不是已收录插件):

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "id": "dsc-demo-log",
      "name": "Demo Log",
      "version": "0.1.0",
      "description": "示例插件",
      "author": "omdsc-dev",
      "homepage": "https://github.com/omdsc-dev/dsc-plugin-template",
      "download": "https://omdsc-dev.github.io/awesome-dsc-plugin/plugins/dsc-demo-log.js",
      "manifest": {}
    }
  ]
}
```

约定:

- `schemaVersion` 必须为 1。
- `plugins` 每项必须含 `id`、`name`、`version`、`description`、`author`、`homepage`、`download`,`manifest` 可选。
- 字段缺失或类型不符的条目会被 dsce 跳过。因此本仓库在写出索引前逐条校验,校验不通过即以非零退出码结束,不产出坏索引。

## 目录结构

```text
awesome-dsc-plugin/
├── .github/
│   ├── workflows/
│   │   └── build-and-deploy.yml
│   └── scripts/
│       └── build-artifacts.mjs
├── .gitignore
├── LICENSE
├── README.md
├── README.en-US.md
├── package.json
├── plugins/
│   └── README.md
└── scripts/
    └── build-index.mjs
```

## 收录条件

- 产物符合 dsc 插件产物规范: 单个浏览器 ESM js 文件,导出 `activate(context)`,不引用 Node 内置模块与后端接口。
- 提供可访问的 https 分发地址,或提供可构建的仓库地址(条目声明 `repo`,仓库内 `pnpm build` 产出 `dist/plugin.js`)。
- 条目 `id` 符合 `^[a-z][a-z0-9-]{2,63}$`,`version` 为三段数字。
- 插件不绕过引擎访问宿主内部对象,不采集用户数据,不隐式发起网络请求。
- 作者承担维护责任,并愿意回应使用者的问题。

## 提交方式

- 在 `plugins/` 新增 `<id>.json`,字段与取值规则见 [plugins/README.md](plugins/README.md)。
- 执行 `pnpm build`,确认校验通过且 `dist/index.json` 中出现该条目。
- 向 `main` 提交 PR,由维护者评审合并。

## 索引字段表

| 字段 | 类型 | 必填 | 说明 |
|:---:|:---:|:---:|:---:|
| `schemaVersion` | number | 是 | 固定为 1 |
| `plugins` | array | 是 | 插件条目数组,按 `id` 字典序排列 |
| `plugins[].id` | string | 是 | 插件标识,匹配 `^[a-z][a-z0-9-]{2,63}$` |
| `plugins[].name` | string | 是 | 展示名称,非空 |
| `plugins[].version` | string | 是 | 三段数字,形如 `0.1.0` |
| `plugins[].description` | string | 是 | 一句话说明,非空 |
| `plugins[].author` | string | 是 | 作者或组织名,非空 |
| `plugins[].homepage` | string | 是 | http 或 https 地址 |
| `plugins[].download` | string | 是 | https 分发地址,或本仓库相对路径 |
| `plugins[].manifest` | object | 否 | 插件清单,省略时由 dsce 使用产物导出的清单 |

## 构建与本地预览

```bash
pnpm install
pnpm build
```

`pnpm build` 等价于 `node scripts/build-index.mjs`,读取 `plugins/*.json`,校验通过后写出:

- `dist/index.json`
- `dist/plugins/<id>.json`

目录为空时写出 `{ "schemaVersion": 1, "plugins": [] }`,不报错。

本地预览 Pages 内容:

```bash
pnpm dlx serve dist
```

构建插件产物(需要 git 与联网,读取条目中的 `repo`):

```bash
node .github/scripts/build-artifacts.mjs
```

`PAGES_BASE_URL` 可覆盖改写 `download` 时使用的 Pages 基地址。

## 免责声明

- 收录不等于认证。本仓库只做索引与分发,不评审插件代码。
- 插件由各自作者维护,功能、兼容性与安全性由作者负责。
- 插件运行在浏览器页面主线程,可接触当前会话内容与已保存的 API Key。请只安装信任来源的插件,使用风险自担。

## 许可

Apache-2.0,见 [LICENSE](LICENSE)。
