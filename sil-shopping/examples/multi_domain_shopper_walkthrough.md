---
name: multi-domain-shopper-walkthrough
description: A worked six-beat run — create one shopper (after endorsement), then shop two unrelated niches in one session, the second minted on the fly, with a shared user_spec fact reused across both. Illustrative, not a spec.
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
   slope }`; `sil_profile_search` finds no ski domain → a MISS.
2. **Method** — research ski gear, **mint** via `sil_learn create`, **announced** ("I read this
   as *ski gloves for the slope* — correct me if not").
3. **Fill** — the method resolves waterproofing + cuff length; the wool allergy is **reused**
   from the shared `user_spec` **without re-asking**; only the budget is elicited (one question,
   tied to why).
4. **Search-space** — a bounded fan-out of ≤ 4 `sil_search` calls, core first.
5. **Reflect** — honesty pass, then a **hero + one alternative**, each with a why.
6. **Feedback** — "I always run Hestra" → confirm, persist a per-domain taste to the method via
   `sil_learn`.

## Niche B — an espresso grinder (same session, minted on the fly)

The user pivots: "now I need a burr grinder" — a **second, unrelated niche**. No agent switch;
the one shopper handles it:

1. **Classify** → `{ domain: espresso, product: grinder, intent: general }` (context-free →
   `general`).
2. **Method** — a MISS again → research + **mint on the fly**, **announced**.
3. **Fill** — "ships to Berlin" is **reused across** niches from the shared `user_spec`, kept
   from the ski session. The Hestra taste, per-domain on the ski method, does **not** leak here.

Shared facts flow to both; per-domain taste stays isolated.

## The singleton edge

"Set me up a second shopper" → the engine refuses: **a shopper already exists**. Steer to shop
a new niche (mints a domain on the spot) or refine with `sil_learn` — never a second shopper.
</content>
