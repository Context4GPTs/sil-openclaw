---
name: multi-domain-shopper-walkthrough
description: A worked six-beat, multi-domain run — create one shopper (after an explicit endorsement), then shop two unrelated niches in one session, the second minted on the fly and announced, with a shared user_spec fact reused across both. Illustrative, not a spec.
---

# Worked run — one shopper, two niches, six beats

A concrete end-to-end walkthrough of the six-beat loop across two unrelated
niches. It is illustrative — the authoritative rules live in the beat references.

## Create the shopper (once, after endorsement)

The two-touchpoint interview assembles a draft persona + a shared user-spec seed.
Only after the user **endorses** the assembled draft does the engine run
`openclaw agents add` and materialize the shared `user_spec.md`. Nothing is created
before that endorsement. The result is **one** shopper — a **singleton**.

The seeded shared spec already holds one durable fact: `- [hard] ships to Berlin;
allergic to wool` — a cross-niche fact, kept in `user_spec` because it stays true in
**every niche**.

## Niche A — ski gloves (all six beats)

1. **Classify** — the request "warm gloves for the slope" resolves to
   `{ domain: ski, product: gloves, intent: slope }`. `sil_profile_search` finds no
   ski domain yet → a MISS.
2. **Method** — research ski gear and **mint** the method via `sil_learn create`,
   **announced** ("I read this as *ski gloves for the slope* — correct me if not").
3. **Fill** — precedence resolves waterproofing and cuff length from the method;
   the wool allergy is **reused** from the **shared** `user_spec` **without
   re-asking**. Only the budget is elicited — one question, tied to why.
4. **Search-space** — a bounded fan-out of ≤ 4 `sil_search` calls, core first.
5. **Reflect** — honesty pass, then a **hero + one alternative**, each with a why.
6. **Feedback** — the buyer reacts "I always run Hestra" → confirm, then persist a
   durable per-domain taste to the method via **`sil_learn`**.

## Niche B — an espresso grinder (same session, minted on the fly)

In the **same session** the user pivots: "now I need a burr grinder." This is a
**second niche**, **unrelated** to ski gear. No agent switch — the one shopper
handles it:

1. **Classify** → `{ domain: espresso, product: grinder, intent: general }` (a
   context-free request keys `general`).
2. **Method** — a MISS again → research + **mint on the fly**, **announced**.
3. **Fill** — the "ships to Berlin" fact is again **reused across** niches from the
   **shared** `user_spec`, **kept from** the ski session — never re-asked. The
   Hestra taste, being per-domain on the ski method, does **not** leak here.

The two niches coexist: shared facts flow to both; per-domain taste stays isolated.

## The singleton edge

If the user later says "set me up a second shopper," the engine refuses: **a
shopper already exists**. Steer them to shop a new niche (it mints a domain on the
spot) or refine the existing one with `sil_learn` — never a second shopper.
