---
type: card
title: Migrate OpenClaw tool schemas to TypeBox 1.x
slug: migrate-openclaw-tool-schemas-to-typebox-1-x
work_type: refactor
tiers: [unit, integration]
status: done
agents: []
priority: 2
created: 2026-06-08
updated: 2026-06-08
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-migrate-openclaw-tool-schemas-to-typebox-1-x
branch: card/migrate-openclaw-tool-schemas-to-typebox-1-x
pr: https://github.com/Context4GPTs/sil-openclaw/pull/6
merged_commit: 3b7cc904af1b5179fb647efdd3c2968c61524f58
epic_id: typebox-1x-migration-2026-06
---

## Intent (founder)

We're still in the early innings, so adopt the latest TypeBox now across the whole stack rather than a more painful migration later. Move the plugin's MCP tool-parameter schemas off `@sinclair/typebox@0.34` onto the standalone `typebox@1.x`, so the plugin doesn't straddle a different TypeBox major than `sil-services`. This is a dependency-major migration only: the tool-parameter shapes — and therefore the agent-facing tool contract — must be unchanged, and the manifest-contract drift guard must stay green.

## Epic notes (provisional — sibling Discovery owns the verdict)

**Epic:** `typebox-1x-migration-2026-06` — adopt TypeBox 1.x across the whole sil stack while it is small. Lead card is in `sil-services` (the shared `@sil/schemas` package + the Fastify type-provider); peer is `sil-stage` (golden-example schema). This plugin uses TypeBox independently (it does **not** consume `@sil/schemas`), so it can migrate on its own timeline — the epic just does all three together.

**Likely change site (shallow guess — Discovery to confirm):**
- `package.json` — `@sinclair/typebox@0.34.14` → `typebox@1.x`.
- `src/tools/examples.ts` and `src/tools/identity.ts` — the `Type.Object({...})` tool-parameter definitions. Discovery should sweep `src/` for any other `Type.*` usage.

**Draft acceptance (Discovery may revise):**
- Given sil-openclaw, when `pnpm build && pnpm typecheck && pnpm test` runs, then all pass on `typebox@1.x` with no `@sinclair/typebox@0.34` left in the tree.
- Given the registered MCP tools, when their `parameters` JSON-schema is inspected, then it is the same shape agents see today — no tool-contract change, and `manifest-contract.integration.test.ts` stays green.

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

- 2026-06-08 epic-add (intake) — cross-sibling: part of epic `typebox-1x-migration-2026-06`; lead card is `sil-services` (migrate-sil-api-and-schemas-to-typebox-1-x), peer is `sil-stage` (migrate-staging-golden-schema-to-typebox-1-x). Independent TypeBox usage here — no dependency on the lead landing first.
- 2026-06-08 expert-developer (in-dev) — pattern: TypeBox 1.x tightens `TObject<P>` to a precise interface with NO string index signature, so any `schema as Record<string, unknown>` cast that compiled on 0.34 now fails `tsc` with TS2352 — fix is `as unknown as Record<string, unknown>` (type-level only, assertions unchanged). Surfaced in TEST code here; will recur in the sil-services + sil-stage peer cards. Also: 1.x reorders emitted JSON-schema keys (set-identical, order-different) — schema equivalence must use unordered `toEqual`, never a `JSON.stringify` byte-compare against a 0.34 literal.

---

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — product-owner, solutions-architect

<!-- Filled jointly by product-owner and solutions-architect. -->

### Governing contract rule (the acceptance bar) — product-owner

The single business rule this migration must not violate:

> **The agent-facing MCP tool contract is invariant across the migration.** For every registered tool, the `name`, `label`, `description`, and the **JSON-schema object that lands in `parameters`** (the value the OpenClaw host serializes and presents to agents) must be equivalent before and after the swap from `@sinclair/typebox@0.34` to `typebox@1.x`. The set of tools is likewise invariant: `{ sil_echo, sil_ping, sil_register, sil_whoami }` — no additions, removals, or renames.

Why the contract is the **emitted JSON-schema**, not the TypeBox library identity (verified against the code, not assumed from the intent):
- `ToolDefinition.parameters` is typed `TObject` (`src/types/openclaw.d.ts:51`); the host consumes the *enumerable* JSON-schema shape it carries (`type`, `properties`, `required`, nested `description`) — never the library's internal type markers.
- TypeBox 1.x's headline breaking change is removing the `Kind` / `Optional` / `Readonly` **symbols** in favour of *non-enumerable* `~kind` / `~optional` / `~readonly` properties. The plugin reads none of these — confirmed: zero `Kind` / `~kind` / `Type.Strict` introspection anywhere in `src/`. So the symbol change is invisible both to this plugin's runtime and to the host (which sees only enumerable keys).
- The four schemas in play are trivial: `Type.Object({})` (×3 — `sil_ping`, `sil_register`, `sil_whoami`) and `Type.Object({ message: Type.String({ description }) })` (`sil_echo`). None of 1.x's other breaking changes touch them: no removed `Date` / `Uint8Array` types, no Compiler / `TypeCheck`→`Validator` API, no `Errors()` iterator usage.

Net: for these exact shapes the JSON-schema emitted by `0.34` and `1.x` is expected to be **byte-identical**. The acceptance criteria below pin that equivalence *observationally*, so an unexpected emission drift fails the build rather than silently reaching an agent.

### Approach + alternatives ruled out — solutions-architect

**Chosen: straight dependency swap, root-namespace import.** Replace the `@sinclair/typebox@0.34.14` direct dep with `typebox@^1.2.2` (latest; the standalone successor — same author, renamed package, ESM-only) and rewrite the 3 source import sites' specifier from `"@sinclair/typebox"` to `"typebox"`. The call surface (`Type.Object`, `Type.String`, the `TObject` type) is identical between the two, so the schema-building code does not change — only the import specifier. Confirmed end-to-end against the real 1.2.2 and 0.34.14 packages (see Risks for the byte-level diff).

Alternatives ruled out:
- **Import from a subpath (`typebox/type`) instead of the root.** Rejected — the `typebox` root `.` export re-exports `Type` as a namespace (`export * as Type from './typebox.mjs'`, also the default export) and re-exports `TObject`/`Static`/`TSchema` (`export * from './type/types/index.mjs'`), so the existing **root-level named imports resolve unchanged**. A subpath import would be gratuitous churn diverging from the 0.34 style already in the codebase.
- **Stay on `@sinclair/typebox`, bump within 0.x.** Rejected — violates the epic's whole-stack-on-1.x goal and the repo's no-backwards-compat rule; the card's entire point is to stop straddling a different TypeBox major than `sil-services`.
- **Exact-pin `typebox` (e.g. `1.2.2`) to mirror the old `0.34.14` pin style.** The current `package.json` pins exact. I recommend `^1.2.2` (caret): 1.x is post-1.0 semver-stable and the JSON-Schema output is the contract we pin *via tests*, so a caret lets patch/minor security fixes land without a card. Either is defensible — dev may keep the exact-pin house style. Flagging the choice, not blocking on it.

### Affected files / surfaces

<!-- solutions-architect owns the authoritative sweep. product-owner note: the
intent's "likely change site" list misses one import that the typecheck will
trip on — flagging it so it isn't lost: -->

- `package.json` — `@sinclair/typebox@0.34.14` dependency → `typebox@1.x`.
- `src/tools/examples.ts:27` — `import { Type } from "@sinclair/typebox"` (value).
- `src/tools/identity.ts:32` — `import { Type } from "@sinclair/typebox"` (value).
- **`src/types/openclaw.d.ts:21` — `import type { TObject } from "@sinclair/typebox"` (type-level).** Not in the intent's guess; this is the type of `ToolDefinition.parameters`, so a missed swap here leaves `tsc` resolving `TObject` from the removed package and breaks typecheck even if the value imports are migrated. (sweep confirmed via `grep -rn "typebox" src/`: these three files are the *only* `@sinclair/typebox` references in `src/`; test files only mention TypeBox in comments.)
- `pnpm-lock.yaml` — must end with `typebox@1.x` and no `@sinclair/typebox` node (currently pins `@sinclair/typebox@0.34.14`).
- solutions-architect: confirm whether 1.x being **ESM-only** interacts with this repo's ESM/`tsc` setup, and whether `Type`/`TObject` are exported from the standalone `typebox` package root under the same names.

**solutions-architect — sweep confirmation + the two open confirmations answered:**
- Sweep agrees: those **4 occurrences across 3 files** are the *entire* `src/` footprint (grepped `Type.*`, `typebox`, `@sinclair`, `TObject`, `TSchema`, `Static<`, `Kind`, `TProperties`). `src/index.ts` does **not** touch TypeBox. The `Type.Object(...)` / `Type.String(...)` *call sites* (examples.ts L43/L57-60, identity.ts L75/L161) need **no change** — only the import specifiers do.
- **`Type` and `TObject` ARE exported from the `typebox` root under the same names** — verified by unpacking `typebox@1.2.2`: root `.` → `./build/index.mjs`, types `./build/index.d.mts`; `export * as Type` + `export * from './type/types/...'` give `Type`/`TObject`/`Static`/`TSchema` at the root. Ran `import { Type } from "typebox"` and `import type { TObject } from "typebox"` at runtime and under `tsc --strict` — both resolve. So this is a pure specifier swap, no construction rewrite (confirms the product-owner's ASSUMPTION 2).
- **ESM-only does NOT interact problematically** — `typebox@1.x` ships `"type":"module"` with `exports` keyed only on `import` (no root CJS `require` target). The repo is already fully ESM (`"type":"module"`, `module: ESNext`, `moduleResolution: bundler`). I typechecked the plugin's exact import lines under the repo's own `bundler` + `ES2022` + `strict` config — clean, exit 0. **No tsconfig change needed** (`tsconfig.json` / `tsconfig.build.json` untouched).
- **`pnpm-lock.yaml` carries 3 `@sinclair/typebox@0.34.14` references** (importer spec ~L11, resolution block ~L140, dependency entry ~L532) and `@sinclair/typebox` is a **direct dep only** (not transitive). `pnpm install` after the `package.json` edit regenerates the lock; all 3 must vanish. Note the lockfile currently has `os: [win32]` and `node_modules` is not installed — the dev installs fresh; the regenerated lockfile is part of the diff.

### Risks / failure modes — solutions-architect

- **JSON-Schema KEY-ORDER differs between 0.34 and 1.x — correcting the product-owner's "byte-identical" expectation.** I ran the plugin's two exact schemas in **both** real packages. The emitted key *sets* are identical; the *order* is not:
  - `Type.Object({})` → `{"type":"object","properties":{}}` in **both** — genuinely byte-identical. (Note: 1.x emits `properties:{}` for the empty object, same as 0.34 — so the product-owner's no-arg criterion "no `properties`" should read **`properties: {}` present-and-empty**, which deep-equals fine.)
  - `Type.Object({ message: Type.String({description}) })`:
    - **0.34.14:** `{"type":"object","properties":{"message":{"description":"...","type":"string"}},"required":["message"]}`
    - **1.2.2:** `{"type":"object","required":["message"],"properties":{"message":{"type":"string","description":"..."}}}`
    - Same keys (`type`, `required`, `properties`, nested `type`/`description`); 1.x orders `required` before `properties`, and nested `type` before `description`. **The agent-facing contract is unaffected** — JSON-Schema objects are unordered key sets; the host serializes and validates by key, not byte order. The product-owner's criteria use **deep-equals**, which is correct and safe. **But the consequence is a hard constraint for qa-developer: assert schema equivalence with `toEqual` (deep, unordered) or a serialized snapshot, NEVER `expect(JSON.stringify(a)).toBe(JSON.stringify(b))` against a 0.34 byte-literal — that would flip RED on a pure dependency bump even though the contract is intact.**
- **`~kind` / `~optional` / `~readonly` are non-enumerable in 1.x** (the product-owner's headline observation — confirmed). `JSON.stringify` of the live `parameters` in 1.2.2 produced exactly the schemas above with **no `~kind` leakage** — so the Pillar-A `JSON.stringify` "no `~kind` key" criterion passes as written, and it's safe to use `JSON.stringify` *for that specific negative assertion* (it's checking for absence of a key, not byte-equality of order).
- **Stale lockfile leaving `@sinclair/typebox` behind.** If `package.json` is edited but the lock isn't regenerated (or `--frozen-lockfile` runs against the old lock), `@sinclair/typebox` lingers in the tree, violating the no-trace constraint. Pinned by the grep criterion below.
- **`skipLibCheck: true` masks errors inside `typebox`'s own `.d.mts`.** Not a real risk (the plugin's *own* usage typechecks), but the build won't second-guess the library's internal types — noting it so a future TypeBox-internal regression isn't assumed impossible.
- **`Static<>` is unused in this repo** — confirmed zero `Static<` usages in `src/`, so 1.x's (more involved) `Static` codec-direction changes do not touch this plugin. Only `Type.Object`, `Type.String`, and the `TObject` type matter, and all three are contract-stable.

### Acceptance criteria

<!-- product-owner framed the behaviour (Given/When/Then). solutions-architect
has FINALIZED the tier tags (the [tier?: …] proposals are resolved to [tier]).
`tiers:` frontmatter union = {unit, integration}. No e2e: this repo has no
host-load tier (CLAUDE.md), and the contract is fully verifiable at unit +
integration (mock host + on-disk manifest). Grouped by the two acceptance pillars. -->

**Pillar A — the agent-facing tool contract is observably unchanged**

- `[integration] Given` the plugin built on `typebox@1.x`, `when` `register()` runs against the in-memory mock host and the registered tool set is read, `then` it is exactly `{ sil_echo, sil_ping, sil_register, sil_whoami }` — no additions, removals, or renames (the contract's tool-set invariant). *(The drift guard `manifest-contract.integration.test.ts` already pins set-equality of registered names vs `contracts.tools`; it must stay green unchanged.)*
- `[unit] Given` each registered tool on `1.x`, `when` its `name`, `label`, and `description` are read, `then` each equals its pre-migration value verbatim (these are plain string literals, independent of TypeBox, and must not be incidentally edited during the swap).
- `[unit] Given` the three no-argument tools (`sil_ping`, `sil_register`, `sil_whoami`) on `1.x`, `when` each tool's `parameters` JSON-schema is inspected, `then` it deep-equals (`toEqual`, unordered) the empty-object schema agents see today — `{ type: "object", properties: {} }`, no `required` (verified: `Type.Object({})` emits `{type:"object",properties:{}}` byte-identically on `1.x` and `0.34`). *(SA correction: the empty schema carries `properties: {}` present-and-empty on both versions, not absent — deep-equal against `{type:"object",properties:{}}`.)*
- `[unit] Given` `sil_echo` on `1.x` (the only tool with a non-empty schema — the boundary case), `when` its `parameters` JSON-schema is inspected, `then` it deep-equals (`toEqual`, unordered) today's: `type: "object"`, a single `properties.message` of `{ type: "string", description: "Text echoed back verbatim in the stub payload." }`, and `required: ["message"]` — nested `description` and the `required` array preserved exactly. *(This is the one schema with structure to lose. SA note: 1.x reorders keys vs 0.34 [`required` before `properties`] — assert with `toEqual`, NOT a `JSON.stringify` byte comparison; see Risks.)*
- `[unit] Given` any tool's `parameters` object on `1.x`, `when` it is serialized with `JSON.stringify` (what the host effectively does before exposing it to an agent), `then` no `~kind` / `~optional` / `~readonly` key appears in the output — confirming 1.x's introspection metadata stays non-enumerable and never leaks into the agent-visible schema. *(SA: verified — `JSON.stringify` of the live 1.2.2 schemas leaks no `~kind`; this is the one place `JSON.stringify` is the right tool, since it asserts key ABSENCE, not byte-order equality.)*

**Pillar B — the build + test suite is green on 1.x with no `@sinclair/typebox` left**

- `[integration] Given` the migrated repo, `when` `pnpm install && pnpm build && pnpm typecheck && pnpm test` runs, `then` all succeed on `typebox@1.x` (including the `TObject`-typed `ToolDefinition.parameters` resolving from the new package — see affected-files note on `openclaw.d.ts`). *(SA added `pnpm install` first: node_modules is currently absent and the lockfile must be regenerated.)*
- `[integration] Given` the migrated repo, `when` `grep -r "@sinclair/typebox"` is run over `package.json`, `pnpm-lock.yaml`, and `src/`, `then` it returns zero matches (no straddling two TypeBox majors — the explicit reason for the migration), and `typebox@1.x` is the resolved version. *(SA: the lockfile grep is the load-bearing one — 3 references live there today and are the easiest to leave behind.)*
- `[integration] Given` the existing `examples.test.ts` assertion that `parameters.type === "object"` and the manifest drift guard, `when` the suite runs post-migration, `then` both pass without being weakened or skipped — the equivalence is demonstrated against the real registration code, not a re-stated schema literal. *(qa-developer: the RED tests for the Pillar-A schema-equivalence criteria above should deep-equal [`toEqual`] the `parameters` of each tool against the known-good 0.34 JSON-schema literals captured in Risks — NOT only re-check `type === "object"`, which would pass even if `required`/`description` drifted.)*

### Open questions (if any)

<!-- escalate to founder if blocking -->

None blocking. This is a no-contract-change dependency-major migration; the
behavioural bar is fully specified above. Recorded assumptions instead of
questions, per the autonomous-discovery rule:

- **ASSUMPTION (product-owner):** "the same shape agents see today" is satisfied by the *emitted JSON-schema* of `parameters` being equivalent, not by retaining the `@sinclair/typebox` package — because the host only ever consumes that enumerable schema (`src/types/openclaw.d.ts:51` types it `TObject`; nothing in `src/` reads TypeBox symbols). If the founder intended literal package-identity preservation, the whole migration is contradictory, so this reading is the only coherent one.
- **ASSUMPTION (product-owner):** `Type.Object`/`TObject` are exported from the standalone `typebox@1.x` root under the **same names** as `@sinclair/typebox@0.34`, so the migration is an import-specifier swap with no schema-construction rewrite. solutions-architect to confirm against the 1.x package surface; if a name moved, it is a mechanical fix, not a contract change, and does not alter any criterion above.
- **ASSUMPTION (product-owner):** the deferred host-load (e2e) smoke noted in `CLAUDE.md` is **not** required for this card — the contract is verifiable at the unit/integration tiers (mock host + on-disk manifest), and adding an e2e gate here would be scope the migration doesn't need. solutions-architect owns the final tier set; flagging that none of the criteria above inherently demand e2e.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

**Start point (expert-developer)** — a 5-line mechanical swap plus a lockfile regen. Edit in this order:
1. `package.json:44-46` — swap the dep: remove `"@sinclair/typebox": "0.34.14"`, add `"typebox": "^1.2.2"` (latest is 1.2.2; caret recommended, exact-pin acceptable as house style).
2. `pnpm install` — regenerates `pnpm-lock.yaml`. Confirm all 3 `@sinclair/typebox` references are gone and `typebox@1.x` is present.
3. `src/tools/examples.ts:27` and `src/tools/identity.ts:32` — change the specifier to `"typebox"` (the named `{ Type }` import is unchanged — it resolves from the `typebox` root).
4. `src/types/openclaw.d.ts:21` — change the `import type { TObject }` specifier to `"typebox"`.
5. `pnpm typecheck && pnpm build && pnpm test`.

Do **NOT** touch: the `Type.Object(...)` / `Type.String(...)` call sites, `src/index.ts`, `openclaw.plugin.json`, `tsconfig*.json`, or `vitest.config.ts` — none need to change (all verified).

**Constraints (non-negotiable):**
- Agent-facing tool contract unchanged: every tool's `parameters` JSON-schema keeps the same key *set* (key *order* differs in 1.x — that's fine, it's not part of the contract; see Risks). No new `any` at the import boundary; `TObject` stays the typed contract on `ToolDefinition.parameters`.
- **No `@sinclair/typebox` anywhere** — `src/`, `package.json`, AND `pnpm-lock.yaml`. The lockfile is the one that's easy to forget (3 references today).
- `manifest-contract.integration.test.ts` stays green (it's name-only, insensitive to schema serialization — but it's the regression signal that no name drifted).

**Test strategy (qa-developer):**
- The existing unit/integration tests pin the structural shape and the drift guard and stay green **untouched** — confirm that first; it's the primary regression signal.
- Add the explicit **contract-equivalence** RED test (Pillar-A schema criteria): build each tool's `parameters` and `toEqual` it against the known-good 0.34 JSON-schema literals captured in Risks — empty tools → `{type:"object",properties:{}}`; `sil_echo` → `{type:"object",properties:{message:{type:"string",description:"Text echoed back verbatim in the stub payload."}},required:["message"]}`. **Use deep/unordered `toEqual` or a serialized snapshot — NEVER `expect(JSON.stringify(...)).toBe(<0.34 byte-literal>)`; 1.x reorders keys and that comparison would falsely fail.**
- Add the lockfile/tree grep assertion (Pillar-B) so a stale-lockfile straddle fails CI: assert `@sinclair/typebox` appears in neither `package.json` nor `pnpm-lock.yaml`.
- No e2e tier in this repo — integration (mock api + real registration code + on-disk manifest) is the ceiling.

## In Dev — expert-developer, qa-developer

### Implementation (expert-developer) — production migration COMPLETE

Executed the 5-step mechanical swap from Discovery, verbatim:

1. `package.json` — removed `"@sinclair/typebox": "0.34.14"`, added `"typebox": "^1.2.2"` (caret, per SA recommendation: 1.x is post-1.0 semver-stable and the JSON-Schema output is pinned by tests, so patch/minor security fixes land without a card).
2. `pnpm install` — regenerated `pnpm-lock.yaml`. All 3 `@sinclair/typebox@0.34.14` lock references (importer spec, resolution block, dependency entry) are gone; `typebox@1.2.2` resolves at importer L11 + resolution L358 + dep L728.
3. `src/tools/examples.ts:27` + `src/tools/identity.ts:32` — specifier `"@sinclair/typebox"` → `"typebox"`; the `{ Type }` named import is unchanged (resolves from the `typebox` root).
4. `src/types/openclaw.d.ts:21` — `import type { TObject }` specifier → `"typebox"`.

Did NOT touch: the `Type.Object(...)`/`Type.String(...)` call sites, `src/index.ts`, `openclaw.plugin.json`, `tsconfig*.json`, `vitest.config.ts` — none needed changes (Discovery verified; confirmed in practice — typecheck of the production sources is clean with no tsconfig edit).

**Live verification of the agent-facing contract (against the actually-installed `typebox@1.2.2`, via the real built registration code through a capture-only mock host):**

```
sil_ping     {"type":"object","properties":{}}
sil_register {"type":"object","properties":{}}
sil_whoami   {"type":"object","properties":{}}
sil_echo     {"type":"object","required":["message"],"properties":{"message":{"type":"string","description":"Text echoed back verbatim in the stub payload."}}}
```

- Empty-object tools: byte-identical to 0.34 (`properties:{}` present-and-empty, no `required`).
- `sil_echo`: same key *set* as 0.34, with 1.x's predicted reordering (`required` before `properties`; nested `type` before `description`) — confirms SA Risk #1. Deep-equals the known-good 0.34 literal; the agent-facing JSON-Schema contract is invariant.
- No `~kind`/`~optional`/`~readonly` leakage in any serialized schema — confirms 1.x's introspection metadata stays non-enumerable.

**No-trace constraint satisfied:** `grep -rn "@sinclair/typebox" package.json pnpm-lock.yaml src/` → **zero** matches.

### Tests (qa-developer's RED tests landed in the shared worktree mid-flight)

Both qa-developer files arrived while I was migrating and both go GREEN against the migration **at runtime** (250/250 tests pass, up from 230):
- `src/__tests__/tools/tool-schema-contract.unit.test.ts` — Pillar-A contract equivalence (deep `toEqual` vs 0.34 literals, tool-set invariant, verbatim string fields, `sil_echo` boundary, `~kind`/`~optional`/`~readonly` non-leak).
- `src/__tests__/typebox-no-trace.integration.test.ts` — Pillar-B no-trace (package.json + pnpm-lock.yaml, all dependency buckets, raw-text + parsed, 1.x-major range).

The pre-existing `examples.test.ts` (`parameters.type === "object"`) and `manifest-contract.integration.test.ts` (name-only drift guard) stayed green **untouched** — the primary regression signal.

### ⛔ HOLD — green gate NOT met; review transition deferred (BLOCKED on qa-developer's lane)

`pnpm typecheck` is RED. Root cause is a **migration side-effect in qa-developer's test file** — NOT a contract change and NOT in any production source:

```
src/__tests__/tools/tool-schema-contract.unit.test.ts(158,22): error TS2352
src/__tests__/tools/tool-schema-contract.unit.test.ts(171,20): error TS2352
src/__tests__/tools/tool-schema-contract.unit.test.ts(178,20): error TS2352
  Conversion of type 'TObject<TProperties>' to type 'Record<string, unknown>'
  may be a mistake because neither type sufficiently overlaps with the other.
```

In `typebox@1.x`, `TObject<Properties>` is a precise interface — `{ '~kind':'Object'; type:'object'; properties:Properties; required:TRequiredArray<Properties> }` — with **no string index signature**. The direct casts `getTool(api,name).parameters as Record<string, unknown>` (L158, L171) and `as { properties:…; required:… }` (L178) compiled under 0.34's looser `TObject` but `tsc` rejects them under 1.x. (`pnpm build` PASSES because `tsconfig.build.json` excludes `src/__tests__`; `pnpm test` PASSES because vitest strips types without checking them — so only `pnpm typecheck`, a Pillar-B criterion, catches it.)

Boundary respected: the failing file is qa-developer's lane — I did **not** edit it. The migration of production code is complete and correct; the combined deliverable cannot pass the green gate until the test casts are made 1.x-correct.

### → Handback to qa-developer (NOT to Review — green gate unmet)

**One mechanical fix, three sites, zero assertion changes** — cast through `unknown`, exactly as TS2352 instructs ("convert the expression to 'unknown' first"):

- `tool-schema-contract.unit.test.ts:158` — `as Record<string, unknown>` → `as unknown as Record<string, unknown>`
- `tool-schema-contract.unit.test.ts:171` — `as Record<string, unknown>` → `as unknown as Record<string, unknown>`
- `tool-schema-contract.unit.test.ts:178` — `as { properties: …; required: … }` → `as unknown as { properties: …; required: … }`

This is type-level only — the runtime `toEqual` / `toBe` / `toHaveProperty` assertions are unchanged, so the test is NOT weakened (the equivalence is still pinned exactly). It is the correct 1.x access pattern, not a workaround.

After qa-developer applies it, the gate is `pnpm typecheck && pnpm build && pnpm test` all green (expected: typecheck exit 0, build emits `dist/`, 250/250 tests). At that point expert-developer (me) owns the in-dev → review transition: commit the migration + tests on `card/migrate-openclaw-tool-schemas-to-typebox-1-x`, push (first tracked commit — creates the origin `card/...` ref in this gitignored-mode repo), open the PR, and flip the card to `status: review`, `agents: []`.

(Recorded as a reusable epic gotcha in agent-memory: stricter `TObject` → TS2352-via-`unknown`; this will recur in the sil-services + sil-stage peer cards.)

### qa-developer — RED tests delivered + typecheck handback RESOLVED

**Handback resolved.** I hit the same TS2352 independently (`pnpm typecheck` against the migrated tree) and had already applied the exact fix the expert-developer prescribed — all three sites cast through `unknown` (`as unknown as …`), assertions unchanged. The fix is **in my committed test file** (`6683832`). Green gate is now met: `pnpm typecheck` exit 0, `pnpm test` 250/250. The dev's in-dev → review transition is unblocked.

**Two test files committed** (`6683832` on `card/…`, pushed — created the `origin/card/…` ref):

1. `src/__tests__/tools/tool-schema-contract.unit.test.ts` (unit, 13 tests) — Pillar A. Built each tool's `parameters` via the **real registration code** (`registerExampleTools` + `registerIdentityTools` through the capture-only mock host, mirroring `register()`), then:
   - tool-set is exactly `{sil_echo, sil_ping, sil_register, sil_whoami}` (sorted `toEqual`);
   - `name`/`label`/`description` are byte-identical to the pre-migration literals (TypeBox-independent — guards against incidental edits during the swap);
   - the three no-arg tools' `parameters` deep-equal `{type:"object",properties:{}}` AND carry no `required` (`not.toHaveProperty`);
   - `sil_echo` (the boundary — only structured schema) deep-equals the full known-good literal `{type:"object",properties:{message:{type:"string",description:"Text echoed back verbatim in the stub payload."}},required:["message"]}`, plus drift-resistant sub-assertions pinning the nested `description` text and the exact `required:["message"]`;
   - `JSON.stringify(parameters)` of all four leaks **no** `~kind`/`~optional`/`~readonly` (the one correct use of `JSON.stringify` — asserting key ABSENCE, not byte-order).
   - **All schema equivalence is `toEqual` (deep, order-insensitive) — never a `JSON.stringify` byte comparison vs a 0.34 literal**, exactly per SA Risk #1 (1.x reorders `required` before `properties` and nested `type` before `description`).

2. `src/__tests__/typebox-no-trace.integration.test.ts` (integration, 7 tests) — Pillar B. Reads the on-disk `package.json` + `pnpm-lock.yaml`:
   - `@sinclair/typebox` absent from every dependency bucket (deps/dev/optional/peer flattened) AND from the raw `package.json` text (catches a resolutions/overrides straddle);
   - `typebox` is a declared dep resolving to a **1.x** range (regex pins major `1`, rejects any `0.` straddle);
   - `pnpm-lock.yaml` contains **zero** `@sinclair/typebox` references (the load-bearing grep — 3 lived there pre-migration) and resolves a `typebox@1.` token. The positive lockfile probe deliberately matches `typebox@1\.` (a versioned token the old `@sinclair/typebox@0.34.14` cannot produce) — a bare `toContain("typebox")` would be a false-green because the OLD scoped name contains the substring `typebox`.

**Existing suite untouched + green** — the primary regression signal. `examples.test.ts` (`parameters.type==="object"`) and `manifest-contract.integration.test.ts` (name-only drift guard) pass as-is. My contract test is the structural complement: `examples.test.ts` would stay green even if `required`/`description` silently drifted; my `toEqual` would not.

**RED-bite certified (TDD ordering was inverted — dev worked ahead).** The migration was already on the shared working tree when my tests ran, so both files go GREEN at runtime — which proves nothing on its own. I certified the assertions actually *bite* with a **transcribed-buggy throwaway fixture** (`proof-red-typebox-migration.test.ts`, imported nothing from the production tree, then **deleted** — never shipped). 11/11 proof assertions passed:
- the no-trace assertions go RED against a transcribed pre-migration `package.json`+`pnpm-lock.yaml` (the genuine Red signal), and the `typebox@1.` presence regex does **not** false-match the old `@sinclair/typebox@0.34.14` token;
- the contract `toEqual` rejects every plausible drift (lost nested `description`, lost `required`, changed description text, spurious `required:[]` on an empty schema, an enumerable `~kind` leak) **while accepting a pure 1.x key-reorder** — proving `toEqual` is correctly order-insensitive, not over-strict (the exact trap SA Risk #1 warned against).

No `### → Handoff back to In Dev` failure note needed — the migration satisfies every test. The deliverable is green on all three gates.

### → Handoff to Review (next agent: code-quality-guardian)

Green gate met on all three checks (`pnpm typecheck` exit 0, `pnpm build` emits `dist/index.js`, `pnpm test` 250/250 across 23 files); no `@sinclair/typebox` in `package.json`, `pnpm-lock.yaml`, or production `src/`. The handback above (TS2352 on 1.x's stricter `TObject`) is resolved — qa-developer's tests carry the `as unknown as …` fix.

The diff is a pure dependency-major migration: a 5-file production swap (`package.json` dep + regenerated `pnpm-lock.yaml` + 3 import-specifier edits) plus qa-developer's two new tests (committed in `6683832`). No production logic changed; no `Type.Object(...)`/`Type.String(...)` call site touched; `src/index.ts`, `openclaw.plugin.json`, `tsconfig*`, `vitest.config.ts` untouched.

Watch list:
- **Regenerated `pnpm-lock.yaml`** — 3 `@sinclair/typebox@0.34.14` nodes removed, `typebox@1.2.2` added (importer L11, resolution L358, dep L728). The file most likely to hide a straddle; `typebox-no-trace.integration.test.ts` pins it to zero (raw-text + parsed buckets).
- **`typebox@1.x` is ESM-only** (`"type":"module"`, `exports` keyed only on `import`). Confirmed compatible — repo is already fully ESM (`module: ESNext`, `moduleResolution: bundler`); no tsconfig change needed.
- **1.x reorders emitted JSON-schema keys** (`required` before `properties`; nested `type` before `description`). Key *set* is invariant → agent-facing contract unchanged. Asserted with order-insensitive `toEqual`, NOT a `JSON.stringify` byte-compare. Deliberate and correct, not a smell.
- **`as unknown as …` double-casts in `tool-schema-contract.unit.test.ts`** (L158/171/178) — the 1.x-correct way to read a `TObject` as a plain record in a test; required by 1.x's stricter type (no string index signature), not a shortcut. Runtime assertions unweakened.
- **No new `any`** at the import boundary; `TObject` remains the typed contract on `ToolDefinition.parameters` (`src/types/openclaw.d.ts:50`).
- **PR carries implementation + tests only** (gitignored-mode repo — the card body is never committed). RED tests (`6683832`) then GREEN implementation commit, both on `card/migrate-openclaw-tool-schemas-to-typebox-1-x`.

## Review round 1 — code-quality-guardian

**Verdict: PASS.**

Pure dependency-major migration, executed exactly as Discovery scoped it. The PR #6 diff is a 4-line production swap (`package.json` dep + 3 import-specifier edits) plus a surgically-regenerated `pnpm-lock.yaml` and 2 new contract tests. No production logic and no `Type.Object(...)` / `Type.String(...)` call site changed — verified by diffing the call-site lines (empty). The agent-facing MCP tool contract is provably invariant and pinned observationally; the no-trace constraint holds across all three targets; all three gates are green when I run them myself.

### Independent verification (re-run in the worktree, not taken on trust)

- `pnpm typecheck` → **exit 0** (strict, `tsc --noEmit`).
- `pnpm build` → **exit 0**, emits `dist/index.js` (the manifest `main`).
- `pnpm test` → **250 passed / 250, 23 files**. Pre-existing `examples.test.ts` and the `manifest-contract.integration.test.ts` drift guard are **untouched in the diff** (empty `git diff` against both) and pass as part of the 250 — the primary regression signal is intact and unweakened.
- No-trace: `grep -rn "@sinclair/typebox" package.json pnpm-lock.yaml src/` → the **only** hits are the integration test's own assertion strings / doc comments (a test that legitimately names the old package to assert its absence). Zero matches in `package.json`, `pnpm-lock.yaml`, and production `src/`. `typebox@1.2.2` resolves in the lock (resolution + snapshot blocks) and in `node_modules` (`"name":"typebox","version":"1.2.2","type":"module"`).
- Lockfile diff is clean and minimal: all 3 `@sinclair/typebox@0.34.14` nodes (importer spec, resolution, snapshot) removed; `typebox@1.2.2` added in the same 3 places. No collateral transitive churn.

### Dimension findings (no P1/P2/P3 issues)

- **Security (OWASP):** N/A — no boundaries, auth, secrets, or input handling touched. Same-author successor package; integrity hash pinned in the lock.
- **Type safety:** Strict mode intact. No `any`, no `@ts-ignore`/`@ts-expect-error`. `TObject` remains the typed contract on `ToolDefinition.parameters` (`src/types/openclaw.d.ts:21`), now sourced from `typebox`. The `as unknown as …` double-casts at `tool-schema-contract.unit.test.ts:158/174/184` are the 1.x-correct way to read a precise `TObject` interface (no string index signature → TS2352 on a direct cast) — **type-level, test-only, runtime assertions unchanged**; deliberate per the In-Dev handback and confirmed compiling by my typecheck run. Not a smell.
- **Error handling / logging / performance:** N/A — no error paths, logging, hot paths, or queries touched. ESM-only `typebox@1.x` is leaner, no regression.
- **Complexity / bloat / legacy:** Production diff is 4 lines. Tests are flat and readable, no dead code. The old major is **deleted outright** (no shim, no side-by-side) — honors the no-backwards-compat rule.
- **Anti-patterns / architecture:** None. No coupling or dependency-direction change; the drift guard and existing suite stay green untouched.
- **Test quality:** Both new files assert behavior, not implementation. Schema equivalence uses deep, order-insensitive `toEqual` against the known-good 0.34 literals — never a `JSON.stringify` byte-compare (correctly handles 1.x's key-reorder: `required` before `properties`, nested `type` before `description`). `JSON.stringify` is used only for the `~kind`/`~optional`/`~readonly` **absence** assertion, which is the one place it is the right tool. The no-trace test correctly avoids a `toContain("typebox")` false-green (the old scoped name contains that substring) and pins new-package presence via the package.json key + a `typebox@1\.` lock token. RED-bite was certified via a transcribed-buggy throwaway fixture (deleted, never shipped).
- **Knowledge capture:** The non-obvious WHY (1.x's stricter `TObject` → cast-through-`unknown`; key-reorder → order-insensitive equality) is captured as inline comments in both test files **and** as a cross-sibling `pattern` signal in this card body for the distillation stage to lift. Nothing non-obvious shipped uncommented.
- **Tier coverage:** `tiers: [unit, integration]` matches the shipped files exactly (`tool-schema-contract.unit.test.ts` + `typebox-no-trace.integration.test.ts`); every acceptance criterion carries a tier tag. No e2e gate exists in this repo (per CLAUDE.md), correctly not demanded.

Advancing to `distilling`. The distiller reads the merge-target diff directly; no handoff block.

## Distillation — solutions-architect

<!-- Runs in the worktree on the card branch after Review PASS. Pushes to the same PR. Per the `distillation` skill: SEARCH docs/ INDEX files first; edit existing docs rather than creating duplicates. Captures land at smallest viable scope: inline WHY comments, docs/decisions/, docs/knowledge/, docs/product/, or CLAUDE.md. Then flips status to pr-ready. -->

Searched `docs/{decisions,knowledge,product}/INDEX.md` for `typebox|schema|dependency|contract|typecheck|tsconfig|json-schema|TObject` — no existing doc covers TypeBox, dependency choices, JSON-schema emission, or the build/typecheck/test gate topology (the existing docs are all about the sil HTTP client + identity contract). One new doc; no edits to existing docs.

**Captured (one doc, smallest viable scope):**
- `knowledge/typecheck-is-the-only-test-type-gate.md` (new) — `pnpm typecheck` is the *only* one of the three scripts that type-checks `src/__tests__` (`build` excludes tests via `tsconfig.build.json#exclude`; vitest strips types without checking). So a test-only type error is a false-green on `build && test`, and any gate touching test files must run `typecheck`. Verified against `package.json` scripts + both tsconfigs + `vitest.config.ts`. This card's TS2352 hold is the motivating example; the doc generalizes to the gate topology (recurs for any test-only type error). INDEX.md row added at top.

**Deliberately NOT captured (already at smallest viable scope, or wrong altitude):**
- The TS2352-via-`as unknown as …` fix for 1.x's stricter `TObject` (no string index signature) — already a thorough inline WHY comment at all three cast sites (`tool-schema-contract.unit.test.ts:155-157, 169-173`). A doc would restate the inline comment for the same (this-repo) audience. Its *cross-sibling recurrence* (sil-services, sil-stage) is an orchestrator-altitude concern, already logged as a `pattern` signal on this card + in the architect's agent-memory — it cannot be reached from this repo's `docs/`.
- 1.x reorders emitted JSON-schema keys → assert with order-insensitive `toEqual`, never a `JSON.stringify` byte-compare — already captured inline as the load-bearing `CONTRACT NOTE` at `tool-schema-contract.unit.test.ts:18-25`, exactly where the assertions live.
- The agent-facing contract is the emitted *enumerable* JSON-schema, not TypeBox library identity (`~kind`/`~optional`/`~readonly` non-enumerable) — already captured inline at `tool-schema-contract.unit.test.ts:196-202`, and it is a card-specific framing rather than a standing repo invariant.

- INDEX.md updated: knowledge

## PR Ready

<!-- PR url; founder notification fires here -->

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
