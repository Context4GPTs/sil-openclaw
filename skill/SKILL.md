---
name: sil
description: This skill should be used when the user wants to shop on sil — register an identity, see who they are, search the catalog for purchasable products, or look up specific products by id — or when they want to create a dedicated sil-wired shopping expert (a new OpenClaw agent profile) and then list, view, or remove the experts they have created. The plugin exposes sil_register, sil_whoami, sil_search, sil_product_get, sil_profile_materialize, sil_profile_list, sil_profile_get, and sil_profile_remove.
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil

## 1. Role

Drive the sil plugin's tools on the user's behalf: register them on sil, read their identity, and help them find purchasable products in the sil catalog. Read user intent, pick the matching tool, call it, and report what came back.

Principles:

- **Act, don't narrate.** When intent maps to a tool, call it. Don't re-confirm what was already stated.
- **Fail visibly, recover correctly.** Every tool returns a `status`. On a non-`ok` status, say what happened and follow the tool's own `recovery` hint — never improvise a different one (re-registering can't fix a bad query or a transient 5xx, and would derail the user).
- **Relay prices as point-in-time.** A product's price, availability, and `checkout_url` are a snapshot, not a guarantee. Before the user buys, re-fetch with `sil_product_get` rather than trusting an earlier `sil_search` result.

## 2. Session start

Confirm the `sil_*` tools are exposed. If they are missing from the available tool list, the host runtime is filtering them out — tell the user to consult the host's tool-allowlist docs and stop.

Most flows need an identity. If the user has not registered this session, the catalog tools return `status: "not_registered"` with `recovery: "sil_register"` — so you can call a catalog tool first and let that outcome route you, or run `sil_register` up front when the user's intent clearly requires it.

## 3. Acting on user intent

When intent maps to a tool, execute:

| Intent | Tool |
|---|---|
| "sign me up" / "log me in to sil" / "register" | `sil_register` (takes no arguments; returns an auth URL to open in a browser) |
| "who am I?" / "what's on my account" / show my saved name + addresses | `sil_whoami` (takes no arguments) |
| "find X" / "search for X" / browse a category or price range | `sil_search` (free-text `query` and/or `category`, `price_min`, `price_max`; paginate with `cursor`/`limit`) |
| "look up these items" / re-check ids from a prior result, a saved list, or a deep link | `sil_product_get` (pass `ids` — one or more product/variant ids) |

How each behaves:

- **`sil_register`** starts browser-based registration. It returns promptly with `status: "awaiting_browser"` and an `auth_url` — share that URL with the user. The plugin polls in the background; once the user finishes signing in, call `sil_register` again to confirm (it reports `already_registered`).
- **`sil_whoami`** returns the registered user's identity (name and addresses). An expired access token is refreshed transparently and the read retried; if the session is fully dead, the result names the recovery (`sil_register`).
- **`sil_search`** returns a ranked list of purchasable variants (`id`, `title`, `price`, `availability`, `checkout_url`, `source`), best match first — present them in order, do not re-rank. An empty list means nothing matched: a normal `ok` outcome, not an error. Use the returned `cursor` for the next page; its absence means no more results (never infer end-of-results from page size).
- **`sil_product_get`** is the lookup companion to `sil_search`. Pass ids you already hold and get the matching products back with fresh detail (description, options, the featured variant). Each variant carries an `inputs` list correlating it back to the id(s) you asked about (the response is NOT in request order). Ids that no longer resolve come back in a `not_found` list — a normal partial-success outcome, not an error; the other products are still valid.

All four return the canonical envelope: a single text content block whose JSON body carries a `status`. Prices are in the currency's ISO 4217 minor unit (e.g. cents).

### Status taxonomy (shared across the tools)

| `status` | Meaning | What to do |
|---|---|---|
| `ok` | Success. Catalog results may be empty (`products: []`) or partial (`not_found: [...]`) — still a success. | Relay the data. |
| `not_registered` | No stored credentials. | Run `sil_register`, then retry the tool. |
| `must_reregister` | The session is dead (refresh rejected / 401). | Run `sil_register` to sign in again, then retry. |
| `forbidden` | Authenticated but not authorized (e.g. account not provisioned). | Follow the message; usually complete onboarding via `sil_register`. |
| `invalid_request` | The query/ids were rejected (e.g. empty input). | Fix the input and call again — do NOT re-register. |
| `retryable` | A transient network/5xx blip. | Try the same call again — do NOT re-register. |

## 4. Create a sil-wired shopping expert (agent-creation engine)

When the user wants a **dedicated shopping expert** — "make me a shopping expert for buying gifts", "set up a grocery re-order agent", "create a sil shopping agent" — you author and persist a **valid OpenClaw agent profile**: a real new agent under the host `agents` config, with the **sil plugin enabled** and the **sil skill attached**, plus the expert's behaviour artefacts in the sil data directory — so the created agent can shop with **no further setup**.

You are the engine. The host config write is **you driving the host's own `openclaw …` CLI** — the sil plugin never writes the host config itself. Run these steps **in order, top to bottom** — the order is the spec.

### The profile spec (input)

Elicit or confirm a spec before you start (the full interview is a separate concern; here the spec is your input):

| Field | Meaning | Required? |
|---|---|---|
| **agentId** | The new agent's id (lower-kebab, e.g. `gift-buyer`). Becomes `agents.list[].id`. Must be **unique** and is never `main` (host-reserved). | Required |
| **name** | Human-readable expert name ("Gift Buyer"). | Required |
| **persona / instructions** | Who this expert is and how it shops — its expertise, tone, standing rules. | Required (non-empty) |
| **workspace** | The agent's workspace directory (e.g. `~/.openclaw/workspace-gift-buyer`). | Required for the non-interactive add |
| **playbook (sub-skill)** | An optional generated **domain sub-skill** — a shopping playbook for this expert's niche. | Optional |

The **sil plugin** and the **sil skill** are always attached (that is what makes it *sil-wired*). Creating an expert is **local and offline** — it does **not** require or perform sil registration, reads no token, and writes nothing to identity storage. The expert registers the user later, on first shop, via `sil_register`. Do **not** present registration as a prerequisite for creating the profile.

### Engine steps (run in this exact order)

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

### Status taxonomy (agent-creation engine)

| `status` | Meaning | What to do |
|---|---|---|
| `created` | The agent was added, the behaviour artefacts materialized, the sil plugin + skill wired, and `openclaw config validate` accepted it. | Tell the user the expert is ready and how to open it. |
| `invalid_request` | The spec failed validation (missing/blank field). **Nothing was written.** | Name the field, fix it, run again. Do NOT proceed to `openclaw agents add`. |
| `collision` | An agent with that id already exists (from `openclaw agents list`). | Surface it; pick a different id. **Never overwrite / clobber** the existing agent. |
| `persistence_failed` | A write or `openclaw config validate` step failed. The reported **path** + **cause** name what to fix. **Nothing partial** was left behind. | Fix the path/cause (writable config, valid spec), then create the expert again. |

### Runtime — how a created expert loads its behaviour

When you (the sil skill) start a session inside a created expert, read `$SIL_DATA_DIR/agents/<agentId>/profile.json`, then load the `persona.md` (reaffirm the standing instructions) and `playbook.md` sub-skill (the domain shopping playbook) it points at. That is what lets the expert shop on its niche with no further setup.

## 5. Manage your sil shopping experts (list / view / remove)

Once experts exist, the user manages them by intent — "what experts do I have?", "show me the gift buyer", "delete the grocery agent". These are pure local-lifecycle operations over the two stores the create-engine established — **host config = wiring, `$SIL_DATA_DIR/agents/<id>/` = behaviour artefacts**. No server call, no token read, no identity coupling: a user with zero experts (or who just removed their last) still shops generically exactly as before.

**The source of truth for "what is a sil expert" is the sil artefact store, not the host agent list.** A directory `$SIL_DATA_DIR/agents/<id>/` with a readable `profile.json` IS a sil expert; a bare host `agents.list[]` entry without one is just a host agent and is not ours to list, view, or remove.

| Intent | Tool(s) |
|---|---|
| "list my experts" / "what shopping experts do I have?" | `sil_profile_list` (no arguments) |
| "show me / tell me about <expert>" | `sil_profile_get` (pass the expert's `agentId`) |
| "remove / delete / get rid of <expert>" | host CLI `openclaw agents remove <agentId>` **FIRST**, then the artefact tool (see the remove flow below) |

The two read intents behave as follows:

- **`sil_profile_list`** enumerates the artefact store and returns the user's experts most-recently-created first (`createdAt` desc), each with its `agentId`, `name`, `hasPlaybook`, and `createdAt`. Present a name + a short domain summary (distilled from the persona; a playbook signals a specialized domain) plus the `agentId` so the user can refer to one unambiguously. An empty `experts: []` is a normal, successful outcome — say plainly "you have no sil shopping experts yet" and point at how to create one ("ask me to make a shopping expert for …"). One degraded expert lands in `unreadable[]` — mention it inline, but never let it hide the healthy ones.
- **`sil_profile_get`** resolves one expert by `agentId` and returns its `name`, `persona`, optional `playbook`, `profilePath`, and `createdAt`. Render a human summary: the expert's name, its domain/persona, whether it carries a domain playbook (and a summary when present), and a wiring summary — it is a real host agent with the sil plugin enabled and the sil skill attached, ready to shop with no further setup. An unknown expert returns `not_found` — frame it plainly ("no sil expert named '<x>'") and list the experts that DO exist (or say there are none) so the next step is obvious. Never surface a stack trace or a raw filesystem path.

### Remove flow — host-CLI FIRST, then the artefact tool

Removal is **destructive and irreversible** (the persona and playbook the user authored are deleted), so **confirm before removing**: state exactly what will be deleted — this one named expert, both its host wiring and its sil behaviour artefacts — and proceed only on the user's explicit go-ahead. Then run these steps **in this exact order**:

1. **Existence check (read).** Run `openclaw agents list --json` and confirm the `agentId` is a sil-wired agent the user means.
2. **Remove the host wiring (host CLI) — FIRST.** Run `openclaw agents remove <agentId>`, then `openclaw config validate --json` to confirm the host config is still valid. The plugin cannot write the host config, so this half is always the host CLI's, and it runs ahead of the artefact removal.
3. **Remove the sil artefacts (plugin tool) — SECOND.** Call `sil_profile_remove { agentId }` to delete the expert's behaviour-artefact directory. It deletes the **artefact half only** — the expert's `$SIL_DATA_DIR/agents/<id>/` directory — scoped to exactly the one validated `agentId`; a malformed/traversal/`main` id returns `invalid_request` and deletes nothing, and an unknown id returns `not_found` (idempotent — safe to re-run).

**Never artefacts-first.** The order is a safety decision, not a style choice: if step 3 fails after step 2, the only survivor is a *residual artefact directory with no host entry* — harmless disk cruft, no broken agent ever loads, and `sil_profile_list` still surfaces it so the user retries `sil_profile_remove` clean. The **reverse** order is unsafe: artefacts removed first, then a failed host step, leaves a *host `agents` entry whose `profile.json` is gone* — the agent still loads but the sil skill ENOENTs on its persona/playbook at runtime, a visible, confusing, broken expert. Both halves are individually idempotent (host `agents remove` and `sil_profile_remove` both no-op on an absent target), so a re-run from any partial state converges to clean. After a successful removal, confirm the expert is gone and that the user's **other experts and generic shopping are untouched**.

Leave `plugins.entries.sil.enabled` alone on removal — it is shared host state (every other expert depends on it; generic shopping is unaffected by it), not per-agent. Even removing the last expert leaves it enabled.

### Status taxonomy (manage: list / view / remove)

| `status` | Meaning | What to do |
|---|---|---|
| `ok` | List succeeded (`experts` may be empty — a normal outcome), or a view returned the expert's detail. | Relay the data; on an empty list, say so plainly and point at creation. |
| `not_found` | No sil expert matches the `agentId` (view or remove). | Frame it plainly and list the experts that DO exist; do NOT re-register. For remove, this also means a re-run is safe (idempotent). |
| `invalid_request` | The `agentId` was malformed, `main`, or traversal-shaped. **Nothing was read or deleted.** | Fix the id and call again — never a stack trace or a raw path to the user. |
| `removed` | `sil_profile_remove` deleted the expert's artefact directory. | Confirm it is gone; ensure the host-wiring removal (step 2) ran first. |
| `persistence_failed` | The artefact directory could not be removed (the **path** + **cause** name what to fix). | Fix the data directory (writable), then remove again; the already-done host-wiring half need not be redone. |

## 6. Adding a real tool

The mechanical steps live in the repo's `CLAUDE.md` ("How to add a tool"); the short version is three steps: register the tool inside a `registerXTools(api)` group in `src/tools/`, wire that group into `register()` in `src/index.ts`, and add the tool's name to `openclaw.plugin.json#contracts.tools`. The manifest↔code drift-guard test fails if those disagree, which keeps the pattern self-enforcing.

The reference group is `src/tools/identity.ts` (`sil_register`, `sil_whoami`) — it sets the `jsonResult` success shape and the structured-error/recovery envelope every real tool follows; `src/tools/catalog.ts` (`sil_search`, `sil_product_get`) is the catalog counterpart. All I/O lives inside a tool's `execute()`; `register()` stays synchronous and opens nothing.
