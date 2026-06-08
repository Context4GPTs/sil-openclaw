# Completed Work Is Stub-Free

A stub is a placeholder to **replace**, never to maintain — and never to test.
A green test against a stub proves nothing: it asserts the placeholder still
returns its hardcoded shape, not that the product works. This rule is a direct
corollary of [`production-grade-first.md`](./production-grade-first.md) —
production-grade includes real correctness, and a stub is its absence.

## The rule

- **We do not test stubs.** No integration or e2e test may assert a stubbed
  response. When the only thing green is a stub, the test is theater — delete it.
- **Touching an area de-stubs it first.** The first move when you work an area
  is to remove the stubs that preceded it. You don't build on a stub, and you
  don't leave one behind.
- **Completed work is stub-free.** Anything taken through development to done
  carries no stub in the path it exercises. "Done" and "still stubbed" are
  mutually exclusive.

## Tests authenticate for real

- Tests run as **real, provisioned test users**, through the same auth path
  production uses — real token verification, no shortcuts.
- Prod/dev behaviour switches on **`NODE_ENV`**, never on a dev bypass. There is
  no dev-token and no `AUTH_DEV_BYPASS` — it is rejected, fail-closed. A test
  that needs a bypass to pass is testing the bypass, not the product.

## On touch, not big-bang

De-stubbing is gated on **touch**: a domain's stub is removed when that domain
is next worked, as part of that work — never maintained, never tested, and never
deferred to a separate big-bang migration. Each completed slice leaves its own
surface stub-free; the rest fall as their areas are worked.
