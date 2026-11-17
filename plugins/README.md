# 插件条目

本目录存放插件条目,每个插件一个 `<id>.json` 文件。`scripts/build-index.mjs` 读取本目录的全部 json 文件,校验通过后生成 `dist/index.json`,并把条目原样复制到 `dist/plugins/`。

本目录的 `README.md` 不参与索引生成。

## 条目字段

| 字段 | 类型 | 必填 | 说明 |
|:---:|:---:|:---:|:---:|
| `id` | string | 是 | 插件标识,同时决定文件名 `<id>.json` |
| `name` | string | 是 | 展示名称 |
| `version` | string | 是 | 三段数字,形如 `0.1.0` |
| `description` | string | 是 | 一句话说明 |
| `author` | string | 是 | 作者或组织名 |
| `homepage` | string | 是 | http 或 https 地址 |
| `download` | string | 是 | https 分发地址,或本仓库相对路径 |
| `manifest` | object | 否 | 插件清单。省略时由 DeepSeek-Chat-Enhanced 使用产物导出的 `manifest` |
| `repo` | string | 否 | 插件源码仓库,CI 据此构建产物 |

## 取值规则

- `id` 必须匹配 `^[a-z][a-z0-9-]{2,63}$`,且与文件名一致。例如文件 `dsc-demo-log.json` 的 `id` 只能是 `dsc-demo-log`。
- `version` 必须匹配 `^[0-9]+\.[0-9]+\.[0-9]+$`。
- `homepage` 必须为 `http://` 或 `https://` 开头的绝对地址。
- `download` 必须是 `https://` 开头的绝对地址,或相对本仓库根目录的路径,例如 `plugins/dsc-demo-log.js`。`http://` 与绝对文件路径被拒绝。
- `manifest` 若存在必须是对象,内容遵循 dsc 插件产物规范。
- `repo` 接受 `https://github.com/<owner>/<repo>` 或 `<owner>/<repo>` 两种写法。声明后,CI 会浅克隆该仓库,执行 `pnpm install --frozen-lockfile` 与 `pnpm build`,把 `dist/plugin.js` 复制为 `dist/plugins/<id>.js`,并把该条目的 `download` 改写为 Pages 地址。构建失败的条目会被剔除,不影响其他条目。

## 收录硬性条件

- 产物符合 dsc 插件产物规范: 单个浏览器 ESM js 文件,导出 `activate(context)`,不引用 Node 内置模块与后端接口。
- 提供可访问的 https 分发地址,或提供可构建的仓库地址。
- 条目通过 `node scripts/build-index.mjs` 的全部校验。

## 校验行为

`node scripts/build-index.mjs` 逐条校验,遇到以下任一情况以非零退出码结束,并打印文件名与具体原因:

- `id` 不符合规则,或与文件名不一致。
- `name`、`version`、`description`、`author`、`homepage`、`download` 缺失、为空或类型不符。
- `version` 不是三段数字。
- `download` 既不是 https 地址也不是合法的仓库相对路径。
- `manifest` 存在但不是对象。
- 多个条目使用同一个 `id`。

## 示例

以下片段仅说明格式,不构成收录条目:

```json
{
  "id": "dsc-demo-log",
  "name": "Demo Log",
  "version": "0.1.0",
  "description": "把会话事件写入浏览器控制台的示例插件",
  "author": "omdsc-dev",
  "homepage": "https://github.com/omdsc-dev/dsc-plugin-template",
  "download": "https://omdsc-dev.github.io/awesome-dsc-plugin/plugins/dsc-demo-log.js",
  "repo": "omdsc-dev/dsc-plugin-template",
  "manifest": {
    "id": "dsc-demo-log",
    "name": "Demo Log",
    "version": "0.1.0",
    "capabilities": ["notify"]
  }
}
```
