# Awesome dsc Plugin

[简体中文](README.md)

A curated collection of dsc community plugins: it provides the plugin index and distribution entry for the built-in marketplace of DeepSeek-Chat-Enhanced(hereafter dsce).

## Positioning

This repository does two things:

- Maintains the plugin index `index.json`, recording the identifier, name, version, description, author, homepage and download address of every listed plugin.
- On release, CI pulls the sources of plugins that declare a repository address, builds their artifacts, and deploys them together with the index file to the Pages environment.

This repository does not host plugin sources, does not own plugin repositories, and does not audit plugin implementations.

## How the index is consumed by the dsce marketplace

The built-in `dsc-market` plugin of dsce fetches by default:

```text
https://omdsc-dev.github.io/awesome-dsc-plugin/index.json
```

Index shape(excerpt, format illustration only; the `dsc-demo-log` id in the excerpt is a placeholder, not a listed plugin):

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

Rules:

- `schemaVersion` must be 1.
- Every `plugins` item must carry `id`,`name`,`version`,`description`,`author`,`homepage` and `download`;`manifest` is optional.
- Items with missing fields or wrong types are skipped by dsce. This repository therefore validates every entry before writing the index and exits with a non-zero code instead of producing a broken index.

## Directory layout

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

## Inclusion criteria

- The artifact follows the dsc plugin product specification: a single browser ESM js file exporting `activate(context)`, without Node built-in modules or backend endpoints.
- The entry provides a reachable https download address, or a buildable repository address(declared through `repo`,where `pnpm build` produces `dist/plugin.js`).
- The entry `id` matches `^[a-z][a-z0-9-]{2,63}$` and `version` is three numeric segments.
- The plugin does not bypass the engine to reach host internal objects, does not collect user data, and does not issue implicit network requests.
- The author maintains the plugin and responds to user questions.

## Submitting a plugin

- Add `<id>.json` under `plugins/`;fields and value rules are described in [plugins/README.md](plugins/README.md).
- Run `pnpm build` and confirm the entry appears in `dist/index.json` with validation passing.
- Open a pull request against `main` for maintainer review.

## Index field reference

| Field | Type | Required | Description |
|:---:|:---:|:---:|:---:|
| `schemaVersion` | number | yes | Always 1 |
| `plugins` | array | yes | Plugin items sorted by `id` in lexicographic order |
| `plugins[].id` | string | yes | Plugin identifier matching `^[a-z][a-z0-9-]{2,63}$` |
| `plugins[].name` | string | yes | Display name, non-empty |
| `plugins[].version` | string | yes | Three numeric segments such as `0.1.0` |
| `plugins[].description` | string | yes | One-line description, non-empty |
| `plugins[].author` | string | yes | Author or organization, non-empty |
| `plugins[].homepage` | string | yes | http or https address |
| `plugins[].download` | string | yes | https download address, or a repository-relative path |
| `plugins[].manifest` | object | no | Plugin manifest; dsce falls back to the manifest exported by the artifact |

## Build and local preview

```bash
pnpm install
pnpm build
```

`pnpm build` runs `node scripts/build-index.mjs`,which reads `plugins/*.json` and writes, after validation:

- `dist/index.json`
- `dist/plugins/<id>.json`

An empty directory produces `{ "schemaVersion": 1, "plugins": [] }` without failing.

Preview the Pages content locally:

```bash
pnpm dlx serve dist
```

Build plugin artifacts(requires git and network access, reads `repo` from each entry):

```bash
node .github/scripts/build-artifacts.mjs
```

`PAGES_BASE_URL` overrides the Pages base address used when rewriting `download`.

## Disclaimer

- Inclusion is not certification. This repository only indexes and distributes; it does not review plugin code.
- Plugins are maintained by their own authors, who are responsible for functionality, compatibility and security.
- Plugins run on the browser main thread and can reach the current session content and stored API keys. Install only plugins from sources you trust, and use them at your own risk.

## License

Apache-2.0, see [LICENSE](LICENSE).
