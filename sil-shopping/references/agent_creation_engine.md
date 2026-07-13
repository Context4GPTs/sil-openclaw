---
name: agent-creation-engine
description: The ordered, one-command engine that persists the single sil-wired shopper after the user endorses the assembled draft. Load only after explicit endorsement in the interview.
---

# Create your sil-wired shopper — the agent-creation engine

**Precondition: run this ONLY after the user has explicitly endorsed the assembled draft
from [`brainstorm_interview.md`](brainstorm_interview.md).** The interview owns that gate.

This persists **one** valid OpenClaw agent — the user's **shopper**: a real agent under
the host `agents` config, sil plugin enabled, sil skill attached, its persona in the
workspace **`SOUL.md`**, plus the **shared user spec** in the sil data dir — so it shops
with **no further setup**. The shopper is a **singleton**: created once, then it learns
**domains** lazily on first shop, so a fresh shopper has an **empty `domains` map** —
healthy. Creation is **local and offline**: no token is read, no `sil_register` /
`sil_whoami`, no network call. The shopper registers the user later, on first shop.

## The one command

After the endorsement, run exactly **one** shipped command — the package bin
**`sil-openclaw-create-shopper`** — and it runs the whole choreography **atomically** and
**fail-closed**, then returns one structured JSON result. You do **not** hand-run the
host-CLI steps; the bin runs them **for you, in order, as one transaction**. Feed it the
endorsed spec as one JSON object on **`stdin`** (or via **`--spec <path>`**):

```
sil-openclaw-create-shopper <<'JSON'
{ "agentId": "my-shopper", "name": "My Shopper",
  "workspace": "~/.openclaw/workspace-my-shopper",
  "persona": "…the endorsed persona…", "userSpec": "…the seeded shared user spec…",
  "channel": "telegram" }
JSON
```

The bin is **non-interactive**: it executes an **already-assembled, already-endorsed**
spec — it **never re-runs the interview** and never prompts. The sil **plugin** and sil
**skill** are always wired — that is what makes it *sil-wired*. It is a standalone
operator script, **not** the plugin process, so the plugin's "never write host config"
guarantee holds; the bin legitimately drives `openclaw …` on your behalf.

## The spec (input)

| Field | Meaning | Goes to | Required? |
|---|---|---|---|
| **agentId** | Lower-kebab id → `agents.list[].id`. Unique, never `main`. | host | Required |
| **name** | Human-readable name ("My Shopper"). | sil manifest | Required |
| **persona** | Who the shopper is / how it shops — a generalist, voice, standing rules. | host **`SOUL.md`** (no separate persona file) | Required |
| **workspace** | The shopper's workspace directory. | host | Required |
| **userSpec** | The user's **shared, cross-niche** facts + hard constraints. Seeded partial by the interview. | sil `user_spec.md` | **Required** |
| **channel** | The channel the setup conversation is on — bound to the new shopper. | host `openclaw.json` bindings | **Optional (fail-open)** |

There is **no per-niche input at create** — no method and no PRD; those are minted lazily
on first shop via `sil_learn create`. The shopper reaches the web to mint and refresh
domains, so the agent needs web/fetch tools (inherited from `agents.defaults`); if
defaults grant none, the bin reports `created` with a `warnings` entry naming the gap
(bare `sil_search` still works) — surface it.

## What the bin does atomically (in this exact order)

1. **Validate the spec FIRST** — `agentId` (present, lower-kebab, ≠ `main`), `name`,
   `persona`, `workspace`, and the shared **`userSpec`** (present, non-blank — the only
   sil artefact at create). No per-domain method or PRD to validate. Any failure stops with
   **`invalid_request`** naming the field and **writes nothing**, ahead of every host
   command.
2. **Singleton check.** Run `openclaw agents list --json` and read the sil store (whether a
   shopper `user_spec.md` already exists) **before** the add. If a sil shopper already
   exists, stop with **`collision`** — **"a shopper already exists"** — and do **not** run
   `openclaw agents add`; steer to shop-a-new-niche (lazy mint) or refine — **never mint a
   second shopper**. An `agentId` clashing with any existing agent is likewise
   `collision`. An inconclusive read fails closed.
3. **Create the agent shell.** `openclaw agents add <agentId> --workspace <workspace>
   --non-interactive --json` — the real `agents.list[]` entry + workspace bootstrap
   (`SOUL.md`, `AGENTS.md`, …), inheriting model and tool profile from `agents.defaults`.
4. **Write the persona straight into the workspace `SOUL.md`** (host CLI). The persona is
   the shopper's soul — the host's `SOUL.md`, not a sil artefact. There is **no separate
   persona file** and **no copy** step.
5. **Materialize the shared user spec — SETUP-ONLY, NO `domain`.** Call
   `sil_profile_materialize { name, userSpec }` (the singleton takes no `agentId`). It is
   **setup-only**: it writes the shared **`user_spec.md`** into `$SIL_DATA_DIR/shopper/`,
   atomically, with the shopper **name in its frontmatter** — there is **no manifest**, and
   it mints **no method or PRD**. Those are minted lazily on first shop via
   `sil_learn create`.
6. **Wire the sil skill + plugin** (host CLI). Asserted against the pinned host
   **`alpine/openclaw:2026.6.9`**, both value-mode sets with `--strict-json` (the only set
   mode this image accepts):
   ```
   openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json
   openclaw config set plugins.entries.sil.enabled true --strict-json
   ```
   The skill **attach** makes the agent know how to drive the tools; the plugin **enable**
   turns sil on — but does not un-filter the tools by itself (next step).
7. **Admit sil at the host allow surfaces.** Until sil is admitted at `plugins.allow` +
   **`tools.alsoAllow`**, the host keeps the `sil_*` tools filtered. The value-mode `config
   set` above is overwrite-only, so it cannot additively merge those shared arrays without
   clobbering another admitted plugin (e.g. `klodi`). The bin runs the shipped admission
   helper — the sibling bin `sil-openclaw-allowlist` (the `openclaw:allowlist` script) —
   the additive, idempotent, self-validating three-surface merge. **If the helper exits
   non-zero (a failed admission), the bin reports `persistence_failed` with the path +
   cause and does NOT declare `created`** — never a green `created` over filtered tools.
8. **Bind the current channel — FAIL-OPEN.** Resolve the channel (`spec.channel`, else the
   host's `OPENCLAW_MCP_MESSAGE_CHANNEL`) and, if one resolves, run `openclaw agents bind
   --agent <agentId> --bind <channel> --json`, then **verify** the route stuck (read-back +
   `openclaw config validate` still passes). If undetermined, owned by another agent (no
   `--force`), or unverifiable, revert any partial route and degrade to a manual-bind hint
   in `warnings` — this step **never fails creation**.
9. **Validate with the host's own check, THEN declare created.** `openclaw config validate
   --json` returns `{ valid, path, issues? }` — success keys off **`.valid`**, never an
   `ok` field. Only when `valid: true` **and** admission (step 7) succeeded does it report
   **`created`**, carrying `boundChannel` (or `null`). Otherwise it reports
   **`persistence_failed`** with the failing **path** + **cause**.
10. **On any failure after writes begin, tear down** — restore the pre-run `openclaw.json`
    snapshot (reversing the agent entry + skill + plugin + admission + any channel
    binding), remove the workspace dir (only if it created it) and the singleton shopper
    dir (only if it did not pre-exist). `persistence_failed` truthfully means **nothing
    partial** is left. In the rare case teardown cannot fully revert, the bin reports a
    distinct, louder outcome that **names the residue** — never voiced as "nothing partial".

The bin emits **one** `{ status, … }` result and exits 0 **only** on `created`.

## Status taxonomy

| `status` | Meaning | What to do |
|---|---|---|
| `created` | Shopper added, shared user spec materialized, plugin + skill wired, `openclaw config validate` accepted it. Carries `name` + `agentId` + `workspace` + `boundChannel` (or `null`). | Tell the user it's ready; if `boundChannel` is `null`, relay the manual-bind hint. |
| `invalid_request` | Spec failed validation. **Nothing attempted.** | Name the field, fix it, run again. |
| `collision` | A shopper already exists (the singleton), or the `agentId` clashes. **Nothing written.** | Surface "a shopper already exists"; steer to shop-a-new-niche or refine. **Never a second shopper.** |
| `persistence_failed` | A write, the allow-list helper (non-zero exit), or `openclaw config validate` failed. Teardown ran — **nothing partial** left. | Fix the reported path/cause and re-run (safe). |

## Runtime — how the shopper loads its behaviour

When you (the sil skill) start a session as the shopper, the host has already injected the
persona via **`SOUL.md`**. Load the shared **`user_spec.md`** (cross-niche facts + hard
constraints, reused across every niche); its frontmatter carries the shopper **name**, and
`sil_profile_search` scans the domains it has learned — an empty set is healthy, and each
per-domain method loads **lazily at shop time**. Because the `sil_*` tools were admitted at
create, the shopper calls **`sil_search`** / **`sil_product_get`** (and `sil_register` /
`sil_whoami` as needed) with **no further setup**, minting each niche on the fly the first
time the user shops it, per [`shop_loop.md`](shop_loop.md). To sharpen the shopper or a
domain, see [`fill_and_feedback.md`](fill_and_feedback.md).
