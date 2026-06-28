# Manage your shopper's domains — list, view, forget

Load this when the user wants to see what their **shopper** knows or **forget a domain** (a niche) — "what does my shopper know?", "which domains has it learned?", "show me the cycling domain", "forget the grocery niche". The router in `SKILL.md` names which `sil_profile_*` tool each intent maps to; this reference is what those tools do, plus the **two remove granularities** and the confirm-before-remove gate.

These are pure local-lifecycle operations over the two stores the create-engine established — **host config + workspace `SOUL.md` = wiring + persona; `$SIL_DATA_DIR/agents/<id>/` = the shared user spec + per-domain packs**. No server call, no token read, no identity coupling: a shopper with zero domains still shops generically exactly as before — the first shop in a niche mints it.

**The source of truth for "what the shopper knows" is the sil artefact store, not the host agent list.** A directory `$SIL_DATA_DIR/agents/<id>/` with a readable `profile.json` IS the shopper; its `domains` map is the niche index. A bare host `agents.list[]` entry without a `profile.json` is just a host agent, not ours to list/view/forget. Always read `profile.json`, **never the host agent list**, to decide what exists.

## Match intent to a tool

| Intent | Tool |
|---|---|
| "what does my shopper know?" / "which domains has it learned?" / "list my domains" | `sil_profile_list` (no arguments) |
| "show me the shopper" / "what do you know about me?" (overview) | `sil_profile_get` (pass the `agentId`, no `domainSlug`) |
| "show me / tell me about the &lt;niche&gt; domain" | `sil_profile_get` (pass the `agentId` **and** the `domainSlug`) |
| "forget / remove / delete the &lt;niche&gt; domain" | `sil_profile_remove` (pass the `agentId` **and** the `domainSlug`) |
| "decommission / tear down my whole shopper" | host CLI `openclaw agents remove <agentId>` **FIRST**, then clear the artefact tree (see the two granularities) |

## How the read tools behave

- **`sil_profile_list`** enumerates the artefact store, returning each **shopper** with its `agentId`, `name`, `createdAt`, and its **`domains`** index (each niche's `slug`, `name`, `createdAt`, `updatedAt`). A shopper **with no domains yet still lists, with an empty domain list — that is healthy, not an error** (the first shop in a niche mints it); so is an empty store ("you haven't set up a shopper yet" → point at create). Present the shopper plus a short list of the domains it has learned so the user can refer to one by niche. A degraded/legacy directory lands in `unreadable[]` — mention it inline, but never let it hide the healthy domains. (A flat-layout directory left over from the retired one-agent-per-niche model reads as `unreadable` — frame it as an **old-model leftover** and steer the user to re-create their shopper; do not try to list it as a domain.)
- **`sil_profile_get`** resolves the shopper by `agentId`, in two modes:
  - **No `domainSlug` (overview):** returns the shopper's `name`, the **shared `userSpec`** (the person's cross-niche facts + hard constraints), and the **`domains` index** (no per-domain bodies). Render a human summary: the shopper, what it knows about the user (shared facts + hard constraints), the domains it has learned, and a wiring summary (a real host agent, sil plugin enabled, sil skill attached, ready with no further setup). An empty domain index is healthy — say so and point at "just start shopping a niche".
  - **With a `domainSlug` (one domain):** returns that niche's pack — `domainSpec` + `intentSpec` + `playbook` (the niche buying taste) **plus** the shared `userSpec`. Render the niche (from the domain spec), its decomposition dimensions, and the buying taste learned for it.
  - An unknown shopper or an unminted/unloadable domain returns `not_found` (its `recovery` is `sil_profile_list`) — frame it plainly ("no `<slug>` domain — here's what the shopper has learned") and list what DOES exist. **Never surface a stack trace or a raw filesystem path.**

## The two remove granularities — forget a domain vs decommission the shopper

Removal is **destructive and irreversible**, so **confirm before removing**: state exactly what will be deleted and proceed only on the user's **explicit go-ahead**. There are **two distinct granularities** — pick the one the user means, and when ambiguous, ask:

### Forget ONE domain (the common case — `sil_profile_remove`)

"forget the grocery niche", "remove the cycling domain", **"delete the grocery agent"** now mean **forget that one DOMAIN** — the niche pack only. The shopper, the **shared user spec**, and **every other domain survive**. This is the **artefact half only**, scoped to one niche; **no host wiring is touched** (the shopper agent stays):

- Call **`sil_profile_remove { agentId, domainSlug }`** — `domainSlug` is **REQUIRED** (it never deletes the whole shopper). It removes exactly the one `domains/<slug>/` leaf and de-registers it from the manifest. A malformed/traversal/`main`/missing slug returns `invalid_request` and deletes nothing; an unregistered slug returns `not_found` (idempotent — safe to re-run); a filesystem failure returns `persistence_failed`.
- After it, confirm the domain is gone and the shopper, the shared user spec, and its **other domains are untouched**.

### Decommission the WHOLE shopper (the host-CLI-first path)

"tear down my shopper", "decommission the whole thing" means remove the **entire shopper** — host wiring + `SOUL.md` + the whole artefact tree. This is the **host-CLI-first** flow, for the **whole agent** (not a single niche):

1. **Existence check (read).** Run `openclaw agents list --json` and confirm the `agentId` is the sil-wired shopper.
2. **Remove the host wiring (host CLI) — FIRST.** Run `openclaw agents remove <agentId>`, then `openclaw config validate --json` to confirm the host config is still valid. The plugin cannot write the host config, so this half is the host CLI's and runs ahead of the artefact removal.
3. **Remove the sil artefacts — SECOND.** Clear the shopper's whole `$SIL_DATA_DIR/agents/<id>/` tree (the shared user spec + every domain pack). `sil_profile_remove` is **per-domain** by design (its `domainSlug` is required), so decommissioning the shopper's full tree is the host-side concern, not a single tool call — remove each domain, or clear the agent directory as part of the host teardown.

**Never artefacts-first for the whole-shopper path.** The order is a safety decision: a failed artefact step after the host removal leaves only *residual artefacts with no host entry* — harmless disk cruft `sil_profile_list` still surfaces, so the user retries clean. The **reverse** is unsafe — artefacts gone, then a failed host step, leaves a *host entry whose `profile.json` is gone*: the agent still loads but the sil skill ENOENTs at runtime, a visibly broken shopper. Both halves are individually idempotent, so a re-run from any partial state converges to clean.

Leave `plugins.entries.sil.enabled` alone on any removal — it is shared host state (the shopper depends on it), not per-domain. Even decommissioning the shopper leaves it enabled for a future re-create.

## Status taxonomy (manage: list / view / remove)

| `status` | Meaning | What to do |
|---|---|---|
| `ok` | List succeeded (a shopper's `domains` may be empty — normal), or a view returned the overview or one domain's detail. | Relay the data; on an empty domain index, say so plainly and point at "just shop a niche". |
| `not_found` | No shopper matches the `agentId`, or no domain matches the `domainSlug` (view or remove). Its `recovery` is `sil_profile_list`. | Frame it plainly and list what DOES exist; do NOT re-register. For remove, a re-run is safe (idempotent). |
| `invalid_request` | The `agentId` or `domainSlug` was malformed, `main`, traversal-shaped, or (remove) missing. **Nothing was read or deleted.** | Fix the id/slug and call again — never a stack trace or raw path to the user. |
| `removed` | `sil_profile_remove` deleted exactly one domain pack. | Confirm that niche is gone; the shopper + shared user spec + sibling domains are untouched. |
| `persistence_failed` | The domain directory could not be removed (the **path** + **cause** name what to fix). | Fix the data directory (writable), then remove again. |
