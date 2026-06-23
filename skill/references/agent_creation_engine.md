# Create a sil-wired shopping expert — the agent-creation engine

**Precondition: read and run this reference ONLY after the user has explicitly endorsed the assembled draft from [`brainstorm_interview.md`](brainstorm_interview.md).** Running any step below before that explicit endorsement is forbidden — the interview owns the endorsement gate.

When the user wants a **dedicated shopping expert** — "make me a shopping expert for buying gifts", "set up a grocery re-order agent", "create a sil shopping agent" — author and persist a **valid OpenClaw agent profile**: a real new agent under the host `agents` config, with the **sil plugin enabled**, the **sil skill attached**, its persona written into the workspace **`SOUL.md`**, plus the expert's SDS behaviour artefacts in the sil data directory — so the created agent can shop with **no further setup**.

Every created expert runs **entirely on Spec-Driven Shopping (SDS)** — it is the operating model, not an optional layer. At creation the engine persists the two **required** SDS specs (the deep researched `domainSpec` and the derived `intentSpec` dimension schema); the two **lazy** specs (`userSpec` facts, `playbook` taste) start absent and fill incrementally per-query later ([`expert_shopping.md`](expert_shopping.md)).

You are the engine. The host config write (and the `SOUL.md` write) is **you driving the host's own `openclaw …` CLI** — the sil plugin never writes the host config itself. Run these steps **in order, top to bottom** — the order is the spec.

## The profile spec (input)

The endorsed draft from the interview feeds two stores. The **persona** becomes the agent's host workspace **`SOUL.md`** (its identity / voice / standing rules — written via the host CLI, **not** a sil artefact). The **SDS specs** become the sil data-dir artefacts (`domainSpec` → `domain_spec.md`, `intentSpec` → `intent_spec.md`):

| Field | Meaning | Goes to | Required? |
|---|---|---|---|
| **agentId** | The new agent's id (lower-kebab, e.g. `gift-buyer`). Becomes `agents.list[].id`. Must be **unique** and is never `main` (host-reserved). | host | Required |
| **name** | Human-readable expert name ("Gift Buyer"). | sil manifest | Required |
| **persona / instructions** | Who this expert is and how it shops — its expertise, tone, standing rules. | host workspace **`SOUL.md`** (via the host CLI — **not** a sil artefact, no `persona.md`) | Required (non-empty) |
| **workspace** | The agent's workspace directory (e.g. `~/.openclaw/workspace-gift-buyer`). | host | Required for the non-interactive add |
| **domainSpec (SDS domain spec)** | The niche's **deep researched expertise** — how to buy well and the full mechanics — converged at creation by the interview's domain-research pass. Web-refreshed every query at shop time. | sil `domain_spec.md` | **Required (non-empty)** |
| **intentSpec (SDS intent spec)** | The agent-specific **decomposition dimensions** (a PRD-style schema) a query must resolve, **derived from `domainSpec`** at creation. | sil `intent_spec.md` | **Required (non-empty)** |
| **userSpec (SDS user spec)** | The user's domain-relevant facts + hard constraints. **NOT** set at creation — captured **lazily, per-query** on first need ([`expert_shopping.md`](expert_shopping.md)). The creation engine leaves it absent. | sil `user_spec.md` | Optional (lazy) |
| **playbook (SDS buying taste)** | The user's **buying taste** (price sensitivity, brand, preferences). **NOT** set at creation — captured **lazily, per-query**. The creation engine leaves it absent. | sil `playbook.md` | Optional (lazy) |

The **sil plugin** and the **sil skill** are always attached (that is what makes it *sil-wired*). Creating an expert is **local and offline** — it does **not** require or perform sil registration, reads no token, and writes nothing to identity storage. The expert registers the user later, on first shop, via `sil_register`. Do **not** present registration as a prerequisite for creating the profile.

## The created expert needs WEB tools

SDS at shop time **web-refreshes the domain spec on every query** and the domain-research pass at creation also reaches the web ([`expert_shopping.md`](expert_shopping.md), Correction 5). So the created agent must have **web/fetch tools in its tool profile**. The agent inherits its tool profile from `agents.defaults` when its shell is created (the agent-shell step below): confirm that profile grants a web-fetch/browse capability and **do not deny it** in the agent's tool profile (alongside not denying the `sil_*` tools). If the host's `agents.defaults` does **not** grant a web tool, the created expert cannot keep its domain spec current — surface that to the user as a host-capability gap (and the orchestrator signal in the card records the dependency); do **not** pretend the refresh happened. The ordered steps follow.

## Engine steps (run in this exact order)

1. **Validate the spec FIRST — before anything is written.** Check `agentId` is present, lower-kebab, unique-looking, and not `main`; `name` is present; `persona`/instructions is non-empty; `workspace` is present; the **SDS `domainSpec` and `intentSpec` are both present and non-blank** (SDS is the operating model — a created expert without them is a defect, not an "absent-is-fine" slot). If any check fails, stop with the **`invalid_request`** outcome naming the offending field and **write nothing** — no agent, no artefacts. Nothing partial. This validation runs ahead of every host command, so a bad spec never reaches the host.

2. **Collision check — read before write.** Run `openclaw agents list --json` and confirm no existing agent already uses `agentId`. If one does, stop with the **`collision`** outcome and **do not** run `openclaw agents add` — never overwrite or clobber an existing agent's persona or wiring. Surface the collision so the user can rename. (This list-check precedes the add, so a same-name agent is caught before any change.)

3. **Create the agent shell (host CLI).** Run:
   ```
   openclaw agents add <agentId> --workspace <workspace> --non-interactive --json
   ```
   This creates the real `agents.list[]` entry and the agent's workspace bootstrap files (`SOUL.md`, `AGENTS.md`, …), inheriting model and **tool profile** (which must grant a **web/fetch** capability — see above) from `agents.defaults`. `--non-interactive --json` is required so you can drive it without a prompt and read the structured result.

4. **Write the persona DIRECTLY into the workspace `SOUL.md` (host CLI).** The persona is the agent's soul / system framing — that is the host's `SOUL.md`, **not** a sil behaviour artefact. Write the endorsed persona text straight into the new agent's workspace `SOUL.md` via the host CLI. There is **no** intermediate `persona.md` in the sil store and **no** copy step — the persona lives in exactly one place, the host workspace.

5. **Materialize the SDS behaviour artefacts into the sil data directory.** Call **`sil_profile_materialize`** with `{ agentId, name, domainSpec, intentSpec }` — pass the **deep researched `domainSpec`** and the **derived `intentSpec`** (the decomposition-dimension schema). Both are **required**. It writes the expert's SDS behaviour artefacts atomically into **`$SIL_DATA_DIR`** (the sil data directory — the plugin's own disclosed scope) under `agents/<agentId>/`:
   - **`domain_spec.md`** — the **SDS domain spec** (deep researched niche expertise — how to buy well, the full mechanics); **required**;
   - **`intent_spec.md`** — the **SDS intent spec** (the decomposition-dimension schema derived from the domain spec); **required**;
   - **`profile.json`** — the manifest the sil skill reads at runtime to load them.
   The **user spec** (`user_spec.md`) and the **playbook** (`playbook.md`) are **not** written here — they fill **lazily, per-query** at shop time, not at creation, so the engine leaves `userSpec` and `playbook` absent. There is **no `persona.md`** here (the persona is the workspace `SOUL.md`). These behaviour artefacts live in `$SIL_DATA_DIR`, kept **out of** the thin host `agents` wiring entry. The tool's own outcomes are `ok` / `invalid_request` / `persistence_failed` — on `invalid_request` it wrote nothing; on `persistence_failed` it left nothing partial.

6. **Wire the sil skill and plugin into the agent (host CLI).** Attach the sil skill and enable the sil plugin for the created agent. These shapes are asserted against the host the sil-stage round pins — **`alpine/openclaw:2026.6.9`** — where both are value-mode sets driven with `--strict-json` (the only set mode this image accepts):
   ```
   openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json
   openclaw config set plugins.entries.sil.enabled true --strict-json
   ```
   The skill attach makes the agent **know how** to drive the tools; the plugin enable makes the four `sil_*` tools available to it (they come for free once the `sil` plugin is enabled). Keep `sil` in the agent's skill list and do not deny the `sil_*` tools in its tool profile.

7. **Validate with the host's OWN check, THEN declare created.** Run `openclaw config validate --json`. On `alpine/openclaw:2026.6.9` the verdict shape is `{ valid, path, issues? }` — success keys off **`.valid`**, never an `ok` field. "Valid" means *the host says yes* — never assert it yourself. Only when the verdict reads `valid: true` do you report the **`created`** outcome. If `openclaw config validate` returns `valid: false` (or any CLI step failed), report **`persistence_failed`** with the failing **path** and **cause** (the `issues?` the verdict reports), and leave nothing partial behind. This validate-after-add step is what guarantees the host will load the profile.

8. **Tell the user it is ready.** On `created`, tell the user the expert exists and how to open it. When they open the new agent, the host loads it: the sil plugin is enabled, the sil skill is attached, `SOUL.md` carries the persona, and the sil skill reads `$SIL_DATA_DIR/agents/<agentId>/profile.json` to load the SDS domain spec + intent spec (and the user spec + taste once they have been lazily captured) — the expert calls `sil_search` / `sil_product_get` (and `sil_register` / `sil_whoami` as needed) on the user's intent with **no further setup**.

## Status taxonomy (agent-creation engine)

| `status` | Meaning | What to do |
|---|---|---|
| `created` | The agent was added, the behaviour artefacts materialized, the sil plugin + skill wired, and `openclaw config validate` accepted it. | Tell the user the expert is ready and how to open it. |
| `invalid_request` | The spec failed validation (missing/blank field). **Nothing was written.** | Name the field, fix it, run again. Do NOT proceed to `openclaw agents add`. |
| `collision` | An agent with that id already exists (from `openclaw agents list`). | Surface it; pick a different id. **Never overwrite / clobber** the existing agent. |
| `persistence_failed` | A write or `openclaw config validate` step failed. The reported **path** + **cause** name what to fix. **Nothing partial** was left behind. | Fix the path/cause (writable config, valid spec), then create the expert again. |

## Runtime — how a created expert loads its behaviour

When you (the sil skill) start a session inside a created expert, the host has already injected the persona via the workspace **`SOUL.md`** (the agent's standing instructions, voice, hard-rules). Then read `$SIL_DATA_DIR/agents/<agentId>/profile.json` and load the **SDS behaviour artefacts** it points at:
- **`domain_spec.md`** — the **SDS domain spec**: deep researched niche expertise (how to buy well, the full mechanics) to reason over. **Always present** (required at creation);
- **`intent_spec.md`** — the **SDS intent spec**: the decomposition-dimension schema a query must resolve. **Always present** (required at creation);
- **`user_spec.md`** — the **SDS user spec**: the user's domain-relevant facts + hard constraints, **once one has been lazily captured** (absent until first need);
- **`playbook.md`** — the **SDS buying taste** (price sensitivity, brand, preferences), **once captured lazily** (absent until first need).

The two SDS specs are **required** (a created expert always carries them); the user spec and the playbook are **lazy** — absent until the per-query capture fills them, exactly like a brand-new expert the user has not shopped yet. Loading these is what lets the expert shop on its niche with no further setup. When the user then states a shopping intent, shop per [`expert_shopping.md`](expert_shopping.md) — the profile-driven shop-time loop, which on **every query web-refreshes the domain spec**, **decomposes the request along the intent-spec dimensions** (the per-query intent, ephemeral), and **lazily captures** any missing user fact (`user_spec.md`) or taste (`playbook.md`) on demand. To sharpen a created expert from what it observed in real sessions — including its domain-spec, intent-spec dimensions, user-spec facts, or buying taste — see [`refine_expert.md`](refine_expert.md).
