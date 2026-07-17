---
name: agent-creation-engine
description: Create the single sil-wired shopper end to end — the two-touchpoint onboarding interview (persona + shared user-spec seed, endorsement-gated) then the one-command engine that persists it. Load when the user asks to create or set up their sil shopper.
---

# Create the shopper

Two parts, in order: an **onboarding interview** that shapes the shopper *with* the
user, then the **engine** that persists it. Nothing is created until the user
**explicitly endorses** the draft — the gate lives in Part 1 and the engine refuses
to run before it.

---

## Part 1 — The onboarding interview

When the user asks to **set up shopping** ("create my shopper"), do **not** jump to
the engine. Run a short, **two-touchpoint** onboarding — **pre-seeded from what they
already said this session** — and create nothing until they endorse the draft.

This is a **conversation, not a form-fill**. The shopper is a **generalist**: it goes
deep on whatever the user later buys, **lazily minting a domain on first shop**.
Onboarding researches **no niche** and picks **none** — it touches exactly two things:
the **persona** and a **shared user-spec seed**.

### Open with a reflected draft

Before asking anything, **pre-seed** from what the user said *this session* — the
persona (how it should behave) and the user-spec seed (sizes, hard limits, ethics
rules mentioned in passing) — then **reflect it back** ("from what you've told me,
here's the shopper I'd set up…") and ask only to confirm-or-adjust.

- **Pre-fill, don't interrogate** — fill only genuine gaps. Little said? Seed a
  **minimal honest** draft ("facts to be learned as we shop; no hard constraints
  yet") and say so — never fabricate a size or limit.
- **Session-only, local + offline** — no token, no `sil_whoami`, no network.
- **The pre-fill is a proposal, never consent** — the endorsement gate stands.

### The two touchpoints

| Artefact | Where | Holds |
|---|---|---|
| **`SOUL.md`** (persona) | host workspace | the shopper's voice / standing rules — a **generalist** |
| **`user_spec.md`** (shared) | sil data dir (**required**) | **cross-niche** facts + hard constraints (addresses, sizes, allergy/ethics rules, budget psychology) |

The niche packs — deep know-how, per-request template, niche taste — are **not
authored here**; they mint **lazily on first shop** ([`shop_loop.md`](shop_loop.md)).

1. **Persona** — confirm-or-adjust the seeded **voice/tone** and any **standing
   rules**. This surfaces voice, **not a niche**. Becomes the workspace **`SOUL.md`**.
2. **Shared user spec** — pre-fill the **cross-niche** facts and any **hard
   constraints** holding in *every* niche (addresses/sizes, an allergy or ethics rule,
   budget psychology). Reflect back; mark each **hard** (inviolable) vs **soft**
   (bendable). Seed what's offered; the rest is augmented per-query at shop time.
   Lands in `userSpec`. **No niche taste, no domain question, no intent dimensions
   here.**

### Assemble + endorse — the gate

- **Identity** — confirm ONE friendly display `name`. There is **no `agentId` to invent**:
  the engine derives it from `name` (lower-kebab; a `main`/empty slug silently falls back
  to `sil-shopper`), so identity is just the name.
- **Assemble** — compose **`{ name, persona, userSpec }`**, present a readable summary,
  self-check the shape (non-blank `name`/`persona`/`userSpec`). Writes nothing — the
  engine's validate-first step is the authoritative gate.
- **Endorse** — ask for an explicit go-ahead. Endorsement is an affirmative act
  ("yes, create it") — **not** inferred from the last answer or from silence. **Only on
  that explicit yes** do you run Part 2.

### Interview invariants

- **No creation without explicit endorsement** — zero engine steps before the "yes";
  the draft lives only in the conversation, so an abandoned interview leaves no partial
  shopper.
- **Two touchpoints only** — persona, then shared user spec, both session-seeded. No
  niche researched or chosen; that is first-shop lazy mint.
- **Converge each touchpoint before advancing; stay re-entrant** — the user can revise
  earlier.
- **Singleton** — if a shopper exists the engine refuses (its `collision`); surface it,
  steer to shop-a-new-niche or refine, never clobber the existing.
- **Local + offline for identity** — never present registration or a token as a
  prerequisite, never pull `sil_whoami` to seed.

---

## Part 2 — The creation engine

**Run ONLY after the endorsement gate above clears.** The engine persists **one**
OpenClaw agent — the **shopper**: a host `agents` entry, sil plugin enabled + skill
attached, persona in the workspace **`SOUL.md`**, the **shared user spec** in the sil
data dir. A **singleton** that learns **domains** lazily on first shop — a fresh
shopper's `domains` map is empty, which is healthy. Creation is **local + offline**: no
token, no `sil_register`/`sil_whoami`, no network — it registers the user later, on
first shop.

### The one command

Run one shipped script — **non-interactive**, **atomic**, **fail-closed**; it emits one
JSON result. It is a standalone operator script, not the plugin process, so the plugin's
"never write host config" guarantee holds.

**Get its path from `sil_doctor` — never guess it, and never derive it from this file's
own location.** Call `sil_doctor` and read the report's top-level **`creationEntrypoint`**:
an absolute path, reported every run. It is the only sound source. This file is published
to you as a *symlink*, so a `../scripts/…` hop off this directory does not resolve for
`node` even though `cat` and `ls` say it does; and the bare bin name is on PATH only for
some installs. Both dead-end at this exact step.

Feed the endorsed spec as a **file**, not a heredoc — shell quoting must never touch
model-authored prose (apostrophes, quotes, backticks, `$`, newlines are the norm in a
persona). Write it **0600 under a private dir**, run, then **remove it**: the spec carries
the user's `userSpec` (address, sizes, allergy/ethics rules), so it must not linger
world-readable. The script never deletes an input it does not own — that is yours.

```
# 1. sil_doctor → creationEntrypoint (absolute path to the creation script)
# 2. write the endorsed spec, owner-only, in a private dir:
umask 077 && mkdir -p ~/.sil-tmp && SPEC=~/.sil-tmp/shopper-spec.json
#    …write the JSON object below to "$SPEC"…
# 3. run it by absolute path, via node:
node "<creationEntrypoint>" --spec "$SPEC"
# 4. remove it, whatever the result:
rm -f "$SPEC"
```

The spec file's contents — one JSON object:

```json
{ "name": "My Shopper",
  "workspace": "~/.openclaw/workspace-my-shopper",
  "persona": "…endorsed persona…", "userSpec": "…seeded shared user spec…",
  "channel": "telegram" }
```

### The spec (input)

| Field | Meaning | Goes to | Required? |
|---|---|---|---|
| **name** | Human-readable display name; the `agentId` is **derived** from it. | sil store | yes |
| **persona** | Who the shopper is — a generalist, its voice, standing rules. | host **`SOUL.md`** | yes |
| **workspace** | The shopper's workspace directory. | host | yes |
| **userSpec** | Shared **cross-niche** facts + hard constraints (seeded partial). | sil `user_spec.md` | yes |
| **channel** | Setup conversation's channel, bound to the shopper. | host bindings | optional (fail-open) |

The `agentId` is **not an input** — the bin derives it as `deriveAgentId(name)`
(lower-kebab `^[a-z0-9][a-z0-9-]*$`; a `main`/empty slug silently folds to `sil-shopper`).

**No per-niche input at create** — no method, no PRD; those mint lazily on first shop
via `sil_learn create`. The shopper needs web tools (inherited from `agents.defaults`)
to mint/refresh domains; if defaults grant none, the bin reports `created` with a
`warnings` gap (bare `sil_search` still works) — surface it.

### What the bin does, in order (atomic, fail-closed)

1. **Validate first, then derive the id** — bad/blank `name`, `persona`, `workspace`, or
   `userSpec` → **`invalid_request`** naming the field; **nothing written**. Then
   `agentId = deriveAgentId(name)` — the derivation always yields a conforming id (empty
   or `main` slug → the silent `sil-shopper` fallback), so the id is never a failure mode.
2. **Config + singleton pre-flight** — no host config → `persistence_failed`. An
   existing shopper `user_spec.md`, or an `agentId` clash → **`collision`** ("a shopper
   already exists"); steer to shop-a-new-niche or refine, **never a second shopper**. An
   inconclusive read fails closed.
3. **Snapshot `openclaw.json`** — the teardown anchor, before any write.
4. **`openclaw agents add`** — the real `agents.list[]` entry + workspace bootstrap,
   inheriting model + tools from `agents.defaults`.
5. **Write `SOUL.md`** = endorsed **persona + the standing "The sil way" creed block**
   (below).
6. **Materialize the shared user spec** — `sil_profile_materialize { name, userSpec }`
   (singleton, no agentId) writes **`user_spec.md`** atomically, name in its
   frontmatter. **Setup-only: no domain, no method, no PRD.**
7. **Attach skill + enable plugin** (value-mode `config set --strict-json`, the only
   mode the pinned `alpine/openclaw:2026.6.9` accepts):
   `agents.list[<idx>].skills` ← `["sil-shopping"]`; `plugins.entries.sil.enabled` ←
   `true`. **No per-agent `tools.deny`** — the shopper inherits the host default toolset.
8. **Admit sil (plugin trust)** — the shipped **`scripts/allowlist-openclaw.mjs`** helper
   (which the script runs itself, by absolute path via `node` — never the bare name)
   additively merges the three trust surfaces (`plugins.allow` + `tools.alsoAllow` +
   `plugins.entries.sil`) — the only way to un-filter `sil_*` without clobbering a
   co-installed plugin. A non-zero exit → **`persistence_failed`** (never a green
   `created` over filtered tools).
9. **Bind the channel — FAIL-OPEN** — resolve (`spec.channel`, else
   `OPENCLAW_MCP_MESSAGE_CHANNEL`), bind, **verify** the route stuck. Undetermined /
   owned / unverifiable → revert + a manual-bind hint in `warnings`. Never fails
   creation.
10. **Validate then declare** — `config validate --json` keys off **`.valid`**. Only
    `valid: true` **and** step 8 ok → **`created`** (with `boundChannel`, or `null`).
    Any failure **after step 4** tears down (restore the snapshot; remove the workspace
    + shopper dir only if it created them), so `persistence_failed` means **nothing
    partial**. If teardown cannot fully revert, a louder **`teardown_failed`** names the
    residue.

Exit 0 **only** on `created`.

### The `SOUL.md` "The sil way" creed block

The persona is followed by a standing **"The sil way"** creed — an identity-level
restatement (a philosophy, not a rulebook; the mechanics live in the attached skill)
carrying the **explore-first** mantra, the loop in three lines, and the one distinction
that matters: the shopper **mints an unlearned niche first** (a `sil_profile_search`
MISS → `sil_learn create`, then search); **the sil catalog is where you buy, the open
web is where you learn** (web only researches a niche's buying guide, never sources a
pick); and its **shopping memory is the sil store** — it records what it learns through
`sil_learn` / `sil_profile_*`.

### Status taxonomy

| `status` | Meaning | Do |
|---|---|---|
| `created` | Shopper added, spec materialized, plugin + skill + hardening wired, config valid. Carries `name`/`agentId`/`workspace`/`boundChannel` (or `null`). | Tell the user; if `boundChannel` null, relay the manual-bind hint. |
| `invalid_request` | Spec failed validation. Nothing attempted. | Name the field, fix, re-run. |
| `collision` | A shopper (singleton) or `agentId` already exists. Nothing written. | Steer to shop-a-new-niche or refine — never a second shopper. |
| `persistence_failed` | A write, the allow-list helper, or `config validate` failed; teardown fully reverted. | Fix the path/cause, re-run (safe). |
| `teardown_failed` | Teardown could NOT fully revert. | Louder — names the residue; the host is not at its pre-run state. |

### Runtime

At session start the host has injected the persona via **`SOUL.md`**. Load the shared
**`user_spec.md`** (cross-niche facts + hard constraints; frontmatter carries the name);
`sil_profile_search` scans the learned domains (empty is healthy) and each per-domain
method loads **lazily at shop time**. The `sil_*` tools admitted at create, the shopper
shops with no further setup, minting each niche on the fly on first shop
([`shop_loop.md`](shop_loop.md)). To sharpen it, see
[`fill_and_feedback.md`](fill_and_feedback.md).
