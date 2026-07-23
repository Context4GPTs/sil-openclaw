---
name: agent-creation-engine
description: Loaded by the sil-shopping skill when the user asks to create or set up their one sil shopper — the two-touchpoint onboarding interview (persona + shared user-spec seed) and the creation step that persists it. Nothing is created, written, or configured until the user explicitly endorses the draft.
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

## Part 2 — Creation

**Run ONLY after the endorsement gate above clears.** Creation persists **one**
OpenClaw agent — the **shopper**: a host `agents` entry with the sil skill attached,
the persona in the workspace **`SOUL.md`**, and the **shared user spec** in the sil
data dir. A **singleton** that learns **domains** lazily on first shop — a fresh
shopper has no domains, which is healthy. Creation is **local + offline**: no token,
no `sil_register`/`sil_whoami`, no network — the user registers later, on first shop.

### One tool call

Call **`sil_create_shopper`** with the endorsed spec. There is no script to locate,
no path to derive, no file to write and clean up — you already hold the tool, and the
whole create is one call that returns one JSON result.

```
sil_create_shopper {
  "name": "My Shopper",
  "workspace": "<absolute path under the user's home>",
  "persona": "…endorsed persona…",
  "userSpec": "…seeded shared user spec…",
  "channel": "telegram"
}
```

### The spec (input)

| Field | Meaning | Goes to | Required? |
|---|---|---|---|
| **name** | Human-readable display name; the `agentId` is **derived** from it. | sil store | yes |
| **persona** | Who the shopper is — a generalist, its voice, standing rules. | host **`SOUL.md`** | yes |
| **workspace** | The shopper's own workspace directory. | host | yes |
| **userSpec** | Shared **cross-niche** facts + hard constraints (seeded partial). | sil `user_spec.md` | yes |
| **channel** | Setup conversation's channel, routed to the shopper. | host bindings | optional (fail-open) |

`workspace` must be an **absolute path under the user's home** — a real path, never
`~/…`, because nothing in this stack expands a tilde and you would create a directory
literally named `~`. It must not sit inside sil's data directory. A path that breaks
one of those rules comes back `invalid_request` naming **the rule**, not just the
field, so relay that sentence to the user rather than silently picking another path.
A sensible default is `<home>/.openclaw/workspace-<shopper-id>`.

The `agentId` is **not an input** — it is derived from `name` (lower-kebab
`^[a-z0-9][a-z0-9-]*$`; a `main`/empty slug silently folds to `sil-shopper`).

**No per-niche input at create** — no method, no PRD; those mint lazily on first shop
via `sil_learn create`. The shopper needs web tools (inherited from `agents.defaults`)
to mint/refresh domains.

### What it does, in order (validate first, then atomic)

1. **Validate** — bad/blank `name`, `persona` or `userSpec`, or a `workspace` that
   breaks a confinement rule → **`invalid_request`** naming the field and the rule;
   **nothing is attempted**. Then the id is derived from `name`.
2. **Singleton + id pre-flight** — an existing shopper `user_spec.md`, or an agent id
   already in the host's list → **`collision`**; steer to shop-a-new-niche or refine,
   **never a second shopper**. A store it cannot read is inconclusive and fails closed.
3. **Workspace** — the host bootstraps the shopper's workspace directory.
4. **`SOUL.md`** = endorsed **persona + the standing "The sil way" creed block** (below).
5. **Shared user spec** — `user_spec.md` written atomically, the name in its
   frontmatter. **Setup-only: no domain, no method, no PRD.**
6. **One host-config transaction, last** — the `agents.list` entry with
   `skills: ["sil-shopping"]`, plus the channel route when there is one. The host
   validates it and either takes the whole change or none of it.

Because that transaction is **last and single**, any earlier failure leaves the host
config untouched — nothing partial, ever. Creation then removes what **this run**
created (its workspace tree, or just the files it added to one the user already had,
and the user spec it wrote) and reports **`persistence_failed`**. If something it
created could **not** be removed, the louder **`teardown_failed`** names the residue.
No per-agent `tools.deny` is set — the shopper inherits the host's default toolset.

**Creation never widens sil's own trust.** It writes no `plugins.allow`, no
`tools.alsoAllow`, no plugin-enable key. If sil's tools were not already admitted you
could not have called this tool at all — admission is an operator act that happens
before creation, never something the shopper arranges for itself.

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
| `created` | Shopper added, user spec written, skill attached. Carries `name`/`agentId`/`workspace`/`boundChannel` (or `null`) and any `warnings`. | Tell the user; if `boundChannel` is null, relay the manual-bind hint from `warnings`. |
| `invalid_request` | The spec failed validation. Nothing attempted. | Relay the field AND the `rule` it broke, fix, call again. |
| `collision` | A shopper (singleton) or that agent id already exists. Nothing written. | Steer to shop-a-new-niche or refine — never a second shopper. |
| `persistence_failed` | A step failed; everything this run created was removed. | Relay the `cause` and the `recovery` command, then call again (safe). |
| `teardown_failed` | Something this run created could NOT be removed. | Louder — read out each `residue` path; the machine is not back at its prior state. |

The `cause` is always sil's own words. When a **host**-owned step fails, sil does not
forward the host's error text — it may carry a token, an absolute path or a config
fragment — so the result carries a `recovery` command the user can run themselves to
read the host's own message. Relay that command; do not run it for them.

### Runtime

At session start the host has injected the persona via **`SOUL.md`**. Load the shared
**`user_spec.md`** (cross-niche facts + hard constraints; frontmatter carries the name);
`sil_profile_search` scans the learned domains (empty is healthy) and each per-domain
method loads **lazily at shop time**. The shopper shops with no further setup, minting
each niche on the fly on first shop ([`shop_loop.md`](shop_loop.md)). To sharpen it,
see [`fill_and_feedback.md`](fill_and_feedback.md).
