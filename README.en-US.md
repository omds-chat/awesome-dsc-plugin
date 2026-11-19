# awesome-dsc-plugin

The dsc community plugin collection. Plugins are indexed, signed and distributed here under distribution specification v2, and the plugin market reads the three hash-manifest layers, the end-entity signing certificate and the signatures to obtain them.

[简体中文](README.md)

## Scope

This collection targets dsc runtime plugins and is maintained by omdsc-dev. This repository is omdsc-dev's end-entity signer (EEC): it holds an end-entity signing certificate issued by the root CA of the DeepSeek-Chat-Enhanced repository and uses it to produce detached CMS signatures for the three manifest layers and for every plugin artifact.

Inclusion criteria:

- The artifact is a single browser ESM script that exports `activate(context)` and depends on no Node built-in module and no backend endpoint.
- A buildable source repository or a reachable artifact URL is provided, and `pnpm build` reproduces it.
- The runtime metadata `meta.json` is complete and the plugin name matches `dsc-xxx` or `@scope/dsc-xxx`.

Plugins that need a backend service, a native module, or an artifact that cannot be rebuilt in CI are not accepted.

Inclusion is not endorsement. This collection only guarantees that distributed content matches its signatures; it does not review plugin behaviour.

## Distribution layout

Distribution content is a three-layer hash-manifest structure. Each layer has one `manifest.json` and one `manifest.json.sig`; a manifest records the SHA-512 of every file in its layer and the signature is produced by the end-entity signing certificate (EEC) issued by the root CA. Layers do not reference each other, so each one can be published, verified and re-signed on its own.

```text
<collection>/
├── eec.pem                    # end-entity signing certificate, shipped with Pages, covered by no manifest
├── meta.json                  # L1
├── datalog.json               # L1
├── tags.json                  # L1
├── manifest.json              # L1 manifest
├── manifest.json.sig          # L1 manifest signature
└── plugins/
    ├── author_manifest.json   # L1
    └── <author>/
        ├── author_pub.pem         # L2, author public key, OpenSSL PEM, Ed25519
        ├── plugin_manifest.json   # L2
        ├── manifest.json          # L2 manifest
        ├── manifest.json.sig      # L2 manifest signature
        └── <plugin>/
            ├── versions.json      # L3
            ├── manifest.json      # L3 manifest
            ├── manifest.json.sig  # L3 manifest signature
            └── <x.y.z>/
                ├── meta.json          # L3
                ├── plugin.js
                ├── plugin.js.sig        # collection CMS signature, covers the artifact itself
                └── plugin.js.author.sig # author bare public key signature, optional
```

| Layer | Location | Covered files (relative to the layer directory) |
|:---:|:---:|:---:|
| L1 | collection root | `meta.json`, `datalog.json`, `plugins/author_manifest.json` required, `tags.json` when present |
| L2 | `plugins/<author>/` | `author_pub.pem`, `plugin_manifest.json`, only when the file exists |
| L3 | `plugins/<author>/<plugin>/` | `versions.json` and every version directory's `meta.json` |

Manifest format, with the JSON Schema in `schemas/manifest.schema.json`:

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "files": [
    { "path": "datalog.json", "sha512": "<128 lowercase hex characters>" }
  ]
}
```

- `path` is relative to the directory holding the manifest, uses forward slashes, may not be absolute, may not contain a `.` or `..` segment, may not point at the manifest itself, and may not repeat.
- The hash is SHA-512 in lowercase hex, always 128 characters.
- `revision` is a positive integer per layer: it increments when the layer's file set or contents change, keeps its value when nothing changed, and starts at 1 without a previous manifest.
- L3 does not cover `plugin.js` or `plugin.js.sig`: the artifact itself is signed per version by `plugin.js.sig` and the manifest describes metadata only.
- `tags.json` is optional: when it exists it must be covered by the L1 manifest, and when it does not exist it is neither required nor listed.
- `meta.json.sig` and `meta.json.author.sig` are gone: the only collection signature inside a version directory is `plugin.js.sig`, and `plugin.js.author.sig` stays optional. `meta.json` is covered by the L3 manifest and bound by the collection EEC, while the author public key itself is covered by L2. The `dsc-plugin-template` repository still emits `meta.json.author.sig` and has to be synced.

The three layers are deliberately not folded together: L1 does not reference L2 and L2 does not reference L3, so each layer can be published, verified and re-signed on its own. The trade-off gives up "one check yields a digest of the whole tree" in exchange for per-plugin incremental updates: changing one plugin only increments the L3 `revision`, leaves L2 and L1 untouched, and clients refetch just that layer. Folding the layers into a single root manifest would make every plugin release rewrite the root manifest and force every client to refetch the whole digest.

All three `manifest.json` and `manifest.json.sig` files must be committed with the source. A `revision` is read back from the previous manifest of the same layer, so leaving them out of version control resets every layer to 1 on a fresh checkout and breaks revision continuity across CI runs; the manifests and their signatures are themselves distribution content, and `pnpm build` can regenerate them but cannot recover the historical `revision`.

## Required files

| Location | Required | Optional |
|:---:|:---:|:---:|
| collection root | `eec.pem`, `meta.json`, `datalog.json`, `plugins/author_manifest.json`, `manifest.json`, `manifest.json.sig` | `tags.json` |
| `plugins/<author>/` | `plugin_manifest.json`, `manifest.json`, `manifest.json.sig` | `author_pub.pem` |
| `plugins/<author>/<plugin>/` | `versions.json`, `manifest.json`, `manifest.json.sig` | none |
| `plugins/<author>/<plugin>/<x.y.z>/` | `meta.json`, `plugin.js`, `plugin.js.sig` | `plugin.js.author.sig` |

Directory naming, the `versions.json` shape and the `meta.json` fields are documented in [plugins/README.md](plugins/README.md). `eec.pem` only proves who signed; it is covered by no manifest. The root certificate is not part of distribution content: it is distributed through the online-data branch and pinned by fingerprint inside the web client.

## Signing and verification

### Three roles

The scheme is built on OpenSSL PKI, with three roles each holding one key, so who signs what is unambiguous.

| Role | Holder | Material | Signs |
|:---:|:---:|:---:|:---:|
| Root CA | `DeepSeek-Chat-Enhanced` repository (the organisation mainline) | root private key (offline, never committed), root certificate | end-entity signing certificates `eec.pem` |
| End-entity signer (EEC) | this repository | EEC private key (CI secret `EEC_SECRET_KEY`), `eec.pem` | detached CMS signatures for the three manifests and every version's `plugin.js` |
| Independent signer | plugin authors, omdsc-dev included | author key pair | bare public key signature over `plugin.js` |

### Certificate chain

Trust starts at the root certificate and runs all the way down to the bytes of a manifest and a plugin file.

```text
DeepSeek-Chat-Enhanced repository (root CA, offline)
  root_ca.crt
      │  issues
      ▼
  this repository's eec.pem (end-entity signing certificate)
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
| Author signature | detached bare public key signature, `openssl pkeyutl -sign -rawin`, Ed25519 author keys |

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
openssl cms -sign -binary -md sha512 -outform DER -in manifest.json -out manifest.json.sig -signer eec.pem -inkey eec_secret.pem -nocerts -noattr
openssl cms -verify -binary -md sha512 -inform DER -in manifest.json.sig -content manifest.json -CAfile root_ca.crt -certfile eec.pem
```

`-md sha512` pins the digest algorithm instead of relying on the OpenSSL default, and `-outform DER` is not optional. The default output is an S/MIME `multipart/signed` wrapper, which browsers cannot parse, and the plugin market verifies signatures in the browser. DER is therefore the cross-repository format: signers always pass `-outform DER` and verifiers always pass `-inform DER`, and either side falling back to the default format breaks verification. Confirm the artifact with `openssl asn1parse -inform DER -in manifest.json.sig`.

To enable revocation checking, concatenate the root certificate and the CRL into a single `-CAfile` and add `-crl_check`: `cat root_ca.crt crl.pem > ca_with_crl.pem`. The `cms` subcommand in OpenSSL 3.5 has no `-CRLfile` option, so the CRL can only travel inside `-CAfile`.

### Author signatures

Plugin authors are independent signers: they do not go through this repository and do not depend on the certificate chain. An author signs the artifact with a bare public key signature and this repository only carries the artifact and the key verbatim:

- The author public key travels with the artifact and is stored as `plugins/<author>/author_pub.pem` (Ed25519, OpenSSL PEM), covered by the L2 manifest.
- The author's `dist/plugin.js.sig` is stored as `plugin.js.author.sig`, coexisting with the collection CMS signature `plugin.js.sig`; the file name tells the signers apart.
- Author signatures over `meta.json` are no longer carried: `meta.json` is covered by the L3 manifest and bound by the collection EEC.

Author signatures are optional. Without one, a version carries only this repository's EEC signature.

### Verification rules

`pnpm verify` checks each item below and exits non-zero with the full problem list if any of them fails. Every problem names its layer and file path.

| # | Rule |
|:---:|:---:|
| 1 | `eec.pem` exists in the root, chains to the given root certificate (`--root-ca` or `ROOT_CA_PATH`), is not expired, has `digitalSignature` in `keyUsage` and is not a CA |
| 2 | Every plugin in `datalog.json` appears in `plugins/<author>/plugin_manifest.json` and its plugin directory exists |
| 3 | Every plugin directory has `versions.json` and `latest` is present in `versions` |
| 4 | Every version directory has `meta.json`, `plugin.js` and `plugin.js.sig`, verified with `openssl cms -verify -binary -md sha512 -inform DER -CAfile <root> -certfile eec.pem`; a failure is an error |
| 5 | When `plugin.js.author.sig` exists in a version directory, `plugins/<author>/author_pub.pem` must exist and the signature must verify with `openssl pkeyutl -verify`; a failure is an error. Other `*.author.sig` files are not checked |
| 6 | When `tags.json` exists, every `tag` in `datalog.json` comes from it |
| 7 | All three manifests exist and are structurally valid: `schemaVersion` is 1, `revision` is a positive integer, `files` is a non-empty array, and each entry holds only `path` and `sha512` |
| 8 | Every `path` is valid: forward slashes, relative, no `..`, not the manifest itself, no duplicates |
| 9 | Coverage matches the layer exactly: every required file is listed and nothing extra is, so L3 never lists `plugin.js` or `plugin.js.sig` |
| 10 | Every recorded SHA-512 matches the file contents, and a mismatch names the layer and the file |
| 11 | Every `manifest.json.sig` verifies against the root certificate and `eec.pem`; a failure is an error |

### Verification semantics

- Pre-release verification in this repository is strict: `pnpm build` and every CI step abort with a non-zero exit code on any error, so non-compliant content is never distributed. `pnpm verify` passes `--allow-placeholder-eec` by default for an empty collection and local development: a missing root certificate, an `eec.pem` that does not chain to it, or manifests and manifest signatures that do not exist yet become warnings. `--allow-missing-manifest` relaxes only the missing-manifest and missing-signature errors while structure and hash checks still run.
- Verification after distribution is lenient: on the plugin market side, certificate chain checks, plugin signature checks and web asset signature checks only warn. They never block and never fall back, and the user decides whether to continue.
- Signatures cover file bytes. Any change to line endings, indentation or whitespace breaks verification, and the repository uses LF everywhere.

### Requesting an EEC

The EEC certificate is issued by the root CA of the DeepSeek-Chat-Enhanced repository. This repository cannot self-sign it and cannot issue for other collections.

1. Generate the EEC private key and a certificate signing request (CSR) locally, with `CN` set to the collection name:

   ```bash
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out eec_secret.pem
   openssl req -new -key eec_secret.pem -out eec.csr -subj '/O=omdsc-dev/CN=awesome-dsc-plugin'
   ```

2. Submit `eec.csr` to the DeepSeek-Chat-Enhanced repository (the root CA maintainer) with the purpose, validity period and contact.
3. Overwrite the root `eec.pem` of this repository with the issued certificate.
4. Put the contents of `eec_secret.pem` into the GitHub Actions secret `EEC_SECRET_KEY`; never commit it.
5. After merge, CI checks the chain of `eec.pem` against the root certificate and aborts on a broken chain, an expired certificate, or a `keyUsage` or `basicConstraints` mismatch.

The root private key lives in the offline environment of the DeepSeek-Chat-Enhanced repository; this repository and CI neither have nor need it. The `eec.pem` committed here is a placeholder: it is not issued by the root CA and must not be used for real signing, and it must be replaced before any real distribution.

## Repository layout

```text
awesome-dsc-plugin/
├── .github/
│   ├── plugins-sources.json            import source manifest, editing it changes the result
│   ├── plugins-sources.README.md       field reference
│   └── workflows/build-and-deploy.yml  import, chain check, manifest signing, self-check, publish
├── .gitattributes                      enforce LF line endings
├── .gitignore
├── LICENSE
├── README.md
├── README.en-US.md
├── eec.pem                             end-entity signing certificate, overwritten by the root CA of DeepSeek-Chat-Enhanced
├── meta.json                           collection metadata, holds the download counting switch
├── datalog.json                        plugin catalog array, one entry per plugin (plugin_name, author, tag)
├── tags.json                           preset tags
├── manifest.json                       L1 manifest, committed with the source
├── manifest.json.sig                   L1 manifest signature, committed with the source
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── schemas/
│   └── manifest.schema.json            JSON Schema of the three manifests
├── plugins/
│   ├── author_manifest.json            registered authors
│   ├── manifest.json                   L2 manifests are generated per author directory
│   └── <author>/
│       ├── author_pub.pem              the author's Ed25519 public key
│       ├── plugin_manifest.json        the author's plugin list
│       ├── manifest.json               L2 manifest
│       ├── manifest.json.sig           L2 manifest signature
│       └── <plugin>/
│           ├── versions.json           version list
│           ├── manifest.json           L3 manifest
│           ├── manifest.json.sig       L3 manifest signature
│           └── <x.y.z>/
│               ├── meta.json           plugin runtime metadata
│               ├── plugin.js           plugin runtime script
│               ├── plugin.js.sig       collection CMS signature
│               └── plugin.js.author.sig  author bare public key signature (optional)
└── scripts/
    ├── pki.mjs                         OpenSSL PKI wrapper, drives the CLI only
    ├── lib/collection-verify.mjs       shared verification logic
    ├── build-collection.mjs            build and sign the three manifests, verify, produce dist/
    ├── verify-collection.mjs           read-only consistency check
    └── import-plugins.mjs              build and import plugins from the source manifest
```

The scripts under `scripts/` are byte-identical to [awesome-dsc-plugin-set-template](https://github.com/omdsc-dev/awesome-dsc-plugin-set-template). Change the template first and then sync this repository, so the two never drift in verification semantics. `dist/` and `temp/` are generated directories and are not committed: the first is produced by `pnpm build`, the second is the scratch workspace of the import step.

## Collection metadata

The root `meta.json` only declares the download counting switch:

| Field | Value here | Meaning |
|:---:|:---:|:---:|
| `DOWNLOAD_COUNT_ENABLE` | `false` | When `true`, the plugin market sends a fire-and-forget POST to the counting endpoint on every download and tells the user that the source counts downloads |
| `DOWNLOAD_COUNT_API` | absent | Counting endpoint, only needed when counting is enabled |
| `API_NEED_IP` | `false` | Whether a counting request carries the public IP of the requester |

This collection does not enable download counting.

## Import flow

1. Open a PR that edits `.github/plugins-sources.json`, one entry per plugin with `repo`, `author` and `plugin`, plus optional `ref` and `profile`. Fields are documented in [plugins-sources.README.md](.github/plugins-sources.README.md).
2. After merge, CI imports the plugins from the source manifest: fetch the source, run `pnpm install --frozen-lockfile` and `pnpm build`, write the artifact and the author signature into `plugins/<author>/<plugin>/<version>/`, then update that plugin's `versions.json`, the author's `plugin_manifest.json` and the root `datalog.json`. The file-by-file mapping is in [plugins-sources.README.md](.github/plugins-sources.README.md).
3. Tags are added by hand. A new entry starts with an empty `tag` array in `datalog.json` and needs tags picked from `tags.json`. Verification rejects tags that are not declared there.
4. Merge and distribute. CI resolves the root certificate, checks the `eec.pem` chain with `openssl verify`, signs every version's `plugin.js` and generates the three manifests plus their signatures with `EEC_SECRET_KEY`, verifies `dist/` again and self-checks the three manifest signatures against the root certificate, then commits the changes to `plugins/`, `datalog.json` and every `manifest.json` and `manifest.json.sig` back to the repository while publishing `dist/` to Pages.

A failure during import only skips that plugin and logs the reason; the remaining plugins are still processed. A failure during signing or verification aborts the whole build.

## How the plugin market consumes this collection

The market reads collection metadata and the plugin catalog, then fetches each manifest, brings `eec.pem` into the trust anchors through the root certificate, verifies the manifest signature and only then fetches plugin files and artifact signatures. The table below is the path contract this repository promises, consumed in order relative to `base_url`.

| Step | Path | Purpose |
|:---:|:---:|:---:|
| 1 | `<base_url>/meta.json` | Decide whether the source enables download counting |
| 2 | `<base_url>/datalog.json` | List every plugin, author and tag |
| 3 | `<base_url>/eec.pem` | Fetch the end-entity certificate and validate its chain against the root certificate |
| 4 | `<base_url>/manifest.json` and `manifest.json.sig` | Verify the L1 signature and the SHA-512 values it records |
| 5 | `<base_url>/plugins/<author>/manifest.json` and `manifest.json.sig` | Verify the L2 manifest and obtain the author public key and plugin list |
| 6 | `<base_url>/plugins/<author>/<plugin>/manifest.json` and `manifest.json.sig` | Verify the L3 manifest and obtain digests of `versions.json` and every version's `meta.json` |
| 7 | `<base_url>/plugins/<author>/<plugin>/versions.json` | Fetch the version list and latest version |
| 8 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/meta.json` | Fetch plugin metadata and compare it with the digest recorded by L3 |
| 9 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/plugin.js` and `plugin.js.sig` | Fetch the runtime script and verify it against `eec.pem` |
| 10 | `<base_url>/plugins/<author>/author_pub.pem` and `plugin.js.author.sig` | When an author signature exists, fetch the author key and signature |

Any failed check only raises a warning and never blocks plugin loading, matching the lenient semantics described above.

## Cross-origin access

The collection is hosted on GitHub Pages. Pages returns `Access-Control-Allow-Origin: *` for static assets by default, so distribution content is readable across origins and the host cannot narrow it to an allowlist. That is platform behaviour, not a setting of this repository.

The specification requires cross-origin sources to be limited to trusted origins, at minimum `https://omdsc-dev.github.io`. Moving distribution content to another host means configuring a CORS allowlist that at least permits that origin.

## Local checks

```bash
pnpm install
pnpm verify        # read-only consistency check; chain, manifest and signature problems downgrade to warnings without a root certificate
pnpm build         # generate the three manifests and dist/ after verification, plus build-info.json as the distribution index
pnpm run import    # import plugins from the source manifest
```

- `pnpm verify` and `pnpm build` run in skeleton mode when no usable certificate chain is available, which suits an empty collection and local development. Once the root certificate is at hand, verify strictly:

  ```bash
  pnpm verify:strict --root-ca root_ca.crt
  ROOT_CA_PATH=root_ca.crt pnpm verify:strict
  ```

- `pnpm build` without `--sign` only generates manifests and produces no signatures: whenever a manifest changes, the script deletes that layer's stale `manifest.json.sig` so a manifest that can never verify is not distributed. Use `pnpm sign` to sign: it reads `EEC_SECRET_KEY`, signs every version's `plugin.js` and the three manifests, and first confirms that the key matches `eec.pem`. Verification after signing needs a root certificate, so run `ROOT_CA_PATH=root_ca.crt pnpm sign`, or call the script directly with `--root-ca`.
- Use `pnpm run import` for imports. `pnpm import` is pnpm's own command, not this repository's import script.
- OpenSSL 3.0 or newer is required locally; the scripts only drive the `openssl` CLI and implement no cryptography.

## Security notes

- When a signature fails, the plugin market warns the user and suggests downloading again; it never runs silently.
- Inclusion is not endorsement. A signature only proves that distributed content matches its signer, not that plugin behaviour was reviewed.
- Keep private keys in CI secrets and local environment variables only. The EEC private key lives in `EEC_SECRET_KEY`; the root private key never enters this repository. `.gitignore` already excludes `.env`.
- Replacing the EEC key pair requires replacing `eec.pem` and requesting a new certificate from the DeepSeek-Chat-Enhanced repository; CMS signatures made with the old certificate stop verifying.
- Manifest and artifact signatures cover file bytes. Any change to line endings, indentation or whitespace breaks verification, and the repository uses LF everywhere; author artifacts must be LF too.
- Minifying the artifact is recommended: it shrinks the payload and avoids meaningless whitespace differences.

## License

Apache License 2.0, see [LICENSE](LICENSE).
