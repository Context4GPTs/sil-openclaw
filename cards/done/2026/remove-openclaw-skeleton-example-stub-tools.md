---
type: card
title: Remove OpenClaw skeleton example stub tools
slug: remove-openclaw-skeleton-example-stub-tools
work_type: refactor        # feature | bug | refactor | chore | docs
tiers: [unit, integration]  # set by solutions-architect during Discovery; grep checks are acceptance gates, not a test tier
status: done              # backlog | discovery | stand-by | in-dev | review | distilling | pr-ready | done | abandoned
agents: []                # current active agent set; updated by each handoff (Review PASS → distillation owns the merge-diff knowledge capture)
priority: 1               # 1 = drop-everything, 2 = normal, 3 = nice-to-have
created: 2026-06-09       # placeholder — /board-add overwrites with today's date; never leave as a placeholder before commit (INDEX.base formulas will break)
updated: 2026-06-09       # same — must be a real ISO date before commit
base_branch: main         # the branch this card's worktree was cut from and the PR will target
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-remove-openclaw-skeleton-example-stub-tools
branch: card/remove-openclaw-skeleton-example-stub-tools
pr: https://github.com/Context4GPTs/sil-openclaw/pull/10  # set by expert-developer at in-dev → review
merged_commit: 6ca8772f1aed352b1a56b4751c0f0b9c0fb79fb5       # set by /board-tick on PR-merge detection
epic_id: catalog-plugin-tools
origin: goal:agentic-search-slice
---

## Intent (founder)

The plugin skeleton's example stub tools — `sil_ping` and `sil_echo` in `src/tools/examples.ts`, registered via `registerExampleTools` — were scaffolding to copy when adding real tools. The real tools now exist (`sil_register`, `sil_whoami`, `sil_search` merged, `sil_product_get` next), so the examples are dead weight that actively breaks the stub-free rule: they are registered in the manifest **and tested as stubs** (`examples.test.ts` asserts a "well-formed stub ToolResult" — exactly the test theater the rule forbids). Remove them entirely — delete `examples.ts` and its stub test, drop `sil_ping`/`sil_echo` from `openclaw.plugin.json#contracts.tools`, unwire `registerExampleTools` from `register()`, and repoint the now-stale "skeleton / canonical pattern" references (manifest `description`, `CLAUDE.md`) at a real tool group. No backwards-compat — delete, don't deprecate.

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
- 2026-06-09 orchestrator (goal-tick) — origin: goal:agentic-search-slice. Founder-directed (2026-06-09): "in sil-openclaw there are example tools and stubs — these should go since we started building the real thing." Enforces the goal's sil-openclaw per-surface acceptance ("the manifest carries only real tools; no stub is registered or tested"). The loop's own card.
- 2026-06-09 orchestrator (goal-tick) — serialize: shares the `src/index.ts` + `openclaw.plugin.json#contracts.tools` + `manifest-contract.integration.test.ts` surface with [[sil-product-get-plugin-tool]] (stand-by). Run this FIRST — the stub-free rule says "touching an area de-stubs it first," and product-get is stand-by with zero dev work to lose, so it waits for this to merge rather than rebasing. Priority 1 to win the board's hot-card order on this surface. Do not run the two concurrently.

---

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Epic notes (provisional — sibling Discovery owns the verdict)

### Likely change sites (shallow read-only guess — Discovery confirms)

- `src/tools/examples.ts` — **DELETE** (`sil_ping`, `sil_echo`, `registerExampleTools`; and the `stubResult` helper if nothing else uses it — grep to verify, real tools return `jsonResult`).
- `src/index.ts` — remove the `registerExampleTools` import + its call in `register()`; fix the header doc comment that points at `examples.ts` as "the canonical pattern" (repoint to a real group, e.g. `catalog.ts` / `identity.ts`).
- `openclaw.plugin.json` — remove `sil_ping`/`sil_echo` from `contracts.tools`; rewrite the plugin `description` (no longer "registers stub tools a developer copies").
- `src/__tests__/tools/examples.test.ts` — **DELETE** (asserts stub `ToolResult`s — the stub-free rule's "test theater").
- `src/__tests__/manifest-contract.integration.test.ts` — drop the `registerExampleTools` import + the "declares at least two tools (the skeleton ships a pattern, not one example)" assertion (its rationale is obsolete; ≥2 real tools remain). The drift-guard itself stays and must still PASS against the real tool set.
- `src/__tests__/index.test.ts` — remove the `examples.js` mock + the "wires the example tool group into register()" test.
- `CLAUDE.md` — "What this repo is" ("a skeleton… registers stub tools") + "How to add a tool" (examples as the canonical pattern) are now stale; repoint to a real tool group (distillation may own this).

### Acceptance

- `[unit]` Given the plugin builds, when `register()` runs, then no `sil_ping`/`sil_echo` (or any stub) tool is registered and `src/tools/examples.ts` no longer exists.
- `[integration]` Given `openclaw.plugin.json#contracts.tools`, when the manifest-contract drift guard runs, then it set-matches exactly the real registered tools (no example entries) and PASSES.
- `[unit]` Given the test suite, when it runs, then no test asserts a stubbed `ToolResult` (the `examples.test.ts` stub theater is gone) and the suite is green.
- `[grep]` Given the repo, when grepping for `registerExampleTools` / `stubResult` / `sil_ping` / `sil_echo`, then there are no live references (history aside).

---

## Discovery findings — solutions-architect, product-owner

### Product framing (product-owner, 2026-06-09)

**No agent-facing / end-user product surface impact — confirmed on the record.**
`sil_ping` and `sil_echo` were never real product tools an agent would call in a
commerce flow. They are pure skeleton scaffolding: both `execute` bodies return
`stubResult(...)` and do zero I/O (verified `src/tools/examples.ts:44,62`). The
real agent-facing surface — identity (`sil_register`, `sil_whoami`) and catalog
(`sil_search`) — returns `jsonResult` and is untouched by this card (verified
`src/tools/identity.ts`, `src/tools/catalog.ts`). Removing the examples changes
no user-visible behavior, no commerce flow, and no published product contract.
`docs/product/INDEX.md` has zero entries, so there is no product-spec doc to
repoint either. This is a pure internal/developer-facing dead-code + doc removal.

**The only "product" surface here is the contributor's mental model.** The
contributor-facing framing in `CLAUDE.md` and two code header comments currently
describes the plugin as a *skeleton that registers stub tools to copy* — which is
now false: real tools ship. That stale framing is the entire user-facing change,
and its "user" is the next contributor.

**Doc-framing recommendation (one line):** repoint the framing from "a skeleton
that registers stub tools to copy" to "a UCP commerce plugin whose real tool
groups — `identity.ts` (`sil_register`/`sil_whoami`) and `catalog.ts`
(`sil_search`) — are the canonical pattern to copy: register a tool in a group,
wire the group into `register()`, add its name to
`openclaw.plugin.json#contracts.tools`," with `src/tools/identity.ts` named as the
reference tool (it sets the `jsonResult` success shape + structured-error envelope
every real tool follows). Concrete sites: `CLAUDE.md` "What this repo is" + "How
to add a tool"; the `src/index.ts` header comment ("To add a tool, see
`src/tools/examples.ts`"); and the plugin `description` in both `src/index.ts` and
`openclaw.plugin.json` (drop "registers stub tools a developer copies").

**Behavior assertion (the spine of the acceptance criteria above):** after this
card, no stub tool is registered, no test asserts a stubbed `ToolResult`, the
manifest's `contracts.tools` reflects only real tools, and every contributor-facing
description points at a real tool group — never at `examples.ts`.

### Open questions

- **`stubResult` helper fate (for solutions-architect to settle in the technical
  map).** Grep confirms `stubResult` in `src/lib/tool-result.ts` has exactly ONE
  caller — `examples.ts` (the only other hits are its own definition + doc
  comments). Once `examples.ts` is deleted it becomes a dead export, and it is
  *the stub helper itself*. The `complete-work-is-stub-free` rule and the card's
  own change-site note ("the `stubResult` helper if nothing else uses it") both
  point at deleting it together with its only caller, so no stub scaffolding is
  left behind. Product-owner recommends removal; architect confirms there is no
  remaining/near-term real caller (`jsonResult` is what real tools use) and tags
  the resulting dead-export check's tier.

### Technical approach (solutions-architect, 2026-06-09)

**Decision on `stubResult` (open question settled): delete it.** Grep confirms the
only non-test caller of `stubResult` is `examples.ts:45,63`; every real tool
(`identity.ts:58`, `catalog.ts:56`) imports only `jsonResult`. With `examples.ts`
gone, `stubResult` is a dead export — and it is *the stub primitive itself*, so the
stub-free rule says it goes with its only caller. Remove the `export function
stubResult(...)` block + its doc paragraph from `src/lib/tool-result.ts`; **keep
`jsonResult`** (the canonical success shape all real tools return). Net: `tool-result.ts`
becomes a one-function file.

**The shallow guess was materially incomplete.** Verified against the real code on
this branch, the change surface is wider than the card's "Likely change sites" list.
Two surfaces it missed are load-bearing: `skill/SKILL.md` and `README.md` are written
*entirely* around `sil_ping`/`sil_echo`, and `skill-content.test.ts:113` greps the
skill body for **every registered tool name** — so the skill is not a doc tidy, it's a
test-coupled rewrite. Full confirmed map:

*Delete outright:*
- `src/tools/examples.ts` — the whole file (`registerExampleTools`, `sil_ping`, `sil_echo`).
- `src/__tests__/tools/examples.test.ts` — the whole file. It asserts a "well-formed stub `ToolResult`" (`examples.test.ts:107`) — the exact stub-test-theater `complete-work-is-stub-free` forbids. Deleting it *is* part of the card's purpose, not collateral.

*Edit (code):*
- `src/lib/tool-result.ts` — remove `stubResult` + its doc para (lines 28-43 and the `stubResult` half of the header comment, lines 7-16). Keep `jsonResult`.
- `src/index.ts` — remove `import { registerExampleTools } …` (line 32) and the `registerExampleTools(api);` call (line 46); rewrite the header comment (lines 4-8, 18) so it no longer calls the plugin a stub-tool skeleton and repoints "To add a tool, see `src/tools/examples.ts`" → a real group (`src/tools/identity.ts`); rewrite the `description:` literal (lines 38-40) off "registers stub tools a developer copies."
- `openclaw.plugin.json` — drop `"sil_echo"`, `"sil_ping"` from `contracts.tools` (lines 12-13); rewrite the top-level `description` (line 4) off "Skeleton … registers stub tools a developer copies."

*Edit (tests — keep them GREEN against the real-only set):*
- `src/__tests__/manifest-contract.integration.test.ts` — remove the `registerExampleTools` import (line 37) and its call in `codeRegisteredNames()` (line 79); **delete** the "declares at least two tools (the skeleton ships a pattern, not one example)" assertion (lines 95-97) — its rationale is obsolete (≥2 real tools remain, but the *reason* is gone); fix the header/`codeRegisteredNames` doc comments that name `registerExampleTools` (lines 21, 29-30). The drift guard itself and its failure-direction proofs **stay** and must PASS — this is the feature.
- `src/__tests__/index.test.ts` — remove the `vi.mock("../tools/examples.js", …)` (line 64), the `registerExampleTools` import (line 66) and the "wires the example tool group into register()" test (lines 104-108); remove `stubResult` from the `tool-result` import (line 73) and **delete the entire `describe("stubResult — uniform placeholder shape", …)` block** (lines 277-296); fix the header comment that names `stubResult` and the example group (lines 19, 27-28, 32). Repoint the wiring assertion at a real group, OR drop it (the full-real-path wiring is already proven by `plugin-load.integration.test.ts`) — qa-developer's call; the entry contract (sync, single load-marker, config precedence) is the part that must stay.
- `src/__tests__/tools/tool-schema-contract.unit.test.ts` — remove `sil_ping`/`sil_echo` from `TOOL_CONTRACT` (lines 70-83), the `EMPTY_OBJECT_SCHEMA`/`ECHO_PARAMETERS_SCHEMA` literals that only the examples used (`sil_register`/`sil_whoami` reuse `EMPTY_OBJECT_SCHEMA`, so keep that one; `ECHO_PARAMETERS_SCHEMA` dies with `sil_echo`), the `registerExampleTools` import+call (lines 32, 111), and shrink the "exactly the four" tool-set invariant (lines 117-125) to "exactly { sil_register, sil_whoami }". **Do NOT add catalog here** — `sil_search`'s schema is independently owned by `search.test.ts:128`; this file's concern is the identity surface's TypeBox-migration invariant. The boundary-case `sil_echo` deep-equal assertions (lines 167-193) die with it.
- `src/__tests__/skill-content.test.ts` — remove the `registerExampleTools` import (line 30) and its call in `registeredNames()` (line 85); repoint `registeredNames()` to the real groups (`registerIdentityTools` + `registerCatalogTools`) so its "body names every registered tool" assertion (line 113) checks the body against the REAL tool set; fix the header comments naming stubs (lines 11-12, 23). **This test is the forcing function for the SKILL.md rewrite below.**
- `src/__tests__/plugin-load.integration.test.ts` — prose-only: line 11 names `registerExampleTools` as the mocked group in the contrasting `index.test.ts`; reword (no code change, the file mocks nothing of the examples).

*Edit (docs — contributor mental model):*
- `skill/SKILL.md` — **rewrite around the real tools.** Frontmatter `description` (line 3), Role/Principles ("Stubs are stubs", line 19), Session start (`sil_ping` liveness, lines 23-25), the intent table (lines 31-36), and "Adding a real tool" (line 40, `examples.ts` → `identity.ts`/`catalog.ts`). The body must name every registered real tool (`sil_register`, `sil_whoami`, `sil_search`, **`sil_product_get`** post-rebase) or `skill-content.test.ts` is RED. This is the single largest piece of work in the card.
- `README.md` — rewrite the intro (line 3, off "skeleton … registers stub tools"), the Tools table (lines 9-10, `sil_ping`/`sil_echo` → real tools), the envelope para (line 12, the `{stub,tool,echo}` shape is gone), the config "Unused by the stub tools" note (line 20), and "How to add a tool" (line 35, `examples.ts` → a real group).
- `CLAUDE.md` — "What this repo is" (the "skeleton … registers stub tools" sentence) and "How to add a tool" (the `examples.ts`/`sil_ping`/`sil_echo` "canonical pattern" para, line 29) repoint to a real group. **Distillation owns the final CLAUDE.md + the obsolete knowledge-doc cleanup** (see below) — Dev only needs to land enough of CLAUDE.md that no stale "skeleton" claim remains; the polished convention rewrite is a distillation capture.

*Do NOT touch:*
- `src/__tests__/lib/search-classify.test.ts:145-147,252-264` — the `STUB_BODY` const + its assertions are a `sil_search` false-green guard (a 200 carrying `{stub:true}` must NOT classify as a clean empty match — `complete-work-is-stub-free`). It is hand-written, does **not** import `stubResult`, and is load-bearing for the real `sil_search` classifier. Leaving it is correct; the "current skeleton STUB shape" comment is mildly stale but the guard is valid. (Optional one-line comment tidy at distillation, not in this card's acceptance.)
- `docs/knowledge/skeleton-stubs-are-compliant-until-touched.md` — this doc argues the stubs are compliant *until touched*; **this card is the touch.** The doc is now obsolete. **Distillation removes it + its `docs/knowledge/INDEX.md` row** (the post-review distillation pass is the right place — it reads the merge diff and owns INDEX hygiene). Flag, don't delete in Dev.

**The failure mode that matters most — keep both sides of the drift guard in sync.**
`manifest-contract.integration.test.ts` set-compares `openclaw.plugin.json#contracts.tools`
against what `register()` registers (via `codeRegisteredNames()`, which mirrors
`register()` exactly). Removing `sil_ping`/`sil_echo` from the manifest **and** from
the code-side (`examples.ts` deletion + dropping the `registerExampleTools()` call in
both `index.ts` and the test's `codeRegisteredNames()`) must land together. Drop one
side only and the guard FAILS — that's the guard doing its job, not a bug. The
green-after state: both sides equal `{ sil_product_get, sil_register, sil_search, sil_whoami }`
(post-rebase).

**`pnpm typecheck` is the real gate for the test edits.** Per
`docs/knowledge/typecheck-is-the-only-test-type-gate`, the build excludes tests and
vitest strips types — so a dangling `registerExampleTools`/`stubResult` import in a test
file is caught by `pnpm typecheck`, not `pnpm build`. Dev must run `pnpm typecheck`
**and** `pnpm test` before review.

### Acceptance criteria (tier-tagged — supersedes the provisional "Acceptance" block above)

- `[unit]` Given the plugin source, when grepping `src/`, then `src/tools/examples.ts` does not exist and there are no live references to `registerExampleTools`, `stubResult`, `sil_ping`, or `sil_echo` anywhere under `src/` (history and the `search-classify` `STUB_BODY` guard aside).
- `[unit]` Given `register()` is driven against a mock api, when it runs, then it registers exactly `{ sil_product_get, sil_register, sil_search, sil_whoami }` — no `sil_ping`/`sil_echo`, no stub — completes synchronously, and logs `sil_plugin_loaded` exactly once.
- `[unit]` Given the test suite, when it runs, then no test asserts a stubbed `ToolResult` (the `examples.test.ts` file and the `index.test.ts` `stubResult` describe block are gone) and the suite is green.
- `[unit]` Given `src/lib/tool-result.ts`, when imported, then it exports `jsonResult` and does NOT export `stubResult`.
- `[integration]` Given `openclaw.plugin.json#contracts.tools` and the real `register()` code, when the manifest↔code drift guard runs, then the two sets are exactly equal to `{ sil_product_get, sil_register, sil_search, sil_whoami }` and the guard (incl. both failure-direction proofs) PASSES; no example tool appears on either side.
- `[integration]` Given `skill/SKILL.md` and the real registered tool set, when `skill-content.test.ts` runs, then the skill body names every registered real tool (`sil_register`, `sil_whoami`, `sil_search`, `sil_product_get`) and names no removed example tool, and the test PASSES.
- `[unit]` Given the manifest and code descriptions (`openclaw.plugin.json#description`, `src/index.ts` `description` + header comment), when read, then none describes the plugin as a stub-tool skeleton and none points "add a tool" at `examples.ts` — all repoint at a real group.
- `[grep]` Given the repo (excluding `cards/done/**` history and `dist/`), when grepping `README.md`, `CLAUDE.md`, `skill/SKILL.md`, when complete, then no live contributor-facing text presents `sil_ping`/`sil_echo`/`examples.ts` as the canonical pattern.

### → Handoff to In Dev (next agents: expert-developer, qa-developer)

**REBASE FIRST — mandatory.** This branch (`HEAD = 3649407`) is **behind `origin/main`**
(`ddee1dd`): it predates the `sil_product_get` merge (`6f7984c`, PR #9). HEAD *is* an
ancestor of `origin/main` (verified `git merge-base --is-ancestor` → 0), so this is a
clean fast-forward rebase with **no expected conflicts** in the files this card touches —
`origin/main` did not touch `examples.ts` and did not remove the example wiring; it only
*added* `sil_product_get` to `catalog.ts` + the manifest. Before any edit:
```
git fetch origin && git rebase origin/main
```
After rebase, `openclaw.plugin.json#contracts.tools` will list `sil_product_get`, and
`catalog.ts` will register it. **The post-rebase real tool set is
`{ sil_product_get, sil_register, sil_search, sil_whoami }`** — all acceptance criteria
above are written against that set. If you skip the rebase you'll build against a stale
4-tool manifest and the drift guard will be wrong at pr-ready.

**The serialize signal on the card is now moot.** The orchestrator note (line 46) said run
this *before* `sil-product-get` because it was stand-by. That card has since merged
(`ddee1dd`) — so there is nothing to serialize against; just rebase onto the merged work.

**Where to start (ordering — qa-developer leads with RED, then expert-developer GREEN):**
1. **Rebase** onto `origin/main` (above). Confirm `pnpm install && pnpm test` is green on the rebased base before changing anything.
2. **qa-developer — adjust the test surface to the target state (these are deletions/edits, not new RED tests for new behavior; the "new behavior" is *absence*).** Order within: (a) delete `src/__tests__/tools/examples.test.ts`; (b) edit `manifest-contract.integration.test.ts`, `index.test.ts`, `tool-schema-contract.unit.test.ts`, `skill-content.test.ts`, `plugin-load.integration.test.ts` per the map. After this step the suite will be RED (imports point at code not yet deleted) — that's the expected RED.
3. **expert-developer — make it GREEN by removing the dead code:** delete `src/tools/examples.ts`; remove `stubResult` from `tool-result.ts`; unwire from `src/index.ts` (import + call + comments + description); drop the two names + rewrite description in `openclaw.plugin.json`.
4. **expert-developer — rewrite the contributor docs to satisfy `skill-content.test.ts` + the grep/description criteria:** `skill/SKILL.md` (the big one — must name all real tools), `README.md`, and the stale `CLAUDE.md` sentences (enough that no "skeleton/stub" claim survives; distillation polishes the convention).
5. **Gate:** `pnpm typecheck && pnpm test` — both. typecheck is the only thing that catches a dangling test import (`docs/knowledge/typecheck-is-the-only-test-type-gate`).

**Constraints:** strict TS, no `any` at boundaries; do not weaken the drift guard or its failure-direction proofs (they prove the guard bites); `register()` stays synchronous and opens nothing. No backwards-compat — delete, never deprecate.

**Left for distillation (post-review, in worktree):** remove the obsolete
`docs/knowledge/skeleton-stubs-are-compliant-until-touched.md` + its INDEX row (this card
is the "touch" that doc anticipated); polish the `CLAUDE.md` "How to add a tool" convention
to name `identity.ts`/`catalog.ts` as the canonical pattern; optional one-word comment tidy
on `search-classify.test.ts:145` AND `lookup-classify.test.ts:193` (both say "current skeleton
STUB shape" → "stub-shaped 200"; both are valid false-green guards, comment-only is stale).

### QA test surface in place (qa-developer, 2026-06-09) — RED is ready, expert-developer GREENs it

The test surface now expresses the target (real-only) state. Suite is **RED in exactly the
intended shape: 7 failures across 3 files, every one a true claim about the post-removal state.**
`pnpm typecheck` is **GREEN** (no dangling imports — every `registerExampleTools`/`stubResult`/
`examples.js` reference is gone from the test files).

**What I changed:**
- **DELETED** `src/__tests__/tools/examples.test.ts` (the stub-`ToolResult` theater — deleting it is the card's purpose).
- `manifest-contract.integration.test.ts` — dropped the `registerExampleTools` import + its call in `codeRegisteredNames()`; deleted the obsolete "declares at least two tools" assertion; **kept the drift guard + both failure-direction proofs intact**; ADDED two positive assertions pinning the exact real set `{ sil_product_get, sil_register, sil_search, sil_whoami }` on both sides and asserting neither side names `sil_ping`/`sil_echo`.
- `index.test.ts` — removed the `vi.mock("../tools/examples.js")`, the `registerExampleTools` import, dropped `stubResult` from the `tool-result` import, **deleted the entire `describe("stubResult …")` block**; repointed the wiring test to drive the REAL `register()` and assert it registers exactly the four real tools (no mock). Entry contract (sync, single load marker, config precedence) untouched.
- `tool-schema-contract.unit.test.ts` — removed `sil_ping`/`sil_echo` from `TOOL_CONTRACT`, the `ECHO_PARAMETERS_SCHEMA` literal, the `registerExampleTools` import+call; **kept `EMPTY_OBJECT_SCHEMA`**; shrank the tool-set invariant to `{ sil_register, sil_whoami }`. Did NOT add catalog (search/product_get schemas are owned by `search.test.ts`/`product-get.test.ts`). This file is GREEN already (identity-only, independent of index.ts/manifest).
- `skill-content.test.ts` — dropped the `registerExampleTools` import + call; repointed `registeredNames()` to `registerIdentityTools` + `registerCatalogTools` so the body is checked against the REAL set; ADDED a "names no removed example tool" assertion. **This is the forcing function for your SKILL.md rewrite** — it stays RED until SKILL.md names all four real tools AND drops `sil_ping`/`sil_echo`.
- `plugin-load.integration.test.ts` — prose-only reword (the `index.test.ts` contrast no longer mocks a tool group).

**The 7 RED failures map cleanly to your removals:**
1. `index.test.ts` "wires the real tool groups … exactly the real tool set" → GREENs when you remove the `registerExampleTools` import + call from `src/index.ts` (register currently emits 6, expects 4).
2–5. `manifest-contract` (manifest⊆code, equality, the pinned-set, "neither names removed") → GREEN when you (a) remove the `registerExampleTools()` call from `src/index.ts` AND (b) drop `"sil_echo"`,`"sil_ping"` from `openclaw.plugin.json#contracts.tools`. **Both sides together** — drop one only and the guard stays RED (that's it doing its job).
6–7. `skill-content` ("names every real tool", "names no removed example") → GREEN when `skill/SKILL.md` names `sil_register`/`sil_whoami`/`sil_search`/`sil_product_get` and no longer mentions `sil_ping`/`sil_echo`.

**Your `tool-result.ts` `stubResult` removal** is covered: the only test that exercised it (the `index.test.ts` describe block) is deleted, so removing the export will not orphan a test — `pnpm typecheck` will confirm.

**GATE before review:** `pnpm typecheck && pnpm test` — both must be green. typecheck is the only thing that catches a dangling test import after you delete `examples.ts`/`stubResult`.

**No push-back.** Every criterion can go green honestly by removing code — no test was weakened to fit a stub. Tests are the spec; build to them.

---

## In Dev — expert-developer, qa-developer

Confirmed the rebased base (`ddee1dd`, includes `sil_product_get` PR #9) was green (28 files / 366 tests) before any change. The qa-developer landed the RED test surface; I GREENed it by deleting the dead code, then rewrote the contributor docs. Final tool set on both sides of the drift guard: **`{ sil_product_get, sil_register, sil_search, sil_whoami }`**.

**Code (GREEN — what I removed/changed):**
- **Deleted** `src/tools/examples.ts` (the whole file: `registerExampleTools`, `sil_ping`, `sil_echo`).
- **`src/lib/tool-result.ts`** — removed the `stubResult` export + its doc paragraph and rewrote the header comment off the stub framing. **Kept `jsonResult` byte-for-byte** (only the surrounding file shrank). `tool-result.ts` is now a one-function file.
- **`src/index.ts`** — removed the `registerExampleTools` import + its `register()` call; rewrote the header comment + `description` literal off "skeleton/stub" (now "sil commerce plugin … register, identity, catalog"); repointed "To add a tool, see …" → `src/tools/identity.ts` (named as the reference group that sets the `jsonResult` + structured-error shape). `register()` is unchanged structurally — still synchronous, opens nothing.
- **`openclaw.plugin.json`** — dropped `"sil_echo"`/`"sil_ping"` from `contracts.tools`; rewrote the top-level `description`. The `security`/`configSchema`/`uiHints` blocks (which already described the real tools) were left untouched.

**Docs (GREEN — repointed at the real tools):**
- **`skill/SKILL.md`** — full rewrite around the four real commerce tools. Frontmatter `description` repointed; Role/Principles rewritten (the "Stubs are stubs" principle replaced by a "fail visibly, recover correctly — follow the tool's own `recovery` hint" principle); Session-start keyed off registration/`not_registered` routing rather than a liveness ping; the intent table now covers `sil_register`/`sil_whoami`/`sil_search`/`sil_product_get`; added a shared **status taxonomy** table (`ok`/`not_registered`/`must_reregister`/`forbidden`/`invalid_request`/`retryable`) lifted from the real `identity.ts`/`catalog.ts` envelopes; "Adding a real tool" repointed at `identity.ts`/`catalog.ts`. Body names every registered real tool, no removed example → `skill-content.test.ts` GREEN.
- **`README.md`** — rewrote intro, Tools table (all four real tools with real args/returns), the envelope paragraph (now the `status` envelope, not `{stub,tool,echo}`), Configuration (corrected to the real **two** keys `sil_api_url`/`sil_api_base` — the stale doc listed only one and called it "unused by the stub tools"), and "How to add a tool".
- **`CLAUDE.md`** — repointed the "What this repo is" sentence (no longer "a skeleton that registers stub tools") and the "How to add a tool" para (`examples.ts`/`sil_ping`/`sil_echo`/`stubResult` → the real groups + `jsonResult`). Enough that no stale "skeleton/stub" claim survives; the polished convention rewrite is left for distillation per the handoff.

**Gate (all green):**
- `pnpm typecheck` → exit 0 (the gate that catches a dangling `registerExampleTools`/`stubResult` test import; build excludes tests).
- `pnpm test` → 27 files / 343 tests pass.
- `pnpm build` → `tsc` exit 0; `dist/tools/` = `{ catalog.js, identity.js }` only, no `examples.js`.
- **Live verification** — Build PASS + Run/load-proof PASS (`plugin-load.integration.test.ts` ran the real `register()` against the **compiled** `dist/index.js`: no throw, registers tools, `sil_plugin_loaded` once). API/Browser/Integration phases N/A — host-loaded plugin, no standalone server, no API routes, no UI; diff is code-deletion + docs.
- **grep acceptance** — no live `registerExampleTools`/`stubResult`/`sil_ping`/`sil_echo`/`examples.ts` refs in `src/` or the contributor docs.

**Surprises / notes:**
- The shallow change-site guess was materially incomplete (as the architect flagged) — `README.md` Configuration was *wrong* pre-existing (one key, "unused by stub tools") and I corrected it to the real two-origin config while repointing it.
- The three `*-classify.test.ts` `STUB_BODY` consts (search/lookup/identity) are hand-written false-green guards, NOT `stubResult` callers — left untouched, correct as-is. A broad `grep STUB` surfaces them; don't mass-delete.

**PR:** https://github.com/Context4GPTs/sil-openclaw/pull/10 (base `main`). No CI checks are configured on this repo — the local `typecheck + test + build + load-proof` gate is authoritative.

### → Handoff to Review (next agent: code-quality-guardian; + style-quality-guardian for the doc/markdown diff)

**What to pay attention to:**
- **The drift guard is the feature — confirm it still bites.** `manifest-contract.integration.test.ts` keeps both set-equality directions AND both failure-direction proofs ("FAILS when code registers a tool the manifest omits" / "… the manifest declares a tool the code never registers"), now plus two pin-by-literal guards. The obsolete "declares at least two tools (the skeleton ships a pattern)" assertion was *deleted* (rationale gone), not weakened. Both sides land equal to `{ sil_product_get, sil_register, sil_search, sil_whoami }`.
- **`stubResult` is fully gone, `jsonResult` is byte-identical.** Verify no orphaned reference anywhere (typecheck confirms; grep in `src/` is clean). The only `sil_ping`/`sil_echo` mentions remaining are *deliberate absence-guards* (assert they must NOT appear) + one explanatory comment.
- **`tool-schema-contract.unit.test.ts` deliberately did NOT add catalog.** It owns only the identity surface's TypeBox-migration invariant (`{ sil_register, sil_whoami }`); `sil_search`/`sil_product_get` schemas are owned by `search.test.ts`/`product-get.test.ts`. This is per the architect's map, not an omission.
- **Doc diff is the largest piece** (SKILL.md full rewrite, README, CLAUDE.md) — `style-quality-guardian` should check the markdown framing. The SKILL status-taxonomy table is transcribed from the real `identity.ts`/`catalog.ts` envelopes; if a status string drifts there it'd be a doc/code mismatch.

**Deliberate trade-offs / known smells:** none I'd flag as smells. No `any` introduced, no error swallowed, no abstraction added (`tool-result.ts` is now one function — correct, no premature re-wrap). No backwards-compat shim — `examples.ts` and `stubResult` are deleted outright per the rule.

**Left for distillation (do NOT remove in review):** `docs/knowledge/skeleton-stubs-are-compliant-until-touched.md` + its `docs/knowledge/INDEX.md` row — this card is the "touch" that doc anticipated, so it is now obsolete, but the post-review distillation pass owns its removal (it reads the merge diff + owns INDEX hygiene). Also for distillation: polish the `CLAUDE.md` "How to add a tool" convention; optional one-word comment tidy on `search-classify.test.ts:147` ("current skeleton STUB shape" → "stub-shaped 200").

---

## Review round 1 — code-quality-guardian

**Verdict: PASS** (with two pre-flagged distillation items only — no findings, no rework).

Reviewed the open PR #10 diff (`git diff origin/main...HEAD`, HEAD `ebe5a23`, rebased on `ddee1dd` — confirmed `origin/main` is an ancestor, so the drift guard runs against the real post-`sil_product_get` 4-tool set). 13 files, +170 / −460. This is a pure deletion + doc-repoint enforcing `complete-work-is-stub-free`; judged on the six review-focus dimensions, all clean.

**Verified clean (no findings):**

1. **Nothing dead or dangling left behind.** Grep across `src/` + the contributor docs for `registerExampleTools` / `stubResult` / `sil_ping` / `sil_echo` / `examples.(ts|js)` returns *only* deliberate absence-guards (assertions that these must NOT appear) and two prose-only stale comments in the `*-classify.test.ts` `STUB_BODY` docblocks (already flagged for distillation). `pnpm typecheck` → **exit 0**, which is the authoritative catch for an orphaned test import (the build excludes tests, per `docs/knowledge/typecheck-is-the-only-test-type-gate`). No orphaned export, import, type, or live comment survives.

2. **Drift guard strengthened, not weakened.** `manifest-contract.integration.test.ts:166-188` keeps **both** failure-direction proofs *byte-unchanged* ("FAILS when code registers a tool the manifest omits" / "… the manifest declares a tool the code never registers") — they still perturb each side and assert the equality check rejects it, so the guard demonstrably bites. The obsolete "declares at least two tools (the skeleton ships a pattern)" assertion was **deleted** (its rationale is gone), not hollowed-to-pass. Two new pin-by-literal positive guards were *added* (`:118-141`) locking both sides to exactly `{ sil_product_get, sil_register, sil_search, sil_whoami }` and asserting neither side names `sil_ping`/`sil_echo`. Net: the guard is harder to regress, not softer.

3. **Stub-free on the exercised path.** `src/tools/examples.ts` deleted outright; `stubResult` removed from `src/lib/tool-result.ts` (now a clean one-function file; `jsonResult` byte-identical). `pnpm build` → exit 0 and `dist/tools/` = `{ catalog.js, identity.js }` only — grep of compiled `dist/` for the removed symbols is empty. The stub-test-theater (`examples.test.ts`, the `index.test.ts` `stubResult` describe block) is gone. The three `STUB_BODY` false-green guards (`search-/lookup-/identity-classify.test.ts`) are correctly **retained** — they are hand-written `{ stub: true }` literals (NOT `stubResult` callers) that assert a stub-shaped 200 must NOT classify as `ok`; they are the suite's enforcement of the very rule this card serves. Verified `search-classify.test.ts:251-298` still asserts `not ok`.

4. **Strict TS, no `any`, no backwards-compat shim.** No `any` introduced; deletion, not deprecation — exactly the rule. `tool-result.ts` shrank without a premature re-wrap (correct — three lines beat a needless helper).

5. **Docs accurate, no new inaccuracy.** SKILL.md's shared status-taxonomy table (`ok` / `not_registered` / `must_reregister` / `forbidden` / `invalid_request` / `retryable`, plus `awaiting_browser` / `already_registered` for `sil_register`) maps **exactly** onto the status strings the real `src/lib/` classifiers + `src/tools/` emit (verified by grep against the live code). README's config section was corrected from one stale key ("unused by the stub tools") to the **real two** keys `sil_api_url` / `sil_api_base` — both confirmed defined in `src/lib/config.ts`. No surviving "skeleton/stub" claim in `CLAUDE.md` / `README.md` / `SKILL.md` / manifest `description`. No wrong tool name or endpoint introduced.

6. **No scope bleed.** Under `src/`, the diff touches **only** `tool-result.ts` (the intended `stubResult` removal) and the `examples.ts` deletion. `catalog.ts`, `identity.ts`, and every classifier/client (`sil-client.ts`, `credentials.ts`, `pkce.ts`, `poller.ts`) are byte-untouched — no commerce-tool logic was changed.

**Local gate (authoritative — no CI on this repo):** `pnpm typecheck` exit 0 · `pnpm test` **27 files / 343 tests pass** · `pnpm build` exit 0, `dist/` stub-free. Matches the dev pair's reported gate exactly.

**Knowledge capture:** adequate for this card. The non-obvious distinctions (the `STUB_BODY` guards are false-green gates and not `stubResult` callers; typecheck-not-build is the dangling-import catch) are already captured in `docs/knowledge/` and re-stated inline in the surviving test comments — nothing non-trivial shipped uncommented.

### → Handoff to Distilling (next agent: solutions-architect)

PASS — no fix loop. Two items were flagged on this card *for distillation* and were correctly left in place by Review (do not treat their presence as findings):

1. **Remove the now-obsolete knowledge doc.** `docs/knowledge/skeleton-stubs-are-compliant-until-touched.md` argued the example stubs are compliant *until the area is touched* — **this card is that touch**, so the doc's premise is now spent. Delete the doc **and** its row in `docs/knowledge/INDEX.md` (INDEX hygiene is the distiller's to own; it reads the merge-target diff directly).
2. **Optional comment tidy (cosmetic, non-blocking).** `search-classify.test.ts:145` and `lookup-classify.test.ts:193` both open their `STUB_BODY` docblock with "The current skeleton STUB shape (`stubResult` → …)". The guard is valid and load-bearing; only the *prose* is stale now that `stubResult` is gone — reword to "a stub-shaped 200 (`{ stub, tool, echo }`)". `identity-classify.test.ts:73` has the same `STUB_BODY` const without the stale `stubResult` mention — leave it.

Also for distillation per the architect's handoff: polish the `CLAUDE.md` "How to add a tool" convention to lock `identity.ts` / `catalog.ts` as the canonical reference (Dev already removed every stale "skeleton" claim; this is the convention-polish pass, not a correction).

Capture commits land on this same branch / PR #10; distillation flips `status: distilling → pr-ready`.

---

## Distillation — solutions-architect

Pure subtractive doc hygiene — no new doc created (and none warranted; see below). Commit `e3e205a`, pushed to PR #10. Local gate re-run after the edits: `pnpm typecheck` exit 0, `pnpm test` 27 files / 343 tests pass (unchanged — these were comment- and doc-only edits, no code path touched).

- **REMOVED** `docs/knowledge/skeleton-stubs-are-compliant-until-touched.md` + its `docs/knowledge/INDEX.md` row. That doc argued the `sil_ping`/`sil_echo` stubs were compliant *until the area is touched* — **this card is the touch**, so the doc's premise is spent and it would now actively mislead a future contributor into keeping the examples. No live wikilink pointed at it (the two `docs/decisions/` docs don't reference it; the only other hit is `cards/done/2026/adopt-the-stub-free-rule.md`, an archived distillation record that correctly documents what *that* card did — left as history).
- **Comment tidy** — `src/__tests__/lib/search-classify.test.ts:145` and `src/__tests__/lib/lookup-classify.test.ts:193`: reworded the `STUB_BODY` docblock from "The current skeleton STUB shape (`stubResult` → `{ stub, tool, echo }`)" to "A stub-shaped 200 (`{ stub, tool, echo }`)". The false-green guards themselves are valid and **stay** — only the `stubResult` reference was stale (`stubResult` no longer exists). `identity-classify.test.ts` had no stale `stubResult` mention — left untouched.
- **INDEX.md updated:** knowledge (one row removed). decisions untouched.

**Deliberately did NOT capture (and why):**
- **No new doc in `docs/decisions/` or `docs/knowledge/`.** Searched both INDEXes first. The only "choice" in this card — delete `stubResult` with its sole caller — is the mechanical application of `complete-work-is-stub-free`, not a contested cross-cutting decision worth a decision doc. The drift-guard manifest↔code symmetry is already documented in `CLAUDE.md` "How to add a tool" *and* restated inline in `manifest-contract.integration.test.ts`; the `STUB_BODY` false-green distinction and the typecheck-not-build dangling-import catch are already in `sil-response-classification` / `typecheck-is-the-only-test-type-gate`. A new doc here would restate code/existing docs — production-grade-first forbids it.
- **No `CLAUDE.md` polish needed.** Dev already landed a clean "How to add a tool" convention naming `identity.ts` (the `jsonResult` + structured-error/recovery reference) and `catalog.ts` as the canonical pattern, with the three-step register→wire→manifest flow and the self-enforcing drift-guard note. It is correct and complete; further editing would only restate it.

### → Handoff to pr-ready (awaiting founder merge)

PR #10 (`https://github.com/Context4GPTs/sil-openclaw/pull/10`, base `main`) is at `e3e205a` and ready for the founder to merge. The full diff is a pure stub removal + contributor-doc repoint enforcing `complete-work-is-stub-free`: `examples.ts` and `stubResult` deleted, `sil_ping`/`sil_echo` dropped from the manifest, the drift guard strengthened (both failure-direction proofs kept + two new pin-by-literal guards), and `SKILL.md`/`README.md`/`CLAUDE.md` repointed at the real tool groups. Distillation added only the obsolete-doc removal + two comment tidies on top. No CI on this repo — the authoritative local gate (`typecheck` exit 0 · `test` 27 files / 343 pass · `build` exit 0, `dist/` stub-free) is green. Nothing blocks merge.
