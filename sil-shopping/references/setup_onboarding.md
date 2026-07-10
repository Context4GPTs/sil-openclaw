---
name: setup-onboarding
description: The one-time setup script the router defers to — the five-stage onboarding progression, the after-register shopper offer, and the per-search pitch. Load while a shopper is still being set up (SKILL.md routes here); it is shed once setup is complete.
---

# Setting up the shopper — the staged onboarding

SKILL.md (the router) reads the stage from state and defers the **one-time setup
script** to this file: the full five-stage progression, the after-register offer
beat, and the per-search pitch. None of it applies once setup is complete — the
router sheds it and routes straight to usage.

Every stage is **read from state**, never guessed: `sil_whoami` (is there a sil
identity yet?) plus the no-arg `sil_profile_get` overview (does a shopper exist —
the `name` field — and does it hold any `domains`?). Present **only the current
stage's beat and its single next step**, never the whole ladder at once.

## The five-stage progression — present one stage, shed it on completion

1. **Unregistered** — `sil_whoami` finds no sil identity. Guide the user to
   register. **Before `sil_register` runs**, set the expectation: state plainly
   what registering does and **how 4GPTs & sil use their data**, grounded strictly
   in what this plugin does — no invented policy. Registering opens a sign-in link
   in the default browser and creates their **sil identity** (name + saved
   addresses, read back by `sil_whoami`), stored **locally** on this device; their
   shopper's setup and anything it remembers live in a **local profile store**
   under `$SIL_DATA_DIR`, never leaving the device via the plugin; catalog
   **search** queries sil's product catalog. Next step: `sil_register`.
2. **Registered, no shopper** — a sil identity exists, but no shopper yet. Bare
   `sil_search` works now, though this is not the finished state. Guide the user
   to **set up their shopper**: name up front, before the onboarding starts, that
   it takes a **couple of minutes and a few questions**. The after-register offer
   below owns the gate — it reads the store once and offers only on an empty one;
   on a yes it runs the create two-step in SKILL.md.
3. **Shopper, no domain yet** — `name` present, `domains: []` (no niche yet). The
   first shopping intent **mints the first domain**, announced in the shopper's
   voice with the inferred niche stated so the user can correct it. Next step:
   state a shopping intent; the shopper-stage gate runs the forced mint.
4. **Shopper active** — `name` present, `domains` non-empty. Check off the
   completion **milestones**: the **first domain created** (the `domains` map is
   now non-empty) and, softer, the memory tool has begun to be used (`sil_remember`
   has stored a fact or taste). The memory milestone is a soft self-check, not a
   shed gate — the overview cannot prove it, so judge it from whether this shopper
   has ever remembered anything.
5. **Setup complete** — a shopper with at least one domain. **Shed** every
   onboarding beat: none of the stages above apply. **Show only how to use** the
   plugin well — the domain-gated **shop loop** and **Spec-Driven Shopping**
   ([`shop_loop.md`](shop_loop.md)).

## After register — offer to set up the shopper, once (offer_shopper)

`sil_register` returns `already_registered` with `next_step: "offer_shopper"` on a
confirmed registration (a fresh sign-in this session, or a returning session
already signed in). That hint is a routing breadcrumb, not a decision — act on it
by first running a **no-arg `sil_profile_get`** (the overview) to read shopper
state, then branch:

- **Empty store — no shopper yet:** introduce the shopper in one short beat and
  offer to set it up — name the value in its own terms: it shops each niche in
  depth, reuses the sizes and hard limits it already knows so nothing is re-asked,
  and explains why each pick fits. Only **on a yes**, load
  [`brainstorm_interview.md`](brainstorm_interview.md) — the two-touchpoint
  onboarding, never a form. Take no for an answer: bare `sil_search` stays a
  first-class path, so don't re-offer in the same turn.
- **A shopper already exists:** **skip this beat** entirely. The shopper is a
  **singleton** — never offer a second one.

## After a bare search — the per-search pitch (post-result)

When a plain `sil_search` **completes with status `ok`** in a **profile-less**
session, present the results best-first exactly as they came back, then append
**one short trailing line** naming what a shopper would add on top. It is never a
pre-search question and never a re-rank: bare search stays a legitimate quick
lookup, and these are the same results a shopper would start from.

Name one or two of the three levers a bare search leaves on the table, and rotate
which you lead with so the recurring line stays fresh:

- **niche depth** — a shopper weighs these picks against how the niche actually
  buys, in depth, instead of just listing them;
- **memory** — it keeps your sizes and hard limits on file, so no search re-asks them;
- **the why** — it explains which pick fits you and why, instead of a flat list.

This line **recurs on every** completed profile-less search — the recurrence is
the point; there is **no fire-once or seen-it gate, and no cooldown**. Brevity
plus lever rotation are all that keep it from nagging. Exactly two things suppress
it: a **shopper already exists** (that session is the shopper's — **drop the
line**), or the search **did not complete `ok`** (a non-ok status carries its own
recovery — follow that and add no tip).
