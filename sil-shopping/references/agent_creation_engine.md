---
name: agent-creation-engine
description: Create the single sil-wired shopper end to end — the two-touchpoint onboarding interview (persona + shared user-spec seed, endorsement-gated) then the one-command engine that persists it. Load when the user asks to set up or create their shopper.
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

- **Identity** — propose an `agentId` (lower-kebab, ≠ `main`) and a `name`; confirm both.
- **Assemble** — compose **`{ agentId, name, persona, userSpec }`**, present a readable
  summary, self-check the shape (`agentId` lower-kebab & ≠ `main`; non-blank
  `name`/`persona`/`userSpec`). Writes nothing — the engine's validate-first step is the
  authoritative gate.
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

Run one shipped bin — **`sil-openclaw-create-shopper`** — **non-interactive**,
**atomic**, **fail-closed**; it emits one JSON result. It is a standalone operator
script, not the plugin process, so the plugin's "never write host config" guarantee
holds. Feed the endorsed spec as one JSON object on **`stdin`** (or `--spec <path>`):

```
sil-openclaw-create-shopper <<'JSON'
{ "agentId": "my-shopper", "name": "My Shopper",
  "workspace": "~/.openclaw/workspace-my-shopper",
  "persona": "…endorsed persona…", "userSpec": "…seeded shared user spec…",
  "channel": "telegram" }
JSON
```

### The spec (input)

| Field | Meaning | Goes to | Required? |
|---|---|---|---|
| **agentId** | Lower-kebab (`^[a-z0-9][a-z0-9-]*$`), never `main`. | host | yes |
| **name** | Human-readable name. | sil store | yes |
| **persona** | Who the shopper is — a generalist, its voice, standing rules. | host **`SOUL.md`** | yes |
| **workspace** | The shopper's workspace directory. | host | yes |
| **userSpec** | Shared **cross-niche** facts + hard constraints (seeded partial). | sil `user_spec.md` | yes |
| **channel** | Setup conversation's channel, bound to the shopper. | host bindings | optional (fail-open) |

**No per-niche input at create** — no method, no PRD; those mint lazily on first shop
via `sil_learn create`. The shopper needs web tools (inherited from `agents.defaults`)
to mint/refresh domains; if defaults grant none, the bin reports `created` with a
`warnings` gap (bare `sil_search` still works) — surface it.

### What the bin does, in order (atomic, fail-closed)

1. **Validate first** — bad/blank `agentId` (lower-kebab, ≠ `main`), `name`, `persona`,
   `workspace`, or `userSpec` → **`invalid_request`** naming the field; **nothing
   written**.
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
   An fs-mutator deny is inert while codex's own shell (surfaced as `bash`) stays open by
   design: it reads the shopper's skill files and can write regardless. The shell stays
   open (trusted single-operator posture); persistence is steered through the sil tools by
   the skill, not enforced by tool policy.
8. **Admit sil (plugin trust)** — the shipped **`sil-openclaw-allowlist`** helper
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
pick); **persists only through `sil_learn`**, never to host files.

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
