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

## Distribution layout

The collection is published as a pages bundle: on every Release CI pulls the plugins registered in `catalog/` from each author's own `base_url`, re-signs them with the collection EEC, rebuilds the whole bundle and replaces it, keeping no versions. Plugins are organised under `plugins/` in three levels (author, plugin, version), and each level carries one `manifest.json` and one `manifest.json.sig`: a manifest records the SHA-512 of every file in its layer and the signature is produced by the end-entity signing certificate (EEC) issued by the root CA. Layers do not reference each other, so each one can be published, verified and re-signed on its own.

```text
<collection>/                          # pages bundle root, rebuilt from scratch on every Release
├── index.html                         # site build output
├── assets/                            # site build output: page scripts and styles
├── meta.json                          # L1, collection metadata with the download counting switch
├── tags.json                          # L1, preset tags
├── plugins.json                       # L1, plugin index generated from catalog/
├── manifest.json                      # L1 manifest
├── manifest.json.sig                  # L1 manifest signature
├── catalog/                           # registrations copied over (removed.json included), plus the generated index.json and anomalies.json; covered by no manifest
├── certs/                             # trust material, copied verbatim, covered by no manifest
│   └── awesome-dsc-plugin/            # source folder, named after the source id; holds the certificate and its matching public key
│       ├── awesome-dsc-plugin-eec.crt          # collection end-entity signing certificate (EEC), issued by the root CA
│       └── awesome-dsc-plugin-eec-secret.pub   # public key matching the EEC private key
└── plugins/
    ├── author_manifest.json           # L1
    └── <author>/
        ├── author_pub.pem             # L2, author public key, OpenSSL PEM, Ed25519
        ├── plugin_manifest.json       # L2
        ├── manifest.json              # L2 manifest
        ├── manifest.json.sig          # L2 manifest signature
        └── <plugin>/
            ├── versions.json          # L3
            ├── manifest.json          # L3 manifest
            ├── manifest.json.sig      # L3 manifest signature
            └── <x.y.z>/
                ├── meta.json          # L3
                ├── plugin.js
                ├── plugin.js.sig        # collection CMS signature, covers the artifact itself
                └── plugin.js.author.sig # author bare public key signature, optional
```

There is no `eec.pem` in the root any more: the collection certificate lives at `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt`, ships with the pages bundle and is covered by no manifest; the root certificate is not distribution content either. `certs/` holds source folders only, with each certificate and public key placed at `certs/<source id>/<file name>`; the folder name is the source id and every file name starts with `<source id>-`; private keys are never committed.

Collection settings live in `site/`: `site/meta.json` and `site/tags.json` are the only sources of the same-named files in the pages bundle and are copied over verbatim. `plugins.json`, `manifest.json`, `manifest.json.sig` and `plugins/` are build output that exists only inside the pages bundle; the repository root keeps none of them and no baselines stand in for them.

| Layer | Location | Covered files (relative to the layer directory) |
|:---:|:---:|:---:|
| L1 | pages bundle root | `meta.json`, `plugins.json` (the plugin index), `tags.json`, `plugins/author_manifest.json`, with `tags.json` covered when present |
| L2 | `plugins/<author>/` | `author_pub.pem`, `plugin_manifest.json`, only when the file exists |
| L3 | `plugins/<author>/<plugin>/` | `versions.json` and every version directory's `meta.json` |

`catalog/` and `certs/` are covered by no manifest: the first is registration data, the second is trust material.

Manifest format, with the JSON Schema in `schemas/manifest.schema.json`:

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "files": [
    { "path": "plugins.json", "sha512": "<128 lowercase hex characters>" }
  ]
}
```

- `path` is relative to the directory holding the manifest, uses forward slashes, may not be absolute, may not contain a `.` or `..` segment, may not point at the manifest itself, and may not repeat.
- The hash is SHA-512 in lowercase hex, always 128 characters.
- `revision` is a positive integer per layer: it increments when the layer's file set or contents change and keeps its value when nothing changed; the bundle is rebuilt from scratch on every Release, so the previous value is read per layer from `layer-manifests/` on the `ci-memory` branch, falling back to the published site's `manifest.json` at the same path only when the branch has no manifest for that layer, and starting at 1 when neither exists. Before publishing, the three layer manifests are written back to the same location on that branch, mirroring the distribution paths one to one and keeping each manifest paired with its `.sig`; a failed write-back aborts the release, CI reports the error, and the old `revision` is not carried forward into a publish. The branch is the source of truth for read-back and the site read-back is only a transitional fallback; a missing branch fails the pipeline instead of being created.
- L3 does not cover `plugin.js` or `plugin.js.sig`: the artifact itself is signed per version by `plugin.js.sig` and the manifest describes metadata only.
- `tags.json` is optional: when it exists it must be covered by the L1 manifest, and when it does not exist it is neither required nor listed.
- `meta.json.sig` and `meta.json.author.sig` are gone: the only collection signature inside a version directory is `plugin.js.sig`, and `plugin.js.author.sig` stays optional. `meta.json` is covered by the L3 manifest and bound by the collection EEC, while the author public key itself is covered by L2. When an author keeps the output of `dsc-plugin-template`, that template also emits `meta.json.author.sig`; this repository does not carry the file.

The three layers are deliberately not folded together: L1 does not reference L2 and L2 does not reference L3, so each layer can be published, verified and re-signed on its own. The trade-off gives up "one check yields a digest of the whole tree" in exchange for per-plugin incremental updates: changing one plugin only increments the L3 `revision`, leaves L2 and L1 untouched, and clients refetch just that layer. Folding the layers into a single root manifest would make every plugin release rewrite the root manifest and force every client to refetch the whole digest.

The pages bundle is a build artifact and is never committed back: every Release rebuilds it and replaces it wholesale, so the repository keeps no history of `plugins.json`, the plugin data under `plugins/`, `manifest.json` or `manifest.json.sig`, and no empty baselines stand in for them. Each layer's `revision` therefore cannot be carried over from the source tree; the previous version lives on the `ci-memory` branch instead: the manifests are written back to `layer-manifests/` before publishing, and the next build reads each layer back from there, keeping the value when the file set and hashes are unchanged and incrementing it otherwise. The read-back source is the `ci-memory` branch, which takes precedence over the published site; the site read-back is only a transitional fallback, and a missing branch fails the pipeline rather than being created.

## Required files

The required and optional files of each location inside the pages bundle. They exist only in the built bundle; the repository root holds none of them:

| Location | Required | Optional |
|:---:|:---:|:---:|
| pages bundle root | `meta.json`, `plugins.json`, `plugins/author_manifest.json`, `manifest.json`, `manifest.json.sig` | `tags.json` |
| `certs/<source id>/` | `<source id>-eec.crt`, covered by no manifest | `<source id>-eec-secret.pub`, likewise covered by none |
| `catalog/` | every author's `author.json`, `author_pub.pem` and `<plugin>/plugin.json`, copied verbatim and covered by no manifest | none |
| `plugins/<author>/` | `plugin_manifest.json`, `manifest.json`, `manifest.json.sig` | `author_pub.pem` |
| `plugins/<author>/<plugin>/` | `versions.json`, `manifest.json`, `manifest.json.sig` | none |
| `plugins/<author>/<plugin>/<x.y.z>/` | `meta.json`, `plugin.js`, `plugin.js.sig` | `plugin.js.author.sig` |

Directory naming, the `versions.json` shape and the `meta.json` fields are documented in [.github/bundle-layout.README.md](.github/bundle-layout.README.md). The collection certificate lives only at `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` and the root no longer carries an `eec.pem`; it only proves who signed and is covered by no manifest. The root certificate is not part of distribution content: it is distributed through the `certs` branch of DeepSeek-Chat-Enhanced and pinned by fingerprint inside the web client.

## Signing and verification

### Three roles

The scheme is built on OpenSSL PKI, with three roles each holding one key, so who signs what is unambiguous.

| Role | Holder | Material | Signs |
|:---:|:---:|:---:|:---:|
| Root CA | `DeepSeek-Chat-Enhanced` repository (the organisation mainline) | root private key (offline, never committed), root certificate | end-entity signing certificate `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` |
| End-entity signer (EEC) | this repository | EEC private key (CI secret `AWESOME_DSC_PLUGIN_EEC_SECRET`), `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` | detached CMS signatures for the three manifests and every version's `plugin.js` |
| Independent signer | plugin authors, omds-chat included | author key pair | bare public key signature over `plugin.js` |

### Certificate chain

Trust starts at the root certificate and runs all the way down to the bytes of a manifest and a plugin file.

```text
DeepSeek-Chat-Enhanced repository (root CA, offline)
  root_ca.crt
      │  issues
      ▼
  this repository's certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt (end-entity signing certificate)
      │  openssl cms -sign -binary -md sha512 -outform DER -nocerts -noattr
      ▼
  manifest.json.sig          L1 manifest signature
  plugins/<author>/manifest.json.sig              L2 manifest signature
  plugins/<author>/<plugin>/manifest.json.sig     L3 manifest signature
  plugins/<author>/<plugin>/<x.y.z>/plugin.js.sig artifact signature
```

| Item | Convention |
|:---:|:---:|
| Root CA key | ECDSA P-256, native OpenSSL PEM; WebCrypto support for P-256 is the broadest, certificate chain validation happens in the browser, and Ed25519 is unavailable on the target browser floor |
| Root certificate | self-signed X.509, `keyUsage=critical,keyCertSign,cRLSign`, `basicConstraints=critical,CA:TRUE,pathlen:0`, valid for 3650 days |
| EEC key | ECDSA P-256; the CMS implementation of OpenSSL reports `provider signature failure` for Ed25519, so Ed25519 cannot be used here |
| EEC certificate | issued by the root CA, `keyUsage=critical,digitalSignature`, `basicConstraints=critical,CA:FALSE`, valid for 365 days |
| Collection signature | detached CMS signature, `openssl cms -sign -binary -md sha512 -outform DER -nocerts -noattr`, stored as a sibling `.sig` file. Both signing and verification pass `-binary`, so raw bytes are signed without line-ending canonicalisation. The artifact is always DER and verification passes `-inform DER` |
| Author signature | detached bare public key signature, `openssl pkeyutl -sign -rawin`, Ed25519 author keys; a failed verification only warns and never blocks inclusion |

Both curves are hard constraints rather than preferences: switching to Ed25519 breaks chain validation or CMS verification outright on the target browsers and on OpenSSL.

### What gets signed

| Signature | Covers | Artifact |
|:---:|:---:|:---:|
| Collection CMS signature | one manifest per layer, L1 to L3 | `manifest.json.sig`, one per layer |
| Collection CMS signature | `plugin.js` of every version | `plugin.js.sig` |
| Author bare public key signature | `plugin.js`, optional | `plugin.js.author.sig` |

`meta.json` is no longer signed separately: the L3 manifest covers it by SHA-512, and the author public key is covered by L2.

### Commands

Collection signing and verification. The three manifests and `plugin.js` share one command and differ only in the file name:

```bash
openssl cms -sign -binary -md sha512 -outform DER -in manifest.json -out manifest.json.sig -signer certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt -inkey eec_secret.pem -nocerts -noattr
openssl cms -verify -binary -md sha512 -inform DER -in manifest.json.sig -content manifest.json -CAfile root_ca.crt -certfile certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt
```

`-md sha512` pins the digest algorithm instead of relying on the OpenSSL default, and `-outform DER` is not optional. The default output is an S/MIME `multipart/signed` wrapper, which browsers cannot parse, and the plugin market verifies signatures in the browser. DER is therefore the cross-repository format: signers always pass `-outform DER` and verifiers always pass `-inform DER`, and either side falling back to the default format breaks verification. Confirm the artifact with `openssl asn1parse -inform DER -in manifest.json.sig`.

To enable revocation checking, concatenate the root certificate and the CRL into a single `-CAfile` and add `-crl_check`: `cat root_ca.crt crl.pem > ca_with_crl.pem`. The `cms` subcommand in OpenSSL 3.5 has no `-CRLfile` option, so the CRL can only travel inside `-CAfile`.

### Author signatures

Plugin authors are independent signers: they do not go through this repository and do not depend on the certificate chain. An author signs the artifact with a bare public key signature and this repository only carries the artifact and the key verbatim:

- The author public key travels with the artifact and is stored as `plugins/<author>/author_pub.pem` (Ed25519, OpenSSL PEM), covered by the L2 manifest.
- The author's `dist/plugin.js.sig` is stored as `plugin.js.author.sig`, coexisting with the collection CMS signature `plugin.js.sig`; the file name tells the signers apart.
- Author signatures over `meta.json` are no longer carried: `meta.json` is covered by the L3 manifest and bound by the collection EEC.

Author signatures are optional. Without one, a version carries only this repository's EEC signature.

An author signature never blocks inclusion: a failed verification, or a key and signature that are not both present, only raises a warning in reports and logs. The reason is that the author layer is supplementary evidence. The collection already reviews the author and the plugin on the registration side, through the PR review of `catalog/` and the repository-level check; an author signature answers "did the author sign this copy" and does not change the inclusion decision. Since it plays no part in that decision, there is no reason to use it to stop content that has already been reviewed.

Both sides are required: a `plugin.js.author.sig` without `author_pub.pem`, or an `author_pub.pem` without `plugin.js.author.sig`, is reported as "unverified" and never as a pass. The first has a signature but no key to verify it with; the second has a key but no signature to verify. Neither offers usable evidence, so "not verified" must not be written up as "verified".

### Verification rules

`pnpm verify:bundle` checks every item below against the built pages bundle. Except for rule 12, which only warns, any failure exits non-zero with the full problem list. Every problem names its layer and file path.

| # | Rule |
|:---:|:---:|
| 1 | The collection certificate `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` exists (the root no longer carries an `eec.pem`), chains to the given root certificate (`--root-ca` or `ROOT_CA_PATH`), is not expired, has `digitalSignature` in `keyUsage` and is not a CA |
| 2 | Every plugin in the plugin index `plugins.json` appears in `plugins/<author>/plugin_manifest.json` and its plugin directory exists |
| 3 | Every plugin directory has `versions.json` and `latest` is present in `versions` |
| 4 | Every version directory has `meta.json`, `plugin.js` and `plugin.js.sig`, verified with `openssl cms -verify -binary -md sha512 -inform DER -CAfile <root> -certfile certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt`; a failure is an error |
| 5 | Author signatures are optional evidence and only warn, never block: when `plugin.js.author.sig` exists and `plugins/<author>/author_pub.pem` is usable, the signature is checked with `openssl pkeyutl -verify -pubin -rawin -inkey <key> -in plugin.js -sigfile plugin.js.author.sig`; a failure is a warning. A signature without a key, or a key without a signature, is reported as unverified and never as a pass. Other `*.author.sig` files are not checked |
| 6 | When `tags.json` exists, every `tag` in the plugin index `plugins.json` comes from it |
| 7 | All three manifests exist and are structurally valid: `schemaVersion` is 1, `revision` is a positive integer, `files` is a non-empty array, and each entry holds only `path` and `sha512` |
| 8 | Every `path` is valid: forward slashes, relative, no `..`, not the manifest itself, no duplicates |
| 9 | Coverage matches the layer exactly: every required file is listed and nothing extra is, so L3 never lists `plugin.js` or `plugin.js.sig` |
| 10 | Every recorded SHA-512 matches the file contents, and a mismatch names the layer and the file |
| 11 | Every `manifest.json.sig` verifies against the root certificate and `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt`; a failure is an error |
| 12 | Every `plugin.js` gets a static self-built-network scan: a global `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, or an `import(` of a remote address (`http://`, `https://`, `//`) reports a `PLUGIN_NETWORK_SELFTALK` warning with the matched literal and its line and column; plugins opening their own network channel do not follow the convention and should use the host's network capability instead. This is an inclusion contract, not a sandbox: a hit only warns and never blocks inclusion |

### Plugins opening their own network channel: a warning-only inclusion contract

Network access should go through the host's `context.net`. A plugin may forward or wrap it, but should not open a channel of its own: a self-built channel bypasses the host's connection policy, timeouts and observability, so the same plugin behaves differently on every host and its origins and permissions cannot be bounded. This is an inclusion contract, not a sandbox: a hit only produces a warning during the build and the bundle self-check. It never blocks inclusion and never intercepts the plugin at runtime.

`scripts/lib/plugin-network-scan.mjs` scans every `plugin.js` and reports a `PLUGIN_NETWORK_SELFTALK` warning for each hit, with the matched literal and its line and column:

| Literal | Meaning |
|:---:|:---:|
| `fetch(` | Global `fetch(`; `window.fetch(`, `globalThis.fetch(`, `self.fetch(` and `global.fetch(` also hit |
| `XMLHttpRequest` | Direct reference to the constructor, including `new XMLHttpRequest()` |
| `WebSocket` | Direct reference to the constructor, including `new WebSocket(...)` |
| `EventSource` | Direct reference to the constructor, including `new EventSource(...)` |
| `navigator.sendBeacon` | Includes `window.navigator.sendBeacon(...)`; a bare `sendBeacon(` also hits |
| `import('https://...')` | `import()` of a remote address: `http://`, `https://` or the protocol-relative `//host/path` |

Only direct calls on a global object match: the character before the method name is not a dot, or the call is explicitly written on `window`, `globalThis`, `self` or `global`. Forwarding and wrapping, such as `context.net.fetch(...)` or `net.fetch(...)`, are therefore untouched, and handing the host network capability to an internal module stays allowed.

This is a static text match, not a JavaScript parser, so it can misfire: the same words in comments, strings or regular expressions are reported too, while aliasing a global first (`const send = fetch; send(url)`) is not caught. On a misfire the author explains it in a code comment or in the pull request, or rewrites the call as a `context.net` forward. The rule describes the shape of the artifact: it is an inclusion contract, not a sandbox and not runtime protection, and says nothing about runtime behaviour.

On a hit, the build only records a warning and publishes the plugin as usual without touching `catalog/anomalies.json`; for an assembled pages bundle, `pnpm verify:bundle` also only warns and its exit code does not change.

### Verification semantics

- Pre-release verification in this repository is strict: `scripts/build-from-catalog.mjs` and every CI step abort with a non-zero exit code on any error, so non-compliant content is never distributed. Repository-level verification `pnpm verify:catalog` only checks the structure and certificate material of `catalog/` and `certs/` and needs no build output; the strict check for the pages bundle is `pnpm verify:bundle`, which covers the three manifests, their signatures, artifact signatures and cross-consistency; author signatures are outside that strict check, so a failed verification or an unpaired key and signature only warns and never changes the exit code. To relax missing manifests temporarily, pass `--allow-missing-manifest` to `scripts/verify-collection.mjs` directly. Without a root certificate the chain cannot be checked: `verify-collection.mjs` reports `ROOT_CA_MISSING` as an error and exits non-zero, while structure and hash checks still run; to run only those, add `--allow-placeholder-eec` (skeleton mode, which downgrades chain and signature problems to warnings). The artifact-side network scan runs both during the fetch stage of a build and in `pnpm verify:bundle`, and a hit only warns and never changes the exit code.
- Verification after distribution is lenient: on the plugin market side, certificate chain checks, plugin signature checks and web asset signature checks only warn. Author signatures behave the same way and only warn on failure. They never block and never fall back, and the user decides whether to continue.
- Signatures cover file bytes. Any change to line endings, indentation or whitespace breaks verification, and the repository uses LF everywhere.

### Requesting an EEC

The EEC certificate is issued by the root CA of the DeepSeek-Chat-Enhanced repository. This repository cannot self-sign it and cannot issue for other collections.

1. Generate the EEC private key and a certificate signing request (CSR) locally, with `CN` set to the collection name:

   ```bash
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out eec_secret.pem
   openssl req -new -key eec_secret.pem -out eec.csr -subj '/O=omds-chat/CN=awesome-dsc-plugin'
   ```

2. Submit `eec.csr` to the DeepSeek-Chat-Enhanced repository (the root CA maintainer) with the purpose, validity period and contact.
3. Write the issued certificate to `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` in this repository; the root no longer carries an `eec.pem`.
4. Put the contents of `eec_secret.pem` into the GitHub Actions secret `AWESOME_DSC_PLUGIN_EEC_SECRET`; never commit it.
5. After merge, CI checks the chain of `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` against the root certificate and aborts on a broken chain, an expired certificate, or a `keyUsage` or `basicConstraints` mismatch.

The root private key lives in the offline environment of the DeepSeek-Chat-Enhanced repository; this repository and CI neither have nor need it. The committed `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` carries public material only and is issued by that root CA; CI can also override it with the secret `AWESOME_DSC_PLUGIN_EEC`, and the override still has to pass the chain check.

## Maintainer self-check scripts

`scripts/` ships a set of standalone self-check scripts so a maintainer can cross-check the whole repository before CI runs. They add no new rules: `lib/catalog-checks.mjs`, `lib/collection-verify.mjs`, `lib/consistency-verify.mjs` and `lib/collection-meta.mjs` are the same modules `pnpm verify:catalog` and `pnpm verify:bundle` use, and these scripts only orchestrate them and print JSON.

| Script | Check | Needs build output |
|:---:|:---:|:---:|
| `check-authors.mjs` | Author directory names follow the GitHub username rule, and are unique case-insensitively (`Alice` and `alice` are the same user) | No |
| `check-plugins.mjs` | Plugin name rules, global uniqueness of plugin names, and a warning when authors share a bare plugin directory name | No |
| `check-versions.mjs` | `versions.json` agrees with the `plugins/` tree: latest listed, version directories and required files present, `meta.json` aligned | Yes |
| `check-manifests.mjs` | Coverage and SHA-512 of the three manifests, signatures included | Yes |
| `check-certs.mjs` | The end-entity signing certificate under `certs/` and its chain | No |
| `check-removed.mjs` | Structure of `removed.json` and the "removed yet still registered" contradiction | No |
| `check-site.mjs` | `site/tags.json` and `site/meta.json` agree with `catalog/` | No |
| `check-all.mjs` | Runs the seven checks above and prints one combined JSON | Depends |

Usage:

```bash
# One check at a time, human-readable output; exit code 1 when an error-level problem exists
node scripts/check-authors.mjs
node scripts/check-manifests.mjs --dir dist/pages --root-ca root_ca.crt

# One JSON object, easy for scripts to consume
node scripts/check-authors.mjs --json > temp/authors.json

# Combine results through a pipe
node scripts/check-authors.mjs --json | node scripts/summarize.mjs
node scripts/summarize.mjs temp/authors.json temp/certs.json

# Every check in one run, one combined JSON; the exit code reports whether all passed
pnpm check
```

`check-versions.mjs` and `check-manifests.mjs` only look at a built pages bundle: when the directory is absent they record a `BUNDLE_MISSING` warning and skip, and the exit code stays 0. The other checks read repository sources only.

### JSON fields

A single check result and the combined result are both one JSON object, not line text, so `JSON.parse` works directly:

| Field | Type | Meaning |
|:---:|:---:|:---:|
| `ok` | boolean | Whether the check passed; only `error`-level problems count, so any `error` makes it `false` |
| `check` | string | Check identifier, such as `authors`; the combined result uses `all` |
| `title` | string | Human-readable check name |
| `target` | string or null | What the check inspected (directory or file) |
| `counts` | object | `errors`, `warnings` and `problems` counters |
| `problems` | array | Problem list; every item has `code`, `path`, `message` and `level`, and combined results add `check` |
| `stats` | object | Per-check statistics |
| `checks` | array | Combined result only: `check`, `title`, `ok`, `target` and `counts` per check |

Exit codes: 0 passed, 1 an `error`-level problem exists, 2 usage error or runtime failure.

## Repository layout

```text
awesome-dsc-plugin/
├── .github/
│   ├── bundle-layout.README.md         plugin tree notes: three levels, required files and meta.json fields
│   ├── pipeline.README.md              pipeline notes: certificate location, bundle layout, manifest coverage, anomaly reporting
│   └── workflows/build-and-deploy.yml  repository check, pull plugins, re-sign, assemble the bundle, verify independently, report anomalies, publish
├── .gitattributes                      enforce LF line endings
├── .gitignore
├── LICENSE
├── README.md
├── README.en-US.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── catalog/                            registration: author identity, public key and plugin site
│   ├── README.md                       author guide
│   ├── removed.json                    plugins no longer hosted, ships with the bundle
│   └── <author>/                       one directory per author, named after username
│       ├── author.json                 author identity
│       ├── author_pub.pem              author public key, Ed25519, OpenSSL PEM
│       └── <plugin>/                   one directory per plugin
│           └── plugin.json             plugin registration, holds base_url and optional tags
├── certs/                              certificate source folders, shipped with the bundle, covered by no manifest
│   └── awesome-dsc-plugin/             source folder, named after the source id; holds the certificate and its matching public key
│       ├── awesome-dsc-plugin-eec.crt
│       └── awesome-dsc-plugin-eec-secret.pub
├── schemas/                            every JSON Schema of this repository
│   ├── README.md                       schema index
│   ├── manifest.schema.json            JSON Schema of the three manifests
│   ├── catalog-author.schema.json      JSON Schema of author.json
│   ├── catalog-plugin.schema.json      JSON Schema of plugin.json
│   ├── catalog-removed.schema.json     JSON Schema of removed.json
│   ├── catalog-index.schema.json       JSON Schema of the bundle catalog/index.json
│   └── plugins.schema.json             JSON Schema of the bundle plugins.json (the plugin index)
├── scripts/                            verification and build scripts; read their inputs, write dist/pages
│   ├── pki.mjs                         OpenSSL PKI wrapper, drives the CLI only
│   ├── lib/collection-verify.mjs       shared verification logic
│   ├── lib/plugin-network-scan.mjs     static self-built-network scan for plugin.js (inclusion contract, warning only)
│   ├── lib/catalog.mjs                 reads catalog registrations, fetches versions and artifacts via base_url
│   ├── lib/catalog-index.mjs           generates catalog/index.json and catalog/anomalies.json
│   ├── lib/layer-manifests.mjs         generates and signs the three manifests layer by layer
│   ├── lib/catalog-checks.mjs          repository checks for catalog/ and certs/
│   ├── lib/npm-package-check.mjs       strict npm package name check: registered name equals plugin name and exists on the registry
│   ├── lib/preflight-comment.mjs       renders the preflight report as the PR comment (fixed marker inside)
│   ├── lib/consistency-verify.mjs      cross-checks the collected information of a pages bundle
│   ├── lib/collection-meta.mjs         rules for the collection metadata site/meta.json
│   ├── lib/check-suite.mjs             self-check definitions, reusing the modules above
│   ├── build-from-catalog.mjs          assembles the pages bundle from catalog/, the CI entry point
│   ├── build-collection.mjs            re-signs or regenerates the three manifests for a built collection directory
│   ├── verify-catalog.mjs              repository check: structure and certificate material of catalog/ and certs/
│   ├── verify-collection.mjs           structure, manifests, signatures and artifact network scan of a pages bundle
│   ├── verify-catalog-consistency.mjs  cross-checks the collected information of a pages bundle
│   ├── verify-bundle.mjs               combines the two pages bundle checks into one entry point
│   ├── check-syntax.mjs                syntax check for every script and site source file
│   ├── report-build-anomalies.mjs      reports excluded plugins as an issue, never blocks the release
│   ├── check-*.mjs                     maintainer self-check scripts, one entry per check
│   ├── check-all.mjs                   combined self-check entry: every check, one combined JSON
│   ├── preflight.mjs                   preflight: catalog, manifests, signature placeholders, npm package names and artifact scan in one run
│   └── summarize.mjs                   merges several self-check results into one combined JSON
└── site/                               collection settings and showcase site project; its output goes to the bundle root
    ├── README.md                       site notes: data sources, build and output
    ├── build.mjs                       build script, Node built-ins only
    ├── package.json
    ├── meta.json                       collection metadata with the download counting switch; source of the bundle meta.json
    ├── tags.json                       preset tag list (including ui-enhance); source of the bundle tags.json
    └── src/                            site source: index.html and assets/
```

The repository root holds only `catalog/`, `certs/`, `schemas/`, `scripts/`, `site/` and the engineering files; `plugins.json`, `manifest.json`, `manifest.json.sig` and `plugins/` are never committed and exist only inside the built pages bundle, with page data, manifests and signatures produced by CI at Release time. Collection settings and site settings both live in `site/`: the collection metadata is `site/meta.json`, the preset tags are `site/tags.json`, and the showcase site project is `site/`. `dist/`, `site/dist/` and `temp/` are pure generated directories and are not committed; `single-branch/` holds the local workspace of the `ci-memory` branch and is not committed either. The verification semantics of `scripts/lib/collection-verify.mjs` and `scripts/pki.mjs` follow [dsc-plugin-set-template](https://github.com/omds-chat/dsc-plugin-set-template): change the template first and then sync this repository, so the two never drift.

## Collection metadata

`site/meta.json` only declares the download counting switch and is copied verbatim into the pages bundle root:

| Field | Value here | Meaning |
|:---:|:---:|:---:|
| `DOWNLOAD_COUNT_ENABLE` | `false` | When `true`, the plugin market sends a fire-and-forget POST to the counting endpoint on every download and tells the user that the source counts downloads |
| `DOWNLOAD_COUNT_API` | absent | Counting endpoint, only needed when counting is enabled |
| `API_NEED_IP` | `false` | Whether a counting request carries the public IP of the requester |

This collection does not enable download counting.

## Import flow

1. Open a PR that registers the plugin in `catalog/`: `catalog/<author>/author.json`, `catalog/<author>/author_pub.pem` and `catalog/<author>/<plugin>/plugin.json`. Fields, schemas and the submission checks are documented in [catalog/README.md](catalog/README.md).
2. After merge, CI pulls every registration at Release time: it fetches `versions.json` from `base_url` plus each version's `meta.json`, `plugin.js` and optional `plugin.js.author.sig`, writes them into the bundle's `plugins/` directory and re-signs every `plugin.js` with the collection EEC. Each fetched `plugin.js` first goes through the self-built-network scan, where a hit only logs a warning and the plugin is still included. An author signature that cannot be fetched or is empty is treated as absent: it only logs a warning and never excludes the plugin.
3. It assembles the pages bundle: the site output goes to the root, `meta.json` and `tags.json` come from `site/`, the plugin index `plugins.json` is generated from `catalog/`, `catalog/` (with `removed.json`, minus the authors and plugins excluded from this release) and `certs/` are copied over, `catalog/index.json` and `catalog/anomalies.json` are then written, and the L1, L2 and L3 manifests are generated and signed layer by layer.
4. It cross-checks the result: `scripts/verify-catalog-consistency.mjs` compares `catalog/index.json`, `plugins.json`, `plugins/author_manifest.json`, the `catalog/` copy and the `plugins/` tree, and aborts with a non-zero exit code listing every difference.
5. It publishes: CI verifies every manifest and every `plugin.js` independently with `openssl`, then checks the bundle layout, and only when everything passes writes the new manifests and signatures back to the `ci-memory` branch and pushes them before replacing the published site wholesale, keeping no versions. A failed write-back aborts the release.

The build separates three kinds of problem; the boundary is implemented in `scripts/build-from-catalog.mjs` and documented in [catalog/README.md](catalog/README.md):

| Kind | Decision | Build behaviour |
|:---:|:---:|:---:|
| Invalid registration | A registration file in `catalog/` is itself invalid: missing fields, `name` not matching its directory, malformed `tags`, or a tag outside the `tags.json` preset list | A registration error: the build aborts with a non-zero exit code, no plugin is published, and the author fixes the registration |
| Runtime anomaly | The author site fails to fetch (network, HTTP 4xx/5xx), the remote `versions.json` is invalid, the remote `meta.json` disagrees with the registration, or `plugin.js` is empty | Only that plugin is excluded from this release; every other plugin is built and published as usual, and the exclusion goes into `catalog/anomalies.json` and is reported as an issue |
| Network contract notice | `plugin.js` trips the self-built-network scan (`PLUGIN_NETWORK_SELFTALK`) | Only a warning is recorded; the plugin is built and published as usual and nothing goes into `catalog/anomalies.json`; this is an inclusion contract, not a sandbox |

Signing failures, manifest generation failures and bundle self-check failures are neither an author registration error nor a single-plugin runtime problem, so they still fail the build.

Every `tag` in the plugin index `plugins.json` comes from that plugin `plugin.json` `tags`, and an omitted `tags` means an empty array. Tag values must come from the preset list in `site/tags.json`; a tag outside it fails the build and names the plugin and the tag.

## How to submit a plugin

Registration lives in `catalog/`, with one directory per author and one `plugin.json` per plugin. Artifacts never enter this repository, so a PR that adds the three files below is the whole submission; no script or `.github/` change is needed:

```text
catalog/<author>/
├── author.json        author identity: username and profile
├── author_pub.pem     author public key, OpenSSL PEM, Ed25519
└── <plugin>/
    └── plugin.json    plugin registration: name, description, license, repo_link, base_url, optional tags
```

- `base_url` points at the plugin's own publishing site; CI fetches every version and artifact of the plugin from that address and re-signs them with the collection EEC before writing them into the pages bundle. Releases carry no assets and no assets are fetched from a release.
- `author_pub.pem` must be submitted even when no author signature is planned: a directory without the key is not accepted.
- Versions are not registered in `catalog/`; CI discovers them from `base_url`, so `catalog/<author>/<plugin>/` holds only `plugin.json` — do not create version or placeholder directories.
- To withdraw, delete your `catalog/<author>/` directory, append one entry to `catalog/removed.json` and open a PR.

Fields, the public key command, what happens after inclusion and the structural schemas are documented in [catalog/README.md](catalog/README.md).

## How the plugin market consumes this collection

The market reads collection metadata and the plugin catalog, then fetches each manifest, brings `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` into the trust anchors through the root certificate, verifies the manifest signature and only then fetches plugin files and artifact signatures. The table below is the path contract this repository promises, consumed in order relative to `base_url`.

| Step | Path | Purpose |
|:---:|:---:|:---:|
| 1 | `<base_url>/meta.json` | Decide whether the source enables download counting |
| 2 | `<base_url>/plugins.json` | The plugin index: every plugin, author and tag |
| 3 | `<base_url>/certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` | Fetch the collection end-entity certificate and validate its chain against the root certificate; the root has no `eec.pem` |
| 4 | `<base_url>/manifest.json` and `manifest.json.sig` | Verify the L1 signature and the SHA-512 values it records |
| 5 | `<base_url>/plugins/<author>/manifest.json` and `manifest.json.sig` | Verify the L2 manifest and obtain the author public key and plugin list |
| 6 | `<base_url>/plugins/<author>/<plugin>/manifest.json` and `manifest.json.sig` | Verify the L3 manifest and obtain digests of `versions.json` and every version's `meta.json` |
| 7 | `<base_url>/plugins/<author>/<plugin>/versions.json` | Fetch the version list and latest version |
| 8 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/meta.json` | Fetch plugin metadata and compare it with the digest recorded by L3 |
| 9 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/plugin.js` and `plugin.js.sig` | Fetch the runtime script and verify it against the collection certificate |
| 10 | `<base_url>/plugins/<author>/author_pub.pem` and `plugin.js.author.sig` | When an author signature exists, fetch the author key and signature; a failed check only warns and is never counted as a pass |

Any failed check only raises a warning and never blocks plugin loading, matching the lenient semantics described above.

`catalog/index.json` exists for this site's own display only: the author list (`username`, `profile`, plugin count) and the plugin list (author, name, description, license, repository link, current version, tags, version count), with the site falling back to `plugins/author_manifest.json` and `plugins.json` when it cannot read the index. It is not an entry point that saves the market requests, and the market must not depend on it to load catalog data. Nor may an aggregate index replace layer-by-layer fetching: the aggregate flattens registration data into one derived file that no manifest covers and no signature vouches for, so once it disagrees with the three manifests the market has no digest to verify, while fetching layer by layer yields exactly which files a layer holds and what their digests are.

`plugins.json` and `catalog/index.json` are both statistical listings: `plugins.json` only says which plugins exist, who authored them and which tags they carry, with no version, description or digest, while `catalog/index.json` is a derived summary used for display. Both serve author self-checks, quick overviews and third-party search; neither is the channel through which the host reads plugin information. The host fetches layer by layer: `versions.json`, each version's `meta.json` and the three manifests are what carry digests, and `plugin.js` carries its own detached `plugin.js.sig`. The per-file generator, consumer and signature coverage are listed in [docs/design/pages-artifacts.md](docs/design/pages-artifacts.md).

## Cross-origin access

The collection is hosted on GitHub Pages. Pages returns `Access-Control-Allow-Origin: *` for static assets by default, so distribution content is readable across origins and the host cannot narrow it to an allowlist. That is platform behaviour, not a setting of this repository.

The specification requires cross-origin sources to be limited to trusted origins, at minimum `https://omds-chat.github.io`. Moving distribution content to another host means configuring a CORS allowlist that at least permits that origin.

## Local checks

The two checks look at different things.

| Command | Target | When to run |
|:---:|:---:|:---:|
| `pnpm verify:catalog` | structure, fields, public key format, tag values, npm package name consistency (registry query) and certificate material of `catalog/` and `certs/` | before opening a registration PR; needs no build output; `pnpm verify` is an alias |
| `pnpm verify:bundle` | the built pages bundle: three manifests, manifest signatures, artifact signatures and cross-consistency | after a build and before publishing; needs `dist/pages` |
| `node scripts/preflight.mjs` | preflight: catalog registrations, certs, npm package names, the three manifests with signature placeholders and the artifact scan, aggregated in one report | before opening a PR; the same script the CI preflight job runs; offline, the npm check downgrades to a "skip online check" warning |

```bash
pnpm install
pnpm type            # syntax check: every script and site source parses
pnpm verify:catalog  # repository check, reads catalog/ and certs/ only, includes the npm name check
node scripts/preflight.mjs  # preflight, the same script the PR preflight job runs
pnpm build:site      # build the site into site/dist; the output goes to the pages bundle root
pnpm build           # needs AWESOME_DSC_PLUGIN_EEC_SECRET and ROOT_CA_PATH: assemble dist/pages from catalog/
pnpm verify:bundle --root-ca root_ca.crt   # pages bundle check
```

- Without a root certificate the chain cannot be checked: `verify-collection.mjs` reports `ROOT_CA_MISSING` as an error and exits non-zero while structure and every file's SHA-512 are still checked; add `--allow-placeholder-eec` to `scripts/verify-collection.mjs` (skeleton mode) to downgrade chain and signature problems to warnings. Set `ROOT_CA_PATH` or pass `--root-ca` for the full check.
- Author signatures never change the exit code: a failed verification or an unpaired key and signature only warns and does not affect whether `verify:bundle` passes.
- `pnpm build` is the same as calling `scripts/build-from-catalog.mjs`; the full local reproduction is:

  ```bash
  AWESOME_DSC_PLUGIN_EEC_SECRET=... ROOT_CA_PATH=root_ca.crt \
    node scripts/build-from-catalog.mjs \
    --catalog catalog --certs certs --site site/dist --out dist/pages \
    --ci-memory single-branch/ci-memory \
    --published-base https://omds-chat.github.io/awesome-dsc-plugin/
  ```

- The write-back is a separate step that only mirrors files; the pipeline commits and pushes with git:

  ```bash
  node scripts/write-ci-memory.mjs --bundle dist/pages --ci-memory single-branch/ci-memory
  git -C single-branch/ci-memory add -A
  git -C single-branch/ci-memory commit -m "chore(ci-memory): layer manifests for <tag>"
  git -C single-branch/ci-memory push origin HEAD:ci-memory
  ```

- Single steps remain available: `pnpm verify:consistency` cross-checks the collected information in `dist/pages`; `node scripts/report-build-anomalies.mjs --dry-run` prints the reporting request body without sending anything, and a real re-report only needs `GITHUB_TOKEN` without `--dry-run`.
- OpenSSL 3.0 or newer is required locally; the scripts only drive the `openssl` CLI and implement no cryptography.

## Security notes

- When a signature fails, the plugin market warns the user and suggests downloading again; it never runs silently.
- Inclusion is not endorsement. A signature only proves that distributed content matches its signer, not that plugin behaviour was reviewed.
- Keep private keys in CI secrets and local environment variables only. The EEC private key lives in `AWESOME_DSC_PLUGIN_EEC_SECRET`; the root private key never enters this repository. `.gitignore` already excludes `.env`.
- Replacing the EEC key pair requires replacing `certs/awesome-dsc-plugin/awesome-dsc-plugin-eec.crt` and requesting a new certificate from the DeepSeek-Chat-Enhanced repository; CMS signatures made with the old certificate stop verifying.
- Manifest and artifact signatures cover file bytes. Any change to line endings, indentation or whitespace breaks verification, and the repository uses LF everywhere; author artifacts must be LF too.
- Minifying the artifact is recommended: it shrinks the payload and avoids meaningless whitespace differences.

## License

Apache License 2.0, see [LICENSE](LICENSE).
