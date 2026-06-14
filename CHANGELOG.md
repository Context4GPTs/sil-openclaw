# Changelog

All notable changes to the `sil-openclaw` plugin (npm `sil-openclaw`, ClawHub `@4gpts/sil`) are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Keep `## [Unreleased]` current as you work. `pnpm version <bump>` promotes it to a
dated release section, and `pnpm release` attaches that section to the ClawHub
release (`clawhub package publish --changelog`). See [README](./README.md#releasing).

## [Unreleased]

### Fixed

- **A catalog `422 source_rejected` is now classified non-retryable
  `invalid_request`, not source-named `retryable`.** A real source *rejection*
  (the source looked at the request and refused it — it can never succeed
  unchanged) was falling through to `retryableFromBody`, and because the 422 body
  carries a `source` it surfaced as the source-named `retryable` (outcome b) — a
  false instruction that told the agent to retry a doomed request while the real
  upstream cause was buried as a transient `detail`. Both catalog classifiers
  (`classifySearchResponse` / `classifyLookupResponse`, backing `sil_search` /
  `sil_product_get`) now special-case `422 → invalid_request` carrying the
  upstream `{ error, message }`, mirroring the existing `400` arm. The narrowing
  is exact: a `5xx`/`429 source_unavailable` stays `retryable`.

## [0.2.2] - 2026-06-13

### Fixed

- **`sil_register` no longer aborts registration on the first premature claim
  `404`.** The claim poll's first tick fires seconds in, before the user opens
  the auth URL — but the session row is created server-side only when they do, so
  the endpoint returns `404` (`not_found`) until then. That first `not_found` was
  grouped with the genuine terminals, killing registration before the human could
  act. `not_found` is now a keep-polling state (like `pending`), bounded by the
  30-min deadline: a session that never appears settles as `timeout`, never as
  `not_found`. Terminality now lives at the poll loop, not the wire classifier. (#18)
- **`400` / unexpected non-2xx claim responses now fail fast** via a new distinct
  `invalid_request` outcome, instead of riding the keep-polling `not_found` path
  and spinning to a misleading `timeout`. Unreachable from this client today (the
  plugin always sends a valid verifier), so it logs at WARN as contract-drift
  insurance.

## [0.2.1] - 2026-06-11

### Changed

- README restructured to be usage-first. Dropped the internal "How it works",
  "Configuration", and "Files on disk" sections and reduced "Security" to a
  pointer to [SECURITY.md](./SECURITY.md). Expanded the tool surface into a
  **Tools** section (Identity + Catalog, including the `sil_search` ship-to /
  serviceability filters), and added an **Identity & authentication** section
  (sil gives the agent an identity and the capability to transact with UCP
  merchants) and a **Skills** section documenting the bundled `sil` skill.
  Implementation and security internals now live solely in `SECURITY.md` and
  `openclaw.plugin.json#security`.
- Fixed `pnpm release`’s ClawHub upload: it now re-packs the built tarball under
  the scoped name `@4gpts/sil` (the bare plugin id `sil` is unclaimable — already
  owned by that package) instead of the failing `--name sil`, so npm
  (`sil-openclaw`) and ClawHub (`@4gpts/sil`) publish the same contents from one
  build.

## [0.2.0] - 2026-06-11

### Changed

- **Renamed the published package.** npm: `@4gpts/sil` → **`sil-openclaw`** (unscoped —
  npm has no implicit OpenClaw context, so the distribution name carries the suffix and
  matches the repo). ClawHub: `@4gpts/sil` → **`sil`** (the registry is inherently
  OpenClaw, so the `-openclaw` suffix is redundant; published under the `4gpts` org, from
  `openclaw.plugin.json#id`). `release.mjs` now passes `--name` so the two names diverge by
  design. The mistaken `@4gpts/sil` 0.1.0 is retired on both registries.
- README rewritten in the install-first style of the klodi OpenClaw adapter (Install,
  Host prerequisites, Config keys, Files on disk, Tool surface, Bundled skill, Security).

## [0.1.0] - 2026-06-11

### Added

- Identity tools `sil_register` and `sil_whoami`, and catalog tools `sil_search`
  and `sil_product_get`, exposed to an OpenClaw host as the `sil` plugin.
- npm + ClawHub publishing: the `pnpm version <bump>` cadence (bump → sync manifest
  → test → commit → tag → push) and `pnpm release` / `release:dry`, which build a
  clean `dist/`, pack one tarball, and publish the identical bytes to npm and
  ClawHub. `package.json#version` is the single source of truth, mirrored into
  `openclaw.plugin.json#version` and guarded by a version-parity test.
- Release hygiene shipped in the package: `CHANGELOG.md` (these notes, surfaced
  to ClawHub via `clawhub package publish --changelog`) and a `SECURITY.md`
  disclosure.
