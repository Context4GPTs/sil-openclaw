---
name: agent-creation-engine
description: The one-command engine that persists the single sil-wired shopper after the user endorses the draft. Load only after explicit endorsement in the interview.
---

# Create your sil-wired shopper — the agent-creation engine

**Run ONLY after the user explicitly endorses the draft** from
[`brainstorm_interview.md`](brainstorm_interview.md) — that reference owns the gate.

Persists **one** OpenClaw agent — the **shopper**: a host `agents` entry, sil plugin enabled
+ skill attached, persona in the workspace **`SOUL.md`**, the **shared user spec** in the sil
data dir. A **singleton** that learns **domains** lazily on first shop — a fresh shopper's
`domains` map is empty, which is healthy. Creation is **local + offline**: no token, no
`sil_register`/`sil_whoami`, no network — it registers the user later, on first shop.

## The one command

Run one shipped bin — **`sil-openclaw-create-shopper`** — **non-interactive**, **atomic**,
**fail-closed**; it emits one JSON result. It is a standalone operator script, not the plugin
process, so the plugin's "never write host config" guarantee holds. Feed the endorsed spec as
one JSON object on **`stdin`** (or `--spec <path>`):

```
sil-openclaw-create-shopper <<'JSON'
{ "agentId": "my-shopper", "name": "My Shopper",
  "workspace": "~/.openclaw/workspace-my-shopper",
  "persona": "…endorsed persona…", "userSpec": "…seeded shared user spec…",
  "channel": "telegram" }
JSON
```

## The spec (input)

| Field | Meaning | Goes to | Required? |
|---|---|---|---|
| **agentId** | Lower-kebab (`^[a-z0-9][a-z0-9-]*$`), never `main`. | host | yes |
| **name** | Human-readable name. | sil store | yes |
| **persona** | Who the shopper is — a generalist, its voice, standing rules. | host **`SOUL.md`** | yes |
| **workspace** | The shopper's workspace directory. | host | yes |
| **userSpec** | Shared **cross-niche** facts + hard constraints (seeded partial). | sil `user_spec.md` | yes |
| **channel** | Setup conversation's channel, bound to the shopper. | host bindings | optional (fail-open) |

**No per-niche input at create** — no method, no PRD; those mint lazily on first shop via
`sil_learn create`. The shopper needs web tools (inherited from `agents.defaults`) to
mint/refresh domains; if defaults grant none, the bin reports `created` with a `warnings` gap
(bare `sil_search` still works) — surface it.

## What the bin does, in order (atomic, fail-closed)

1. **Validate first** — bad/blank `agentId` (lower-kebab, ≠ `main`), `name`, `persona`,
   `workspace`, or `userSpec` → **`invalid_request`** naming the field; **nothing written**.
2. **Config + singleton pre-flight** — no host config → `persistence_failed`. An existing
   shopper `user_spec.md`, or an `agentId` clash → **`collision`** ("a shopper already
   exists"); steer to shop-a-new-niche or refine, **never a second shopper**. An inconclusive
   read fails closed.
3. **Snapshot `openclaw.json`** — the teardown anchor, before any write.
4. **`openclaw agents add`** — the real `agents.list[]` entry + workspace bootstrap,
   inheriting model + tools from `agents.defaults`.
5. **Write `SOUL.md`** = endorsed **persona + a standing "Shopping with sil" rules block**
   (below).
6. **Materialize the shared user spec** — `sil_profile_materialize { name, userSpec }`
   (singleton, no agentId) writes **`user_spec.md`** atomically, name in its frontmatter.
   **Setup-only: no domain, no method, no PRD.**
7. **Attach skill + enable plugin + harden tools** (value-mode `config set --strict-json`,
   the only mode the pinned `alpine/openclaw:2026.6.9` accepts): `agents.list[<idx>].skills` ←
   `["sil"]`; `plugins.entries.sil.enabled` ← `true`; **`agents.list[<idx>].tools.deny`** ←
   **`["exec","write","edit","apply_patch"]`** — a per-agent **deny-list** removing the shell
   (`exec`) + filesystem mutators while **keeping the sil tools + web**. A deny (not replacing
   the base tool set) is used because per OpenClaw precedence it only *further-restricts* and
   can never strip the sil grant.
8. **Admit sil (plugin trust)** — the shipped **`sil-openclaw-allowlist`** helper additively
   merges the three trust surfaces (`plugins.allow` + `tools.alsoAllow` + `plugins.entries.sil`)
   — the only way to un-filter `sil_*` without clobbering a co-installed plugin. A non-zero
   exit → **`persistence_failed`** (never a green `created` over filtered tools).
9. **Bind the channel — FAIL-OPEN** — resolve (`spec.channel`, else
   `OPENCLAW_MCP_MESSAGE_CHANNEL`), bind, **verify** the route stuck. Undetermined / owned /
   unverifiable → revert + a manual-bind hint in `warnings`. Never fails creation.
10. **Validate then declare** — `config validate --json` keys off **`.valid`**. Only
    `valid: true` **and** step 8 ok → **`created`** (with `boundChannel`, or `null`). Any
    failure **after step 4** tears down (restore the snapshot; remove the workspace + shopper
    dir only if it created them), so `persistence_failed` means **nothing partial**. If
    teardown cannot fully revert, a louder **`teardown_failed`** names the residue.

Exit 0 **only** on `created`.

### The `SOUL.md` rules block

The persona is followed by a standing **"Shopping with sil"** block — an identity-level
restatement (not just the skill) that the shopper: shops through the **sil tools**; **mints
an unlearned niche first** (a `sil_profile_search` MISS → `sil_learn create`, then search);
**never answers a buy-intent from the open web** (web is only for a niche's buying guide while
minting); **persists only through `sil_learn`**, never to host files.

## Status taxonomy

| `status` | Meaning | Do |
|---|---|---|
| `created` | Shopper added, spec materialized, plugin + skill + hardening wired, config valid. Carries `name`/`agentId`/`workspace`/`boundChannel` (or `null`). | Tell the user; if `boundChannel` null, relay the manual-bind hint. |
| `invalid_request` | Spec failed validation. Nothing attempted. | Name the field, fix, re-run. |
| `collision` | A shopper (singleton) or `agentId` already exists. Nothing written. | Steer to shop-a-new-niche or refine — never a second shopper. |
| `persistence_failed` | A write, the allow-list helper, or `config validate` failed; teardown fully reverted. | Fix the path/cause, re-run (safe). |
| `teardown_failed` | Teardown could NOT fully revert. | Louder — names the residue; the host is not at its pre-run state. |

## Runtime

At session start the host has injected the persona via **`SOUL.md`**. Load the shared
**`user_spec.md`** (cross-niche facts + hard constraints; frontmatter carries the name);
`sil_profile_search` scans the learned domains (empty is healthy) and each per-domain method
loads **lazily at shop time**. The `sil_*` tools admitted at create, the shopper shops with no
further setup, minting each niche on the fly on first shop
([`shop_loop.md`](shop_loop.md)). To sharpen it, see
[`fill_and_feedback.md`](fill_and_feedback.md).
</content>
