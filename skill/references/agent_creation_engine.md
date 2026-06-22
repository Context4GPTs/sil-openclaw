# Create a sil-wired shopping expert — the agent-creation engine

**Precondition: read and run this reference ONLY after the user has explicitly endorsed the assembled draft from [`brainstorm_interview.md`](brainstorm_interview.md).** Running any step below before that explicit endorsement is forbidden — the interview owns the endorsement gate.

When the user wants a **dedicated shopping expert** — "make me a shopping expert for buying gifts", "set up a grocery re-order agent", "create a sil shopping agent" — author and persist a **valid OpenClaw agent profile**: a real new agent under the host `agents` config, with the **sil plugin enabled** and the **sil skill attached**, plus the expert's behaviour artefacts in the sil data directory — so the created agent can shop with **no further setup**.

You are the engine. The host config write is **you driving the host's own `openclaw …` CLI** — the sil plugin never writes the host config itself. Run these steps **in order, top to bottom** — the order is the spec.

## The profile spec (input)

The endorsed draft from the interview *is* this spec (the persona → `persona`, and the elicitation style + answer→param mapping + rubric → `playbook`):

| Field | Meaning | Required? |
|---|---|---|
| **agentId** | The new agent's id (lower-kebab, e.g. `gift-buyer`). Becomes `agents.list[].id`. Must be **unique** and is never `main` (host-reserved). | Required |
| **name** | Human-readable expert name ("Gift Buyer"). | Required |
| **persona / instructions** | Who this expert is and how it shops — its expertise, tone, standing rules. | Required (non-empty) |
| **workspace** | The agent's workspace directory (e.g. `~/.openclaw/workspace-gift-buyer`). | Required for the non-interactive add |
| **playbook (sub-skill)** | An optional generated **domain sub-skill** — a shopping playbook for this expert's niche. | Optional |

The **sil plugin** and the **sil skill** are always attached (that is what makes it *sil-wired*). Creating an expert is **local and offline** — it does **not** require or perform sil registration, reads no token, and writes nothing to identity storage. The expert registers the user later, on first shop, via `sil_register`. Do **not** present registration as a prerequisite for creating the profile.

## Engine steps (run in this exact order)

1. **Validate the spec FIRST — before anything is written.** Check `agentId` is present, lower-kebab, unique-looking, and not `main`; `name` is present; `persona`/instructions is non-empty; `workspace` is present. If any check fails, stop with the **`invalid_request`** outcome naming the offending field and **write nothing** — no agent, no artefacts. Nothing partial. This validation runs ahead of every host command, so a bad spec never reaches the host.

2. **Collision check — read before write.** Run `openclaw agents list --json` and confirm no existing agent already uses `agentId`. If one does, stop with the **`collision`** outcome and **do not** run `openclaw agents add` — never overwrite or clobber an existing agent's persona or wiring. Surface the collision so the user can rename. (This list-check precedes the add, so a same-name agent is caught before any change.)

3. **Create the agent shell (host CLI).** Run:
   ```
   openclaw agents add <agentId> --workspace <workspace> --non-interactive --json
   ```
   This creates the real `agents.list[]` entry and the agent's workspace bootstrap files (`SOUL.md`, `AGENTS.md`, …), inheriting model and tool profile from `agents.defaults`. `--non-interactive --json` is required so you can drive it without a prompt and read the structured result.

4. **Materialize the behaviour artefacts into the sil data directory.** Call **`sil_profile_materialize`** with `{ agentId, name, persona, playbook? }`. It writes the expert's behaviour artefacts atomically into **`$SIL_DATA_DIR`** (the sil data directory — the plugin's own disclosed scope) under `agents/<agentId>/`:
   - **`persona.md`** — the persona/instructions that power the expert's behaviour;
   - **`playbook.md`** — the generated domain **sub-skill**, when supplied;
   - **`profile.json`** — the manifest the sil skill reads at runtime to load them.
   These behaviour artefacts live in `$SIL_DATA_DIR`, kept **out of** the thin host `agents` wiring entry. The tool's own outcomes are `ok` / `invalid_request` / `persistence_failed` — on `invalid_request` it wrote nothing; on `persistence_failed` it left nothing partial.

5. **Make the persona the agent's system framing.** Copy the materialized `persona.md` into the new agent's workspace `SOUL.md` (its persona bootstrap file), so the host injects the persona into the expert's system prompt.

6. **Wire the sil skill and plugin into the agent (host CLI).** Attach the sil skill and enable the sil plugin for the created agent:
   ```
   openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json
   openclaw config set plugins.entries.sil.enabled true --merge
   ```
   The skill attach makes the agent **know how** to drive the tools; the plugin enable makes the four `sil_*` tools available to it (they come for free once the `sil` plugin is enabled). Keep `sil` in the agent's skill list and do not deny the `sil_*` tools in its tool profile.

7. **Validate with the host's OWN check, THEN declare created.** Run `openclaw config validate --json`. "Valid" means *the host says yes* — never assert it yourself. Only when validation passes do you report the **`created`** outcome. If `openclaw config validate` returns `ok: false` (or any CLI step failed), report **`persistence_failed`** with the failing **path** and **cause**, and leave nothing partial behind. This validate-after-add step is what guarantees the host will load the profile.

8. **Tell the user it is ready.** On `created`, tell the user the expert exists and how to open it. When they open the new agent, the host loads it: the sil plugin is enabled, the sil skill is attached, `SOUL.md` carries the persona, and the sil skill reads `$SIL_DATA_DIR/agents/<agentId>/profile.json` to load the persona + playbook — the expert calls `sil_search` / `sil_product_get` (and `sil_register` / `sil_whoami` as needed) on the user's intent with **no further setup**.

## Status taxonomy (agent-creation engine)

| `status` | Meaning | What to do |
|---|---|---|
| `created` | The agent was added, the behaviour artefacts materialized, the sil plugin + skill wired, and `openclaw config validate` accepted it. | Tell the user the expert is ready and how to open it. |
| `invalid_request` | The spec failed validation (missing/blank field). **Nothing was written.** | Name the field, fix it, run again. Do NOT proceed to `openclaw agents add`. |
| `collision` | An agent with that id already exists (from `openclaw agents list`). | Surface it; pick a different id. **Never overwrite / clobber** the existing agent. |
| `persistence_failed` | A write or `openclaw config validate` step failed. The reported **path** + **cause** name what to fix. **Nothing partial** was left behind. | Fix the path/cause (writable config, valid spec), then create the expert again. |

## Runtime — how a created expert loads its behaviour

When you (the sil skill) start a session inside a created expert, read `$SIL_DATA_DIR/agents/<agentId>/profile.json`, then load the `persona.md` (reaffirm the standing instructions) and `playbook.md` sub-skill (the domain shopping playbook) it points at. That is what lets the expert shop on its niche with no further setup.
