---
name: design-system
description: "Read-first skill for any UI work. Loads the project's design docs (brand, tokens, screens) and surfaces the relevant subset for the current task. Enforces token reuse, brand voice, and screen patterns. Falls back to SETUP mode (one-time generator) only when the project has no design system yet."
---

# Design System

The default reason this skill activates is to **use** the design system that already exists — not to create one. Every UI card consults the docs in `docs/design/` for tokens, voice, and screen patterns. The skill's job is to load the right subset, surface it for the agent doing the work, and refuse handoffs that drift from the system.

A one-time **SETUP** mode exists for projects that don't have a design system yet. After setup, the skill is read-only by default.

## Modes

The skill picks its mode by reading `docs/design/INDEX.md`:

| Condition | Mode | Behavior |
|---|---|---|
| INDEX exists and lists ≥1 doc | **USE** (default) | Read, surface, enforce. No founder questions. |
| INDEX absent, or present but empty | **SETUP** | Brand discovery + generation. Founder questions allowed. Fires once per repo. |
| INDEX exists but key files missing (e.g. `system.md` listed but file deleted) | **SETUP-RESUME** | Regenerate only the missing files. Brand discovery skipped if `brand.md` already exists. |

## USE Mode (default)

### When it triggers

- Any card whose work touches UI, CSS, HTML, a component, microcopy, naming, or layout.
- Brainstorming a feature with visible surface area — the council loads design context.
- Style-quality-guardian's review runs against tokens loaded by this skill.

### Phase 1 — Locate

`docs/design/` contains:

```
docs/design/
├── INDEX.md         ← entry point, sorted by updated_at
├── brand.md         ← essence, voice, personality, naming, anti-patterns
├── system.md        ← color tokens, typography, spacing, motion, components, a11y
├── screens.md       ← screen-by-screen specs, navigation map, wireframes
└── showcase.html    ← visual validation page (not in INDEX; raw HTML)
```

Larger projects may split further (e.g. `tokens-color.md`, `tokens-type.md`). Always grep `INDEX.md` first; never assume filenames.

### Phase 2 — Load the Subset

Don't read everything. Pick by task shape:

| Task | Read |
|---|---|
| Picking colors / contrast | `system.md` § Color Palette |
| Picking typography | `system.md` § Typography |
| Writing microcopy, names, marketing | `brand.md` § Voice + Editorial + Naming |
| Building a new screen | `screens.md` (closest matching screen as pattern) + `system.md` for tokens |
| Component motion / animation | `system.md` § Motion |
| Choosing spacing / layout grid | `system.md` § Spacing |
| Validating an entire screen | `showcase.html` open in browser + WCAG ratios from `system.md` |

If the relevant section isn't in `system.md`, grep tags in the INDEX — there may be a more-specific doc.

### Phase 3 — Enforce

Three rules, in order:

1. **Never invent a new token.** If the spec needs a color that doesn't exist in `system.md`, surface the gap as an open question on the card and propose the closest existing token. Don't introduce `--my-special-blue`; either extend `system.md` (a separate doc change) or pick an existing token.
2. **Never violate brand anti-patterns.** Grep `brand.md` for the `Anti-Patterns` section. Hard-stop on any match (forbidden phrases, banned color schemes, prohibited typography, etc.).
3. **Match screen patterns.** If a screen with similar purpose exists in `screens.md`, reuse its layout / navigation / states. Diverge only when the new screen has a genuinely different job; flag the divergence in the card body.

### Phase 4 — Surface

When working alongside another agent (e.g. expert-developer is about to write a component), provide a *paste-ready* token subset rather than expecting them to re-read the docs:

```
RELEVANT TOKENS (from docs/design/system.md):
- Primary: var(--primary-solid)  oklch(0.76 0.16 45)
- Hover:   var(--primary-hover)  oklch(0.70 0.15 45)
- Text on primary: var(--primary-foreground)
- Min touch target: 44px (mobile) — see system.md § Accessibility

BRAND CONSTRAINTS (from docs/design/brand.md):
- No exclamation marks. No emojis. No "AI-powered" language.
- Buttons are pill-shaped (full radius). Square buttons are anti-pattern.

CLOSEST EXISTING SCREEN (from docs/design/screens.md):
- [[screens-org-picker]] uses the same two-column layout you're proposing.
```

### Phase 5 — Drift Detection (optional pass)

When invoked with no specific task (e.g. `/design-system review`), grep the changed files since `base_branch` for token violations:

```bash
# Hardcoded hex colors (should reference tokens instead)
grep -rE '#[0-9a-fA-F]{3,8}' apps/ src/ | grep -v 'docs/design/'

# Font-family declarations not in the token list
grep -rE 'font-family:' apps/ src/

# Spacing values not from the scale
grep -rE 'padding|margin|gap.*:\s*[0-9]+px' apps/ src/
```

Flag each on the card under `## Design drift`. Don't auto-fix — the card author decides whether to refactor or accept.

## SETUP Mode (one-time per repo)

Fires only when `docs/design/INDEX.md` is absent or empty. Produces the full design system in one pass, then exits. Subsequent invocations fall back to USE.

### Phase 1 — Brand Discovery

This is the **only** phase in this skill where the founder is asked questions. Brand personality genuinely cannot be inferred from the codebase.

Ask one at a time:

1. **What is the brand personality?** Pick 3–5 adjectives.
2. **Who is the actual person using this?** Their context, state of mind, environment.
3. **What should the interface feel like?** Reference real things: warm like a notebook, cold like a terminal, dense like a trading floor, spacious like a gallery, sharp like a scalpel.
4. **What brands or products do you admire visually?** Name 2–3.
5. **What must this NOT look like?** Specific anti-patterns to avoid.

Skip any question whose answer is already in `docs/knowledge/` or `docs/product/` (grep first).

### Phase 2 — Generate `brand.md`

```yaml
---
id: brand
title: Brand identity
tags: [design, brand, voice, naming]
card: <originating-card>
commit: <sha>
updated_at: <YYYY-MM-DD>
updated_by_card: <originating-card>
---

# Brand identity

## Essence
<one paragraph — what the brand is, in human terms>

## Personality
<the 3-5 adjectives from Q1, each with a one-line elaboration>

## Voice
<editorial guidelines, sentence rhythm, what to avoid>

## Naming
<product naming conventions, capitalization rules, words to avoid>

## Anti-Patterns
<the Q5 list + voice/visual no-go's>
```

### Phase 3 — Generate `system.md`

Follow [`references/token-generation-guide.md`](references/token-generation-guide.md). Frontmatter:

```yaml
---
id: system
title: Design tokens
tags: [design, tokens, color, typography, spacing, motion, a11y]
card: <originating-card>
commit: <sha>
updated_at: <YYYY-MM-DD>
updated_by_card: <originating-card>
---
```

Sections required:
1. **Color Palette** — Primary (3 shades), secondary, neutral scale (50–900), semantic, surface, dark mode. WCAG contrast ratios documented inline.
2. **Typography** — Display font (never Inter/Roboto/Arial), body font, mono font. Modular scale with `clamp()`. Text styles with weight/spacing/line-height.
3. **Spacing, Borders, Shadows, Motion** — Scales derived from brand personality.
4. **Component Utility Classes** — Buttons, cards, inputs, badges. Token-driven, not hex-driven.
5. **Accessibility** — Min touch targets, focus rings, motion-reduced fallbacks, color contrast guarantees.
6. **File Locations** — Where the tokens land in the actual codebase (`global.css`, `tailwind.config.ts`, etc.).

### Phase 4 — Generate `screens.md`

```yaml
---
id: screens
title: Screen specs
tags: [design, screens, layouts, wireframes]
card: <originating-card>
commit: <sha>
updated_at: <YYYY-MM-DD>
updated_by_card: <originating-card>
---
```

For each key screen:
- Purpose (user goal, entry/exit)
- Progressive disclosure levels
- Desktop ASCII wireframe
- Mobile ASCII wireframe
- Components used (with token refs)
- Interaction states (loading, empty, error, success)
- Accessibility notes (focus order, shortcuts, announcements)

End with a Navigation Map.

### Phase 5 — Generate `showcase.html`

Self-contained validation page rendering every token + component. No build step. Replace placeholders with actual generated values:
- All hex colors → generated palette
- Font families → selected fonts (with Google Fonts `<link>` if web fonts)
- Spacing, radius, shadow, motion → generated values
- Dark-mode overrides in `[data-theme="dark"]`
- Contrast Check section with actual ratios

### Phase 6 — Generate `INDEX.md`

```markdown
# `design/`

Brand identity, design tokens, screen specs. Owned by the `design-system` skill. The day-to-day skill mode is read-only; this folder is created on first setup and consulted on every UI card.

| ID | Title | Tags | Updated |
|---|---|---|---|
| [[screens]] | Screen specs | design, screens, layouts | <date> |
| [[system]] | Design tokens | design, tokens, color, typography, ... | <date> |
| [[brand]] | Brand identity | design, brand, voice, naming | <date> |

> `showcase.html` — visual validation page. Not in INDEX (not Markdown). Open in browser.

See [`../README.md`](../README.md) for the docs convention.
```

Sort by `updated_at` descending as usual.

### Phase 7 — Capture the Adoption Decision

Use the `distillation` skill to add a one-doc capture under `docs/decisions/` — title like "Adopted design system: <name>", body explaining brand inputs and the reasoning behind major choices. Search the INDEX first; if a prior design-system decision exists, supersede it via `superseded_by` frontmatter.

### Phase 8 — Validation

Run these checks before exiting SETUP:
1. **Contrast** — every text/background pairing in `system.md` meets WCAG AA (4.5:1 / 3:1).
2. **Completeness** — every required section in `system.md` populated.
3. **Consistency** — token names follow convention; no magic numbers in spacing.
4. **Distinctiveness** — apply the "swap test": replace each choice with the most common alternative. Does the system still feel like this brand? It must.
5. **Anti-pattern self-check** — none of `brand.md`'s anti-patterns appear in the generated system itself.
6. **Imperatives** — progressive disclosure, Fitts's, Hick's, Miller's laws (see [`references/design-imperatives.md`](references/design-imperatives.md)).
7. **Platform** — desktop patterns use hover/keyboard properly; mobile respects touch targets / thumb zones (see [`references/desktop-patterns.md`](references/desktop-patterns.md), [`references/mobile-patterns.md`](references/mobile-patterns.md)).

After validation, the skill exits. The next time it activates, it's in USE mode.

## Reference Guides

- [`references/design-imperatives.md`](references/design-imperatives.md) — progressive disclosure, Fitts's law, Hick's law, Miller's law, Jakob's law, Gestalt principles, Doherty threshold, Postel's law, principle of least surprise. **Useful in both USE and SETUP.**
- [`references/desktop-patterns.md`](references/desktop-patterns.md) — desktop layouts, hover, keyboard nav, data tables, split panels, command palettes, sidebar nav. **Useful when building UI in USE mode.**
- [`references/mobile-patterns.md`](references/mobile-patterns.md) — touch targets, thumb zones, bottom sheets, swipe gestures, mobile forms, stack nav, skeleton screens. **Useful when building UI in USE mode.**
- [`references/token-generation-guide.md`](references/token-generation-guide.md) — color math, type scales, spacing systems, motion curves. **Primarily for SETUP**; consult in USE only when extending the system.

## Hard Rules

- **USE mode is read-only.** Never edit `docs/design/` files during a normal UI card. Edits require a dedicated card via the `distillation` skill.
- **No founder questions in USE mode.** Ambiguity becomes a documented assumption on the card.
- **No invented tokens.** Pick the closest existing token or flag the gap; never create `--ad-hoc-color` in component code.
- **SETUP runs once.** If `docs/design/INDEX.md` already lists ≥1 doc, the skill is in USE mode regardless of how invoked.
- **Brand inputs are founder territory.** Brand personality cannot be inferred from the codebase. Only SETUP asks; USE never does.
- **Distinctiveness is a setup requirement.** The system must fail the "swap test" — be opinionated enough that a competitor's defaults wouldn't accidentally produce the same outputs.
- **Never generate Inter, Roboto, Arial, or system font stacks** as the display font.
- **Never generate purple-gradient-on-white** as a color scheme.
- **Always document WCAG contrast ratios** for every text/background pairing.
- **Always generate dark-mode variants** in SETUP.

## Gotchas

- **Confusing USE with style-quality-guardian.** This skill loads design context proactively *during* work. `style-quality-guardian` enforces after the fact, during review. They overlap but the order matters: this skill prevents the violation; the guardian catches it.
- **Re-running SETUP by accident.** If you find yourself in SETUP and `docs/design/INDEX.md` already exists, you took a wrong turn — exit and check why USE mode didn't fire.
- **Reading `brand.md` and `system.md` both for every task.** That's wasteful. Pick the subset (Phase 2 table). Microcopy = brand; component layout = system + screens.
- **Generating new tokens during a UI card.** A new color in component code is a token request, not a UI fix. Surface it as a card-body open question and consider whether `system.md` needs an update via `distillation`.
- **Forgetting `showcase.html` after editing `system.md`.** When `distillation` updates `system.md`, the showcase falls out of sync. Add a note on the card: "regenerate showcase.html when this lands."
- **Marketplace migration shape.** A repo with the older `docs/DESIGN/{BRAND.md, DESIGN_SYSTEM.md, REFERENCE.md}` layout maps cleanly: rename folder to lowercase `design/`, rename files to lowercase + remove underscores (`BRAND.md` → `brand.md`, `DESIGN_SYSTEM.md` → `system.md`), drop `REFERENCE.md` (its job is now `INDEX.md`), add frontmatter to each. Make it a single card; don't bleed migration into other work.
