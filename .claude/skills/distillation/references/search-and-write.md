# Search Before Write — Full Procedure

The discipline that keeps `docs/` small and conflict-free. Every non-inline capture runs through this.

## The Algorithm

```
for each capture:
    area  = pick_area(capture)                                  # decisions | knowledge | product
    hits  = grep -li "<keyword>" docs/<area>/INDEX.md
    candidates = []
    for hit in hits:
        body = read docs/<area>/<hit-id>.md
        if body is topically related to capture:
            candidates.append(hit)
    if candidates is empty:
        create new doc + add INDEX row
    elif len(candidates) == 1:
        edit existing doc + bump frontmatter + update INDEX row + re-sort
    else:
        pick the most specific candidate (narrowest title); edit that one
        cross-link any related candidates with [[wikilinks]]
```

## Picking the Area

| Question | If yes → |
|---|---|
| Was this a *choice* with rejected alternatives? | `decisions/` |
| Does this constrain how *future code* must be written? | `decisions/` |
| Is this an *invariant* the code enforces, or a *gotcha* the code has? | `knowledge/` |
| Would a debugger benefit from knowing this *before* opening the file? | `knowledge/` |
| Is this about *what the product does* or *how users interact with it*? | `product/` |
| Is this about *what we as a team have agreed to build*? | `product/` |

If two apply, pick the narrower one. If still unsure, prefer `knowledge/`.

## Searching the INDEX

The INDEX is the entry point. Don't grep the whole folder — grep INDEX first; it's small and pre-indexed.

```bash
# By keyword in title or tag
grep -i "rate.limit" docs/decisions/INDEX.md
grep -i "auth" docs/knowledge/INDEX.md

# When you want to scan all areas
grep -ri "<keyword>" docs/*/INDEX.md
```

If INDEX returns matches but the bodies are unrelated, that's still useful — you've confirmed nothing about your topic exists yet.

## When to Edit vs Create

**Edit an existing doc when:**
- The new capture sharpens, contradicts, or extends an existing point.
- The new capture adds a sibling fact to the same topic (e.g. another gotcha in the same auth flow).
- The existing doc's title is broad enough to legitimately cover the new content.

**Create a new doc when:**
- The topic is genuinely new — no INDEX hit relates to it.
- An existing doc's title is narrower than your capture, and extending it would muddy the focus.
- The new capture supersedes an old doc entirely → mark the old one with `superseded_by: <new-id>` and remove from INDEX.

## Worked Example 1: Match Found, Edit

**Capture:** "Auth tokens are SHA256'd before DB lookup — comparing raw tokens always misses."

**Area:** `knowledge/` (it's a gotcha).

**Search:** `grep -i "auth" docs/knowledge/INDEX.md` → returns one hit:

```
| [[auth-session]] | Session lifecycle and storage | auth, session | 2026-04-12 |
```

**Read** `docs/knowledge/auth-session.md`. It covers session creation and expiry. The token-hashing detail is a *sibling fact in the same topic*. **Edit, don't create.**

Append a new section to the body:

```markdown
## Token comparison

Tokens are SHA256'd before DB lookup. Comparing raw tokens to stored values always misses — read `auth/session.py:42`.
```

Bump frontmatter:

```yaml
updated_at: 2026-05-21
updated_by_card: auth-token-bug
commit: a1b2c3d
```

Update INDEX row's `Updated` column to `2026-05-21`. Re-sort so this row is at the top.

## Worked Example 2: No Match, Create

**Capture:** "Use upstash redis for rate-limit counters, not in-process, because pod restarts during deploy reset counters."

**Area:** `decisions/` (it's a choice with a constraint).

**Search:** `grep -i "rate" docs/decisions/INDEX.md` → no hits. `grep -i "redis" docs/decisions/INDEX.md` → no hits.

**Create** `docs/decisions/upstash-rate-limit.md`:

```yaml
---
id: upstash-rate-limit
title: Use upstash redis for rate-limit counters
tags: [infra, rate-limit, redis]
card: rate-limit-track-api
commit: a1b2c3d
updated_at: 2026-05-21
updated_by_card: rate-limit-track-api
---

# Use upstash redis for rate-limit counters

Counters live in upstash redis, not in-process.

## Why

Pod restarts during deploy reset in-process counters, which lets requests slip through the limit during rollouts. Upstash persists across pod lifecycle.

## Alternatives considered
- In-process map — fails as above.
- DynamoDB counter — atomic but adds ~30ms per request.
- Cloudflare Workers KV — eventual consistency breaks burst protection.

## Constraints
- Requires `UPSTASH_REDIS_URL` env var in every service that rate-limits.
- See [[rate-limit-headers]] for the response format we expose.
```

Add to `docs/decisions/INDEX.md` as the top row:

```markdown
| [[upstash-rate-limit]] | Use upstash redis for rate-limit counters | infra, rate-limit, redis | 2026-05-21 |
```

## Worked Example 3: Multiple Matches, Pick Narrowest

**Capture:** "Onboarding step 3 requires email verification before showing the org-picker."

**Area:** `product/` (a flow rule).

**Search:** `grep -i "onboarding" docs/product/INDEX.md` → two hits:

```
| [[onboarding-flow]]       | Onboarding flow overview            | onboarding | 2026-03-01 |
| [[onboarding-org-picker]] | Org picker behavior during onboarding | onboarding | 2026-04-22 |
```

**Read both.** `onboarding-flow.md` is a high-level overview; `onboarding-org-picker.md` is specifically about the org-picker step. The capture is about the *org-picker's* prerequisite — narrower match. **Edit `onboarding-org-picker.md`.**

If after editing, the flow overview's text is now misleading, also touch `onboarding-flow.md` and add a `[[onboarding-org-picker]]` link. Both bump frontmatter; both INDEX rows re-sort.

## Edge Cases

**The card invalidates an old decision.** E.g. you're moving off Upstash to in-process counters because requirements changed.

- Don't delete `upstash-rate-limit.md` — history matters.
- Edit it: add a top-of-body banner: `> **Superseded** by [[in-process-rate-limit]] (2026-09-12, card: rate-limit-rewrite).`
- Set `superseded_by: in-process-rate-limit` in frontmatter.
- Create the new doc.
- Remove the old row from INDEX; add the new one.

**The capture has no obvious area.** E.g. "PR descriptions should include the kanban card slug." That's a process convention, not knowledge/decisions/product → goes in `CLAUDE.md`, not docs/.

**The capture is about a deprecated subsystem.** Capture anyway. Future archaeologists need to know why something was removed. Add tag `deprecated`.

**Multiple captures from the same card touch the same doc.** Combine them into one edit. Don't bump `updated_at` twice in the same commit.

**The INDEX row sort feels wrong.** The convention is strictly `updated_at` descending. If you want a different order (alphabetical, by tag), build that as a separate view (a script that reads INDEX or the frontmatter), don't fight the table.

## Verification After Write

Quick sanity checks before commit:

1. The doc file's `id:` frontmatter equals the filename minus `.md`.
2. The INDEX row's `[[id]]` matches.
3. The INDEX is sorted newest-first.
4. Any `[[wikilink]]` in your new doc resolves to an existing `id` somewhere in docs/.
5. The card body's `## Distillation` section lists every doc you touched.
