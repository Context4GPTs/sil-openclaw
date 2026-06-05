# Critical Thinking — All Changes

Before every change — code, docs, config, analysis, anything — answer silently:

1. **What problem does this solve?** State it in one sentence or stop — you don't understand it yet.
2. **Is the premise correct?** The user may be solving the wrong problem. Check the actual state first.
3. **Simpler alternative?** Could you solve this by removing something? Reusing what exists? Doing nothing?
4. **What breaks?** Name at least one failure mode. If you can't, you haven't thought hard enough.
5. **Pattern consistency?** Does this match how things already work, or does it introduce a new pattern without justification?
6. **Who said this is needed?** Trace the request to its origin. Is it the user's first instinct? A subagent's recommendation? Your own assumption? All three are suspect.

Push back immediately if the request would:
- Add complexity without articulable benefit
- Introduce an abstraction for a one-time use
- Add a dependency for something achievable in 20 lines
- Loosen types, swallow errors, or add silent failures
- Use hardcoded values that belong in configuration
- Add documentation that restates what the code already says
- Solve a hypothetical future problem instead of a real current one
