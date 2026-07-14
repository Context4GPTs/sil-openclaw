---
name: setup-onboarding
description: The one-time setup script the router defers to — the five-stage onboarding progression, the after-register shopper offer, and the per-search pitch. Load while a shopper is still being set up; shed once setup is complete.
---

# Setting up the shopper — the staged onboarding

The router defers the **one-time setup script** here: the five-stage progression, the
after-register offer, the per-search pitch. None applies once setup is complete — the router
sheds it. **Read the stage from state, never guess:** `sil_whoami` (registered?) + a no-arg
**`sil_profile_search`** (any `domains`?). Present **only the current stage's beat and its
single next step**.

## The five-stage progression

1. **Unregistered** — `sil_whoami` finds no identity. Before `sil_register`, state plainly
   what it does and **how 4GPTs & SIL use the user's data**, grounded strictly in this plugin
   (no invented policy): registering opens a browser sign-in creating their **sil identity**
   (name + addresses, read by `sil_whoami`), stored **locally**; the shopper's setup + memory
   live under `$SIL_DATA_DIR`, never leaving the device via the plugin; **search** hits sil's
   catalog. Next: `sil_register`.
2. **Registered, no shopper** — identity exists, `sil_profile_search` returns no domains, no
   shopper created. Bare `sil_search` works but isn't the finished state; guide the user to
   **set up their shopper**, naming up front it takes a **couple of minutes and a few
   questions**. The after-register offer owns the gate.
3. **Shopper, no domain** — the shopper was created (engine `created`) but `sil_profile_search`
   still returns no domains. The first shopping intent **mints the first domain**, announced
   with the inferred niche so the user can correct it. Next: state a shopping intent.
4. **Shopper active** — `sil_profile_search` returns ≥ 1 domain. Milestones: the **first domain
   created**, and softer, that `sil_learn` stored a fact or taste.
5. **Setup complete** — a shopper with ≥ 1 domain. **Shed** every onboarding beat; **show only
   how to use** the plugin well — the domain-gated six-beat loop and Spec-Driven Shopping
   ([`shop_loop.md`](shop_loop.md)).

## After register — offer the shopper, once (offer_shopper)

`sil_register` returns `already_registered` with `next_step: "offer_shopper"` on a confirmed
registration. Run a no-arg **`sil_profile_search`**, then branch:

- **No domains, no shopper:** introduce the shopper in one beat and offer to set it up — name
  the value (shops each niche in depth; reuses the sizes + hard limits it knows so nothing is
  re-asked; explains why each pick fits). Load
  [`brainstorm_interview.md`](brainstorm_interview.md) **only if the user accepts**. Take no
  for an answer; bare `sil_search` stays first-class.
- **A shopper exists:** **skip this beat.** The shopper is a **singleton** — never offer a
  second.

## After a bare search — the per-search pitch (post-result)

When a plain `sil_search` **completes `ok`** in a **profile-less** session, present the results
best-first **exactly as returned**, then append **one short trailing line** naming what a
shopper adds. Never a pre-search question, never a re-rank. Name one or two of three levers,
rotating which you lead with:

- **niche depth** — weighs picks against how the niche actually buys;
- **memory** — keeps your sizes + hard limits on file, so no search re-asks them;
- **the why** — explains which pick fits you and why.

It **recurs on every** completed profile-less search — **no fire-once gate, no cooldown**;
brevity + lever rotation keep it from nagging. Two suppressors: a **shopper exists** (that
session is the shopper's — drop the line), or the search **not `ok`** (its own recovery
carries; add no tip).
</content>
