# Changelog

All notable changes to the `sil-openclaw` plugin (npm `sil-openclaw`, ClawHub `@4gpts/sil`) are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Keep `## [Unreleased]` current as you work. `pnpm version <bump>` promotes it to a
dated release section, and `pnpm release` attaches that section to the ClawHub
release (`clawhub package publish --changelog`). See [README](./README.md#releasing).

## [Unreleased]

### Added

- **The `sil` skill now runs a brainstorm interview before creating a shopping
  expert.** An open, back-and-forth interview converges five sections *with* the
  user — domain framing, persona, elicitation style, answer→`sil_search`-param
  mapping, and recommendation rubric — eliciting BOTH the domain's
  decision-attributes AND the user's own tastes/budget/constraints, then
  assembles a tailored spec the agent-creation engine materializes via
  `sil_profile_materialize`. Nothing is created until the user explicitly
  endorses the assembled draft (abandon-mid-flow leaves nothing written, no
  teardown); a vague domain is narrowed with the user first; a name collision
  offers refine-or-rename and never clobbers. The mapping targets only real
  `sil_search` params (budget → `price_min`/`price_max` in minor units, "prefer
  secondhand" → `condition`, niche → `query`/`category`) and leaves `ship_to`
  empty so sil resolves the registered default server-side.
- **Local expert lifecycle — list, view, and remove the shopping experts you
  create.** Three new tools manage the artefact store the create-engine writes
  (`$SIL_DATA_DIR/agents/<id>/`): `sil_profile_list` enumerates your experts
  most-recently-created first (sourced from each `profile.json` manifest — the
  authoritative "is a sil expert" signal — with one corrupt manifest isolated
  in `unreadable[]`, never aborting the listing); `sil_profile_get` returns one
  expert's full detail (name, persona, optional playbook, manifest path,
  createdAt); and `sil_profile_remove` deletes exactly one validated expert's
  behaviour-artefact directory. All three make no network call and read no
  token — generic profile-less shopping is unchanged. Removal is the **artefact
  half only**: the host-wiring half (`openclaw agents remove`) is host-CLI
  driven and runs **first** (a failed artefact step then leaves only harmless,
  list-surfaced disk cruft — never a broken-but-loading expert), and the skill
  **confirms before removing**. `sil_profile_remove` is fail-closed and scoped:
  a malformed/traversal/`main` id is rejected (`invalid_request`) and deletes
  nothing, an absent id is `not_found` (idempotent — safe to re-run), and a
  genuine filesystem failure is `persistence_failed` with the path + cause —
  never a thrown error across the tool boundary. The list/view/remove flow lives
  in its own progressive-disclosure reference, `references/manage_experts.md`,
  which the router routes the manage intents to.

### Changed

- **Restructured the bundled `sil` skill to progressive disclosure
  (skill-creator convention).** `skill/SKILL.md` is now a maximally-lean pure
  router: frontmatter, a one-paragraph role, the three always-on behavioural
  principles, a brief session-start note, and an intent→tool→reference routing
  table — nothing more. The detailed procedures moved into self-contained
  references loaded on demand: `references/catalog_tools_reference.md` (the four
  core tools' per-tool behaviour + the shared status taxonomy),
  `references/brainstorm_interview.md` (the interview),
  `references/agent_creation_engine.md` (the ordered creation engine),
  `references/search_param_mapping.md` (the answer→`sil_search`-param mapping),
  and `references/manage_experts.md` (the list/view/remove flow), with a worked
  end-to-end walkthrough under `examples/road_cycling_expert_walkthrough.md`.
  The endorsement-before-engine gate now lives as the router's two-step trigger
  (interview first; engine only after explicit endorsement). The
  contributor-facing "adding a tool" prose — duplicated from the repo
  `CLAUDE.md` and never needed at runtime — was removed from the skill entirely.
  No detail is duplicated between the router and any reference.

## [0.2.4] - 2026-06-18

### Fixed

- **`sil_register` now steers users into their device's default browser before the
  Auth0 leg, so registration completes first-try from in-app/embedded webviews.** An
  auth link opened in an app's built-in webview dead-ends — Auth0 can't set its
  session cookie in a partitioned webview, so login bounces with `?error=`. The
  `awaiting_browser` return now carries an explicit instruction, in both the
  human-facing `message` and the agent-facing `instructions`, to open the link in the
  **default browser (Safari, Chrome, …), not this app's built-in browser** — before
  the link is ever opened, steering a webview user out ahead of the Auth0 leg. The
  `auth_url` value is byte-for-byte unchanged and the link stays atomically
  angle-bracket-wrapped on its own line (the #24 invariants hold); no new tool and no
  webview detection (the host exposes no surface signal, so the steer ships
  unconditionally). (#25)

## [0.2.3] - 2026-06-16

### Added

- **`sil_search` and `sil_product_get` now surface evaluate-before-buy detail.**
  Beyond the purchasable variant, results carry — where the source provides them —
  the product/variant `url` (the page to VIEW / learn more, distinct from the
  buy-committing `checkout_url`), a short `description`, `media`, the product
  `options` menu, the `seller` with its policy/info links (shipping & return/refund
  policies, terms), and arbitrary `metadata`. The tool descriptions teach the three
  distinct actions — VIEW (`url`), DIG IN (`seller.links`), BUY (`checkout_url`) — so
  an agent can compare, answer "what's their return policy?", and hand back the right
  link without conflating viewing with buying. (#23)

### Changed

- **`sil_search`: replaced the `ships_from` filter with a `local_merchants` boolean
  bias.** It nudges shops based in the shopper's own country up the ranking,
  best-effort — it does NOT restrict results to them (some local shops go
  undetected, some non-local ones still appear). The agent passes no country: sil
  resolves it server-side from the registered address. To actually surface local
  stores, issue the `query` in the shopper's own language (a French query surfaces
  French shops). (#20)

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

- **`sil_search` / `sil_product_get` surface `user_not_provisioned` as a distinct
  `forbidden` outcome and clear the structurally-dead token**, so the next
  `sil_register` re-onboards the user instead of short-circuiting to
  `already_registered`. A `principal_mismatch` or unknown 403 reason stays
  recoverable and is NOT cleared. (#21)

- **Catalog transient (5xx) failures now name the failed source** when the wire
  carries one — "the catalog source X is temporarily unavailable; sil itself is
  fine" — instead of mis-attributing one degraded source to sil being down, which
  would make the agent abandon a healthy platform. (#19)

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
