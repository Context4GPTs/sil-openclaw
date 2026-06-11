# sil — OpenClaw plugin

A [OpenClaw](https://docs.openclaw.ai) plugin for **sil**. It exposes the sil commerce tools to an agent running in an OpenClaw host: register an identity, read it back, and search and look up purchasable products in the sil catalog.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `sil_register` | _(none)_ | Starts browser-based registration. Returns an `auth_url` for the user to open; the plugin polls in the background and stores credentials once sign-in completes. |
| `sil_whoami` | _(none)_ | The registered user's identity (name and addresses), refreshing an expired token transparently. |
| `sil_search` | `query?`, `category?`, `price_min?`, `price_max?`, `cursor?`, `limit?` | A ranked list of purchasable variants (`id`, `title`, `price`, `availability`, `checkout_url`, `source`) plus a pagination `cursor`. |
| `sil_product_get` | `ids: string[]` | The matching products in UCP shape with fresh detail (description, options, featured variant), each variant carrying an `inputs` correlation; unresolved ids come back in `not_found`. |

Every tool returns the same envelope — a single text content block whose JSON body carries a `status` (`ok`, `not_registered`, `must_reregister`, `forbidden`, `invalid_request`, or `retryable`) and, on success, the tool's payload. All I/O happens inside a tool's `execute()`; `register()` opens nothing.

## Configuration

Two optional plugin-scoped keys, resolved at call time (override → env → default):

| Key | Env fallback | Default | Purpose |
|---|---|---|---|
| `sil_web_url` | `SIL_WEB_URL` | `https://sil.4gpts.com` | sil-web origin — the auth authority (registration, token refresh). |
| `sil_api_url` | `SIL_API_URL` | `https://sil-api.4gpts.com` | sil-api origin — the domain service (`sil_whoami` identity reads, `sil_search` / `sil_product_get` catalog calls). |

Set them under `plugins.sil.config` in your OpenClaw config. Override only for staging or self-hosted deployments.

## Developing

```bash
pnpm install     # install dependencies (Node 22+)
pnpm build       # tsc → dist/  (emits the plugin entry dist/index.js)
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

### How to add a tool

`src/tools/identity.ts` (`sil_register`, `sil_whoami`) is the reference group — it sets the `jsonResult` success shape and the structured-error envelope every real tool follows; `src/tools/catalog.ts` is the catalog counterpart. Adding a real tool is three steps:

1. Register the tool with `api.registerTool({...})` inside a `registerXTools(api)` group in `src/tools/`.
2. Wire that group into `register()` in `src/index.ts` (only needed for a new group).
3. Add the tool's `name` to `openclaw.plugin.json#contracts.tools`.

A drift-guard test set-compares the manifest's `contracts.tools` against the names `register()` registers and fails if they disagree, so step 3 is enforced, not optional. The full contributor guide — including why `register()` must stay synchronous — is in [`CLAUDE.md`](./CLAUDE.md).

## Releasing

`@4gpts/sil` publishes to **npm** (`@4gpts/sil`) and to **ClawHub** (the `code-plugin` family). Two steps — bump on every change, publish when ready:

```bash
# 1. Bump — your cadence, run on every shippable change:
pnpm version patch        # or: minor | major
#   runs typecheck + tests, bumps package.json#version, mirrors it into
#   openclaw.plugin.json, commits, tags v<x.y.z>, and pushes (commit + tag).

# 2. Publish — build once, ship the same tarball to both registries:
pnpm release:dry          # full build → pack → publish pipeline, uploads NOTHING
pnpm release              # npm publish + clawhub package publish
```

`package.json#version` is the single source of truth — `scripts/sync-version.mjs` keeps `openclaw.plugin.json`'s version in lock-step, and a version-parity test fails if they ever drift. `pnpm release` builds a clean `dist/`, packs one tarball, and uploads those exact bytes to both registries (no drift between what npm and ClawHub serve). It refuses to publish a dirty or untagged tree, or when you are not logged in — so run `pnpm version` first.

**Changelog:** keep the `## [Unreleased]` section of [`CHANGELOG.md`](./CHANGELOG.md) current as you work ([Keep a Changelog](https://keepachangelog.com/) format). `pnpm version` promotes it to a dated release section inside the version commit, and `pnpm release` attaches those notes to the ClawHub release (`clawhub package publish --changelog`). After a real publish, `clawhub package readiness @4gpts/sil` reports any remaining readiness blockers.

**One-time prerequisites:**

```bash
npm login                            # npm auth (publishConfig already sets access: public)
npm i -g clawhub && clawhub login    # ClawHub CLI + auth
```

Releases publish under the **`4gpts`** ClawHub org — the `CLAWHUB_OWNER` default, mirroring the `@4gpts` npm scope. You authenticate as an org member with `clawhub login` (and `npm login`); override the org with `CLAWHUB_OWNER` if needed.

## License

[Apache-2.0](./LICENSE). See [`NOTICE`](./NOTICE).
