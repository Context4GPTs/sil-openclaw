---
name: setup-onboarding
description: The one-time setup script the router defers to — the five-stage onboarding progression, the after-register shopper offer, and the per-search pitch. Load while a shopper is still being set up (SKILL.md routes here); it is shed once setup is complete.
---

# Setting up the shopper — the staged onboarding

The router defers the **one-time setup script** here: the five-stage **progression**, the
after-register offer, and the per-search pitch. None of it applies once setup is complete
— the router sheds it. Read every stage from state, never guess: `sil_whoami` (is there a
sil identity yet?) plus the no-arg `sil_profile_get` overview (does a shopper exist — the
`name` field — and does it hold any `domains`?). Present **only the current stage's beat
and its single next step**.

## The five-stage progression — present one stage, shed it on completion

1. **Unregistered** — `sil_whoami` finds no sil identity. Before `sil_register` runs, set
   the expectation: state plainly what registering does and **how 4GPTs & SIL use the
   user's data**, grounded strictly in this plugin — no invented policy. Registering opens
   a browser sign-in and creates their **sil identity** (name + addresses, read by
   `sil_whoami`), stored **locally**; their shopper's setup and memory live in a **local
   profile store** under `$SIL_DATA_DIR`, never leaving the device via the plugin; catalog
   **search** queries sil's product catalog. Next: `sil_register`.
2. **Registered, no shopper** — a sil identity exists, no shopper yet. Bare `sil_search`
   works now, but is not the finished state. Guide the user to **set up their shopper**,
   naming **up front, before the onboarding starts**, that it takes a **couple of minutes
   and a few questions**. The after-register offer below owns the gate.
3. **Shopper, no domain yet** — `name` present, `domains: []`. The first shopping intent
   **mints the first domain**, announced with the inferred niche stated so the user can
   correct it. Next: state a shopping intent.
4. **Shopper active** — `name` present, `domains` non-empty. Check off the completion
   **milestones**: the **first domain created** (`domains` now non-empty) and, softer, that
   the memory tool has been used (`sil_remember` stored a fact or taste — a soft self-check
   judged from whether this shopper has ever remembered anything).
5. **Setup complete** — a shopper with at least one domain. **Shed** every onboarding beat:
   none of the stages above apply. **Show only how to use** the plugin well — the
   **domain-gated shop loop** and **Spec-Driven Shopping** ([`shop_loop.md`](shop_loop.md)).

## After register — offer to set up the shopper, once (offer_shopper)

`sil_register` returns `already_registered` with `next_step: "offer_shopper"` on a
confirmed registration. That hint is a breadcrumb: first run a **no-arg `sil_profile_get`**
(the overview) to read shopper state, then branch:

- **Empty store — no shopper yet:** introduce the shopper in one short beat and offer to
  set it up — name the value (it shops each niche in depth, reuses the sizes and hard
  limits it already knows so nothing is re-asked, explains why each pick fits). Load
  [`brainstorm_interview.md`](brainstorm_interview.md) **only if the user accepts** (a
  yes). Take no for an answer; bare `sil_search` stays first-class.
- **A shopper already exists:** **skip this beat** entirely. The shopper is a **singleton**
  — never offer a second one.

## After a bare search — the per-search pitch (post-result)

When a plain `sil_search` **completes with status `ok`** in a **profile-less** session,
present the results best-first **exactly as they came back**, then append **one short
trailing line** naming what a shopper would add. It is never a pre-search question and
never a re-rank. Name one or two of the three levers, rotating which you lead with:

- **niche depth** — a shopper weighs these picks against how the niche actually buys;
- **memory** — it keeps your sizes and hard limits on file, so no search re-asks them;
- **the why** — it explains which pick fits you and why.

This line **recurs on every** completed profile-less search — the recurrence is the point;
there is **no fire-once or seen-it gate, and no cooldown**. Brevity plus lever rotation
keep it from nagging. Two things suppress it: a **shopper already exists** (that session is
the shopper's — **drop the line**), or the search **did not complete `ok`** (a non-ok
status carries its own recovery — follow that and add no tip).
