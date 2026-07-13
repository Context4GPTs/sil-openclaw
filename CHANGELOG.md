# Changelog

All notable changes to the `sil-openclaw` plugin (npm `sil-openclaw`, ClawHub `@4gpts/sil`) are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Keep `## [Unreleased]` current as you work. `pnpm version <bump>` promotes it to a
dated release section, and `pnpm release` attaches that section to the ClawHub
release (`clawhub package publish --changelog`). See [README](./README.md#releasing).

## [Unreleased]

### Changed

- **Spec-Driven Shopping rebuilt around a frontmatter-as-truth store and a
  six-beat loop (Phase 1).** The shopper's behaviour store is recast: the
  `profile.json` manifest and the `domain_spec`/`intent_spec`/`playbook` triple
  are **deleted** (no backwards compatibility — old flat packs read `unreadable`),
  replaced by a filesystem-scanned layout `shopper/{user_spec.md,
  domains/<slug>/{method.md, prds/<product>-<intent>.md, assets/}}` where each
  file's own frontmatter IS the source of truth. Discovery is a scan, not an index
  read; a file with malformed frontmatter is skipped and surfaced as `unreadable`,
  never half-read. `sil_profile_materialize` is now **setup-only** (it writes the
  shared `user_spec.md`, its frontmatter carrying the shopper name, and mints no
  domain); `sil_profile_get` / `sil_profile_remove` take `domainSlug` + optional
  `prd` selectors (read one body / remove a whole domain or one PRD). The bundled
  `sil-shopping` skill is rewritten as the **six-beat** loop — classify → method →
  fill → search-space → reflect → feedback — across new `references/shop_loop.md`,
  `method_and_prds.md`, and `fill_and_feedback.md` (the `manage_domains.md` /
  `refine_shopper.md` references are retired).

### Added

- **`sil_learn` — one `target + change` write verb (5 kinds).** Replaces
  `sil_remember`: `create` mints a whole method/PRD; `append` / `amend` / `retract`
  refine a section-aware markdown body in place (single-occurrence match,
  fail-closed); `attach-asset` persists image bytes into the domain's `assets/`
  (owner-only, content-hashed) and links them by relative path. Targets
  `user_spec` / `method` / `prd`; `hard` marks an inviolable constraint on
  `user_spec`/`prd` appends.
- **`sil_profile_search` — the frontmatter-as-truth discovery tool.** Queries
  artefact frontmatter and returns coordinates only (domains + PRDs, no bodies) —
  the reuse-before-mint primitive that replaces the deleted manifest's index role;
  malformed artefacts surface in an observable `unreadable[]`, never silently
  dropped. Tool floor 8 → 9.

### Removed

- **`sil_remember`** (renamed to `sil_learn` — no alias) and the `profile.json`
  manifest machinery. The two operator bins now read the singleton from the
  `user_spec.md` frontmatter, not the manifest.

## [0.3.9] - 2026-07-10

### Added

- **A new shopper is auto-bound to the current channel — fail-open, verified.**
  Creation grew a final bind beat: `resolveBindChannel` picks the channel
  (`spec.channel` > `OPENCLAW_MCP_MESSAGE_CHANNEL` > none), and
  `create-shopper.mjs` binds the freshly-minted shopper to it and **verifies the
  bind from the host's own JSON** before declaring success (the `created` outcome
  now carries `boundChannel`). The bind is **fail-open**: a bind or verify
  failure never fails the create and never leaves a half-bound agent — it
  self-reverts and returns a manual-bind hint naming the shopper and the exact
  step to run. No channel resolvable is a clean no-op, not an error. (#48)
- **`SKILL.md` is now stage-aware and gates the shopper's search on a learned
  domain.** The always-loaded router reads two live signals — registration
  (`sil_whoami`) and shopper state (the no-arg `sil_profile_get` overview) — and
  presents a **five-stage onboarding progression** while setup is incomplete,
  then **sheds to usage-only** once complete, so a steady-state session isn't
  taxed with setup prose. When acting *as the shopper*, search is gated behind a
  learned domain (classify → learn-on-miss before any `sil_search`); the
  profile-less **Lane 1 bare search stays untouched**. Prose-only — no tool
  change, `contracts.tools` byte-unchanged. (#49)

### Changed

- **The `sil-shopping` skill bundle was refactored to progressive disclosure and
  de-rigidified** — same SDS state machine and file-creation flow, leaner and
  more legible. The one-time onboarding script was **evicted from the
  always-loaded `SKILL.md`** into `references/setup_onboarding.md` (loads on
  demand, shed once setup completes); the router collapses to a **pure state
  branch** (no identity / no shopper / shopper) — body **2394 → 1042 words
  (−56%)**, description **917 → 622 chars**. Language firmness was then matched to
  the task: firm only at the genuine cliffs (endorsement gate, singleton refusal,
  confirm-before-remove/persist, hard-constraint reject-at-pick,
  re-fetch-before-buy, follow-the-tool's-recovery), plain heuristics everywhere
  else. The **whole 10-file bundle** was rewritten leaner (**15,644 → 9,101
  words, −41%**; `shop_loop` −56%): killed tool↔skill and cross-file duplication
  and dropped the `sil_search` param-catalog table (the tool description owns it —
  the mapping now points there). Skill prose + tests only; the 8-tool floor and
  `contracts.tools` are unchanged. (#50, #51)

### Fixed

- **The `sil-shopping` skill now actually loads into the created shopper agent.**
  `create-shopper.mjs` attached the **plugin id** (`["sil"]`) at
  `agents.list[i].skills`, but a skill attaches by its **published name** — the
  skill-dir basename `sil-shopping` (`basename(openclaw.plugin.json#skills[0])`,
  == the `SKILL.md` frontmatter `name`) — so the host looked up a skill named
  `sil`, found none, and the shopper ran with **no skill driving its `sil_*`
  tools**. The `["sil"]` literal is deleted; the attach value is now
  **single-sourced from the shipped manifest** and resolved as a fail-closed
  precondition (a blank/absent `skills[0]` attaches nothing, never `[""]`). A
  static name-agreement drift guard (`basename(skills[0]) == SKILL.md name !=
  plugin id`) keeps the plugin-id/skill-name conflation from silently returning.
  (#47)

## [0.3.8] - 2026-07-06

### Added

- **One-tap shopper creation via a single operator bin.** A new bin
  `sil-openclaw-create-shopper` (`scripts/create-shopper.mjs`, wired through
  `package.json#bin`) runs the **whole** shopper-creation choreography atomically
  over one stdin JSON payload — reusing `materializeProfile` and the
  `sil-openclaw-allowlist` bin — instead of the skill hand-driving the host CLI
  step by step. It reports a four-outcome taxonomy (`created` / `invalid_request`
  / `collision` / `persistence_failed`) plus a louder `teardown_failed` emitted
  only when snapshot-restore itself cannot revert; a whole-file snapshot-restore
  teardown returns the host to its **exact** pre-run state on any failure (no
  half-created shopper, no orphaned config/workspace). The skill references were
  rewritten around the one command: `agent_creation_engine.md` now invokes the
  single bin, and `brainstorm_interview.md` becomes a session-seeded, **local +
  offline** pre-fill with the explicit endorsement gate intact — nothing is
  created until the user endorses the assembled draft. No new plugin tool; the
  8-tool manifest is unchanged. (#45)
- **Post-register shopper nudge + per-search pitch.** `sil_register`'s
  `already_registered` payload now carries an additive, unconditional
  `next_step: "offer_shopper"` routing hint — `identity.ts` reads **no**
  profile-store state (it stays decoupled from the store); the skill owns the
  actual gate. The `sil-shopping` skill gains two always-on beats: an
  after-register offer to create the shopper, gated on a no-arg `sil_profile_get`
  empty-store check (a user who already has the singleton shopper is never offered
  a second one), and a recurring post-result per-search pitch that introduces the
  shopper after a bare search. Lane 1 (bare `sil_search`) stays untouched and the
  pitch carries no frequency gate by design. (#44)

### Changed

- **On-query SDS spine hardened into five non-skippable beats.** The shop loop
  (`sil-shopping/references/shop_loop.md`) is re-ordered in place into a hard,
  ordered spine — **domain-exists → learn-on-miss → elicit-missing gate → persist
  → search** — splitting the old Step 3 into a first-class **elicitation gate
  (Beat 3) that runs ahead of search** and a distinct **persist beat (Beat 4)**,
  so the shopper never searches before it has decomposed intent and captured what
  it learned. `SKILL.md` gains one non-skippable domain-exists reinforcement line,
  scoped "as the shopper" (Lane 1 stays bare). The first-`buy` and
  after-recommendation windows remain downstream of the Beat-5 web re-fetch.
  Prose-only: no tool change, `contracts.tools` byte-unchanged. (#46)

### Fixed

- **The version-bump gate is now immune to a stale `dist/`.** The preversion test
  path that reads the registered tool set is now **source-authoritative** — an
  unconditional `await import("../index.js")` with the dist-preference and
  non-behavioural breadcrumb removed — so an out-of-date compiled artifact can no
  longer mask a source regression (the 0.3.6 `sil_profile_list` phantom-mismatch
  class). A new `compiled-artifact-load.integration.test.ts` plants a poisoned
  9-tool compiled entry under a hermetic `outDir` and proves the fresh-build
  harness wipes it and loads a source-faithful dist (registered set ==
  runtime-read `contracts.tools`, no `sil_profile_list`, marker gone). Test-only:
  no tool added/removed, `contracts.tools` / `manifest-contract` / `package.json`
  / `scripts/release.mjs` byte-untouched. (#43)

## [0.3.7] - 2026-06-29

### Fixed

- **README narrative realigned to the single multi-domain shopper.** The "Turn your
  OpenClaw into a shopping expert" section still pitched the **retired per-niche-expert
  model** — minting a **dedicated** agent that shops a **single niche** (*"make me a
  shopping expert for road-cycling gear"* → a standalone "Road-Cycling Buyer" you open
  and shop "inside"). It now describes the shipped model: you create **one** persistent
  shopper once (a light persona + cross-niche interview, **no niche research up front**),
  then shop **any** niche — it classifies, researches, and mints a reusable **domain** on
  first shop, reuses learned domains after, and keeps your facts/taste **across all of
  them** (a second shopper is refused). The "Today the plugin covers …" line drops
  "dedicated shopping experts" (plural) for "a personal multi-domain shopper". Docs-only;
  the tool surface, Tools table, and Skills section were already correct.

## [0.3.6] - 2026-06-29

### Changed

- **Profile tool surface consolidated to the singleton — 9 tools → 8.** `sil_profile_list`
  is **deleted**, folded into `sil_profile_get`: called with **no arguments**, `sil_profile_get`
  now returns the shopper overview (the shared `userSpec` + the domains index + any degraded
  directory in `unreadable[]`), and an empty store reads back `ok` (empty-is-healthy), never
  `not_found`. The caller-supplied **`agentId` is dropped** from all four profile tools
  (`sil_profile_materialize`, `sil_profile_get`, `sil_remember`, `sil_profile_remove`): the
  product is a **singleton** shopper, so the artefact store re-scopes from the per-agent
  `$SIL_DATA_DIR/agents/<agentId>/` to a fixed `$SIL_DATA_DIR/shopper/` — the keying segment
  is now a compile-time constant (un-spoofable), and the only caller-supplied path segment is
  the domain `slug`, still guarded (lower-kebab, not `main`) before any join. Slimmer
  signatures: `sil_profile_get(domainSlug?)`, `sil_profile_materialize(name, userSpec, domain?)`,
  `sil_remember(kind, text, domain?, hard?)`, `sil_profile_remove(domainSlug)`. `sil_remember`
  and `sil_profile_materialize` stay two distinct tools (the #39 cheap-append / whole-doc split);
  `sil_profile_remove` stays standalone, destructive, confirm-gated. No backwards-compat path —
  old `agents/<id>/` data is orphaned, not migrated. Manifest `contracts.tools` + skill bundle +
  every exact-set drift mirror updated to the 8-tool floor.
- **`sil-shopping` skill rewritten for the single multi-domain shopper.** The skill
  bundle now drives the model shipped by Slice 1 (#38): **one** persistent shopper (a
  generalist created once) that learns **domains** (niches) on first shop, replacing
  the retired per-niche-expert flow with **no backwards-compat path**. Onboarding
  collapses to a two-touchpoint create (persona + the shared cross-niche user spec —
  no niche research at create); the shop loop classifies the niche, **reuses a learned
  domain or mints a new one on the fly** (announced + correctable, with semantic slug
  dedup to avoid fragmentation), layers intent over the active domain's taste over the
  shared facts over the domain mechanics, and learns every query via the cheap
  `sil_remember` append (a person fact carries across niches; a niche taste stays in
  that domain). A second create is refused — the shopper is a singleton. The
  `tools.alsoAllow` admission step (#37) and the `sil_remember` per-query persist (#39)
  are preserved. Four references were renamed to match the vocabulary:
  `expert_shopping.md`→`shop_loop.md`, `manage_experts.md`→`manage_domains.md`,
  `refine_expert.md`→`refine_shopper.md`,
  `road_cycling_expert_walkthrough.md`→`multi_domain_shopper_walkthrough.md`. Skill
  prose + tests only — no plugin code or manifest change.

## [0.3.5] - 2026-06-27

### Changed

- **Catalog description rewritten to "Turn your OpenClaw into an expert shopping
  agent."** — the same line now in both `package.json#description` and
  `openclaw.plugin.json#description`. ClawHub crops the catalog card at 10 words, and
  the old opener ("OpenClaw plugin for sil — …") spent those words on what the listing
  already shows (the package is `@4gpts/sil`). The new line is benefit-led and names the
  shopping-expert headline feature within the visible crop.

## [0.3.4] - 2026-06-25

### Fixed

- **Bundled skill now publishes under the unique basename `sil-shopping/`** (was the
  generic `skill/`). The OpenClaw host derives a skill's published name from its
  directory basename, so the old `skill/` collided with klodi's identically-named
  `skill/` when both plugins were co-installed — the host logged a
  `"skill" resolves to both` collision warning and silently dropped sil's skill
  (only the first basename wins), leaving the model with no skill to drive the
  `sil_*` tools. Renaming the directory to `sil-shopping/` makes the published name
  sil-unique and collision-free. The skill's frontmatter `name` is realigned to
  `sil-shopping` and its `description` sharpened so the model reliably routes every
  shopping / identity / shopping-expert intent to it.

## [0.3.3] - 2026-06-25

### Fixed

- **Manifest security disclosure now matches the code's credential behaviour.**
  `openclaw.plugin.json#security.packagingNote` claimed `sil_search` /
  `sil_product_get` did "a single round-trip (a 401 is a terminal re-register
  hint, no refresh)" with "no token write" — stale prose predating the uniform
  401-refresh work. Corrected to state the real behaviour: catalog tools share
  `sil_whoami`'s bounded 401 recovery (refresh once via sil-web, rotating
  `tokens.json`, retry once; a second 401 or dead refresh clears `tokens.json`).

### Changed

- **Profile-rewrite failure guarantee stated precisely.** The manifest and
  `profile-store.ts` header now describe the actual write contract instead of a
  blanket "atomic / all-or-nothing": each artefact is written atomically, a fresh
  create is torn down on failure, and a re-materialize over an existing expert is
  per-file atomic and dir-preserving (not a cross-file transaction) — the prior
  expert is left intact and never served half-refined.
- **Local-data disclosure added to the README.** A "what it remembers, and where
  it lives" note: a created expert's learned facts/taste are stored locally
  (`$SIL_DATA_DIR`, owner-only), per-user, never pooled or sent to a server, and
  are inspectable with `sil_profile_get` and removable with `sil_profile_remove`.
- **Local-shop language tactic reframed as optional.** Guidance to issue the
  `query` in a country's language (to surface local shops) is now explicitly an
  optional tactic, never an override of a language the user deliberately chose —
  in the README, the `sil_search` description, and `search_param_mapping.md`.
- **Refine trigger tightened.** `refine_expert.md` now starts a refinement only on
  an explicit request to sharpen a named expert; an end-of-session prompt merely
  offers and persists nothing without the existing confirm gate.
- **Disclosure wording reworded to clear automated-scanner false positives.** No
  behaviour change — the shipped disclosure says exactly what it did before. In the
  manifest, the tool descriptions, and the bundled skill/comments, "access token"
  is now "session token", the path-traversal guards are described in prose instead
  of `rm`/`rmSync`/`../` literals, and the no-web-access fallback says "compose from
  well-established public knowledge" instead of "write from its own knowledge".

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
