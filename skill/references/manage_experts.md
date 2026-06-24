# Manage your sil shopping experts — list, view, remove

Load this when the user wants to see or remove an expert they created — "what experts do I have?", "show me the gift buyer", "delete the grocery agent". The router in `SKILL.md` names which `sil_profile_*` tool each intent maps to; this reference is what those tools do, plus the host-CLI-first ordering and the confirm-before-remove gate.

These are pure local-lifecycle operations over the two stores the create-engine established — **host config + workspace `SOUL.md` = wiring + persona; `$SIL_DATA_DIR/agents/<id>/` = SDS behaviour artefacts**. No server call, no token read, no identity coupling: a user with zero experts still shops generically exactly as before.

**The source of truth for "what is a sil expert" is the sil artefact store, not the host agent list.** A directory `$SIL_DATA_DIR/agents/<id>/` with a readable `profile.json` IS a sil expert; a bare host `agents.list[]` entry without one is just a host agent, not ours to list/view/remove. Always read `profile.json`, **never the host agent list**, to decide what exists.

## Match intent to a tool

| Intent | Tool |
|---|---|
| "list my experts" / "what shopping experts do I have?" | `sil_profile_list` (no arguments) |
| "show me / tell me about &lt;expert&gt;" | `sil_profile_get` (pass the `agentId`) |
| "remove / delete &lt;expert&gt;" | host CLI `openclaw agents remove <agentId>` **FIRST**, then `sil_profile_remove` (see the remove flow) |

## How the two read tools behave

- **`sil_profile_list`** enumerates the artefact store, returning experts most-recently-created first (`createdAt` desc), each with `agentId`, `name`, `createdAt`. Every expert carries all four SDS specs (all required, present from creation), so per-slot presence is not flagged. Present a name + short domain summary + the `agentId` so the user can refer to one unambiguously. An empty `experts: []` is a normal, successful outcome — say "you have no sil shopping experts yet" and point at how to create one. A degraded expert lands in `unreadable[]` — mention it inline, but never let it hide the healthy ones.
- **`sil_profile_get`** resolves one expert by `agentId`, returning its `name`, its four SDS specs (**`domainSpec`** + **`intentSpec`** + **`userSpec`** + **`playbook`**, all present), `profilePath`, and `createdAt`. The persona is **not** here — it is the host workspace `SOUL.md`. Render a human summary: the name, the niche (from the domain spec), what it knows about the user (user-spec facts + buying taste), and a wiring summary (a real host agent, sil plugin enabled, sil skill attached, ready with no further setup). An unknown expert returns `not_found` — frame it plainly ("no sil expert named '<x>'") and list the experts that DO exist. **Never surface a stack trace or a raw filesystem path.**

## Remove flow — host-CLI FIRST, then the artefact tool

Removal is **destructive and irreversible** (the expert's SDS artefacts, host wiring, and `SOUL.md` are deleted), so **confirm before removing**: state exactly what will be deleted — this one named expert, both its host wiring and its sil behaviour artefacts — and proceed only on the user's **explicit go-ahead**. Then run these steps **in this exact order**:

1. **Existence check (read).** Run `openclaw agents list --json` and confirm the `agentId` is a sil-wired agent the user means.
2. **Remove the host wiring (host CLI) — FIRST.** Run `openclaw agents remove <agentId>`, then `openclaw config validate --json` to confirm the host config is still valid. The plugin cannot write the host config, so this half is the host CLI's and runs ahead of the artefact removal.
3. **Remove the sil artefacts (plugin tool) — SECOND.** Call `sil_profile_remove { agentId }` to delete the expert's behaviour-artefact directory — the **artefact half only** (`$SIL_DATA_DIR/agents/<id>/`), scoped to exactly the one validated `agentId`. A malformed/traversal/`main` id returns `invalid_request` and deletes nothing; an unknown id returns `not_found` (idempotent — safe to re-run).

**Never artefacts-first.** The order is a safety decision: if step 3 fails after step 2, the only survivor is a *residual artefact directory with no host entry* — harmless disk cruft that `sil_profile_list` still surfaces, so the user retries `sil_profile_remove` clean. The **reverse** order is unsafe — artefacts gone, then a failed host step, leaves a *host entry whose `profile.json` is gone*: the agent still loads but the sil skill ENOENTs on its SDS specs at runtime, a visibly broken expert. Both halves are individually idempotent, so a re-run from any partial state converges to clean. After removal, confirm the expert is gone and the user's **other experts and generic shopping are untouched**.

Leave `plugins.entries.sil.enabled` alone on removal — it is shared host state (every other expert depends on it), not per-agent. Even removing the last expert leaves it enabled.

## Status taxonomy (manage: list / view / remove)

| `status` | Meaning | What to do |
|---|---|---|
| `ok` | List succeeded (`experts` may be empty — normal), or a view returned the expert's detail. | Relay the data; on an empty list, say so plainly and point at creation. |
| `not_found` | No sil expert matches the `agentId` (view or remove). | Frame it plainly and list the experts that DO exist; do NOT re-register. For remove, a re-run is safe (idempotent). |
| `invalid_request` | The `agentId` was malformed, `main`, or traversal-shaped. **Nothing was read or deleted.** | Fix the id and call again — never a stack trace or raw path to the user. |
| `removed` | `sil_profile_remove` deleted the expert's artefact directory. | Confirm it is gone; ensure the host-wiring removal (step 2) ran first. |
| `persistence_failed` | The artefact directory could not be removed (the **path** + **cause** name what to fix). | Fix the data directory (writable), then remove again; the host-wiring half need not be redone. |
