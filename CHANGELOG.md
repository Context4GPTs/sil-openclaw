# Changelog

All notable changes to the `sil-openclaw` plugin (npm `sil-openclaw`, ClawHub `@4gpts/sil`) are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Keep `## [Unreleased]` current as you work. `pnpm version <bump>` promotes it to a
dated release section, and `pnpm release` attaches that section to the ClawHub
release (`clawhub package publish --changelog`). See [README](./README.md#releasing).

## [Unreleased]

## [0.3.1] - 2026-06-24

### Added

- **Spec-Driven Shopping (SDS) is the operating model for created experts.** A
  created shopping expert now runs **entirely** on SDS — not coarse attribute
  matching, and not an optional layer. The persona left the sil store: it is the
  agent's host workspace **`SOUL.md`** (identity/voice), written by the engine via
  the host CLI — there is **no `persona.md`**. The sil store holds **four SDS
  behaviour artefacts**: two **required at creation** — **`domain_spec.md`** (deep
  *researched* niche expertise — how to buy well, the full mechanics; the agent
  researches it itself from web + knowledge, and **web-refreshes it on every
  query**) and **`intent_spec.md`** (the agent-specific **decomposition dimensions**,
  a PRD-style schema derived from the domain) — and **`user_spec.md`** (the user's
  domain-relevant facts + **hard constraints**) and **`playbook.md`** (the user's
  **buying taste** — price sensitivity, brand, preferences). **All four are required
  and present from creation** — seeded *partial* by the light setup, then **augmented
  every query** (we keep learning), never re-asked. The per-query **intent** (the
  dimensions filled in for one request) is
  **ephemeral** — only the dimension *schema* is persisted. The shop-time loop
  web-refreshes the domain, decomposes the request, lazily captures the user side,
  and layers **intent → playbook → user_spec → domain_spec** (a user-spec **hard
  constraint is inviolable** — routed to a real `sil_search` filter *and* a
  reject-at-pick rubric rule, never only soft `query` text), recommending with a
  "why" that visibly cites the intent + a stored user fact + a domain mechanic.
  Setup stays **light (≤10 questions)** — the depth comes from the agent's own
  research. All four artefacts ride the existing **`sil_profile_materialize`** store
  path (`domainSpec` + `intentSpec` + `userSpec` + `playbook` all required) with
  **no new tool** (the 8-tool manifest is unchanged) and the same atomic,
  validate-first, per-file-all-or-nothing discipline. Refinement can target the
  domain spec, the intent-spec dimensions, a user-spec fact/hard-constraint, or the
  buying taste as distinct refinable elements (a persona refinement refreshes
  `SOUL.md` via the host CLI).

## [0.3.0] - 2026-06-23

### Added

- **Create a tailored, sil-wired shopping expert — a real OpenClaw agent that
  shops its niche with no further setup.** A new agent-creation engine (the `sil`
  skill drives the host's own `openclaw` CLI — the plugin never writes the host
  config) materializes a dedicated shopping expert: a real `agents.list[]` entry
  with the **sil plugin enabled and the sil skill attached**, the persona injected
  as the agent's `SOUL.md` system framing, and the behaviour artefacts written by
  the new **`sil_profile_materialize`** tool into `$SIL_DATA_DIR/agents/<agentId>/`
  (`persona.md`, an optional `playbook.md` domain sub-skill, and a `profile.json`
  manifest the skill reads at runtime). The engine is validate-first and
  fail-closed: it checks the spec before any write (`invalid_request` — nothing
  written), refuses to clobber an existing agent (`collision` — never overwrites a
  persona or its wiring), and declares `created` only after the host's **own**
  `openclaw config validate` returns `valid: true` (any failed step is
  `persistence_failed` carrying the path + cause, nothing partial left behind).
  Creating an expert is **local and offline** — no registration, no token read,
  no network call; the expert registers the user later, on first shop. Host-CLI
  shapes are pinned to **`alpine/openclaw:2026.6.9`** (the sil-stage host). (#27,
  #30)
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
- **A created expert shops its niche like a trusted specialist, not a generic
  clerk.** When a session opens inside a created expert, the skill loads its
  `profile.json` → `persona.md` + `playbook.md` and runs a profile-driven
  shop-time loop: elicit **only the missing** load-bearing attributes in the
  playbook's priority order (never a fixed question battery, never re-asking what
  the user already stated), map answers to real `sil_search` params (`ship_to`
  left empty so the server resolves the registered default; a taste with no
  matching param folds into `query`/the rubric, never an invented filter), search,
  then reason over the candidates with the playbook's rubric and the persona's
  hard-rules / hard-no's — presenting results **best-first as `sil_search`
  returned them (never re-ranked)** and always with the domain "why". An
  empty-but-servable result relaxes a constraint and explains the change; a
  genuinely unservable domain gets an honest "no", never padded with junk; a
  non-`ok` status follows the tool's own `recovery`, never the empty-match path.
  Consumes the catalog tools **unchanged** — no new tool; the rubric is applied at
  reasoning time. (#31)
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
- **Refine an existing expert from what it observed in real sessions
  (self-reinforcement).** A targeted-amend loop sharpens a *named* expert without
  re-brainstorming it from scratch: load it with **`sil_profile_get`**, propose
  concrete refinements **grounded in observed evidence** from the just-run
  shopping session (a mapping that surfaced irrelevant items, a constraint the
  user volunteered but the playbook never captured, a candidate they rejected —
  never a generic, ungrounded "improvement"), let the user **confirm a subset**
  (per-proposal accept/reject — never inferred from silence or an off-topic
  answer), and persist **only** the confirmed subset by re-running
  **`sil_profile_materialize`** over that one `agentId`. The re-write is per-file
  atomic and dir-preserving — a failed persist leaves the prior expert intact and
  never serves a half-refined one (a torn manifest reads back as not-found,
  fail-closed). The improvement is **per-user and local** (written only to this
  user's `$SIL_DATA_DIR` — no server endpoint, no shared or cross-user signal, no
  identity round-trip) and **isolated** (touches only the named
  `agents/<agentId>/`; sibling experts and generic profile-less shopping are
  untouched). Adds **no new tool** — it composes the existing `sil_profile_get` +
  `sil_profile_materialize`; when no observed session is available it falls back
  to a guided amend and never fabricates observations. (#32)

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
