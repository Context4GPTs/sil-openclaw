# Production-Grade First — The Overriding Priority

We optimize for exactly three things, above all else and in this order:
**production-grade tooling, performance, and code.** Nothing that fails to serve
a production-ready system earns effort.

This is a priority *filter*, not a license to cut corners. Production-grade
**inherently includes** correctness, strict typing, security, observability, and
tests that catch real failures — those are non-negotiable precisely because they
*are* production-grade, not extras layered on top. What the filter rejects is
everything that does **not** move a production-ready system forward.

## Spend effort on

- **Tooling production teams actually run.** Prefer the industry-standard,
  well-supported, typed, observable tool over a bespoke hand-roll — unless the
  hand-roll is *demonstrably* more production-grade here (measure; don't assume).
- **Performance that holds under real load.** Lean images, fast cold starts,
  bounded queries, no N+1s, no needless allocation on hot paths.
- **Code an on-call engineer would thank you for.** Strictly typed, fails fast
  and loud, structured errors, no silent failures, no dead abstractions.

## Do NOT spend effort on

- **Backwards compatibility — ever.** We never keep an old path alive for
  compatibility. Rewrite, replace, **delete** the old thing. No deprecation
  shims, no v1-and-v2 side-by-side, no "migrate the callers we own later."
- **Speculative features** for hypothetical futures. Build what is needed now.
- **Premature abstraction.** Three similar lines beat a premature helper.
- **Documentation that restates the code**, or process ceremony that yields no
  production value.

When a request adds effort that moves none of the three priorities forward, push
back — name the priority it fails to serve. This rule composes with, and never
overrides, [`critical-thinking.md`](./critical-thinking.md).
