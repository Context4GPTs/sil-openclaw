# Create a sil-wired shopping expert — the agent-creation engine

**Precondition: run this ONLY after the user has explicitly endorsed the assembled draft from [`brainstorm_interview.md`](brainstorm_interview.md).** Any step below before that endorsement is forbidden — the interview owns the gate.

When the user wants a **dedicated shopping expert**, author and persist a **valid OpenClaw agent profile**: a real new agent under the host `agents` config, with the **sil plugin enabled**, the **sil skill attached**, its persona written into the workspace **`SOUL.md`**, plus the expert's SDS behaviour artefacts in the sil data directory — so it shops with **no further setup**.

Every created expert runs **entirely on Spec-Driven Shopping (SDS)** — the operating model, not an optional layer. The engine persists **all four** SDS specs, each **required and non-blank**: the deep researched `domainSpec`, the derived `intentSpec` schema, and an **initial** `userSpec` + `playbook` (seeded *partial* by the interview's one-touchpoint-per-document setup). All four are present from creation, then **augmented every query** ([`expert_shopping.md`](expert_shopping.md)) — we keep learning.

You are the engine: the host config write (and the `SOUL.md` write) is **you driving the host's own `openclaw …` CLI** — the sil plugin never writes the host config. Run the steps **in order, top to bottom** — the order is the spec.

## The profile spec (input)

The endorsed draft feeds two stores. The **persona** becomes the host workspace **`SOUL.md`** (its identity / voice / standing rules — via the host CLI, **not** a sil artefact). The **four SDS specs** become the sil data-dir artefacts:

| Field | Meaning | Goes to | Required? |
|---|---|---|---|
| **agentId** | Lower-kebab id (e.g. `gift-buyer`) → `agents.list[].id`. Unique, never `main`. | host | Required |
| **name** | Human-readable name ("Gift Buyer"). | sil manifest | Required |
| **persona** | Who this expert is and how it shops. | host **`SOUL.md`** (via host CLI — no `persona.md`) | Required (non-empty) |
| **workspace** | The agent's workspace directory (e.g. `~/.openclaw/workspace-gift-buyer`). | host | Required for the non-interactive add |
| **domainSpec** | The niche's **deep researched expertise** — how to buy well, the full mechanics — from the interview's §2 research pass. Web-refreshed every query. | sil `domain_spec.md` | **Required (non-empty)** |
| **intentSpec** | The agent-specific **decomposition dimensions** (PRD-style schema) **derived from `domainSpec`**, signed off in §5. | sil `intent_spec.md` | **Required (non-empty)** |
| **userSpec** | The user's domain-relevant facts + hard constraints. **Seeded partial** from §3 (the one basic fact), then augmented per-query. | sil `user_spec.md` | **Required (non-empty)** |
| **playbook** | The user's **buying taste**. **Seeded partial** from §4 (the compare-options answer), then augmented per-query. | sil `playbook.md` | **Required (non-empty)** |

The **sil plugin** and **sil skill** are always attached (that is what makes it *sil-wired*). Creation is **local and offline** — it does **not** require or perform sil registration, reads no token, and writes nothing to identity storage. The expert registers the user later, on first shop, via `sil_register`. Do **not** present registration as a prerequisite.

## The created expert needs WEB tools

SDS **web-refreshes the domain spec on every query** and the §2 research pass also reaches the web. So the created agent must have **web/fetch tools in its tool profile** — inherited from `agents.defaults` when its shell is created (step 3). Confirm that profile grants a web-fetch/browse capability and **do not deny it** (alongside not denying the `sil_*` tools). If `agents.defaults` does **not** grant a web tool, the expert cannot keep its domain spec current — surface that to the user as a host-capability gap; do **not** pretend the refresh happened.

## Engine steps (run in this exact order)

1. **Validate the spec FIRST — before anything is written.** Check `agentId` (present, lower-kebab, unique-looking, ≠ `main`), `name`, `persona`, `workspace`, and the **four SDS specs — `domainSpec`, `intentSpec`, `userSpec`, `playbook` — all present and non-blank** (none is an "absent-is-fine" slot; the user side is seeded *partial* by the interview, never omitted). On any failure, stop with **`invalid_request`** naming the field and **write nothing**. This runs ahead of every host command, so a bad spec never reaches the host.

2. **Collision check — read before write.** Run `openclaw agents list --json`; if `agentId` already exists, stop with **`collision`** and **do not** run `openclaw agents add` — never overwrite an existing agent's persona or wiring. Surface it so the user can rename.

3. **Create the agent shell (host CLI).** Run:
   ```
   openclaw agents add <agentId> --workspace <workspace> --non-interactive --json
   ```
   This creates the real `agents.list[]` entry and the workspace bootstrap files (`SOUL.md`, `AGENTS.md`, …), inheriting model and **tool profile** (which must grant **web/fetch** — see above) from `agents.defaults`. `--non-interactive --json` lets you drive it without a prompt and read the result.

4. **Write the persona into the workspace `SOUL.md` (host CLI).** The persona is the agent's soul / system framing — the host's `SOUL.md`, **not** a sil artefact. Write the endorsed persona text straight into the new agent's `SOUL.md` via the host CLI. There is **no** `persona.md` in the sil store and **no** copy step — the persona lives in exactly one place.

5. **Materialize the SDS behaviour artefacts.** Call **`sil_profile_materialize`** with `{ agentId, name, domainSpec, intentSpec, userSpec, playbook }` — the deep `domainSpec`, the derived `intentSpec` schema, and the initial `userSpec` + `playbook` seeded by the interview (partial, augmented per-query). All four are **required and non-blank**. It writes atomically into **`$SIL_DATA_DIR/agents/<agentId>/`**: `domain_spec.md`, `intent_spec.md`, `user_spec.md`, `playbook.md`, plus `profile.json` (the manifest the sil skill reads at runtime). All four are seeded at creation — none deferred. There is **no `persona.md`** here. The tool's outcomes are `ok` / `invalid_request` / `persistence_failed` — on `invalid_request` it wrote nothing; on `persistence_failed` it left nothing partial.

6. **Wire the sil skill + plugin (host CLI).** Asserted against the pinned host — **`alpine/openclaw:2026.6.9`** — both value-mode sets with `--strict-json` (the only set mode this image accepts):
   ```
   openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json
   openclaw config set plugins.entries.sil.enabled true --strict-json
   ```
   The skill attach makes the agent **know how** to drive the tools; the plugin enable turns the sil plugin **on** — but on `alpine/openclaw:2026.6.9` it does **not** by itself un-filter the `sil_*` tools (see the admission step next). Keep `sil` in the agent's skill list and do not deny the `sil_*` tools.

7. **Admit sil at the host allow surfaces — run the shipped helper.** Enabling the plugin is necessary but not sufficient: until `sil` is admitted at the **global** allow surfaces `plugins.allow` + **`tools.alsoAllow`**, the host keeps the four `sil_*` tools **filtered**, so the opened expert can't call them. Admission is **plugin-ID only** — there is no per-tool key. The value-mode `openclaw config set` above is **overwrite-only** on this image, so it cannot additively merge those shared global arrays without clobbering another already-admitted plugin (e.g. `klodi`). Run the shipped admission helper — the package `bin` that ships with the plugin (same artefact as the `openclaw:allowlist` script) — which performs the **additive, idempotent, atomic, self-validating** three-surface merge (`plugins.allow` + `tools.alsoAllow` + `plugins.entries.sil`):
   ```
   sil-openclaw-allowlist
   ```
   It re-confirms the plugin-enable as an idempotent no-op, so re-running it on every creation never duplicates or clobbers an existing entry. **If the helper exits non-zero (a failed admission), report `persistence_failed` with the path + cause and do NOT declare `created`** — never a green `created` over still-filtered tools, exactly as a rejected `openclaw config validate` is handled in the next step.

8. **Validate with the host's OWN check, THEN declare created.** Run `openclaw config validate --json`. On `alpine/openclaw:2026.6.9` the verdict is `{ valid, path, issues? }` — success keys off **`.valid`**, never an `ok` field. Only when `valid: true` **and** the allow-list admission (step 7) succeeded do you report **`created`**. If `valid: false`, the admission helper exited non-zero, or any CLI step failed, report **`persistence_failed`** with the failing **path** + **cause** (the `issues?`), leaving nothing partial.

9. **Tell the user it is ready.** On `created`, tell them the expert exists and how to open it. Opening it loads the persona (`SOUL.md`) and all four SDS specs (`profile.json`), and — because the `sil_*` tools were admitted in step 7 — the expert calls `sil_search` / `sil_product_get` (and `sil_register` / `sil_whoami` as needed) on the user's intent with **no further setup**.

## Status taxonomy (agent-creation engine)

| `status` | Meaning | What to do |
|---|---|---|
| `created` | Agent added, artefacts materialized, sil plugin + skill wired, `openclaw config validate` accepted it. | Tell the user it's ready and how to open it. |
| `invalid_request` | Spec failed validation (missing/blank field). **Nothing written.** | Name the field, fix it, run again — do NOT proceed to `openclaw agents add`. |
| `collision` | An agent with that id already exists. | Surface it; pick a different id. **Never overwrite.** |
| `persistence_failed` | A write, the allow-list admission helper (non-zero exit), or `openclaw config validate` step failed. **Nothing partial** left. | Fix the reported path/cause, create again. |

## Runtime — how a created expert loads its behaviour

When you (the sil skill) start a session inside a created expert, the host has already injected the persona via the workspace **`SOUL.md`**. Then read `$SIL_DATA_DIR/agents/<agentId>/profile.json` and load the four **SDS behaviour artefacts** it points at — all **always present** (required at creation):
- **`domain_spec.md`** — deep researched niche expertise (how to buy well, the full mechanics) to reason over;
- **`intent_spec.md`** — the decomposition-dimension schema a query must resolve;
- **`user_spec.md`** — the user's domain-relevant facts + hard constraints (seeded partial, augmented per-query);
- **`playbook.md`** — the user's buying taste (seeded partial, augmented per-query).

Loading these is what lets the expert shop on its niche with no further setup. When the user states a shopping intent, shop per [`expert_shopping.md`](expert_shopping.md) — the loop that on **every query** web-refreshes the domain spec, decomposes the request along the intent-spec dimensions (the ephemeral per-query intent), and **augments** the already-present `user_spec.md` + `playbook.md` — we keep learning. To sharpen an expert from observed sessions, see [`refine_expert.md`](refine_expert.md).
