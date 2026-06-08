---
name: premise-correct-against-merged-code
description: In discovery, verify the founder's card intent against the actual merged code/contracts before writing criteria — intents are often stale on endpoint path/verb/shape.
metadata:
  type: feedback
---

When shaping a card, treat the founder's `## Intent` as the *goal*, not the *spec*. Read the
actual merged sibling code and the predecessor cards' contracts FIRST, then write acceptance
criteria against what really exists (or record an ASSUMPTION + Signal where it doesn't).

**Why:** on the identity slice, every card's intent had a stale premise that the
agent-council caught by reading code — sil-api uses BARE paths not `/api/v1/*`; "replaces
auth-stub.ts" but no such file existed; `sil_whoami`'s intent assumed a sil-api identity-read
that is still a stub. Writing criteria from the intent alone would have produced a spec that
can't be built or that tests the wrong shape (a false green against the stub). See
[[identity-onboarding-slice]].

**How to apply:**
- Grep the sibling for the endpoint/handler the intent names; read it. Confirm path, verb,
  request body, response shape, status codes.
- Read the predecessor `cards/done/` bodies — their Discovery findings + Signals carry the
  real contracts and the "deferred to the next card" notes.
- Where the intent depends on something not yet built: don't block. Write the behavior
  against a MOCKED boundary shaped to the assumed contract, record the assumption in Open
  questions, and add a `blocked-on` / `premise-correction` Signal for the orchestrator.
- Add an explicit acceptance criterion that defeats the false-green: assert the tool returns
  the REAL intended data (not the current stub's fixed shape), so the suite can't pass while
  the product promise is unmet.
