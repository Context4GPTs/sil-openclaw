---
name: manage-domains
description: View or forget the shopper's learned domains — the two sil_profile tools, the two remove granularities, confirm-before-remove. Load when the user wants to see what the shopper knows or forget a niche.
---

# Manage your shopper's domains — view, forget

Load this when the user wants to see what their **shopper** knows or **forget a domain**
(a niche) — "what does my shopper know?", "which domains has it learned?", "show me the
cycling domain", "forget the grocery niche". The router names which `sil_profile_*` tool
each intent maps to; this reference is what those tools do, plus the **two remove
granularities** and the confirm-before-remove gate.

These are pure local-lifecycle operations — no server call, no token read. The shopper is
a **singleton** scoped to the fixed `$SIL_DATA_DIR/shopper/` path, so these tools take
**no caller `agentId`** — only an optional `domainSlug`. **The source of truth is the sil
artefact store, not the host agent list:** `$SIL_DATA_DIR/shopper/` with a readable
`profile.json` IS the shopper; its `domains` map is the niche index. Always read
`profile.json`, **never the host agent list**, to decide what exists.

## Match intent to a tool

| Intent | Tool |
|---|---|
| "what does my shopper know?" / "which domains has it learned?" (overview) | `sil_profile_get` (no `domainSlug`) |
| "show me / tell me about the &lt;niche&gt; domain" | `sil_profile_get` (pass the `domainSlug`) |
| "forget / remove / delete the &lt;niche&gt; domain" | `sil_profile_remove` (pass the `domainSlug`) |
| "decommission / tear down my whole shopper" | host CLI `openclaw agents remove <agentId>` **FIRST**, then clear the artefact tree |

## How `sil_profile_get` reads the singleton shopper

- **No `domainSlug` (overview):** returns the `name`, the shared `userSpec` (cross-niche
  facts + hard constraints), the **`domains` index** (each niche's `slug`/`name`/
  timestamps — no bodies), plus any degraded directory in **`unreadable`**. A shopper
  with **no domains yet still reads `ok`, empty index — healthy** (the first shop mints
  one); so does an empty store ("you haven't set up a shopper yet" → point at create —
  still `ok`, never `not_found`). Render a human summary (shopper, what it knows, domains
  learned, wiring); a flat-layout leftover from the old one-agent-per-niche model reads
  as `unreadable` — frame it as an old-model leftover, do not read it as a domain.
- **With a `domainSlug`:** returns that niche's pack (`domainSpec` + `intentSpec` +
  `playbook`) plus the shared `userSpec`. An unminted/unloadable domain returns
  `not_found` (its `recovery` is the no-args `sil_profile_get`) — frame it plainly and
  list what DOES exist. **Never surface a stack trace or a raw filesystem path.**

## The two remove granularities

Removal is **destructive and irreversible**, so **confirm before removing**: state
exactly what will be deleted and proceed only on the user's **explicit go-ahead**. When
ambiguous, ask.

**Forget ONE domain (`sil_profile_remove`).** "forget the grocery niche", "remove the
cycling domain", **"delete the grocery agent"** all mean **forget that one DOMAIN** — the
niche pack only. The shopper, the shared user spec, and every **sibling domain survive**;
no host wiring is touched. Call **`sil_profile_remove { domainSlug }`** — `domainSlug` is
**REQUIRED**. A malformed/traversal/`main`/missing slug returns `invalid_request` and
deletes nothing; an unregistered slug returns `not_found` (idempotent); a filesystem
failure returns `persistence_failed`.

**Decommission the WHOLE shopper (host-CLI-first).** Remove the entire shopper — host
wiring + `SOUL.md` + the whole artefact tree: (1) `openclaw agents list --json` to
confirm the `agentId`; (2) `openclaw agents remove <agentId>` then `openclaw config
validate --json` — the plugin cannot write host config, so this half runs **first**; (3)
clear the whole `$SIL_DATA_DIR/shopper/` tree. Host-first is a safety order: a failed
artefact step after the host removal leaves only harmless residual artefacts, whereas the
reverse leaves a host entry whose `profile.json` is gone — a visibly broken shopper. Both
halves are idempotent. Leave `plugins.entries.sil.enabled` alone — it is shared host
state for a future re-create.

## Status taxonomy (manage: view / remove)

| `status` | Meaning | What to do |
|---|---|---|
| `ok` | A view returned the overview (a `domains` map may be empty — normal; an absent shopper is still `ok`) or one domain's detail. | Relay the data; on an empty index, point at "just shop a niche". |
| `not_found` | No domain matches the `domainSlug`. Its `recovery` is the no-args `sil_profile_get`. | Frame it plainly and list what DOES exist; for remove, a re-run is safe. |
| `invalid_request` | The `domainSlug` was malformed, `main`, traversal-shaped, or (remove) missing. **Nothing read or deleted.** | Fix the slug and call again — never a stack trace or raw path. |
| `removed` | `sil_profile_remove` deleted exactly one domain pack. | Confirm that niche is gone; the shopper + shared user spec + sibling domains are untouched. |
| `persistence_failed` | The domain directory could not be removed (the **path** + **cause** name what to fix). | Fix the data directory (writable), then remove again. |
