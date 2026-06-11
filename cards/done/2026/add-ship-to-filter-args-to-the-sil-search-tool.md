---
type: card
title: Add ship-to + filter args to the sil_search tool
slug: add-ship-to-filter-args-to-the-sil-search-tool
work_type: feature # feature | bug | refactor | chore | docs
tiers: [unit, integration] # subset of [unit, integration, e2e] — set by solutions-architect during Discovery from the acceptance criteria below
status: done # backlog | discovery | stand-by | in-dev | review | distilling | pr-ready | done | abandoned — PR #14 merged 2026-06-11 → done (worktree torn down)
agents: [] # current active agent set; updated by each handoff — idle at pr-ready; founder owns the merge
priority: 2 # 1 = drop-everything, 2 = normal, 3 = nice-to-have
created: 2026-06-11
updated: 2026-06-11 # PR #14 merged → done
base_branch: main # the branch this card's worktree was cut from and the PR will target
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-add-ship-to-filter-args-to-the-sil-search-tool
branch: card/add-ship-to-filter-args-to-the-sil-search-tool
pr: https://github.com/Context4GPTs/sil-openclaw/pull/14 # set by expert-developer at in-dev → review
merged_commit: a4970ef8d68098a02964eb66895d40461191c068 # set by /board-tick on PR-merge detection
epic_id: location-aware-search-2026-06
---

## Intent (founder)

The agent already learns the buyer's address via identity, but search never uses it — and it shouldn't have to fetch it. Add `ship_to`, `ships_from`, `condition`, and `available` as optional arguments to `sil_search`, all defaulted empty, passed straight through to sil-api when set. The key is the tool **description**: it must tell the agent that leaving `ship_to` empty uses the user's registered default address (resolved server-side by sil-api), so the agent never wastes a turn calling `sil_whoami` to fetch and resubmit it. The agent supplies `ship_to` only to override the default (a different delivery destination).

---

## Founder directive — 2026-06-11 — RE-SPEC (supersedes the prior cycle; card RESET pr-ready → stand-by)

**Why the reset.** The prior cycle shipped a *thin* contract. `ship_to.country` is a bare `Type.String()` (`src/tools/catalog.ts:139`) — "ISO 3166-1 alpha-2" lives only in the prose description, not the schema — and `region`/`postal_code` are unconstrained free strings. So the plugin and sil-api share **no enforced contract**: the plugin happily forwards `"United States"`, `region: "Bavaria"`, or arbitrary text in any language, and sil-api's closed `ShipTo` (`^[A-Za-z]{2}$` country) then 400s it — a confusing, fail-late mismatch the agent can't recover from. Re-spec to a **pinned, Shopify-grounded contract that both sides enforce identically**, and to a **tool description rich enough that the agent sends standard codes, never free text.** Do NOT merge PR #14 as-is.

**THE SHARED `ships_to`/`ships_from` CONTRACT** — single source of truth is `@sil/schemas` `ShipTo`/`ShipFrom` (sil-services `packages/schemas/src/catalog.ts`, owned by sibling card `attach-buyer-ship-to-context-server-side-in-sil-ap`). This plugin re-declares the read-subset locally (decision `sil-shared-catalog-client`, it does not import `@sil/schemas`) and **MUST mirror those shapes byte-for-byte — identical patterns.** Keep the two cards in lockstep; the sil-stage `live-catalog-serviceability-localization-eval` verifies it end-to-end. Grounded in `../../vendor/shopify/docs/agents/catalog/global-catalog-extension.md` (the `catalog.filters` table):

- `ships_to.country` — REQUIRED. ISO 3166-1 **alpha-2 CODE**, validated `^[A-Za-z]{2}$`, normalized UPPERCASE (`us`→`US`). A 2-letter code, never a country name, never another language.
- `ships_to.region` — OPTIONAL. ISO 3166-2 **subdivision CODE** (e.g. `CA`, `NY`, `BY`) — uppercase, bounded (recommended `^[A-Za-z0-9]{1,3}$`; Discovery pins the final regex). NOT a free-text place name (`"California"`, `"Βαυαρία"`).
- `ships_to.postal_code` — OPTIONAL. A bounded postal token (recommended: alphanumeric with single spaces/hyphens, 2–12 chars, trimmed) accepting real national formats (`94107`, `EC1A 1BB`, `K1A 0B1`) and rejecting prose/injection.
- `ships_from.country` — REQUIRED. Same rule as `ships_to.country`. No region/postal (origin filters by merchant country only — Shopify).
- `condition` — OPTIONAL `string[]`. Steer the agent to the known set `"new"`/`"secondhand"` (lowercase). Wire stays OPEN — never reject an unrecognized value (Shopify: unrecognized passes through).
- `available` — OPTIONAL boolean. Server default `true`; the plugin NEVER injects a value; a supplied `available: false` must survive.

**This card's responsibilities (plugin / agent-facing side):**

1. **Tighten the local `ship_to`/`ships_from` schema** to the contract above (country alpha-2 `pattern`; region ISO 3166-2 `pattern`; postal bounded `pattern`) so it MATCHES `@sil/schemas` exactly. Today `country` is a bare `Type.String()` — that missing `pattern` is the no-contract root cause.
2. **Reject malformed input client-side**, before any network call, with a clear structured validation error (better agent UX than an opaque sil-api 400). `readSearchParams` validates format and rejects/drops on mismatch — extend the existing drop-on-wrong-type discipline; no `any` at the boundary.
3. **Enrich the tool description — the load-bearing deliverable.** KEEP the existing empty-`ship_to`=registered-default / "do not call `sil_whoami`" / override framing verbatim (it is correct and stays). ADD the exact formats the agent must send and an explicit **"send standard ISO codes, not free text or natural-language place names"** instruction: country = 2-letter ISO 3166-1 alpha-2 (US/GB/DE); region = ISO 3166-2 subdivision code (CA/NY/BY), not a place name; postal_code = the destination postal/ZIP; ships_from = alpha-2; condition = only `new`/`secondhand`. Each per-field `description` self-describes its format (agents read field descriptions independently). Extend the existing description-contract unit tests to assert the new format phrases.
4. Stay **request-side-only**; preserve the input guard (these refine, not constitute, a search); keep `available:false` surviving.

**Acceptance to ADD** (preserve every existing scenario): `ship_to.country = "United States"` → rejected client-side, no network call; `region = "California"` → rejected; `country = "us"` → accepted and forwarded as `US`; the registered `sil_search` description contains the country/region/postal/condition format instructions + the "use codes, not free text" steer.

**Existing PR #14 stays open** — the dev pair extends the same `card/<slug>` branch with the contract-tightening, re-reviews, re-distills → pr-ready. The thin contract is superseded, not rebuilt from scratch. (Prior Discovery/In-Dev/Review/Distillation sections below are retained as history; this directive supersedes their contract decisions.)

---

## Signals to orchestrator (append-only)

<!--
Any agent at any stage can append here when something matters one altitude up
to the orchestrator: a success criterion the PRD missed, a cross-card or
cross-sibling blocker, scope bleed, a reusable pattern, a duplicate-risk with
another card. Write what you know; the orchestrator decides what to do with it.

Format: - <YYYY-MM-DD> <agent> (<stage>) — <type>: <one-line body>

Types are open-ended; common ones: sc-candidate, blocked-on, duplicate-risk,
pattern, scope-bleed. Invent new types when the existing ones don't fit.

The orchestrator reads this every tick and records the signals it has acted on
in $MC/log/<goal_id>/, so entries are never deleted from here — they travel
with the card to cards/done/ or cards/abandoned/. Empty section is fine; the
orchestrator only reads when entries exist.
-->

- 2026-06-11 product-owner (discovery) — cross-sibling: this card's `sil_search` description PROMISES the agent that empty `ship_to` ⇒ registered default address, resolved server-side. That resolution lives in the sibling sil-services card `attach-buyer-ship-to-context-server-side-in-sil-ap`. The plugin can ship independently (it only forwards/omits + documents), but the END-TO-END promise is false until the sil-services card is live — the live verification belongs to the sil-stage eval card (`live-catalog-serviceability-localization-eval`). Worth confirming the three epic siblings stay sequenced so the description's promise isn't merged to prod ahead of the server-side default.
- 2026-06-11 product-owner (discovery) — coordination: the agent-facing `ship_to` arg SHAPE and its sil-api wire placement (open `filters.ships_to{country,…}` à la Shopify vs. request-level `context.address_*`) must agree with what the sil-services sibling resolves server-side. Two siblings independently choosing different shapes/paths for the same buyer signal is a latent integration break the eval would catch late. Flagging so the orchestrator can keep the wire contract aligned across the epic (the architect pins the plugin side in Discovery).
- 2026-06-11 code-quality-guardian (review) — pattern: PR #14 widened the SDK shim `ToolDefinition.parameters` from `TObject` to `TObject | TSchema` (≡ `TSchema` = `{}`) to satisfy a frozen qa test's single-step deep `as` cast. Accepted (runtime object-ness still enforced by `tool-schema-contract.unit.test.ts`), but it loosens the static registration boundary to admit a non-object schema. Tighter end-state is a test-shape fix (introspecting test two-step-casts `as unknown as`, like `tool-schema-contract.unit.test.ts:130`), restoring `parameters: TObject`. Candidate for a small future cleanup card; not blocking.
- 2026-06-11 solutions-architect (discovery) — contract-resolved: pinned the plugin's wire contract to RESOLVE the product-owner's coordination flag above. The plugin sends the OVERRIDE filter `filters.ships_to = { country, region?, postal_code? }` (NOT request-level `context` — `context` is the SERVER's to fill from the DB default, per sibling card `attach-buyer-ship-to-context-server-side-in-sil-ap` line 22/54-55). Two naming seams the sibling must match: (1) agent arg is `ship_to` (singular) but the wire key is `ships_to` (plural) — the sibling's "omits `ship_to`" trigger reads the request shape, so confirm it checks for `filters.ships_to` absence; (2) `available`/`condition` carry NO plugin-side default (server applies `available:true`). The sibling adds `ships_to`/`ships_from`/`available`/`condition` to `SearchFilters` (currently `additionalProperties:true`, so the plugin already wires green pre-merge). Orchestrator: keep the two cards' `filters.ships_to` shape identical; the sil-stage eval verifies end-to-end.

## Epic notes (provisional — sibling Discovery owns the verdict)

**Epic:** `location-aware-search-2026-06` (manual `/epic-add`, founder-authored). Sibling 2 of 3 — sil-openclaw (the agent-facing args); siblings: sil-services (`attach-buyer-ship-to-context-server-side-in-sil-ap`, the server-side default resolution) and sil-stage (`live-catalog-serviceability-localization-eval`, the live eval).

**Free-variable framing.** The *override* filters (`ship_to`/`ships_from`/`condition`/`available`) are controlled by the user's agent — **indirectly, via our tool description**, which is the real control surface. The description must encode the empty-default = registered-address contract, or the agent will redundantly round-trip `sil_whoami`. Memory: `server-side-address-resolution`, `free-variables-product-lens`.

**Depends on (soft):** the empty-`ship_to` default is resolved server-side in sil-services (`attach-buyer-ship-to-context-server-side-in-sil-ap`); this card's description contract relies on it. The plugin itself does **no** address fetching.

**Likely change site (shallow read-only guess — Discovery confirms):**
- `src/tools/catalog.ts` — add the optional args to the `sil_search` param schema and write the description: empty `ship_to` ⇒ registered address used server-side; pass `ship_to` only to override.
- `src/lib/sil-client.ts` — extend `SearchParams` + `buildSearchBody` to pass the new fields through (today it only emits `query`/`filters.categories`/`filters.price`/`pagination`).

**Acceptance (Discovery refines + tier-tags `[unit|integration|e2e]`):**
- Given the user names no destination, then `sil_search` sends no `ship_to`, and the tool description has steered the agent away from a `sil_whoami` round-trip.
- Given "ship to <place>", then `ship_to` is forwarded to sil-api.
- Given `ships_from`/`condition`/`available` requested, then they pass through.
- The description documents the empty = registered-address contract.

**Reference:** filter wire shapes from the Shopify Global-Catalog extension (`../../vendor/shopify/docs/agents/catalog/global-catalog-extension.md`) + `@sil/schemas` `SearchFilters`; never `@ucp-js/sdk`.

---

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — product-owner, solutions-architect

<!-- Filled jointly by product-owner and solutions-architect. -->

### Intent validation — product-owner

**The intent is coherent and complete.** The agent already learns the buyer's address via `sil_whoami`, but `sil_search` never uses it. This card closes that gap WITHOUT making the agent fetch-and-resubmit the address. Four optional args are added to `sil_search`, all defaulted empty, forwarded to sil-api only when the agent sets them:

| Arg | Purpose | When the agent sets it |
|---|---|---|
| `ship_to` | Deliver-to destination (serviceability + localization). | ONLY to override the registered default with a *different* destination ("ship it to my office in Berlin"). |
| `ships_from` | Restrict to a merchant-origin country. | When the user constrains where goods originate ("from US sellers only"). |
| `condition` | Product condition (e.g. `new` / `secondhand`). | When the user asks for new vs. used. |
| `available` | Whether to return only sale-ready items. | When the user wants to include out-of-stock items (set `false`); the server default already returns available-only. |

**User-facing behavior, stated precisely.** The product surface here is NOT a UI — it is the **tool description string the agent reads to decide whether to call `sil_whoami` first**. The behavior we are buying:

1. **No destination named ⇒ no round-trip.** When the user does not name a delivery destination, the agent calls `sil_search` *directly*, sending NO `ship_to`. sil-api resolves the buyer's registered default address server-side (the sibling `attach-buyer-ship-to-context-server-side-in-sil-ap`). The agent must NOT call `sil_whoami` to read the address and pass it back — that wastes a turn and re-sends data the server already holds. This non-round-trip is the headline deliverable.
2. **Destination named ⇒ forward it.** When the user names a *specific* destination ("ship to Berlin"), the agent sets `ship_to`; the plugin forwards it to sil-api, overriding the server-side default.
3. **Other filters forward when set.** `ships_from` / `condition` / `available` each pass straight through when the agent supplies them, and are omitted from the request body when it does not.

**What the description MUST communicate (the load-bearing control surface).** The description is the only lever that steers the agent away from the redundant `sil_whoami`. In product terms it must say, unambiguously:
- **Leaving `ship_to` empty is the correct default for "ship to me."** Explicitly: an absent `ship_to` means sil-api uses the user's *registered default address*, resolved server-side. The agent gets localized/serviceable results for the buyer's own address *without supplying anything*.
- **Do NOT call `sil_whoami` (or any identity read) just to obtain an address to put in `ship_to`.** Name the anti-pattern so the agent recognizes and avoids it. Fetching the address to resubmit it is wasted work and produces the same result as omitting `ship_to`.
- **Set `ship_to` ONLY to override** — i.e. only when the user wants delivery to a *different* place than their registered default. Frame it as an override, not a required input.
- The three remaining args are **plain optional filters**: documented by what they constrain, each omittable, none requiring a prior tool call.

**Scope boundary (what this plugin does NOT do).** The plugin performs NO address fetching and NO default resolution. It does not read `sil_whoami`, does not inspect stored identity, and does not synthesize a `ship_to` from the registered address. Its entire job is (a) the pass-through (forward each arg only when set; omit when empty) and (b) the steering description. The empty-`ship_to` → registered-address resolution is owned server-side by the sibling card in sil-services — this card's description merely *promises* that behavior to the agent and depends (softly) on it being live. If the agent supplies `ship_to`, the plugin forwards it verbatim; it neither validates nor reshapes the value beyond the type narrowing every arg already gets.

### Approach + alternatives ruled out — solutions-architect

**Confirmed the card's shallow guess against the code — correct in shape, with three precise corrections.** A thin, **request-side-only** pass-through across exactly the two files the card named: the agent-facing arg schema + steering description in `src/tools/catalog.ts`, and the wire-body mapping in `src/lib/sil-client.ts`. The plugin re-declares the read-subset of `@sil/schemas` locally and hand-builds the wire body in `buildSearchBody` (sil-client.ts:855) — it does **not** import `@sil/schemas` (decision `sil-shared-catalog-client`), so "from `@sil/schemas` `SearchFilters`" means the *byte-shape to mirror*, not an import. The four new filters ride sil-api's open `SearchFilters` (`additionalProperties: true`, sil-services `packages/schemas/src/catalog.ts:268-277`), so sil-api accepts them on the wire **today**, before the sibling card names them in that schema.

Chosen approach — **forward-only, into `filters`, with the agent-arg→wire-key rename in `buildSearchBody`**:
- `sil_search` gains four optional params, all default-absent: `ship_to` (object `{ country, region?, postal_code? }`), `ships_from` (object `{ country }`), `condition` (array of strings — `["new"]`/`["secondhand"]`), `available` (boolean).
- `buildSearchBody` maps a *supplied* `ship_to` → `filters.ships_to`, `ships_from` → `filters.ships_from`, `condition` → `filters.condition`, `available` → `filters.available`. Absent ⇒ key omitted (the discipline `category`/`price`/`pagination` already use). The plugin sends **no** `ship_to`/`ships_to` when the agent omits it — server-side default resolution is the sibling card's job.
- The **description** is the load-bearing deliverable: omitting `ship_to` uses the buyer's registered default address (resolved by sil-api) so the agent does **not** round-trip `sil_whoami`; supply `ship_to` only to ship elsewhere.

**Resolving the two architect-owned questions the product-owner deferred:**
- **Wire placement → `filters.ships_to` (NOT request-level `context`).** The plugin sends the *override filter*; it does not send `context`. Rationale: the sibling card (`attach-buyer-ship-to-context-server-side-in-sil-ap`, intent line 22 + change-site line 54-55) models `ships_to`/`ships_from`/`available`/`condition` **on `SearchFilters`** and, on an omitted `ship_to`, the *server* "attaches `ships_to` + localization `context`." So `context` is the **server's** to fill from the DB default — the plugin emitting `context` would (a) collide with the server's resolution and (b) require the plugin to know the buyer's address, the very thing this card refuses to fetch. The plugin's lane is `filters` only. The Shopify extension agrees (`global-catalog-extension.md:26-33`: these are `catalog.filters` fields). The product-owner's criteria are JSON-path-agnostic, so this choice satisfies them.
- **Input-guard → the new args are refinements, NOT usable inputs; `hasUsableInput` is UNCHANGED.** A request whose only content is `ship_to`/`ships_from`/`condition`/`available` (no `query`/`category`/`price`) is rejected client-side as empty input, exactly like `cursor`/`limit` today (catalog.ts:385-397). Rationale: these narrow/localize an existing search; they do not *constitute* one — a bare "ship to Berlin" with nothing to search for is not a catalog query, and sil-api's `empty_search_input` 400 is the authoritative backstop regardless. This is the safest, most consistent call and avoids widening the one invariant the tool owns. (Note: this overrides the product-owner's leaning toward treating filters as browse inputs — `category` is a *content* filter that genuinely narrows the catalog, whereas `ship_to`/`available` are *serviceability/localization* refinements over an already-chosen result set. The description will match: it frames these as refinements on a search, not as searches.)

Three corrections to the card's framing:
1. **Agent arg `ship_to` (singular) ≠ wire key `ships_to` (plural).** The founder-facing arg is `ship_to` (the intent text + the sibling card's "omits `ship_to`" trigger language); the Shopify-extension + `SearchFilters` wire key is `ships_to` (`global-catalog-extension.md:32`). `buildSearchBody` performs the rename. Deliberate — keep both names exactly. (`ships_from`/`condition`/`available` keep one name on both sides.)
2. **`available` must NOT be defaulted to `true` in the plugin.** The extension documents a *server-side* default of `true` (`global-catalog-extension.md:30`); the plugin omits the key when unset (no client-injected defaults — the rule search-client.test.ts:161-167 pins). The server applies its default.
3. **`ship_to`/`ships_from` are typed objects, not strings.** `ships_to` = `{ country (required, ISO 3166-1 alpha-2), region?, postal_code? }`; `ships_from` = `{ country }`. The schema must be `Type.Object`, not `Type.String`.

Alternatives ruled out:
- **Plugin resolves the default address itself** (call `fetchIdentity`, read the default, fill `ships_to`). Rejected: duplicates the sibling resolver, adds a network hop to every search, and re-creates the exact `sil_whoami` round-trip the description exists to kill — just moved agent→plugin. The epic's thesis is sil-api owns this. The plugin forwards or omits; it never fetches.
- **Flat string args (`ship_to: "US"`).** Rejected: lossy — `ships_to` carries region + postal for serviceability/localization; a bare country string drops the precision the server-side path provides and diverges from the wire contract.
- **Map the args onto request-level `context`.** Rejected (see wire-placement resolution above) — `context` is the server's to fill; the plugin would have to hold the address to send it.
- **Touch `sil_product_get`/`lookupCatalog` too** (lookup also takes `filters`). Rejected, out of scope: card + intent name `sil_search` only; the sibling forwards lookup filters server-side independently. YAGNI.

### Affected files / surfaces — solutions-architect

- `src/tools/catalog.ts` — `registerSearch` param schema: add `ship_to`/`ships_from` (`Type.Object`), `condition` (`Type.Array(Type.String())`), `available` (`Type.Boolean`), all `Type.Optional`, each with a self-describing per-field `description` (the `ship_to` field description repeats the empty=registered-default / override framing — agents read field descriptions independently). Rewrite the tool `description` string to encode: empty-`ship_to`=registered-default contract, the override semantics, AND the explicit "do not call `sil_whoami` to fetch an address" anti-pattern. `readSearchParams` (catalog.ts:368): narrow the four new fields off `params` (object/array/boolean guards, drop-on-wrong-type, no coercion — mirror the existing narrowing + `readIds` at catalog.ts:336). `hasUsableInput` is **unchanged**.
- `src/lib/sil-client.ts` — `SearchParams` interface (sil-client.ts:203): add `ship_to?`, `ships_from?`, `condition?`, `available?` with precise object/array/boolean types. `buildSearchBody` (sil-client.ts:855): emit `filters.ships_to` / `filters.ships_from` / `filters.condition` / `filters.available` only when supplied (the `ship_to`→`ships_to` rename lives here). No change to `searchCatalog`, the classifier, or any response-side projection — request-only.
- `src/__tests__/lib/search-client.test.ts` — extend the body-mapping `describe` (line 128) with the four field mappings + the rename + omit-when-absent cases (RED first).
- `src/__tests__/catalog-search.integration.test.ts` — extend the wired-tool body assertions (~line 350) with a full `ship_to`/`ships_from`/`condition`/`available` round-trip + the "omits when absent" + the `available: false` survives cases.
- **Description-contract assertion (load-bearing):** a unit test asserting the `sil_search` `description` string contains the empty-`ship_to`=registered-default steering language AND the "do not `sil_whoami` to fetch an address" phrasing — so a future edit cannot silently delete the round-trip-avoidance contract. The dev pair sites it (new small test, or addition to a registration/description test).
- **NOT touched:** `openclaw.plugin.json#contracts.tools` (no new tool name — `sil_search` already listed; the manifest drift guard needs no change), `register()`/`src/index.ts` (no new group), `sil_product_get`/`lookupCatalog`, the response classifier, `hasUsableInput`.

### Risks / failure modes — solutions-architect

- **Wire-shape mismatch with sil-api (highest risk).** The plugin emits `filters.ships_to` etc. into sil-api's *open* `SearchFilters`. If the rename is wrong (emit `ship_to` not `ships_to`, or land it under `context`), sil-api silently ignores the unknown key (`additionalProperties: true` — no 400) and serviceability filtering silently no-ops. Mitigation: the body-mapping unit test asserts the exact emitted key names + nesting against the Shopify-extension/`SearchFilters` contract. This is the one wire seam that can fail *green*.
- **Description fails to steer the agent off the `sil_whoami` round-trip.** A vague description leaves the agent reflexively fetching the address first — the exact waste the card kills. Mitigation: the description explicitly says *omitting `ship_to` uses your registered default address (server fills it); do not call `sil_whoami` to obtain it; pass `ship_to` only to ship elsewhere*, and a unit test pins the steering phrase is present.
- **Over-sending empty fields.** Emitting `filters.available: undefined`, an empty `filters: {}`, or a `ships_to: {}` when nothing was supplied injects defaults the tool must not inject and pollutes the "omits keys the agent did not supply" guarantee. Mitigation: same omit-when-absent discipline as `category`/`price`; integration test asserts a bare query still sends `{ query }` with no `filters`.
- **`available: false` dropped by a truthiness guard.** `available: false` is meaningful (include unavailable items) and must survive narrowing. Mitigation: narrow with `typeof v === "boolean"`, never `if (v)`. (Called out as its own acceptance criterion.)
- **`condition` as array vs string.** The extension types `condition` as an array (OR across values). A scalar would diverge. Mitigation: `Type.Array(Type.String())`; narrow to `string[]` dropping non-strings (mirror `readIds`).
- **Soft-dependency timing.** The empty-`ship_to` default resolution lives in the not-yet-merged sibling sil-services card. Until it lands, an omitted `ship_to` resolves to *nothing* server-side (un-localized search), not the registered default — the description's promise is fully realized only once the sibling merges. Acceptable: the plugin's contract (forward-or-omit) is correct independently and the description documents the *intended* server behavior the epic delivers. Not a blocker; flagged to orchestrator as a cross-sibling ordering note.

### Acceptance criteria

<!-- Behavior framed by product-owner; tier tags added by solutions-architect in its final pass. -->

**Pass-through behavior (the verifiable seam: the body-mapping unit suite spies `fetch` and asserts the exact `CatalogSearchRequest` body — `search-client.test.ts`; the wired-tool integration suite JSON.parses the request body the tool sends to sil-api — `catalog-search.integration.test.ts`).** Tier note (solutions-architect): the per-field `buildSearchBody`→wire mappings are pinned at the cheapest tier (`unit`, in `search-client.test.ts`, exactly where `category`/`price`/`pagination` are pinned today); a representative end-to-end round-trip of all four args is additionally pinned through the wired tool (`integration`). The `ship_to`→`ships_to` rename is the load-bearing assertion in the unit seam.

- `[unit]` Given the simplified `SearchParams` with NO `ship_to`, when `buildSearchBody` runs, then the emitted body carries NO `ships_to` key under `filters` (absent, not an empty object) and no `filters` skeleton if no other filter is set — the plugin injects no default and reads no stored identity.
- `[unit]` Given `SearchParams` with `ship_to = { country, region?, postal_code? }`, when `buildSearchBody` runs, then the emitted body carries `filters.ships_to` with that exact value (the agent arg `ship_to` is renamed to the wire key `ships_to`; forwarded as given, not reshaped or validated beyond type-narrowing).
- `[unit]` Given `SearchParams` with `ships_from = { country }`, when `buildSearchBody` runs, then the emitted body carries `filters.ships_from` with that value; given `ships_from` absent, the `ships_from` key is absent from the body.
- `[unit]` Given `SearchParams` with `condition = ["new"]` (array), when `buildSearchBody` runs, then the emitted body carries `filters.condition` with that array; given `condition` absent, the key is absent.
- `[unit]` Given `SearchParams` with `available = false`, when `buildSearchBody` runs, then the emitted body carries `filters.available: false` (a supplied `false` is forwarded, NOT dropped as falsy); given `available` absent, the key is absent.
- `[integration]` Given a registered user and `sil_search` invoked through the wired tool with `ship_to`/`ships_from`/`condition`/`available` all supplied (alongside `query`), when it runs, then the captured request body sent to sil-api carries `filters.ships_to`/`filters.ships_from`/`filters.condition`/`filters.available` with the supplied values — the full round-trip from agent arg to wire key.
- `[integration]` Given a registered user and `sil_search` invoked with only a bare `query` (none of the new args), when it runs, then the captured request body is exactly `{ query }` — no `filters` skeleton, no defaulted `ships_to`/`available` (the existing "fills no defaults" invariant extends to the new args).
- `[unit]` Given a param of the wrong type at the read site (a drifted on-disk call: `available` as a string, `condition` as a non-array, `ship_to` as a primitive), when `readSearchParams` narrows, then the malformed field is dropped (treated as absent), not coerced — consistent with the existing narrowing discipline and `readIds`; no `any`, no unchecked cast.

**Input-guard interaction (the new args must NOT relax the one client-side invariant the tool owns).** Architect decision (resolving the product-owner's deferral): the new args are *refinements*, NOT usable inputs — `hasUsableInput` is UNCHANGED, so a request carrying only the new filters (no `query`/`category`/`price`) is rejected client-side as empty input, exactly like `cursor`/`limit` today.

- `[integration]` Given a request whose ONLY content is one or more of the new filter args (e.g. `ship_to` alone, or `available: false` alone — no `query`/`category`/`price`), when `sil_search` runs, then it is rejected client-side as `invalid_request`/`empty_search_input` with NO network call (the new args do not satisfy the "≥1 usable input" rule — they refine a search, they do not constitute one; identical handling to `cursor`/`limit`).
- `[integration]` Given a request with at least one real input (`query` or `category` or `price`) PLUS any of the new filter args, when `sil_search` runs, then it passes the input guard and reaches the network (the new args neither create nor block a search; they ride alongside a valid one).

**The steering description (the load-bearing deliverable — verifiable by asserting the registered description string, the pattern the existing suite already uses for tool descriptions).**

- `[unit]` Given the registered `sil_search` tool, when its `description` is read, then it states that leaving `ship_to` empty/absent uses the user's REGISTERED DEFAULT ADDRESS, resolved server-side by sil-api — i.e. the empty = registered-address contract is documented in the text the agent sees.
- `[unit]` Given the registered `sil_search` tool, when its `description` is read, then it explicitly steers the agent AWAY from fetching the address first: it tells the agent NOT to call `sil_whoami` (or otherwise look up the stored address) merely to populate `ship_to` — naming the redundant round-trip as the anti-pattern to avoid.
- `[unit]` Given the registered `sil_search` tool, when its `description` is read, then it frames `ship_to` as an OVERRIDE — supplied only to ship to a destination DIFFERENT from the registered default — not as a required input for "ship to me."
- `[unit]` Given the registered `sil_search` tool, when its `description` is read, then `ships_from`, `condition`, and `available` are each documented as optional filters by what they constrain (origin country / product condition / availability), each omittable with a stated default behavior, none implying a prior tool call.
- `[unit]` Given each new parameter's per-field `description` in the schema, when read, then it is self-describing (the `ship_to` field description repeats the empty = registered-default / override framing, since an agent may read field descriptions independently of the tool description).

**Outcome regression (the new args change only the request body — never the outcome taxonomy).**

- `[integration]` Given any of the existing sil-api outcomes (200 result / 200 empty-match success / 400 `invalid_request` / 401 refresh-and-retry-once / 5xx retryable), when `sil_search` runs WITH any combination of the new args set, then the outcome mapping and the agent-facing envelope are unchanged from today — the new args are request-shaping only and do not add, remove, or reclassify any outcome.

### Open questions (if any)

- **Wire placement of the new args (architect-owned, not blocking).** The Shopify Global-Catalog reference (`vendor/shopify/docs/agents/catalog/global-catalog-extension.md`) places `ships_to`/`ships_from`/`condition`/`available` under `catalog.filters`, and as *objects* for the location ones (`ships_to: { country, region?, postal_code? }`). sil-api's `CatalogSearchRequest` (sil-services `@sil/schemas/catalog.ts`) has BOTH an open `filters` (`SearchFilters`, `additionalProperties: true`) and an open `context` (`CatalogContext` with `address_country`/`address_region`/`postal_code`). So the new args could map onto `filters.ships_to{…}` (Shopify-aligned) OR onto request-level `context` (which is the natural home for the buyer's deliver-to signals and what the server-side default resolution in the sibling card most likely fills). The exact mapping (arg shape the agent passes — bare country string vs. object — and which sub-object it lands in) is the solutions-architect's to pin against the live sil-api + the sibling card's server-side contract. **Product framing is mapping-agnostic:** the acceptance criteria above assert "the body carries / omits the value," not a specific JSON path, so they hold regardless of where the architect lands it. Recorded as an assumption, not a blocker — Discovery does not stall on it.
- **Assumption — `ship_to` arg shape.** Absent a confirmed sil-api contract for the agent-facing arg, the most defensible default is to mirror the Shopify reference: `ship_to` accepts at least a `country` (ISO 3166-1 alpha-2), optionally `region` + `postal_code`. The architect confirms the exact shape against the sibling's server-side resolver; if sil-api expects a richer/looser shape, the schema follows sil-api, not Shopify. This does not change any product criterion above.

<!-- escalate to founder if blocking -->

### → Handoff to In Dev (next agents: expert-developer, qa-developer) — solutions-architect

**This is request-side-only. No response/classifier/projection code changes.** The dev pair runs sequenced on this SHARED worktree: **qa-developer writes RED tests first, then expert-developer makes them GREEN.** One shared contract for both:

**The immutable contract (do not deviate):**
1. Four new optional `sil_search` params: `ship_to` (`Type.Object({ country: Type.String(), region: Type.Optional(Type.String()), postal_code: Type.Optional(Type.String()) })`), `ships_from` (`Type.Object({ country: Type.String() })`), `condition` (`Type.Array(Type.String())`), `available` (`Type.Boolean()`) — all `Type.Optional`, each with a self-describing per-field `description`. Treat `country` as required *within* the object but the whole `ship_to` object as optional (the agent omits the param entirely for the default).
2. **The rename is load-bearing:** agent arg `ship_to` → wire key `filters.ships_to`. `ships_from`/`condition`/`available` keep their name and land under `filters.*`. The rename lives in `buildSearchBody` (sil-client.ts:855).
3. **Omit-when-absent**, always. No client-injected defaults — never emit `available: true`, never an empty `filters: {}` or `ships_to: {}`. Mirror the exact discipline `category`/`price`/`pagination` use today (search-client.test.ts:161-167 is the reference).
4. **`available: false` must survive** — narrow with `typeof v === "boolean"`, never `if (v)`.
5. **`hasUsableInput` is UNCHANGED** — the new args are refinements, not inputs. A request of only-new-args (no query/category/price) is rejected client-side, no network call.
6. **The description must contain** both steering phrases: (a) omitting `ship_to` uses the registered default address resolved server-side, and (b) do NOT call `sil_whoami` to fetch an address to put in `ship_to`. A unit test pins both phrases are present.

**Where to start (qa-developer, RED):**
- `src/__tests__/lib/search-client.test.ts` — the body-mapping `describe` at line 128 is the template. Add: each of the four field→`filters.*` mappings, the `ship_to`→`ships_to` rename (the single highest-value assertion — it's the wire seam that fails *green* if wrong), omit-when-absent for each, and the `available: false` survives case. These are the `[unit]` criteria.
- `src/__tests__/catalog-search.integration.test.ts` — the wired-tool body assertions at ~line 350 are the template. Add the full-round-trip `[integration]` case (all four args set) and the bare-`{ query }` no-defaults case, plus the input-guard `[integration]` cases (only-new-args → `invalid_request` no network; valid input + new args → reaches network) and the outcome-regression `[integration]` case.
- **The description-contract `[unit]` test** — assert `getTool(api, "sil_search").description` (or the registered tool's description via the mock API, the pattern the suite already uses) contains the empty=registered-default language AND the "do not `sil_whoami`" language. This is the load-bearing deliverable's guard; do not skip it.

**Then (expert-developer, GREEN):**
- `src/lib/sil-client.ts`: extend `SearchParams` (line 203) with the four typed fields; extend `buildSearchBody` (line 855) to emit `filters.ships_to`/`ships_from`/`condition`/`available` only when supplied (the rename happens here).
- `src/tools/catalog.ts`: add the four params to the `registerSearch` schema (line 85); rewrite the `description` (line 75) to carry both steering phrases + the override framing + the three new filters' purpose; extend `readSearchParams` (line 368) to narrow the four new fields (object/array/boolean guards, drop-on-wrong-type — mirror `readIds` at line 336). Leave `hasUsableInput` alone.

**Constraints:** strict TypeScript, no `any` at the narrowing boundary (use `asRecord`-style guards / `typeof` checks). No backwards-compat. No new dependency. Do NOT touch `openclaw.plugin.json` (no new tool name), `register()`/`index.ts`, `sil_product_get`, `lookupCatalog`, or any response-side code. `pnpm typecheck` is the only gate that type-checks the tests (knowledge `typecheck-is-the-only-test-type-gate`) — run it.

**Wire-shape source of truth:** `vendor/shopify/docs/agents/catalog/global-catalog-extension.md:26-33` (the `filters` field shapes) and sil-services `packages/schemas/src/catalog.ts` `SearchFilters` (open, `additionalProperties: true` — accepts these keys today). Never `@ucp-js/sdk` (zero catalog types).

**Soft dependency (not blocking):** the empty-`ship_to` → registered-default *resolution* is the sibling sil-services card (`attach-buyer-ship-to-context-server-side-in-sil-ap`). This plugin forwards-or-omits only; it never fetches an address. The description promises the server behavior the epic delivers; it is correct even before the sibling merges (an omitted `ship_to` simply yields un-localized results until then).

## In Dev — expert-developer, qa-developer

**GREEN: all 24 RED tests pass; full suite 415/415; typecheck + build clean.** Request-side-only, exactly the contract — no response/classifier/projection touched. Three source files changed (`src/lib/sil-client.ts`, `src/tools/catalog.ts`, `src/types/openclaw.d.ts`); no test, manifest, `index.ts`, or `sil_product_get`/`lookupCatalog` change.

**What was implemented (per the immutable contract):**
- `SearchParams` (sil-client.ts) gains `ship_to?: ShipTo`, `ships_from?: ShipsFrom`, `condition?: string[]`, `available?: boolean`. Two small exported interfaces (`ShipTo { country; region?; postal_code? }`, `ShipsFrom { country }`) carry the typed shape and are imported by the tool's narrowers.
- `buildSearchBody` (sil-client.ts:~890) emits `filters.ships_to` (the **rename** — agent `ship_to` → wire `ships_to`), `filters.ships_from`, `filters.condition`, `filters.available`, each only when supplied. `available` uses `typeof === "boolean"` so `false` survives; the other three use `!== undefined` (they arrive already narrowed). Omit-when-absent reuses the existing `Object.keys(filters).length > 0` gate, so a bare `{ query }` still sends exactly `{ query }`.
- `registerSearch` schema (catalog.ts) adds the four `Type.Optional` params: `ship_to`/`ships_from` as `Type.Object` (`country` required inside ⇒ `required: ["country"]`), `condition` as `Type.Array(Type.String())`, `available` as `Type.Boolean()`, each with a self-describing per-field `description`. The `ship_to` field description repeats the empty=registered-default / override framing.
- The tool `description` now carries both steering phrases (omit `ship_to` ⇒ registered default resolved server-side by sil-api; do NOT call `sil_whoami` to fetch/resubmit an address) + override framing + the three filters' purpose.
- `readSearchParams` (catalog.ts) narrows the four new fields via three new pure helpers (`readShipTo`/`readShipsFrom`/`readCondition`) + an inline `typeof === "boolean"` for `available`, all drop-on-wrong-type (mirrors `readIds`). Added a local `asRecord` (object-and-not-array) guard. `hasUsableInput` is untouched.

**Test approach:** qa wrote the 24 RED tests first (commit `0e11641`); I made them GREEN by implementation only. Verified the RED baseline (24 failed / 391 passed) before, GREEN (415 passed) after. The unit body-mapping suite (`search-client.test.ts`) pins the rename + omit-when-absent by whole-body equality; the integration suite (`catalog-search.integration.test.ts`) pins the full agent-arg→wire round-trip, the input-guard refinements, and the outcome-taxonomy invariance (including the retry re-sending the renamed filters under the rotated token).

**The one surprise — `ToolDefinition.parameters` type widening (the only non-obvious change):** `pnpm typecheck` (the sole gate that type-checks tests) failed on a *qa test* — `search.test.ts:193` does a **single-step** `as` cast of `getTool(...).parameters` to `{ properties?: Record<string, Record<string, unknown>> }`. The SDK shim typed `parameters: TObject`, whose `properties: Record<string, TSchema>` (TypeBox `TSchema = {}`) is **not comparable** single-step to `Record<string, Record<string, unknown>>` (TS2352). The existing passing tests cast one level shallower (`Record<string, unknown>`, which overlaps) or use `as unknown as` (two-step). I did NOT edit the test (frozen). The minimal correct fix lives in source: widened the shim's `parameters` to `TObject | TSchema` (reduces to `TSchema`, which has no concrete `properties` member to conflict, so the single-step cast compiles; `Type.Object(...)` is still assignable, so registration is unchanged; the host validates inputs at call time). This is a *type-surface* change only — zero runtime effect.

### → Handoff to Review (next agent: code-quality-guardian)

Review runs against PR #14's diff (three files, +197/-5). Where to look:

1. **The wire-key rename is the seam that fails *green* (highest-value check).** sil-api's `SearchFilters` is open (`additionalProperties: true`), so an emitted `ship_to` (wrong) instead of `ships_to` (right) is silently accepted and the serviceability filter no-ops with no error. Confirm `buildSearchBody` emits `filters.ships_to` for the `ship_to` arg, and that the unit/integration whole-body equality assertions actually pin the plural key (they do — `search-client.test.ts:229-242`, `catalog-search.integration.test.ts:445-450`).
2. **The description-contract assertions** (`search.test.ts:272-315`) pin both steering phrases. The description is the load-bearing product deliverable; a future edit that drops "do not call sil_whoami" or "registered default … server-side" would silently regress the round-trip-avoidance contract. The two unit tests guard it.
3. **Omit-when-absent discipline** — verify no path emits an empty `filters: {}`, an empty `ships_to: {}`, or a defaulted `available: true`. `available: false` must survive (narrowed by `typeof === "boolean"`, not `if (v)`). Pinned by `search-client.test.ts:264-271, 302-328`.
4. **The `ToolDefinition.parameters` widening (`src/types/openclaw.d.ts`) is the one deliberate trade-off** — flagged for your judgment. It loosens the static registration constraint from `TObject` to `TObject | TSchema` (effectively `TSchema`) to keep a frozen qa test's single-step `as` cast legal. Object-ness is still enforced at runtime (the `.type === "object"` assertions + `tool-schema-contract.unit.test.ts`) and registration sites all literally write `Type.Object(...)`. Alternative considered + rejected: editing the test to use `as unknown as` (forbidden — tests are the immutable spec). If you'd prefer the constraint kept tighter, that's a test-shape question for a future card, not a same-branch fix.
5. **Confirm request-only:** no response-side / classifier / projection code is in the diff (it isn't — `classifySearchResponse`, `extractSearchResult`, `projectProduct`, `hasUsableInput`, and the manifest are all untouched).

No known smells beyond (4). The three new narrower helpers (`readShipTo`/`readShipsFrom`/`readCondition`) follow the existing `readIds` drop-on-wrong-type pattern; `asRecord` is local to catalog.ts (sil-client.ts has its own — not shared cross-module, deliberately, to avoid a new export for a 3-line guard).

## Review round 1 — code-quality-guardian

**Verdict: PASS (with one non-blocking note).** Reviewed PR #14's diff (`origin/main...HEAD`, 6 files, +922/-5: three source — `src/lib/sil-client.ts`, `src/tools/catalog.ts`, `src/types/openclaw.d.ts` — and three test files). Request-side-only, exactly the immutable contract. No security, type-safety, complexity, anti-pattern, or architecture issue. Gates re-run independently and green.

**Gate verification (the authoritative local gate — no CI on this repo):**
- `pnpm typecheck` → clean (no diagnostics).
- `pnpm test` → **415 passed / 415** (29 files), matching the expert's GREEN claim exactly.
- `pnpm build` → clean; emits `dist/index.js`.

**Contract conformance (all 5 points + the flagged trade-off):**
1. ✅ **Rename + request-side forward.** `buildSearchBody` (sil-client.ts:911) emits `filters.ships_to` for the agent arg `ship_to` (the load-bearing rename), `ships_from`/`condition`/`available` keep their name under `filters.*`. Pinned by whole-body equality in `search-client.test.ts` (the rename test asserts the singular `ship_to` appears NOWHERE on the wire) and the integration round-trip + the 401-retry re-send. The seam that fails *green* (open `SearchFilters`, `additionalProperties:true`) is correctly guarded by exact-key assertions.
2. ✅ **Omit-when-absent, no client defaults.** Reuses the existing `Object.keys(filters).length > 0` gate, so a bare `{ query }` still sends exactly `{ query }` (no `filters` skeleton, no empty `ships_to:{}`, no defaulted `available:true`). **`available:false` survives** — narrowed with `typeof === "boolean"` at BOTH gates (read site catalog.ts:468 + buildSearchBody sil-client.ts:914), never a truthiness guard. Verified.
3. ✅ **`hasUsableInput` UNCHANGED** — confirmed byte-for-byte identical to origin/main. The new args are refinements; only-new-args requests are rejected client-side with zero network (integration-pinned).
4. ✅ **Description carries both steering phrases** verbatim (catalog.ts:86–98): "LEAVE `ship_to` EMPTY … sil-api resolves the user's REGISTERED DEFAULT ADDRESS server-side" + "Do NOT call sil_whoami … to fetch the user's address" + override framing + all three other filters documented. Per-field descriptions self-describing; the `ship_to` field description repeats the empty=default/override framing. Two unit tests pin both phrases.
5. ✅ **Request-only.** Diff grep for `classifySearchResponse` / `extractSearchResult` / `projectProduct` / `hasUsableInput(` / `lookupCatalog` / `openclaw.plugin.json` / `index.ts` → empty. No response-side / classifier / projection / manifest / `register()` / `sil_product_get` touch.

**Type safety / narrowing (P-none).** No `any` at the boundary. The four new fields narrow off untrusted `params` via three pure drop-on-wrong-type helpers (`readShipTo`/`readShipsFrom`/`readCondition`) + an inline `typeof === "boolean"`, mirroring the established `readIds` discipline. The local `asRecord` (catalog.ts:474) duplicates the module-internal `asRecord` in sil-client.ts — this is **deliberate and correct**, not copy-paste rot: the repo pattern is to re-declare the read-subset locally rather than add a cross-module export for a 3-line guard (matches `docs` + the "three similar lines beat a premature helper" rule). Not a finding.

**The `ToolDefinition.parameters` widening — judged in depth (the central review question).** The expert widened the SDK shim's `parameters` from `TObject` to `TObject | TSchema` (`src/types/openclaw.d.ts`) to satisfy a frozen qa test's single-step `as` cast (`search.test.ts:193`, introduced in the RED commit `0e11641` — confirmed: the source moved, the frozen test did not).

I verified the mechanics against the compiler (throwaway probe under the repo tsconfig, since removed):
- With the **original** `TObject`, the test's deep cast `as { properties?: Record<string, Record<string, unknown>> }` genuinely fails TS2352 — `TObject.properties` is `Record<string, TSchema>` and `TSchema` is the empty interface `{}`, not comparable single-step to `Record<string, unknown>`. So *a* source fix is genuinely required (the test is frozen).
- With `TObject | TSchema`, the cast compiles AND `Type.Object(...)` stays assignable (registration unaffected). Because `TSchema = {}` absorbs `TObject`, the union collapses to `TSchema` — so the field's static type now also admits a **non-object** schema (I confirmed `Type.String()` is assignable to it). That is the loosening.

**Judgment: acceptable, not blocking — it is the minimal source-only fix given the frozen-test constraint, and object-ness is still enforced where it matters (at runtime).** All four registration sites literally write `Type.Object({...})`, and `tool-schema-contract.unit.test.ts` + each tool's `parameters.type === "object"` assertion fail loudly if a non-object schema is ever registered. The static type was never the sole guard; the runtime contract test is the stronger one and is untouched. No tighter *source* fix exists: keeping `parameters: TObject` would require the test to two-step (`as unknown as`), which is forbidden this card (tests are the frozen spec); over-constraining to `TObject & {properties: …}` breaks the `Type.Object` assignment. The expert's alternative analysis is sound.

**Note (non-blocking, future card):** the better long-term shape is to keep `parameters: TObject` and have the introspecting test two-step-cast like `tool-schema-contract.unit.test.ts:130` already does (`as unknown as Record<…>`) — that restores the tighter static boundary without loosening the SDK shim. That's a test-shape change, out of scope here. Recorded as a signal to the orchestrator.

**Knowledge capture.** Non-obvious WHY is well-captured inline already (the load-bearing rename, the open-`SearchFilters` fail-green hazard, the `available:false` survival rationale, and the widening's full justification all carry doc-comments). Nothing for distillation to lift beyond what's inline — the distiller may consider whether the widening note warrants a one-line `docs/knowledge` entry, but it is not required.

### → Handoff back to In Dev (if FAIL/REVIEW)

<!-- N/A — verdict is PASS. No fixes required. -->

## Distillation — solutions-architect

Searched all three INDEX files first. Two captures landed; three candidates deliberately skipped as already-covered (all riding the same PR #14).

**Captured (edited existing > created new):**
- **knowledge/sil-api-catalog-contract.md** (EDITED — extends the existing cross-sibling catalog-wire contract doc; did not create a duplicate):
  - Extended the documented `/catalog/search` wire body with the four new filter keys (`ships_to`/`ships_from`/`condition`/`available` under `filters`).
  - Added a new section **"The serviceability filters ride an OPEN `SearchFilters` — a wrong wire key fails GREEN"**: the open-schema (`additionalProperties: true`) fail-green hazard, the `ship_to`(singular agent arg)→`ships_to`(plural wire key) rename and that landing them under `context` instead of `filters` also no-ops silently, the no-client-defaults + `available:false`-survives discipline, and that the keys are accepted on the wire *today* (ahead of the sil-services sibling naming them). This is the durable, cross-repo, fail-*green* gotcha the next catalog card + the sil-services sibling both need — and the one thing the inline `buildSearchBody` comments (in *this* repo) won't surface to a sibling-repo agent. Bumped `commit`/`updated_at`/`updated_by_card`; updated + (already-top) re-sorted the knowledge INDEX row.
- **product/location-aware-search-flow.md** (NEW — `docs/product/` was empty; no doc to fold into):
  - The agent-steering business rule + the epic-level cross-sibling flow: empty `ship_to` ⇒ registered default resolved server-side; agent must NOT round-trip `sil_whoami`; `ship_to` is override-only; the plugin's forward-or-omit lane boundary (no address fetching); the three-sibling sequencing and that the end-to-end promise is false until the sil-services sibling merges; and that the wire home is `filters.ships_to` (not `context`, which is the server's). This is product/flow knowledge that genuinely spans three repos and is NOT derivable from this repo's code alone. Added the product INDEX row (first entry). Cross-linked bidirectionally with the catalog-contract doc.

**Deliberately skipped (already covered — capturing would duplicate):**
- **The `ToolDefinition.parameters` `TObject → TObject | TSchema` widening** — already fully captured by a thorough WHY comment at the exact site (`src/types/openclaw.d.ts`), which is the correct smallest scope (it applies to one declaration). A `docs/knowledge` note would only restate it, and `typecheck-is-the-only-test-type-gate.md` already owns the adjacent "typecheck gates tests" fact. The tighter end-state (two-step-cast test fix restoring `parameters: TObject`) is already recorded as an orchestrator signal for a future card — left as-is, no new card created (orchestrator/founder owns that).
- **Omit-when-absent / no-client-defaults / `available:false` survives** — an already-established repo pattern (`search-client.test.ts:161-167` is "the rule" per the contract) and now also inline-documented at `buildSearchBody` + `readSearchParams`. The repo-knowledge angle of it (the fail-green *consequence*) is folded into the catalog-contract edit above; restating the pattern itself in a doc would duplicate.
- **The load-bearing rename + per-field steering description** — captured inline (the `buildSearchBody` comment, the `ShipTo` interface comment, the description string + per-field descriptions) AND lifted to repo/cross-sibling scope in the two docs above. No further capture needed.

### In Dev round 2 — qa RED (qa-developer)

RED tests pinning the re-specced tightened contract are committed (`b89057e`, test files only — card stays local-only; not pushed, expert pushes at review). **RED baseline: 23 failed / 422 passed (445 total, up from 415 GREEN); typecheck clean.** The 23 failures are the new tightened contract (functionality absent in the thin impl); 7 added tests pass legitimately — they are REGRESSION GUARDS the GREEN impl must KEEP (see below).

**The exact regexes I pinned (immutable spec — both the schema `pattern` AND the @sil/schemas sibling must mirror these byte-for-byte):**
- `country` (ships_to + ships_from): `^[A-Za-z]{2}$` — directive-mandated, ISO 3166-1 alpha-2.
- `region`: `^[A-Za-z0-9]{1,3}$` — directive's recommended pin; accepts CA/NY/BY/97, rejects place names (`California` is 10 chars → fails; `Βαυαρία` non-ASCII → fails).
- `postal_code`: `^(?=[A-Za-z0-9 -]{2,12}$)[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$` — a SINGLE self-contained pattern: a leading length-cap lookahead (2–12 chars total, separators counted) + a structural body (alnum runs joined by single internal space/hyphen, no leading/trailing/doubled separator). Chosen single-regex (not `pattern` + `minLength`/`maxLength`) so the sibling can mirror it from the same directive text with nothing to keep in lockstep. Probe-verified: accepts `94107`/`EC1A 1BB`/`K1A 0B1`/`10001`/`K1A-0B1`; rejects ` 94107`/`94107 `/`EC1A  1BB`/`EC1A-`/`-94107`/`K1A--0B1`/prose-with-commas/`94107; DROP TABLE`/`<script>`/13-char/non-ASCII/`12_34`.

**The pinned client-side validation error envelope (mirrors `invalidInput`/`invalidIds` in catalog.ts, `notRegistered` in identity.ts):** `jsonResult({ status: "invalid_request", error: "invalid_filter", message: <names the field/format> })`, with NO `recovery: sil_register` (auth is fine; the format is the problem). **`error: "invalid_filter"` is the pinned machine code** — distinct from `empty_search_input` (the no-usable-input case). The integration tests assert `payload.error === "invalid_filter"` and `message` matches `/country|ship_to|code|format|alpha-2|iso/` — the expert owns the exact message wording within that.

**THE KEY BEHAVIORAL SPLIT the GREEN impl must implement (and the seam the RED tests pin):**
- Wrong **TYPE** (number country, primitive `ship_to`, non-array `condition`) → **DROP** the field — existing `readShipTo`/`readShipsFrom`/`readCondition` discipline stays; those drop-on-wrong-type tests (`search.test.ts` "drops wrong-typed new filter args") remain GREEN and untouched.
- Wrong **FORMAT** (a STRING that fails its `pattern`) → **REJECT the whole request CLIENT-SIDE** with the `invalid_filter` envelope, **NO network call** (`rec.all.length === 0`). This is NEW — the thin `readShipTo` accepts any non-empty string country. The expert must add format validation at the read site (or a validate step before `hasUsableInput`/network) that distinguishes "field absent/wrong-type → drop" from "field present, string, wrong-format → reject request".
- **NORMALIZATION lives at the WIRE layer.** `country` is uppercased on the wire (`us` → `US`) by `buildSearchBody`/`searchCatalog` (the unit `search-client.test.ts` calls `searchCatalog` directly with a lowercase-country `SearchParams` and asserts `US` on the wire). Region/postal are forwarded VERBATIM (the read site owns their format gate; the wire owns only country-case). So: read site = FORMAT REJECTION; wire = COUNTRY-CASE NORMALIZATION. Both enforce the contract.

**Open wire for `condition` (REGRESSION GUARD — do NOT add validation):** `condition` is steered to new/secondhand in the DESCRIPTION only; the WIRE STAYS OPEN. `["refurbished"]` (and any unrecognized value) MUST still forward under `filters.condition` — never reject or drop for being unrecognized. Two passing RED tests (`condition wire stays OPEN`) pin this; the expert must NOT add a condition allow-list.

**The 7 legitimately-passing added tests are regression guards the GREEN impl must KEEP green:** already-uppercase country no-op (`US`→`US`); the 2 condition-open-wire forwards; and 4 description/field-description phrases the thin impl already satisfies (condition values, the alpha-2 `ship_to`/`ships_from` field descriptions). They are NOT false-greens — they pin behavior that must survive the tightening.

**Files I touched (tests only):** `src/__tests__/lib/search-client.test.ts` (+74: country normalization block), `src/__tests__/tools/search.test.ts` (+184: schema-pattern block, ISO-codes-steer description block, per-field format-language block), `src/__tests__/catalog-search.integration.test.ts` (+238: bad-format-rejection block, accept-and-normalize block, condition-open-wire block). Every existing passing scenario preserved (496 insertions, 0 deletions). **`hasUsableInput` UNCHANGED** — only-new-args requests still reject as empty input with no network (existing tests keep that).

**Scope fences honored:** request-side only; no touch to `openclaw.plugin.json`, `register()`/`index.ts`, `sil_product_get`/`lookupCatalog`, or any response/classifier/projection code.

**Contract ambiguity I resolved:** the postal `pattern` is a FORMAT guard, not a semantic "is this a real postal code" check — a lone alpha word ≤12 chars (e.g. `"California"`) passes postal FORMAT. That is correct: `region="California"` is rejected by the REGION pattern (where the directive places it), not the postal pattern; nobody passes a place name as `postal_code`, and the server's serviceability lookup is the authoritative semantic backstop. The postal corpus rejects prose/injection/overlong/non-ASCII/bad-separators — the things a format guard owns.

**→ Handoff to expert-developer (GREEN):** make the 23 RED tests pass by implementation only — never weaken a test. Add the format `pattern`s to the four schema fields (`country` both objects, `region`, `postal_code`); add country-case normalization in `buildSearchBody`; add the FORMAT-rejection path returning the `invalid_filter` envelope before any network call; enrich the description with the ISO-codes-not-free-text steer + per-field format instructions. Keep `condition` open, keep wrong-TYPE as DROP, keep `hasUsableInput` untouched. `pnpm typecheck` is the only gate that type-checks tests — run it. Confirm GREEN (445/445) + `pnpm build` clean before opening/updating PR #14 at the review transition.

### In Dev round 2 — expert GREEN (expert-developer)

**GREEN: all 23 RED tests pass; full suite 445/445 (from the RED baseline 23 failed / 422 passed); typecheck + build clean (`dist/index.js` emitted).** Request-side-only, exactly the re-spec contract — `condition` left OPEN, wrong-TYPE still DROPS, `hasUsableInput` untouched. **Two source files changed** (`src/lib/sil-client.ts` +40/-? , `src/tools/catalog.ts` +220 lines reworked); no test, manifest, `index.ts`, `sil_product_get`/`lookupCatalog`, or response/classifier/projection change. (Notably did NOT need to touch `src/types/openclaw.d.ts` — the round-1 `parameters` type-shim widening already accommodates the new `pattern` introspection.)

**What changed (per the qa contract's behavioral split):**

1. **READ SITE = FORMAT REJECTION** (`catalog.ts`). The three shared patterns are now module constants (`COUNTRY_PATTERN ^[A-Za-z]{2}$`, `REGION_PATTERN ^[A-Za-z0-9]{1,3}$`, `POSTAL_PATTERN ^(?=[A-Za-z0-9 -]{2,12}$)[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$`) — used BOTH as the schema `Type.String({ pattern })` AND the read-site gate, defined once to keep them in lockstep (and to mirror `@sil/schemas` byte-for-byte). `readShipTo`/`readShipsFrom` now return a **3-arm discriminated `FilterRead<T>` (`ok` / `absent` / `invalid`)** instead of `T | null`: a non-object/missing-country is `absent` (DROP — wrong-TYPE discipline preserved), a present string failing its pattern is `invalid` (the offending `field` named). `readSearchParams` returns `{ kind: "ok"; params } | { kind: "invalid"; field }` — the first bad field wins, no `any` at the boundary. A new `matchesPattern(value, pattern)` helper compiles the shared string to a fresh `RegExp` per call.
2. **The tool rejects format-invalid BEFORE the input guard / any network.** `execute` now branches on the read result: `invalid` → `invalidFilter(field)` (`{ status: "invalid_request", error: "invalid_filter", message }`, NO `recovery`) + a logs-only `sil_search_invalid_filter` marker; only on `ok` does it fall through to `hasUsableInput` and the network. Precedence (format-check → input-guard) is correct: a bad-format filter + a real query rejects `invalid_filter`; a valid `ship_to` ALONE (no query/category/price) still rejects `empty_search_input`.
3. **WIRE LAYER = COUNTRY-CASE NORMALIZATION** (`sil-client.ts`). `buildSearchBody` now routes `ships_to`/`ships_from` through a new `withUppercaseCountry<T extends { country: string }>(value)` helper (spread-then-overwrite — generic over `ShipTo`/`ShipsFrom`, drops/reshapes nothing), so `country` is emitted UPPERCASE (`us`→`US`); `region`/`postal_code` forwarded verbatim. The rename, omit-when-absent, and `available:false`-survives are unchanged.
4. **Description** keeps the round-1 steering phrases verbatim (empty `ship_to` ⇒ registered default server-side; do NOT call `sil_whoami`; override framing) and ADDS the explicit "ALWAYS send standard ISO CODES, NOT free text / natural-language place names" steer + per-field format instructions (country = 2-letter alpha-2 US/GB/DE; region = 3166-2 subdivision code CA/NY/BY, not a place name; postal = destination ZIP; condition = exactly new/secondhand). Each per-field schema `description` self-describes its format.

**The `message` wording I chose for `invalid_filter`:** *"The `<field>` filter is malformed. Send standard ISO codes, not free-text names: country as a 2-letter ISO 3166-1 alpha-2 code (e.g. "US"), region as an ISO 3166-2 subdivision code (e.g. "CA"), and postal_code as a destination postal/ZIP code."* — `<field>` is the dotted path (`ship_to.country` / `ship_to.region` / `ship_to.postal_code` / `ships_from.country`). Satisfies qa's `/country|ship_to|code|format|alpha-2|iso/` constraint and is genuinely actionable (names the offender + the required form).

**Test approach:** qa wrote the 23 RED tests first (`b89057e`); I made them GREEN by implementation only — touched no test. Verified the RED baseline (23 failed / 422 passed) before and GREEN (445 passed) after; the 7 regression guards (already-uppercase no-op, the 2 condition-open-wire forwards, the 4 description/field phrases) stayed green throughout. Live verification: build gate green + the 30 re-spec behavioral tests run in isolation through the REAL tool→sil-client (only `fetch` mocked) — the integration tier IS this repo's runtime surface (no host-load e2e gate; the plugin can't self-bootstrap since `openclaw/plugin-sdk` is a host-provided peer type-shim).

**Contract points I had to interpret (none changed the spec):**
- **Pattern home.** Defined the three patterns once in `catalog.ts` (the request-side module owning both the schema and the read gate) rather than in `sil-client.ts` — the wire layer only uppercases, it never re-validates format, so it needs no pattern.
- **Format-vs-input precedence.** qa's tests never mix bad-format + no-query, so the order isn't pinned by a test; I chose format-check FIRST (a malformed filter is a harder error than missing input, and it keeps the `invalid_filter` path strictly before the network — matching the `rec.all.length === 0` assertions).
- **`region`/`postal` rejection symmetry.** A bad `region`/`postal` rejects even when `country` is valid (the narrower validates all present strings, first-bad-wins) — matches the `region="California"` and `postal="San Francisco, CA, 94107"` tests.

### → Handoff to Review (round 2) — code-quality-guardian

Review runs against PR #14's updated diff (two source files: `src/lib/sil-client.ts`, `src/tools/catalog.ts`). The round-1 PASS still holds for everything it covered; these are the NEW round-2 seams — the highest-value checks:

1. **The wire-normalization seam (`withUppercaseCountry` in `buildSearchBody`).** Confirm `ships_to.country` AND `ships_from.country` are uppercased on emit while `region`/`postal_code` pass VERBATIM, and that the spread preserves every other field (no drop/reshape). The unit `search-client.test.ts` country-normalization block pins `us→US`, `De→DE`, already-uppercase no-op, `gb→GB` on ships_from, and the merged all-filters body; the integration accept-and-normalize block pins the full agent-arg→wire round-trip. This is a NEW wire transform — verify it didn't perturb the rename or omit-when-absent.
2. **The reject-on-FORMAT path (the central round-2 behavioral change).** The two-layer split must stay clean: wrong **TYPE** → DROP (`absent`, request proceeds); wrong **FORMAT** → REJECT (`invalid`, `invalid_filter`, zero network). Confirm `readShipTo`/`readShipsFrom`'s 3-arm `FilterRead` keeps the drop-on-wrong-type tests green (`ship_to:"US"` primitive, `ships_from:42` number → dropped, NOT rejected) AND the bad-format tests reject before any fetch (`rec.all.length === 0`). Confirm `condition` is NOT format-validated (the open-wire regression guards — `["refurbished"]` still forwards). Confirm precedence: `invalid_filter` fires before `hasUsableInput`, but `ship_to` ALONE (valid) still yields `empty_search_input`.
3. **The description-contract assertions.** The round-1 steering phrases (registered-default / do-not-`sil_whoami` / override) must remain verbatim AND the new re-spec format language present (ISO-codes-not-free-text steer; per-field alpha-2/3166-2 instructions; condition new/secondhand). Two suites in `search.test.ts` (ISO-codes-steer + per-field self-describes) pin the new language; the round-1 steering suite pins the kept phrases. A future edit dropping either silently regresses the contract.
4. **No `any` at the new narrowing boundary** — the `FilterRead<T>` union + `matchesPattern` keep the read site fully typed; `withUppercaseCountry<T extends { country: string }>` is generic, no cast. **Request-only confirmed** — diff touches only the two request-side files; no response/classifier/projection/manifest/`index.ts`/`sil_product_get` change.

No known smells. One deliberate, minor duplication: the three patterns + `matchesPattern` live in `catalog.ts`, mirroring `@sil/schemas` in the sil-services sibling (the two MUST stay byte-identical — the directive's lockstep requirement; the sil-stage eval verifies end-to-end). That cross-repo mirror is intentional, not extractable (different repos, no shared package — decision `sil-shared-catalog-client`).

## Review round 2 — code-quality-guardian

**Verdict: PASS.** Reviewed PR #14's full merge-target diff (`origin/main...HEAD`, 10 files, +1646/-17). The round-2 incremental change is exactly the two request-side source files the qa/expert handoff claimed (`src/lib/sil-client.ts`, `src/tools/catalog.ts` — `git diff f99b2d8..HEAD` on `src/*.ts`); `src/types/openclaw.d.ts` was NOT re-touched in round 2 (the round-1 `parameters` widening stands, correctly not re-litigated). No security, type-safety, complexity, anti-pattern, architecture, or observability issue. Every immutable-contract point from the re-spec directive (lines 32–46) holds. Gates re-run independently, all green.

**Gate verification (the authoritative local gate — no CI on this repo):**
- `pnpm typecheck` → clean (`tsc --noEmit`, zero diagnostics).
- `pnpm test` → **445 passed / 445** (29 files), matching the expert's GREEN claim exactly (from the RED baseline 23 failed / 422 passed).
- `pnpm build` → clean; emits `dist/index.js` (2004 bytes).

**Contract conformance — the five re-spec deliverables + the two-layer split:**

1. ✅ **Wire-normalization seam (`withUppercaseCountry` in `buildSearchBody`, sil-client.ts:925–948).** A generic `<T extends { country: string }>(value) => ({ ...value, country: value.country.toUpperCase() })` — spread-then-overwrite, fully typed, no cast, drops/reshapes nothing. `ships_to.country` AND `ships_from.country` uppercased on emit (`us`→`US`); `region`/`postal_code` forwarded VERBATIM. The `ship_to`→`ships_to` rename preserved (line 925); omit-when-absent intact via the unchanged `Object.keys(filters).length > 0` gate (bare `{query}` → exactly `{query}`, unit-pinned search-client.test.ts:334–336); `available:false` survives via `typeof === "boolean"` (line 930). Unit suite pins `us→US`/already-uppercase no-op/`gb→GB`-on-ships_from/merged-all-filters; integration accept-and-normalize block (lines 627–677) pins the full agent-arg→wire round-trip including region+postal verbatim.
2. ✅ **Two-layer split — reject-on-FORMAT vs drop-on-TYPE (`readSearchParams` + the 3-arm `FilterRead<T>`, catalog.ts:496–632).** Wrong **TYPE** (primitive `ship_to`, number `ships_from`, non-array `condition`, string `available`) → `absent` → DROPPED, request proceeds (the `readIds` discipline survives — pinned search.test.ts:576–621, all still green). Wrong **FORMAT** (a present string failing its `pattern` — `country="United States"`, `region="California"`) → `invalid` → REJECT the whole request client-side via the `{ status:"invalid_request", error:"invalid_filter", message }` envelope (catalog.ts:689–699) with **ZERO network** (integration `rec.all.length===0`, lines 521–617). `error:"invalid_filter"` is the pinned machine code, distinct from `empty_search_input`; the `message` names the dotted offender (`ship_to.country` etc.) and prescribes the ISO-code form — genuinely actionable. `condition` stays OPEN — `["refurbished"]` and mixed recognized/unrecognized values forward verbatim, never rejected/dropped (regression guards, lines 686–732). **Precedence correct:** format-check fires BEFORE `hasUsableInput`, yet a valid `ship_to` ALONE still yields `empty_search_input` (lines 742–787). The envelope matches the repo's existing client-side error shape (`invalidInput`/`invalidIds` in catalog.ts, `notRegistered` in identity.ts) — no `recovery: sil_register` (auth is fine; format is the problem).
3. ✅ **Schema `pattern`s match the pinned regexes BYTE-FOR-BYTE.** Module constants (catalog.ts:85–87): country `^[A-Za-z]{2}$`, region `^[A-Za-z0-9]{1,3}$`, postal `^(?=[A-Za-z0-9 -]{2,12}$)[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$` — identical to the RED-test spec (search.test.ts:287–289) and used in BOTH the schema `Type.String({ pattern })` (lines 169/176/184/206) AND the read-site gate (via `matchesPattern`), defined once to keep them in lockstep. `matchesPattern` compiles a fresh `RegExp` per call (no stateful `lastIndex`). Cross-repo `@sil/schemas` lockstep is the sibling card's + sil-stage eval's responsibility; this repo pins its own side correctly.
4. ✅ **Description contract.** Round-1 steering phrases KEPT VERBATIM (catalog.ts:111–117: "LEAVE `ship_to` EMPTY … sil-api resolves the user's REGISTERED DEFAULT ADDRESS server-side"; "Do NOT call sil_whoami … to fetch the user's address"; override framing) AND the new format language present (lines 107–110, 118–124: "ALWAYS send standard ISO CODES, NOT free text or natural-language place names"; per-field alpha-2 / ISO 3166-2 / postal instructions; `condition` = exactly new/secondhand). Per-field schema descriptions self-describe their format. Both axes are phrase-pinned by unit tests (search.test.ts:259–260, 365–398) — a future edit dropping either regresses the contract loudly. The alpha-2 pattern is asserted "enforceable, not decorative" (search.test.ts:325).
5. ✅ **Request-only + scope fences.** Diff grep for `plugin.json`/`index.ts`/`classify`/`extract`/`project` → NONE. No response/classifier/projection code, no manifest, no `register()`/`index.ts`, no `sil_product_get`/`lookupCatalog` touched. `hasUsableInput` confirmed UNCHANGED (catalog.ts:639–646 — only-new-args requests still reject as `empty_search_input` with zero network).

**Type safety / narrowing (P-none).** No `any`, no unsafe cast, no `@ts-ignore` introduced in round 2 (verified on the round-2 source diff). The new boundary is fully typed: the 3-arm discriminated `FilterRead<T>` + `SearchParamsRead`, the `matchesPattern(value, pattern)` helper, and the generic `withUppercaseCountry<T extends { country: string }>` carry the narrowing without a single cast. The local `asRecord` in catalog.ts duplicating the one in sil-client.ts is the established, doc-governed repo pattern (re-declare the read-subset locally rather than export a 3-line guard cross-module — decision `sil-shared-catalog-client`), not copy-paste rot.

**Security (P-none) — the highest-value independent check.** I ran all three patterns against an injection/prose corpus (`<script>`, `; DROP TABLE users`, `' OR 1=1`, `../../etc/passwd`, non-ASCII `Βαυαρία`, prose-with-commas, `94107; DROP TABLE`, `United States`, `California`): **every payload is rejected by every relevant pattern** — XSS, SQLi, path-traversal, prose, and non-ASCII all fail country/region/postal. Valid codes (`US`/`us`/`CA`/`BY`/`94107`/`EC1A 1BB`/`K1A 0B1`) all accepted. The single corpus `true` is `"California"` matching the *postal* pattern as a bare ≤12-char alpha token — exactly the contract ambiguity qa explicitly resolved and documented (card line 343): `"California"` as a *region* is rejected by the region pattern (where the directive places it), the postal pattern is a FORMAT/injection guard not a semantic "is this a real ZIP" check, and the server's serviceability lookup is the authoritative semantic backstop. Deliberate + documented, not a finding. The token-leak canary remains intact (integration:1236–1310), and the new `sil_search_invalid_filter` log marker carries only `{ field }` (a dotted path — no credential, no user value, no PII), consistent with the repo's structured-logging discipline.

**Observability (P-none).** The round-1 silent-success refresh marker (`sil_search_refreshed`, gated on `recovered.refreshed`) is preserved — no regression of the success-refresh seam. The new client-side rejection emits a uniform `sil_search_invalid_filter` info marker (a logworthy state-transition per the `code-logging` skill), payload-safe.

**Knowledge capture.** Non-obvious WHY is well-captured inline (the two-layer FORMAT-reject-vs-TYPE-drop split, the pattern-lockstep rationale, the wire-only country-case normalization, the `condition` open-wire regression guard, the `invalid_filter` precedence-before-input-guard) all carry doc-comments. The round-1 distillation already lifted the cross-repo fail-green hazard to `docs/knowledge/sil-api-catalog-contract.md` and the agent-steering flow to `docs/product/location-aware-search-flow.md` — see the handoff below for what the round-2 tightening adds.

### → Handoff to Distillation (next agent: solutions-architect)

The distiller reads the merge-target diff (`origin/main...HEAD`) directly. The round-1 captures still hold; assess whether the round-2 tightening warrants extending them (prefer editing the existing docs over creating new ones — search the INDEX first):

**Likely worth lifting (the durable, cross-repo, NOT-inline-surfaceable facts):**
- **The pinned format contract + the byte-for-byte `@sil/schemas` lockstep requirement.** `docs/knowledge/sil-api-catalog-contract.md` already documents the open-`SearchFilters` fail-green hazard and the `ships_to` rename. Consider extending it with the THREE pinned regexes (country `^[A-Za-z]{2}$`, region `^[A-Za-z0-9]{1,3}$`, postal `^(?=[A-Za-z0-9 -]{2,12}$)[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$`) and the rule that the plugin's local patterns MUST mirror sil-services `@sil/schemas` `ShipTo`/`ShipFrom` byte-for-byte (sil-stage eval verifies end-to-end). This is the cross-sibling lockstep contract a future catalog card or the sil-services sibling needs and cannot derive from this repo's code alone. The single-regex postal choice (length-cap lookahead + structural body, so the sibling mirrors it from one string) is the kind of non-obvious WHY worth a sentence.
- **The two-layer enforcement seam: read-site FORMAT-rejection vs wire-layer COUNTRY-CASE-normalization, and TYPE-drop vs FORMAT-reject.** The split (a present-but-malformed string rejects client-side with `invalid_filter` and zero network; a wrong-TYPE field drops; `condition` stays open) is a deliberate, non-obvious design that a future tool author touching `readSearchParams` could easily collapse. Inline comments cover it for this file; judge whether a one-line `docs/knowledge` invariant (or an extension of the product-flow doc's business-rule section) better guards it cross-card.

**Already covered inline — likely NO new capture needed (would duplicate):**
- The `ToolDefinition.parameters` `TObject → TObject | TSchema` widening — fully captured by the WHY comment at `src/types/openclaw.d.ts` (round 1; unchanged this round) + the orchestrator signal already recorded for the future test-shape cleanup card. No `docs` note needed.
- Omit-when-absent / no-client-defaults / `available:false` survives — an established repo pattern, inline-documented at `buildSearchBody` + `readSearchParams`, and the fail-green consequence already lives in the catalog-contract doc.
- The load-bearing rename + the per-field steering description — captured inline AND already lifted to the catalog-contract + product-flow docs in round 1.

No new card needed. The future `parameters: TObject` test-shape cleanup is already an orchestrator signal (founder owns it).

## Distillation round 2 — solutions-architect

Searched all three INDEX files (`docs/decisions`, `docs/knowledge`, `docs/product`) first; read the round-1 docs in full and the round-2 merge-target source (`origin/main...HEAD`) before writing. ONE doc edit landed (edited an existing doc; created nothing new); two candidates deliberately skipped as already inline. Everything rides PR #14.

**Captured (extended an existing doc — did NOT create a duplicate):**
- **knowledge/sil-api-catalog-contract.md** (EDITED): added a new section **"The `ships_to`/`ships_from` FORMAT contract is a byte-for-byte cross-repo mirror (no shared package)"** capturing what round 2 made newly true and durable:
  - The three enforced regexes (country `^[A-Za-z]{2}$`, region `^[A-Za-z0-9]{1,3}$`, postal `^(?=[A-Za-z0-9 -]{2,12}$)[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$`) **MUST stay byte-identical** to sil-services `@sil/schemas` `ShipTo`/`ShipFrom`, with **no shared package** to enforce it (cross-links [[sil-shared-catalog-client]]: re-declare locally, don't import). The failure mode — a one-sided edit silently diverging the two repos — and that the sil-stage `live-catalog-serviceability-localization-eval` is the end-to-end check, plus the rule that a pattern change must land in **both** repos in the same change. This is the cross-repo lockstep-without-a-package constraint a sil-services / sil-stage agent cannot derive from THIS repo's inline comments.
  - The single-regex postal choice (length-cap lookahead + structural body, so the sibling mirrors it from one string) — the non-obvious WHY.
  - Folded in (one sentence each, not restated at length): enforcement is **client-side, fail-fast** (`invalid_filter` envelope, zero network) replacing the prior fail-late opaque sil-api 400; `country` is **uppercased on the wire** (`us`→`US`) so a sibling's stored alpha-2 must compare against the uppercased value; `condition` stays **OPEN** (unrecognized forwards, never rejected — steering is description-only).
  - Bumped `commit` f99b2d8 → bcbab28 (the round-2 source commit that introduced the format contract), refreshed the title + tags, updated the (already-top) knowledge INDEX row's title/tags.

**Deliberately skipped (already covered inline — capturing would duplicate):**
- **Reject-on-FORMAT vs drop-on-TYPE two-layer split.** The WHY is thoroughly inline at the exact sites — `readShipTo`/`readShipsFrom` (the 3-arm `FilterRead`: non-object/missing-country → `absent`/DROP; bad-format string → `invalid`/REJECT), `invalidFilter` (the envelope + no-`recovery` rationale + precedence-before-input-guard), and `readCondition` (the open-wire regression guard). The reviewer judged this inline-covered; I concur. Its one cross-repo-relevant *consequence* (client-side reject replaces a fail-late 400) is folded into the doc edit above as a single sentence — the mechanism itself stays inline.
- **Country-case normalization at the WIRE layer (`withUppercaseCountry` in `buildSearchBody`).** Fully captured inline at `withUppercaseCountry`, the `buildSearchBody` block comment ("read site owns FORMAT, wire owns case"), and the `ShipTo`/`ShipsFrom` interface comments. The one cross-repo contract fact (a sibling compares against the *uppercased* wire value) is the only durable angle and is folded into the doc edit; the read-site-vs-wire-layer mechanics stay inline where they apply to one file.

No new inline comment was added (round-2 source already carries thorough WHY; more would duplicate) — so no `pnpm typecheck` re-run was needed. No new card; the `parameters: TObject` test-shape cleanup remains an orchestrator signal (founder owns it).

INDEX.md updated: knowledge.

## PR Ready

**PR #14** — https://github.com/Context4GPTs/sil-openclaw/pull/14 (OPEN; founder merges).

Distillation round 2 complete; card at `pr-ready`. The round-2 tightening (enforced ISO `ship_to`/`ships_from` format contract, client-side `invalid_filter` reject-before-network, wire-layer country-case normalization, ISO-codes-not-free-text steering description) is on the same branch / same PR as the round-1 work. The durable cross-repo learning (the byte-for-byte `@sil/schemas` format-regex mirror + the fail-fast client-side enforcement) is captured in `docs/knowledge/sil-api-catalog-contract.md`. Founder notification fires here.

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
