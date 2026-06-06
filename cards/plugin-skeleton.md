---
type: card
title: Scaffold OpenClaw plugin skeleton
slug: plugin-skeleton
work_type: feature
tiers: []
status: discovery
agents: [solutions-architect, product-owner]
priority: 2
created: 2026-06-06
updated: 2026-06-06
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-plugin-skeleton
branch: card/plugin-skeleton
pr: null
merged_commit: null
epic_id: scaffold-sil
origin: goal:scaffold-sil-solution
---

## Intent (founder)

Scaffold the sil-openclaw plugin so it loads correctly in an OpenClaw agent. The skeleton includes project configuration, dependency setup, a skill definition, and tool stubs that register and return placeholder responses. Each tool stub accepts a request and returns a stubbed response so a developer can add a new tool by following the existing pattern. Also set up CLAUDE.md, docs structure (decisions/, knowledge/, product/), and shared configuration consistent with the klodi pattern.

## Epic notes (provisional — sibling Discovery owns the verdict)

**Per-surface acceptance:** Plugin loads in OpenClaw without errors. Skill is discoverable; tools register and return stub responses. A developer can add a new tool by following the existing pattern. CLAUDE.md and docs structure are present and consistent with the klodi pattern.

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

---

<!--
The sections below get filled in progressively by agents.
Each agent reads the previous stage's "Handoff" section, does its work,
appends its own findings and a new "Handoff" section pointing at the next stage.
All commits land on the card/<slug> branch (the same worktree this file lives in).
-->

## Discovery findings — product-owner, solutions-architect

<!-- Filled jointly by product-owner and solutions-architect. -->

### Behavioral framing — what "loads / discoverable / registers / extensible" each mean (product-owner)

Grounded in the reference plugin `klodi-plugin/adapters/openclaw` (the OpenClaw publish target this skeleton must be consistent with). The four phrases in the founder intent are vague until pinned to observable facts; here is the concrete, verifiable meaning of each.

**1. "Plugin loads correctly in an OpenClaw agent."**
The package exposes a single default export from its entry module built via `definePluginEntry({ id, name, description, register(api) })` (klodi `src/index.ts:69`). "Loads" means: the host parses `openclaw.plugin.json` (id, name, description, version, `skills`, `activation`, `contracts.tools`, `configSchema`) and `package.json` (`type: module`, `main: ./dist/index.js`, an `openclaw` compat block with `pluginApi`/`minGatewayVersion`), then calls `register(api)` exactly once, which emits a single `<plugin>_loaded` info log marker (klodi `src/index.ts:103`). The load is proven the way klodi proves it — install the packed artifact into the pinned OpenClaw host image and grep the install log for that marker (klodi `scripts/smoke-plugin-load.sh:282`). A load is **incorrect** if: the marker never fires, the install subprocess hangs (a long-lived resource opened in `register()` holds the event loop, blocking `&& exec openclaw gateway` — klodi smoke exit-code 1), or the host rejects the manifest. For a skeleton, `register()` must do nothing that opens a socket/timer — registration is synchronous and returns.

**2. "Skill is discoverable."**
`openclaw.plugin.json#skills` lists `["./skill"]`, and `skill/SKILL.md` carries valid frontmatter (`name`, `description`, and `metadata.openclaw.emoji` — klodi `skill/SKILL.md:1-7`). Discoverable means: a host (or a content-level test, klodi's `skill-content.test.ts`) that walks the manifest's `skills` paths finds a `SKILL.md` whose frontmatter parses and whose `name` is non-empty. The skill body names the plugin's tools so the agent knows what it can call at session start (klodi SKILL §2). For the skeleton, one skill with a role section and a session-start section that references the stub tools is sufficient.

**3. "Tools register and return stub responses."**
Tools are registered in groups: `register()` calls one `registerXTools(api)` per group (klodi `src/index.ts:78-84`), and each group calls `api.registerTool({ name, label, description, parameters: Type.Object({...}), async execute(...) })` (klodi `src/tools/setup.ts:65`). "Registers" means: after `register(api)` runs, the api has received a `registerTool` call for every name listed in `openclaw.plugin.json#contracts.tools` — names in the manifest and names registered are the same set (no drift). "Returns a stub response" means: each tool's `execute` accepts its declared params and returns a well-formed `ToolResult` — the canonical success shape `{ content: [{ type: "text", text: <json> }] }` via the `jsonResult(data)` helper (klodi `src/lib/tool-result.ts:26`) — carrying a placeholder payload (e.g. `{ stub: true, tool: "<name>", echo: <params> }`) rather than calling any backend. A registered tool with a malformed `execute` return, or a manifest name with no matching `registerTool`, is a failure.

**4. "A developer can add a new tool by following the existing pattern."**
The pattern is mechanical and three-step, all of which a new tool must satisfy: (a) add an `api.registerTool({...})` call inside a `registerXTools(api)` function (or a new such function), (b) wire that function into `register()` (klodi `src/index.ts:78-84`), and (c) add the tool's `name` to `openclaw.plugin.json#contracts.tools`. "A developer can follow the pattern" is verifiable, not aspirational: the contract test that asserts manifest-names == registered-names (klodi `index.test.ts:73`) will FAIL if a dev adds a `registerTool` but forgets the manifest entry (or vice-versa) — the test is the guardrail that makes the pattern self-enforcing. Acceptance is demonstrated by the skeleton shipping ≥2 tool stubs that are visibly the same shape (so "the existing pattern" is a pattern, not a single instance) plus a CONTRIBUTING/CLAUDE note stating the three steps.

### Approach + alternatives ruled out (solutions-architect)

**Chosen: minimal hand-authored skeleton that mirrors `klodi-plugin/adapters/openclaw` *structurally*, adapted for a single greenfield repo.** Reproduce the load-bearing shape of the reference adapter — `openclaw.plugin.json` manifest, `package.json` with the `openclaw` compat block, a `definePluginEntry` entry point, `src/types/openclaw.d.ts` ambient SDK types, one `lib/tool-result.ts` result helper, a `tools/<domain>.ts` register-fn pattern whose `execute()` bodies return *placeholder* `ToolResult`s, a bundled `skill/SKILL.md`, vitest + a `createMockPluginApi` test harness, and the `docs/{decisions,knowledge,product}` taxonomy with per-folder `INDEX.md`. Pin runtime/SDK from the reference itself (Node 22+, ESM `"type":"module"`, TS `module: ESNext` / `moduleResolution: bundler` / `strict`, TypeBox `Type.Object` for tool `parameters`, `pluginApi >=2026.4.1` + build `2026.4.15`, vitest 4). This is the smallest thing that actually loads in OpenClaw *and* demonstrates the "add a tool by copying the pattern" affordance the card asks for.

Alternatives ruled out:

- **Copy `klodi-plugin/adapters/openclaw` wholesale.** Rejected — it drags in klodi-specific machinery meaningless here: the persistent NATS-WS `WakePump`, JetStream wake delivery, `@klodi/nats-client` + `@klodi/tool-catalog` workspace deps, the `vendor.mjs` publish pipeline, NKey credential seeding, sell/buy file formats, 30+ marketplace tools. A skeleton registers tools that return *placeholders* (card intent), not a live transport. Dead subsystems bury the one pattern a dev is meant to follow and violate YAGNI.
- **Transcribe the monorepo layout** (`adapters/openclaw/` nested under a polyglot root, with repo-root `skill/` copied in via `copy-skill.mjs` and gitignored). Rejected — `sil-openclaw` is a standalone single-language repo; siblings `sil-services` / `sil-stage` are *separate* repos, not in-tree adapters, and there is no `packages/`. The `copy-skill.mjs` indirection exists in klodi *only* because one canonical `skill/` feeds six host adapters (klodi `copy-skill.mjs:5-9`). Here the skill has exactly one home, so it lives **directly at `skill/`, committed and hand-edited** — no copy step, and `skill/` is **not** gitignored (unlike klodi `adapters/openclaw/.gitignore:8`). The plugin lives at the **repo root**, not under `adapters/`.
- **Generator / scaffolding tooling** (`create-sil-plugin` CLI or templating). Rejected — single-use. The card needs one plugin instance to exist, not a factory. "Follow the existing pattern" is satisfied by a readable example tool + a short "how to add a tool" note (≈20 lines of prose), not a tool nobody runs twice.
- **Vendor real runtime deps + `vendor.mjs` packaging.** Rejected for the skeleton — there are no workspace deps to vendor, and `bundleDependencies`/vendoring solve a publish-topology problem (klodi ADR-0009) that does not exist until this plugin ships externally. Keep `package.json#dependencies` flat; defer any vendoring story to its own card if sil ever grows shared packages.

**Assumptions (founder may override):**
- ASSUMPTION: language/runtime is **TypeScript on Node 22+**, matching the reference OpenClaw adapter exactly — because OpenClaw's plugin SDK (`openclaw/plugin-sdk`, `definePluginEntry`, `ToolResult`) is the TS surface klodi targets and the card says "consistent with the klodi pattern". No Python/Rust adapter is in scope.
- ASSUMPTION: plugin **id / npm name** is `sil` / `@4gpts/sil` (mirrors klodi's `klodi` / `@4gpts/klodi`); tool namespace prefix is `sil_*`. The founder can rename at the manifest+package level without touching structure.
- ASSUMPTION: the skeleton ships **2–3 stub tools** (e.g. `sil_ping`, `sil_echo`) grouped in one `tools/*.ts` file — enough that "the pattern" is visibly a pattern (≥2 same-shape instances), not a single instance. No real backend, network, timer, or credential I/O.
- ASSUMPTION: a config-schema + `pluginConfig` override path is included but **minimal** (one optional key, e.g. `sil_api_url`, resolved at call time with an env fallback) — it demonstrates klodi's `applyPluginConfigOverrides` pattern (klodi `lib/paths.ts:90`) without committing to real settings.
- ASSUMPTION: the heavyweight publish/smoke pipeline (`vendor.mjs`, the dockerized `smoke-plugin-load.sh`) is **out of scope** for this card; a lightweight build (`tsc`) + the vitest contract/load tests are the proof of load. A full publish-shape smoke is a follow-up card.

### Affected files / surfaces (solutions-architect)

Concrete tree the dev pair creates at the **repo root** of `sil-openclaw` (the worktree). Filenames adapted 1:1 from `klodi-plugin/adapters/openclaw`, minus the klodi-specific subsystems. `sil` is the placeholder plugin id (see assumptions).

```
openclaw.plugin.json          # manifest: id "sil", name, description, version, skills ["./skill"],
                              #   activation.onCapabilities ["tool"], contracts.tools [<every sil_* name>],
                              #   configSchema (one optional key), uiHints. Mirrors klodi openclaw.plugin.json.
package.json                  # "type":"module", main "./dist/index.js", files [dist, skill, manifest, README…],
                              #   openclaw{} block (extensions, compat.pluginApi/minGatewayVersion, build versions),
                              #   scripts (build=tsc, typecheck, test=vitest, dev), flat dependencies + devDeps
                              #   (@sinclair/typebox, typescript, vitest, @types/node). NO @klodi/* / nats / vendor.
tsconfig.json                 # ES2022 / ESNext / moduleResolution bundler / strict / declaration / outDir dist / rootDir src
tsconfig.build.json           # extends tsconfig, declaration:false, sourceMap:false, excludes src/__tests__
vitest.config.ts              # include src/__tests__/**/*.test.ts, environment node, pool forks
.gitignore                    # node_modules/, dist/, *.tgz  — NOTE: NO `skill/` line (skill is source here, not copied)
README.md                     # install + tool surface + "developing" + "how to add a tool" (klodi README shape, trimmed)
LICENSE / NOTICE              # carry forward repo license posture (LICENSE already present in repo root)

src/
  index.ts                    # default definePluginEntry({id,name,description,register(api)});
                              #   register() calls applyPluginConfigOverrides(api.pluginConfig) then each
                              #   registerXTools(api); logs "sil_plugin_loaded". SYNCHRONOUS — opens nothing.
  types/openclaw.d.ts         # ambient `declare module "openclaw/plugin-sdk"` + ".../plugin-entry":
                              #   PluginAPI.registerTool, ToolDefinition{name,label,description,parameters:TObject,execute},
                              #   ToolResult{content[],isError?}, ToolContent, PluginLogger, definePluginEntry.
                              #   Lift the SDK-contract subset from klodi src/types/openclaw.d.ts verbatim.
  lib/
    tool-result.ts            # jsonResult(data): ToolResult  (klodi lib/tool-result.ts:26). Optionally a tiny
                              #   stubResult(name, params) wrapper so every stub returns an identical shape.
    config.ts                 # getApiUrl()/source + setter + applyPluginConfigOverrides(pluginConfig)
                              #   — the minimal klodi lib/paths.ts override pattern (env fallback, call-time resolve).
  tools/
    examples.ts              # registerExampleTools(api): registers sil_ping + sil_echo via api.registerTool,
                              #   each execute() returns jsonResult({stub:true, tool, echo:params}). THE pattern to copy.
  __tests__/
    helpers/mock-plugin-api.ts  # createMockPluginApi() capturing registerTool into a Map + getTool() (klodi helper verbatim).
    index.test.ts             # entry contract: definePluginEntry captures register; register() calls each group;
                              #   manifest contracts.tools set == registered tool names (the drift guard, klodi index.test.ts:73);
                              #   pluginConfig override applied; "sil_plugin_loaded" logged.
    tools/examples.test.ts    # each stub: execute(params) returns well-formed ToolResult with placeholder payload.
    skill-content.test.ts     # skill/SKILL.md frontmatter parses, name non-empty, references the registered tools.

skill/
  SKILL.md                    # frontmatter (name, description, metadata.openclaw.emoji) + Role + Session-start
                              #   (confirm sil_* tools exposed) + intent→tool table referencing the stubs.
                              #   Lean, klodi SKILL.md shape minus marketplace domain. Lives in-repo, committed.

CLAUDE.md                     # contributor-facing: what the repo is, build/test commands, the docs taxonomy,
                              #   and the canonical "How to add a tool" 3-step note (registerTool → wire into
                              #   register() → add name to contracts.tools). Mirrors klodi CLAUDE.md, trimmed to one plugin.

docs/                         # taxonomy ALREADY scaffolded in the worktree (docs/README.md + decisions/, knowledge/,
                              #   product/ each with INDEX.md). Dev confirms the three INDEX.md exist and are wired;
                              #   no ADRs are required by this card (skeleton makes no contested cross-cutting choice
                              #   beyond those recorded here). Distillation may add one later if warranted.
```

Surfaces NOT created (explicit non-goals, vs. klodi): `service/` (wake pump), NATS/JetStream client, `@klodi/*` workspace deps, `vendor.mjs` / `.publish-stage/`, `copy-skill.mjs`, `scripts/smoke-plugin-load.sh` dockerized gate, NKey/credential seeding, sell/buy file libs, `adapters/` nesting.

### Risks / failure modes (solutions-architect)

- **OpenClaw SDK/API drift from the values klodi pinned.** The reference adapter targets `pluginApi >=2026.4.1`, build `2026.4.15`, and the `definePluginEntry` / `registerTool` / `ToolResult` surface as of klodi `src/types/openclaw.d.ts`. If sil's host runs a newer OpenClaw whose plugin contract shifted, a verbatim copy of those ambient types or the manifest schema could fail to load. *Mitigation:* keep the `openclaw.d.ts` subset minimal (only what the stubs touch), pin the same versions as the reference, and treat the load test (install + grep for `sil_plugin_loaded`) as the canary. Don't invent SDK surface the reference doesn't show.
- **`register()` opening a long-lived resource → install hang.** Klodi's smoke gate exists precisely because an eager NATS connection in `register()` held the install subprocess's event loop open and blocked `&& exec openclaw gateway` (klodi `smoke-plugin-load.sh:51-58, 261-271`). A skeleton has no transport, but a careless dev could add a timer, a `setInterval` keep-alive, or an unawaited promise. *Mitigation:* `register()` is strictly synchronous, returns void, opens nothing; an assertion that registration completes without scheduling work is cheap to add.
- **Manifest ↔ code drift (`contracts.tools` vs. registered names).** OpenClaw validates/exposes tools partly off `openclaw.plugin.json#contracts.tools`; if a dev adds a `registerTool` but forgets the manifest entry (or vice-versa), the tool silently fails to surface or the host rejects an undeclared tool. This is the #1 way "follow the pattern" breaks. *Mitigation:* the `index.test.ts` set-equality test (manifest names == registered names) is **mandatory, not optional** — it is the guardrail that makes the 3-step add-a-tool pattern self-enforcing. The product-owner framing (§4) and I both treat this as load-bearing.
- **Skill not discoverable / frontmatter invalid.** If `skill/SKILL.md` frontmatter is malformed, or `openclaw.plugin.json#skills` points at a path that doesn't ship (e.g. `skill/` accidentally gitignored as it is in klodi, or omitted from `package.json#files`), the agent never loads the playbook. *Mitigation:* `skill/` is committed and listed in `package.json#files`; **do not** copy klodi's `skill/`-gitignore line (that line is correct *only* in the monorepo where the skill is a build-time copy). A `skill-content.test.ts` parses the frontmatter.
- **Stub pattern that doesn't actually guide tool addition.** If the skeleton ships exactly one tool, or each stub looks structurally different, "the existing pattern" is ambiguous and a dev can't safely copy it. *Mitigation:* ≥2 stubs of identical shape in one `tools/*.ts`, plus the CLAUDE.md 3-step note. The two stubs must differ only in name/params, not in structure.
- **Over-scaffolding (carrying klodi machinery the skeleton doesn't need).** The biggest divergence risk is *too much*, not too little — pulling in `service/`, vendoring, `copy-skill.mjs`, or a dockerized smoke gate because "klodi has it." Each is a klodi-specific solution to a problem sil doesn't have yet. *Mitigation:* the "Surfaces NOT created" list above is the explicit non-goal boundary; Review should flag any of those reappearing.
- **Monorepo-ism leaking into a standalone repo.** Copying paths like `adapters/openclaw/`, repo-root `skill/` + `copy-skill.mjs`, or `file:../../packages/*` deps would be structurally wrong here and wouldn't resolve. *Mitigation:* plugin at repo root, skill in-repo, flat deps. Recorded as the central "adapt, don't transcribe" decision in the Approach section.
- **ESM/TS config mismatch.** Wrong `moduleResolution`, missing `"type":"module"`, or `.js` import specifiers omitted (the reference imports `./lib/foo.js` from `.ts` sources under `moduleResolution: bundler`) → build or load failure. *Mitigation:* copy the reference's `tsconfig*.json` and import-specifier convention exactly; the `tsc` build + a load test catch this.

### Acceptance criteria

<!--
Each criterion is tagged with the test tier that verifies it. Format:

- `[tier] Given <state>, when <action>, then <outcome>`

tier ∈ {unit, integration, e2e}. The `tiers:` frontmatter is the union of tiers used here.
See .claude/skills/adversarial-testing/references/testing-tiers.md for tier definitions.
Both product-owner and solutions-architect are responsible for these — product-owner
frames the behavior, solutions-architect tags the tier.

product-owner wrote the Given/When/Then below with best-guess tier tags; per the architect's
handoff note, the tier tag is authoritative — solutions-architect may retag and sets `tiers:`.
-->

**Plugin loads correctly**

- `[unit]` Given the entry module is imported with `definePluginEntry` mocked to capture the register callback, when `register(api)` is invoked with a mock plugin api, then it completes synchronously without throwing and emits exactly one `sil_plugin_loaded` info log marker. (mirrors klodi `index.test.ts:157`)
- `[unit]` Given a mock plugin api whose `registerTool`/logger/lifecycle are spies, when `register(api)` runs, then it opens no socket, arms no timer, and starts no long-lived resource (the register call returns and does not hold the event loop open). (the klodi install-hang failure mode, architect Risk #2)
- `[unit]` Given the built package, when `openclaw.plugin.json` and `package.json` are parsed, then the manifest has non-empty `id`, `name`, `description`, `version`, a `skills` array, and a `contracts.tools` array, and `package.json` has `type: "module"`, `main` pointing at the built entry, and an `openclaw` compat block declaring `pluginApi` and `minGatewayVersion`.
- `[integration]` Given the packed plugin artifact and a pinned OpenClaw host, when the host installs the plugin and starts, then the install log contains the `sil_plugin_loaded` marker and the install subprocess exits cleanly (no hang). (mirrors klodi `scripts/smoke-plugin-load.sh`; architect handoff downgrades this to an "imports built entry, runs captured register() against mock api, asserts no-throw + marker logged" integration test if no Docker host is available here — the dockerized version is a follow-up card)
- `[e2e]` Given a configured OpenClaw agent with the plugin enabled, when the agent boots and a session starts, then the host reports the plugin as loaded/active and surfaces no load error. (architect scoped at most one e2e, only if cheap; otherwise covered by the integration downgrade above)

**Skill is discoverable**

- `[unit]` Given the plugin manifest, when its `skills` paths are resolved, then each path contains a `SKILL.md` whose YAML frontmatter parses and exposes a non-empty `name` and `description`. (mirrors klodi `skill-content.test.ts`)
- `[unit]` Given `skill/SKILL.md`, when its body is read, then it names every stub tool the plugin registers, so the agent's session-start tool check has a source of truth.
- `[integration]` Given the plugin loaded in the host, when the agent inspects its available skills, then the plugin's skill appears with the `name` declared in its frontmatter.

**Tools register and return stub responses**

- `[unit]` Given a mock plugin api, when `register(api)` runs, then `api.registerTool` is called once for every name listed in `openclaw.plugin.json#contracts.tools` — the set of registered names equals the set of manifest tool names (no drift in either direction). (mirrors klodi `index.test.ts:73`; architect tags this `[integration]` because it crosses the JSON manifest file + the TS registration code — defer to that tag)
- `[unit]` Given a registered stub tool, when its `execute` is called with valid params, then it returns a well-formed `ToolResult` of shape `{ content: [{ type: "text", text: <json-string> }] }` carrying a placeholder payload, and performs no network/backend call. (stub shape = klodi `jsonResult`, `src/lib/tool-result.ts:26`)
- `[unit]` Given a registered stub tool with a typed parameter schema, when `execute` receives params, then the placeholder payload echoes the received params (proving the request→response wiring is real even though the body is stubbed).
- `[integration]` Given the plugin loaded in the host, when the agent lists available tools, then every name in `contracts.tools` is present and invocable, and invoking one returns the stub `ToolResult` without error.

**A developer can add a new tool by following the existing pattern**

- `[unit]` Given the skeleton ships at least two tool stubs, when their registration code is compared, then both follow the same shape (a `registerTool` call inside a `registerXTools(api)` group wired into `register()`), so "the existing pattern" is demonstrably a pattern and not a single example.
- `[unit]` Given a developer adds a `registerTool` call but omits the corresponding `contracts.tools` manifest entry (or vice-versa), when the manifest-names-equals-registered-names test runs, then it FAILS — the guardrail makes the add-a-tool pattern self-enforcing. (architect Risk #3 marks this test mandatory, not optional)
- `[unit]` Given `CLAUDE.md` (and the README "how to add a tool" note the architect specced), when that section is read, then it states the three required steps: register the tool in a group, wire the group into `register()`, and add the name to `contracts.tools`.

**Repo scaffolding consistent with the klodi pattern**

- `[unit]` Given the repo root, when its tree is inspected, then `CLAUDE.md` exists and `docs/decisions/`, `docs/knowledge/`, and `docs/product/` each exist with an `INDEX.md` matching the established docs convention.
- `[unit]` Given `package.json` declares build and test scripts, when `build` (tsc → `dist/`) and `test` (vitest) run on a clean checkout, then both succeed (the skeleton is buildable and its stub tests are green from the first commit).

### Open questions (if any)

<!-- escalate to founder if blocking; resolved-inline assumptions below carry the most defensible default so the dev pair is never blocked. -->

No blocking questions for the founder. The architect's `### Approach` block carries the matching structural assumptions (TS/Node 22, `sil` / `@4gpts/sil` id, `sil_*` tools, ≥2 stubs, no NATS, tsc+vitest, dockerized smoke deferred); the behavioral assumptions below agree with it.

- **ASSUMPTION (behavioral) — stub tools call no backend and return synchronously.** "Placeholder responses" (card intent) means each `execute` returns `jsonResult({...})` with a stubbed payload echoing its params; no network, no timer, no credential I/O. This is also what keeps `register()` from holding the event loop open (architect Risk #2 / klodi `smoke-plugin-load.sh:261`).
- **ASSUMPTION (behavioral) — "follow the existing pattern" is satisfied by ≥2 same-shape stub tools plus a short prose note**, not a generator. The acceptance test asserting manifest-names == registered-names is what makes the pattern self-enforcing for the next dev; the prose note states the three add-a-tool steps.
- **ASSUMPTION (behavioral) — tool names are neutral skeleton names (`sil_ping`, `sil_echo`), not `klodi_*`.** This is a fresh plugin, not the klodi marketplace; the names exist only to demonstrate the registration shape. Founder can rename at the manifest+package level without touching structure.
- **DEFERRED (flagged, not blocking) — the full dockerized publish-shape smoke (`vendor.mjs` + `smoke-plugin-load.sh`).** The architect scoped this out of this card. Consequence: the `[integration]`/`[e2e]` host-load criteria describe the eventual target but are verified at the lighter `tsc`-build + vitest "loads without throwing + marker logged" level for *this* card, with the dockerized host-load proof tracked as a follow-up. Surfaced so the dev pair and orchestrator know the load proof is staged, not skipped.

### → Handoff to In Dev (next agents: expert-developer, qa-developer) — solutions-architect

**Hard constraint:** structural consistency with `klodi-plugin/adapters/openclaw` is non-negotiable. When a shape exists in the reference (entry point, result helper, tool register-fn, mock-api harness, tsconfig, manifest), **mirror it** — do not reinvent. When a klodi subsystem is in the "Surfaces NOT created" list, **do not bring it in.** The skeleton is "klodi's openclaw adapter minus the marketplace, flattened to a standalone repo." Read these reference files before writing: `src/index.ts`, `src/types/openclaw.d.ts`, `src/lib/tool-result.ts`, `src/lib/paths.ts` (override pattern only), `src/tools/setup.ts` (a clean register-fn example), `src/__tests__/helpers/mock-plugin-api.ts`, `src/__tests__/index.test.ts`, `skill/SKILL.md`, `openclaw.plugin.json`, `package.json`, `tsconfig*.json`, `vitest.config.ts`.

**Where to start (suggested order):**
1. `package.json` + `tsconfig.json` + `tsconfig.build.json` + `vitest.config.ts` + `.gitignore` — get the toolchain compiling an empty `src/index.ts`. Confirm `pnpm build` (tsc → `dist/`) and `pnpm test` run. **Omit klodi's `skill/` line from `.gitignore`.**
2. `src/types/openclaw.d.ts` — lift the SDK-contract subset (the `definePluginEntry`, `PluginAPI.registerTool`, `ToolDefinition`, `ToolResult` declarations) from the reference. Drop SDK surface the stubs don't touch (`registerHttpRoute`, `registerService`, `RuntimeAPI.system`, wake plumbing) unless a stub needs it.
3. `src/lib/tool-result.ts` (`jsonResult` + optional `stubResult`) and `src/lib/config.ts` (the minimal `applyPluginConfigOverrides` + `getApiUrl` env-fallback pattern).
4. `src/tools/examples.ts` — `registerExampleTools(api)` registering ≥2 same-shape stubs (`sil_ping`, `sil_echo`) whose `execute` returns a placeholder `ToolResult`.
5. `src/index.ts` — `definePluginEntry({...})`; `register(api)` applies config overrides, calls `registerExampleTools(api)`, logs `sil_plugin_loaded`. **Synchronous, opens nothing.**
6. `openclaw.plugin.json` — manifest; `contracts.tools` lists exactly the registered `sil_*` names; one optional `configSchema` key.
7. `skill/SKILL.md`, `CLAUDE.md`, `README.md` — the skill body + the canonical 3-step "add a tool" note.
8. Confirm the three `docs/{decisions,knowledge,product}/INDEX.md` already scaffolded in the worktree are intact.

**Test strategy (qa-developer owns RED first, per `test-driven-development` + `adversarial-testing`):**
- **unit** — the bulk. Each stub `execute(params)` returns a well-formed `ToolResult` (`content[0].type === "text"`, parseable JSON placeholder echoing params). `jsonResult`/`stubResult` shape. `applyPluginConfigOverrides` applies a non-empty override and ignores empty strings / wrong source (mirror klodi `index.test.ts` override cases). The entry contract: `definePluginEntry` captures a `register` fn; `register(api)` calls each `registerXTools` group and logs `sil_plugin_loaded`. Skill frontmatter parses and `name` is non-empty (`skill-content.test.ts`). All run against `createMockPluginApi()` — **no real host, no network, no fs beyond temp.** This is the right tier because every assertion is a single function/object in isolation with a test-double api (testing-tiers.md: <100ms, no I/O).
- **integration** — the manifest↔code contract: parse the real `openclaw.plugin.json` from disk and assert `contracts.tools` set-equals the names registered by running `register()` against the mock api (the drift guard, klodi `index.test.ts:73`). This is integration, not unit, because it crosses two artifacts (the JSON manifest file + the TS registration code) and reads a real file — the seam between manifest and code is exactly what it verifies. Also: `tsc` build emits a loadable `dist/index.js`.
- **e2e** — at most one, and only if cheap: install/load the built plugin into a pinned OpenClaw host and assert the `sil_plugin_loaded` marker fires and the install process exits (klodi `smoke-plugin-load.sh` shape, heavily trimmed — no vendoring asserts). If a dockerized host is not readily available in this env, **downgrade to an integration-tier "loads without throwing" test** that imports the built entry and invokes the captured `register()` against the mock api, asserting no throw + marker logged. Record the downgrade as an assumption; a full publish-shape smoke is a follow-up card. Do not block the skeleton on standing up Docker.

**Tier tags on the acceptance criteria above are mine (solutions-architect); the behavioral text is the product-owner's.** If the product-owner's Given/When/Then phrasing implies a tier different from what's tagged, the tag is authoritative per the harness contract — but flag the mismatch rather than silently retagging a criterion whose intent you're unsure of.

<!-- implementation + test notes -->

### → Handoff to Review (next agent: code-quality-guardian)

<!-- what to pay attention to, known smells -->

## Review round 1 — code-quality-guardian

<!-- verdict + issues; runs against the open PR's diff (PR was opened by expert-developer at the in-dev → review transition) -->

### → Handoff back to In Dev (if FAIL/REVIEW)

<!-- fix list -->

## Distillation — solutions-architect

<!-- Runs in the worktree on the card branch after Review PASS. Pushes to the same PR. Per the `distillation` skill: SEARCH docs/ INDEX files first; edit existing docs rather than creating duplicates. Captures land at smallest viable scope: inline WHY comments, docs/decisions/, docs/knowledge/, docs/product/, or CLAUDE.md. Then flips status to pr-ready. -->

## PR Ready

<!-- PR url; founder notification fires here -->

<!-- Abandoned section: appended by /board-close. Records date, reason, PR state at close, worktree teardown. Heading is "## Abandoned — founder". -->
