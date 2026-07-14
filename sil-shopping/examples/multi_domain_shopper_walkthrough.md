---
name: multi-domain-shopper-walkthrough
description: A worked six-beat run — create one shopper (after endorsement), then shop two unrelated niches in one session (the second minted on the fly), with a shared user_spec fact reused across both and a mid-session correction reconciled by a whole-doc write. Illustrative, not a spec.
---

# Worked run — one shopper, two niches, six beats

Illustrative only — authoritative rules live in the beat references.

## Create the shopper (once, after endorsement)

The two-touchpoint interview assembles a draft persona + shared user-spec seed. Only after the
user **endorses** it does the engine run `openclaw agents add` and materialize the shared
`user_spec.md` — nothing before that. The result is **one** shopper, a **singleton**. The seed
holds one durable fact — `- [hard] ships to Berlin; allergic to wool` — cross-niche, so it
lives in `user_spec` (true in **every** niche).

## Niche A — ski gloves (all six beats)

1. **Classify** — "warm gloves for the slope" → `{ domain: ski, product: gloves, intent:
   slope }`. The domain is the **broad category** (`ski`, not `ski-slope-gloves`), so a later
   "ski goggles" reuses this method. `sil_profile_search` finds no ski domain → a MISS.
2. **Method** — research ski gear, then **mint the general buying guide** via `sil_learn create`
   (`target: method`, domain `ski`): a `## How it's bought` section + a coined `## Search
   vocabulary` (e.g. `product.waterproof_rating`, `product.insulation_g`) — **dimensions, never
   this buyer's values**. **Announced** ("I read this as *ski gloves for the slope*").
3. **Fill** — the method's dimensions resolve from stored state; the wool allergy is **reused**
   from the shared `user_spec` **without re-asking**; only the budget is elicited (one question,
   tied to why). The resolved values are authored into the PRD's **`## Search specs`** block —
   e.g. `{ns:product, key:waterproof_rating, op:gte, value:10000, unit:mm, hard:true}` — and
   persisted with `sil_learn create` (`target: prd`, `ski/gloves-slope`).
4. **Search-space** — **project** the PRD's `## Search specs` block **verbatim** into a bounded
   ≤ 4 `sil_search` fan-out, core first, deliberate widenings after.
5. **Reflect** — honesty pass, then a **hero + one alternative**, each with a why.
6. **Feedback** — "I always run Hestra" → confirm, then **`sil_learn write`** the ski method with
   a `## Durable taste` line folded in (a whole-doc reconcile, per-domain — not a stray bullet).

### A correction, mid-session — the write-reconcile

The buyer pushes back: "the €120 cap was just for today — my real ceiling is €90, and I don't
care about touchscreen fingers." That **contradicts** two filled preferences and is a
**standing** change, so reconcile the PRD with a single **`sil_learn write`**: read the current
`ski/gloves-slope`, **rewrite** the budget predicate and drop the touchscreen one in place, and
write the coherent whole back. No second, contradicting bullet is ever added — the PRD stays
**one truth per dimension**, and the next search projects the corrected block.

## Niche B — an espresso grinder (same session, minted on the fly)

The user pivots: "now I need a burr grinder" — a **second, unrelated niche**. No agent switch;
the one shopper handles it:

1. **Classify** → `{ domain: espresso, product: grinder, intent: general }` (context-free →
   `general`).
2. **Method** — a MISS again → research + **mint the general method on the fly** (`create`),
   **announced**.
3. **Fill** — "ships to Berlin" is **reused across** niches from the shared `user_spec`, kept
   from the ski session. The Hestra taste, per-domain on the ski method, does **not** leak here.

Shared facts flow to both; per-domain taste stays isolated.

## The singleton edge

"Set me up a second shopper" → the engine refuses: **a shopper already exists**. Steer to shop
a new niche (mints a domain on the spot) or refine an existing one with `sil_learn write` — never
a second shopper.
