# awesome-dsc-plugin

The dsc community plugin collection. Plugins are indexed, signed and distributed here under distribution specification v2, and the plugin market reads the three hash-manifest layers, the collection certificate and the signatures inside the pages bundle to obtain them.

[简体中文](README.md)

## Scope

This collection targets dsc runtime plugins and is maintained by omds-chat. This repository is omds-chat's end-entity signer (EEC): it holds an end-entity signing certificate issued by the root CA of the DeepSeek-Chat-Enhanced repository and uses it to produce detached CMS signatures for the three manifest layers and for every plugin artifact.

Inclusion criteria:

- The artifact is a single browser ESM script that exports `activate(context)` and depends on no Node built-in module and no backend endpoint.
- A buildable source repository or a reachable artifact URL is provided, and CI can fetch and reproduce the artifact from `base_url`.
- The runtime metadata `meta.json` is complete and the plugin name matches `dsc-xxx` or `@scope/dsc-xxx`.
- The plugin must be published to npm first, and the npm package name must equal the plugin name: `dsc-xxx` maps to the npm package `dsc-xxx`, and `@scope/dsc-xxx` maps to `@scope/dsc-xxx`. The repository check `pnpm verify:catalog`, the preflight job on PRs and the Release CI all query the npm registry; a missing package or a registered package name that differs from the plugin name is rejected as an error. PR review and CI both block it — without the npm release the plugin is not accepted.

Plugins that need a backend service, a native module, or an artifact that cannot be rebuilt in CI are not accepted.

Inclusion is not endorsement. This collection only guarantees that distributed content matches its signatures; it does not review plugin behaviour.

## What you get

Every Release publishes a pages bundle deployed at `https://omds-chat.github.io/awesome-dsc-plugin/`:

- Installable artifacts of every collected plugin: the plugin market fetches layer by layer through the three manifests and installs after signature checks; verification after distribution is lenient, so a failed signature check only warns and never blocks — the user decides whether to continue, and the market never silently accepts on the user's behalf, instead prompting and suggesting a re-download when a signature fails.
- A static showcase site: browse the collected authors, plugins, versions and the presence of signature material (the site only probes existence and performs no cryptography).
- Registration data and trust material: the `catalog/` copy and the `certs/` certificates ship with the bundle, so third parties can verify on their own.

## Minimal steps

### Submitting a plugin as an author

1. Publish the plugin to npm with the package name equal to the plugin name.
2. Publish `meta.json` and `plugin.js` per version directory on your own Pages site, optionally with an author signature `plugin.js.author.sig`.
3. Open one PR that adds three files under `catalog/`: `author.json`, `author_pub.pem` and `<plugin>/plugin.json`; run `pnpm verify:catalog` locally before submitting.

Field tables, the public-key command, what happens after inclusion and the removal flow are documented in [catalog/README.md](catalog/README.md).

### Consuming the collection as a plugin market

The market fetches, in order relative to `base_url`: collection metadata, the plugin index, the collection certificate, the three manifests with signatures, and each version's metadata and artifact. The full fetch-path contract is the "market fetch order" section of [docs/design/pages-artifacts.md](docs/design/pages-artifacts.md).

### Building and publishing as a maintainer

The build pipeline, the pages bundle verification rules, the self-check scripts and local reproduction are documented in [docs/maintenance.md](docs/maintenance.md); signing conventions and the certificate chain in [docs/design/signing.md](docs/design/signing.md); mechanism trade-offs in [docs/design/collection-pipeline.md](docs/design/collection-pipeline.md).

## Distribution layout at a glance

The collection is published as a pages bundle: CI pulls the plugins registered in `catalog/` from each author's own `base_url`, re-signs them with the collection EEC, rebuilds the whole bundle and replaces it, keeping no versions. Plugins are organised under `plugins/` in three levels (author, plugin, version), and each level carries one `manifest.json` and one `manifest.json.sig`: a manifest records the SHA-512 of every file in its layer and the signature is produced by the end-entity signing certificate (EEC) issued by the root CA. Layers do not reference each other, so each one can be published, verified and re-signed on its own.

```text
<collection>/                    # pages bundle root, rebuilt from scratch on every Release
├── index.html, assets/          # site build output
├── meta.json, tags.json         # L1, collection metadata and preset tags, taken from site/
├── plugins.json                 # L1, plugin index generated from catalog/
├── manifest.json(.sig)          # L1 manifest and signature
├── catalog/                     # registration copy plus generated summaries, covered by no manifest
├── certs/                       # trust material (collection EEC certificate and public key), covered by no manifest
└── plugins/                     # plugin tree: author / plugin / version, with per-layer manifests and signatures
```

The full bundle tree, the required and optional files of each location, the manifest coverage and the `revision` semantics are documented in [docs/maintenance.md](docs/maintenance.md); directory naming, the `versions.json` shape and the `meta.json` fields in [.github/bundle-layout.README.md](.github/bundle-layout.README.md); `catalog/` and `certs/` are covered by no manifest — the first is registration data, the second trust material. The deployed site tree, the entry URL and the version-retention shape are documented in the "Pages environment file structure and deployment" section of [docs/design/pages-artifacts.md](docs/design/pages-artifacts.md).

## Repository layout

```text
awesome-dsc-plugin/
├── .github/        # CI workflow and the plugin tree layout notes
├── catalog/        # registration: author identity, public key and plugin site
├── certs/          # collection end-entity certificate and matching public key, ships with the bundle
├── docs/           # document index, maintainer manual and design notes
├── schemas/        # every JSON Schema of this repository
├── scripts/        # verification and build scripts
└── site/           # collection settings and the showcase site project
```

Each directory documents its own internals: `catalog/README.md`, `docs/README.md`, `schemas/README.md`, `scripts/README.md` and `site/README.md`. The engineering files are `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.gitattributes` (LF line endings everywhere) and `.gitignore`. `plugins.json`, `manifest.json`, `manifest.json.sig` and `plugins/` are never committed; they exist only inside the built pages bundle. The branch structure (`main` and the orphan parallel branch `ci-memory`) is documented in the "Branch structure" section of [docs/maintenance.md](docs/maintenance.md).

## Cross-origin access

The collection is hosted on GitHub Pages. Pages returns `Access-Control-Allow-Origin: *` for static assets by default, so distribution content is readable across origins and the host cannot narrow it to an allowlist. That is platform behaviour, not a setting of this repository.

The specification requires cross-origin sources to be limited to trusted origins, at minimum `https://omds-chat.github.io`. Moving distribution content to another host means configuring a CORS allowlist that at least permits that origin.

## Documentation

The index of every document, the conflict-resolution order and the maintenance conventions are documented in [docs/README.md](docs/README.md).

## License

Apache License 2.0, see [LICENSE](LICENSE).
