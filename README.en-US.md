# awesome-dsc-plugin

The community plugin collection for dsc. Plugins are indexed, signed and distributed here under distribution specification v2, and the plugin market reads this collection's manifests, end-entity certificate and signatures to consume them.

[简体中文](README.md)

## Scope

This collection carries runtime plugins for dsc and is maintained by omdsc-dev. This repository is the end-entity signer (EEC) for omdsc-dev: it holds an end-entity signing certificate issued by the root certificate authority of the DeepSeek-Chat-Enhanced repository and uses it to produce CMS detached signatures over the plugin files it lists.

A plugin is accepted when:

- its artifact is a single browser ESM script that exports `activate(context)` and depends on neither Node built-ins nor a backend API;
- it comes with a buildable source repository or a reachable artifact, and `pnpm build` can reproduce it;
- its runtime metadata `meta.json` is complete and the plugin name matches `dsc-xxx` or `@scope/dsc-xxx`.

Plugins that need a backend, need native modules, or cannot be rebuilt in CI are not accepted.

Being listed is not a certification. The collection guarantees only that distributed content matches its signatures, and does not audit plugin behaviour.

## Signing and trust

### Three roles

The signing system is built on OpenSSL PKI. Three roles each hold one key, so it is always clear who signs what.

| Role | Held by | Holds | Signs |
|:---:|:---:|:---:|:---:|
| Certificate authority | the `DeepSeek-Chat-Enhanced` repository (the organisation's main repository) | root private key (offline, never committed), root certificate | the end-entity certificate `eec.pem` |
| End-entity signer (EEC) | this repository | EEC private key (CI secret `EEC_SECRET_KEY`), `eec.pem` | CMS detached signatures over plugin files |
| Independent signer | plugin authors, omdsc-dev included | author key pair | bare-public-key detached signatures over plugin files |

### Certificate chain

Trust starts at the root certificate and ends at the bytes of a plugin file.

```text
DeepSeek-Chat-Enhanced repository (root CA, offline)
  root_ca.crt
      │  issues
      ▼
  this repository's eec.pem (end-entity certificate)
      │  openssl cms -sign -binary -outform DER
      ▼
  plugins/<author>/<plugin>/<x.y.z>/meta.json.sig
  plugins/<author>/<plugin>/<x.y.z>/plugin.js.sig
```

| Item | Convention |
|:---:|:---:|
| Root CA key | ECDSA P-256, native OpenSSL PEM. WebCrypto support for P-256 is the broadest, certificate chain validation happens in the browser, and Ed25519 is unavailable on the target browser floor |
| Root certificate | X.509 self-signed, `keyUsage=critical,keyCertSign,cRLSign`, `basicConstraints=critical,CA:TRUE,pathlen:0`, valid 3650 days |
| EEC key | ECDSA P-256. The CMS implementation of OpenSSL reports `provider signature failure` for Ed25519, so Ed25519 cannot be used here |
| EEC certificate | issued by the root CA, `keyUsage=critical,digitalSignature`, `basicConstraints=critical,CA:FALSE`, valid 365 days |
| Collection signature | CMS detached signature, `openssl cms -sign -binary -outform DER -nocerts -noattr`, stored as `<file>.sig`. Both signing and verification pass `-binary`, so raw bytes are signed without line-ending canonicalisation; the artifact is always DER and verification passes `-inform DER` |
| Author signature | bare-public-key detached signature, `openssl pkeyutl -sign -rawin`, Ed25519 author keys |

Neither curve is a preference but a hard constraint: switching to Ed25519 breaks chain validation or CMS verification on the target browsers and in OpenSSL, for the reasons listed in the table above.

Signing and verification:

```bash
openssl cms -sign -binary -outform DER -in meta.json -out meta.json.sig -signer eec.pem -inkey eec_secret.pem -nocerts -noattr
openssl cms -verify -binary -inform DER -in meta.json.sig -content meta.json -CAfile root_ca.crt -certfile eec.pem
```

`-outform DER` is not optional. The default output is an S/MIME `multipart/signed` wrapper, which browsers cannot parse, and the plugin market verifies signatures in the browser. DER is therefore the cross-repository format: signers always pass `-outform DER` and verifiers always pass `-inform DER`, and either side falling back to the default format breaks verification. Confirm the artifact with `openssl asn1parse -inform DER -in meta.json.sig`.

### Author self-signatures

Plugin authors are independent signers. They do not go through this repository and do not depend on the certificate chain. Authors sign plugin files with a bare-public-key detached signature, and this repository only files the artifacts and the public key as they arrive:

- The author public key ships with the artifact and is stored as `plugins/<author>/author_pub.pem` (Ed25519, OpenSSL PEM).
- The author's `plugin.js.sig` and `meta.json.sig` are stored as `plugin.js.author.sig` and `meta.json.author.sig`, so they coexist with the collection CMS signatures and the file name tells the signer apart.

Author signatures are optional. When an author does not sign, that version carries only this repository's EEC signature.

### Verification semantics

- Verification before publishing is strict: `pnpm build` and every CI step stop with a non-zero exit code on an error, so non-conforming content is never distributed. `pnpm verify` runs in skeleton mode by default and only warns when the certificate chain is missing, as described under Local checks.
- Verification after distribution is lenient: when a web-file signature, a plugin signature or a certificate chain check fails, the plugin market **only warns**. It does not block, and it does not fall back to trusting anything. The user decides whether to continue.
- Signatures cover raw file bytes. Any change to line endings, indentation or whitespace breaks verification, and the repository uses LF everywhere.

### How to request an EEC

The EEC certificate is issued by the root CA in the DeepSeek-Chat-Enhanced repository. This repository cannot self-sign it, and cannot issue certificates for other collections.

1. Generate the EEC private key and a certificate signing request (CSR) locally, with the collection name as `CN`:

   ```bash
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out eec_secret.pem
   openssl req -new -key eec_secret.pem -out eec.csr -subj '/O=omdsc-dev/CN=awesome-dsc-plugin'
   ```

2. Submit `eec.csr` to the DeepSeek-Chat-Enhanced repository (the root CA maintainers), stating the purpose, the requested validity and a contact.
3. Put the returned certificate in the repository root as `eec.pem`, replacing the placeholder.
4. Put the contents of `eec_secret.pem` into the GitHub Actions secret `EEC_SECRET_KEY`. Never commit it.
5. After merge, CI verifies the `eec.pem` chain against the root certificate. A broken chain, an expired certificate, or the wrong `keyUsage` or `basicConstraints` aborts the build.

The root private key belongs to the offline environment of the DeepSeek-Chat-Enhanced repository. Neither this repository nor its CI can or needs to reach it. The `eec.pem` committed in this repository is a placeholder: it was not issued by the root CA, must not be used for real signatures, and must be replaced before distribution.

## Directory layout

Distribution specification v2 is deliberately tightly coupled: manifests, certificates, signatures and plugin payloads all live on one origin, which removes cross-origin injection paths.

```text
awesome-dsc-plugin/
├── .github/
│   ├── plugins-sources.json            source manifest, the only input that decides what is listed
│   ├── plugins-sources.README.md       field reference for the manifest
│   └── workflows/build-and-deploy.yml  import, verify the chain, sign, commit, publish
├── .gitattributes                      enforce LF line endings
├── .gitignore
├── LICENSE
├── README.md
├── README.en-US.md
├── eec.pem                             end-entity certificate, replaced once the root CA issues it
├── meta.json                           collection metadata, download counting switch
├── datalog.json                        plugin catalogue array, one entry per plugin (plugin_name, author, tag)
├── tags.json                           preset tags
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── plugins/
│   ├── author_manifest.json            registered authors
│   └── <author>/
│       ├── author_pub.pem              that author's Ed25519 public key
│       ├── plugin_manifest.json        that author's plugin list
│       └── <plugin>/
│           ├── versions.json           version list
│           └── <x.y.z>/
│               ├── meta.json           plugin runtime metadata
│               ├── meta.json.sig       collection CMS signature
│               ├── plugin.js           plugin runtime script
│               ├── plugin.js.sig       collection CMS signature
│               └── plugin.js.author.sig  author bare-key signature (optional)
└── scripts/
    ├── pki.mjs                         OpenSSL PKI wrapper, shell calls only, no cryptography
    ├── lib/collection-verify.mjs       shared verification logic
    ├── build-collection.mjs            verify, sign and produce dist/
    ├── verify-collection.mjs           read-only consistency check
    └── import-plugins.mjs              build and import plugins from the manifest
```

Naming rules and required files are in [plugins/README.md](plugins/README.md). `dist/` and `temp/` are generated and not committed: the former is written by `pnpm build`, the latter is the import working area.

## Collection metadata

The root `meta.json` declares the download counting switch only:

| Field | Value in this collection | Meaning |
|:---:|:---:|:---:|
| `DOWNLOAD_COUNT_ENABLE` | `false` | When `true`, the market fires one fire-and-forget POST per download and tells users this source counts downloads |
| `DOWNLOAD_COUNT_API` | absent | Counting endpoint, required only when counting is on |
| `API_NEED_IP` | `false` | Whether the counting request carries the caller's public IP |

Counting is off for this collection.

## How to get a plugin listed

1. Open a pull request against `.github/plugins-sources.json`, one entry per plugin, with `repo`, `author` and `plugin`, plus an optional `ref` or `profile`. Fields are documented in [plugins-sources.README.md](.github/plugins-sources.README.md).
2. After merge, CI imports the entry: it fetches the source, runs `pnpm install --frozen-lockfile` and `pnpm build`, writes the artifacts and author signatures into `plugins/<author>/<plugin>/<version>/`, then updates that plugin's `versions.json`, that author's `plugin_manifest.json` and the root `datalog.json`. The file-by-file mapping is in [plugins-sources.README.md](.github/plugins-sources.README.md).
3. Add tags by hand. New catalogue entries start with an empty `tag` array and need tags picked from `tags.json`. Undeclared tags are rejected by verification.
4. Merge and distribute. CI resolves the root certificate, verifies the `eec.pem` chain with `openssl verify`, signs `meta.json` and `plugin.js` of every version with `EEC_SECRET_KEY`, re-verifies `dist/`, commits the changes to `plugins/` and `datalog.json` back to the repository, and publishes `dist/` to Pages.

A failing import step skips that one plugin and logs the reason; the rest still run. A failing signing or verification step aborts the whole build.

## How the plugin market consumes this collection

The market reads collection metadata and the plugin catalogue first, then fetches version files and signatures by path, and finally anchors `eec.pem` in the root certificate. The table below is the path contract this repository publishes; the market reads these paths under each `base_url`.

| Step | Path | Purpose |
|:---:|:---:|:---:|
| 1 | `<base_url>/meta.json` | Check whether this source counts downloads |
| 2 | `<base_url>/datalog.json` | List plugins, authors and tags |
| 3 | `<base_url>/plugins/<author>/<plugin>/versions.json` | Read the version list and the latest version |
| 4 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/meta.json` | Read plugin metadata |
| 5 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/plugin.js` | Read the runtime script |
| 6 | `<base_url>/plugins/<author>/<plugin>/<x.y.z>/plugin.js.sig` and `meta.json.sig` | Read the collection CMS signatures |
| 7 | `<base_url>/eec.pem` | Read the end-entity certificate and verify its chain against the root certificate |
| 8 | `<base_url>/plugins/<author>/author_pub.pem` and `*.author.sig` | Read the author key and signatures when the version carries them |

Any failed check produces a warning only and does not block loading, matching the lenient semantics above.

## Cross-origin access

This collection is hosted on GitHub Pages. Pages serves static assets with `Access-Control-Allow-Origin: *` by default, so the distributed content is readable cross-origin, and the host side cannot narrow the allowed origins to a whitelist. That is platform behaviour, not a setting of this repository.

The specification requires cross-origin access limited to trusted origins, including `https://omdsc-dev.github.io` at the very least. If distribution is moved to another host, configure a CORS whitelist there that allows that origin at minimum.

## Local checks

```bash
pnpm install
pnpm verify        # read-only consistency check, chain and signatures degrade to warnings without a root certificate
pnpm build         # writes dist/ and build-info.json once verification passes
pnpm run import    # import plugins from the source manifest
```

- `pnpm verify` and `pnpm build` run in skeleton mode with warnings while no usable certificate chain exists, which suits an empty collection and local development. With a root certificate at hand, verify strictly:

  ```bash
  pnpm verify:strict --root-ca root_ca.crt
  ROOT_CA_PATH=root_ca.crt pnpm verify:strict
  ```

- Use `pnpm run import`. `pnpm import` is a built-in pnpm command, not this repository's import script.
- Run `pnpm sign --root-ca root_ca.crt` to produce CMS signatures with `EEC_SECRET_KEY` and emit `dist/`. It fails outright when the key does not match `eec.pem` or when no root certificate is supplied.
- OpenSSL 3.0 or newer is required locally. The scripts only call the `openssl` command line and implement no cryptography themselves.

## Security notes

- When a signature fails, the market warns the user and suggests downloading again. It does not run the plugin silently.
- Being listed is not a certification. A signature proves the content matches its signer, not that the plugin behaviour was audited.
- Keep private keys in CI secrets and local environment variables, never in the repository. The EEC key lives in `EEC_SECRET_KEY`; the root private key never enters this repository. `.gitignore` already excludes `.env`.
- Rotating the EEC key pair means replacing `eec.pem` and requesting a new certificate from the DeepSeek-Chat-Enhanced repository; CMS signatures made with the old certificate can no longer be verified.
- Signatures cover file bytes. Any change to line endings, indentation or whitespace breaks verification, and the repository uses LF everywhere. Author artifacts must be LF too.
- Minify plugin artifacts. It reduces size and removes meaningless whitespace differences.

## License

Apache License 2.0, see [LICENSE](LICENSE).
