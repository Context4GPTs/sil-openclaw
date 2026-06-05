---
name: style-quality-guardian
description: "Frontend/UI code review that FIRST discovers project design context (Tailwind config, design tokens, global styles, design-system doc if present) then evaluates code against those conventions. Enforces design system compliance, accessibility (WCAG), performance, and UX patterns. Issues PASS/REVIEW/FAIL verdict."
---

# Style Quality Guardian

Comprehensive post-implementation quality gate for frontend/UI code. Issues verdict: **PASS**, **REVIEW**, or **FAIL**.

## When to Use

- After implementing frontend components or pages
- In the kanban flow: the PR is already open (expert-developer opens it at the in-dev → review transition). You review against the open PR's diff (`git diff <base_branch>...HEAD`), focusing on UI files.
- When asked to review frontend code quality
- When reviewing CSS, styling, or visual design implementation

## Related Skills

- `design-system` — brand tokens, progressive disclosure, platform patterns. See its [references/](../design-system/references/) for design imperatives, desktop patterns, and mobile patterns.

## Review Workflow

### 0. Project Design Context Discovery (MANDATORY FIRST STEP)

**This phase MUST be completed before any other review.** Understand project-wide design decisions to evaluate code correctly.

**Step 0a: Read the design-system docs if they exist**

Look in `docs/design/INDEX.md` first; the entry points are typically `docs/design/system.md` (tokens, typography, spacing, motion, a11y) and `docs/design/brand.md` (voice, anti-patterns, naming). Fall back to scanning anywhere under `docs/` if the project uses an older layout (`docs/DESIGN/`, `docs/design-system/`). These docs are the authoritative source for:

- Brand identity and design principles → `brand.md`
- Color palette with WCAG contrast ratios → `system.md` § Color Palette
- Typography (font families, type scale, text styles) → `system.md` § Typography
- Spacing, border radius, shadow, motion scales → `system.md`
- Component patterns and signature elements → `system.md` § Components
- Anti-patterns to reject → `brand.md` § Anti-Patterns + `system.md` self-checks

**If design-system docs exist, they take precedence over auto-discovered config files.** Code must conform to the docs. Deviations are REVIEW or FAIL.

**Step 0b: Detect implementation files**

```bash
ls -la tailwind.config.{js,ts,mjs,cjs} 2>/dev/null
ls -la **/theme.{js,ts,json} **/tokens.{js,ts,json} **/design-system.{js,ts} 2>/dev/null
ls -la **/globals.css **/global.css **/base.css **/app.css src/styles/*.css 2>/dev/null
ls -la postcss.config.{js,mjs,cjs} .postcssrc* stylelint.config.{js,mjs,cjs} 2>/dev/null
ls -la components.json shadcn.json .storybook/main.{js,ts} 2>/dev/null
```

**Extract and document:**

| Config Type | What to Extract |
|---|---|
| Design system doc | Brand tokens, palette, typography, spacing, patterns, anti-patterns |
| Tailwind | Theme extensions (colors, spacing, fonts), plugins, content paths, custom utilities |
| Design tokens file | Color palette, typography scale, spacing scale, breakpoints, shadows, radii |
| Global styles | CSS custom properties (`--*`), base styles, resets, font imports |
| Component library | Base components (shadcn, Radix, MUI), theming approach |
| CSS methodology | BEM, CSS Modules, Tailwind-only, styled-components, etc. |

**Cross-reference:** If both a design-system doc and implementation files exist, verify they are consistent. Flag drift as REVIEW.

**Output format:**

```markdown
## Project Design Context

**Design System Doc:** [Found / Not Found]
**Brand Identity:** [personality, feel, principles — from doc]
**Styling Approach:** [Tailwind / CSS Modules / Styled Components / etc.]
**Component Library:** [shadcn/ui / Radix / MUI / Custom / None]
**Design Tokens Source:** [doc path + config files]

### Color Palette
- Primary: [value] (WCAG: [ratio])
- ...

### Typography
- Display font: [value]
- Body font: [value]
- Scale: [values]

### Spacing Scale / Breakpoints / Signature Elements / Anti-Patterns / Custom Utilities
- ...
```

**CRITICAL:** All subsequent phases MUST evaluate code against these discovered conventions. Code that follows project conventions is PASS; deviations without reason are REVIEW/FAIL.

### Reference Loading Strategy

Load reference files ONLY for dimensions relevant to the review. Do NOT read all references upfront.

| Review Dimension | Load These References |
|---|---|
| All UI reviews | visual-design-review, accessibility-review, css-review |
| Component changes | component-architecture |
| Layout/responsive changes | responsive-review, performance-review |
| Interaction changes | ux-patterns |
| Progressive disclosure / platform patterns | design-imperatives, desktop-patterns, mobile-patterns (cross-skill via `design-system`) |

### 1. Gather Change Context

```bash
# Use the card's base_branch from frontmatter (typically main or dev) — not a hardcoded branch name.
BASE_BRANCH=$(grep '^base_branch:' "cards/<slug>.md" | awk '{print $2}')
git diff --name-only "$BASE_BRANCH"...HEAD -- "*.tsx" "*.jsx" "*.css" "*.scss" "*.html"
git diff --stat "$BASE_BRANCH"...HEAD
```

Identify: component types, styling approach, framework used.

### 2. Visual Design Quality

See [references/visual-design-review.md](references/visual-design-review.md).

**Evaluate:**
- Typography: distinctive, readable, proper hierarchy
- Color: cohesive palette, proper contrast, intentional usage
- Spacing: consistent rhythm, proper visual hierarchy
- Layout: purposeful composition, appropriate for content
- Motion: meaningful animations, proper timing/easing

**Anti-patterns (REVIEW/FAIL):**
- Generic AI aesthetics (Inter/Roboto on white with purple gradient)
- Inconsistent spacing/sizing
- Poor typography hierarchy
- Clashing or disconnected color choices

### 3. Accessibility Audit (WCAG)

See [references/accessibility-review.md](references/accessibility-review.md).

**Critical checks (FAIL if missing):**
- Semantic HTML structure
- ARIA labels on interactive elements
- Keyboard navigation support
- Focus indicators visible
- Color contrast (4.5:1 text, 3:1 UI)
- Alt text for images
- Form labels and error messages

### 4. Performance Review (Core Web Vitals)

See [references/performance-review.md](references/performance-review.md).

**Evaluate:**
- Bundle size impact (tree-shaking, code splitting)
- Image optimization (formats, lazy loading, sizing)
- CSS efficiency (specificity, unused styles, render-blocking)
- Animation performance (GPU acceleration, paint triggers)
- Hydration efficiency (for SSR/SSG frameworks)

### 5. Responsive Design

See [references/responsive-review.md](references/responsive-review.md).

**Check:**
- Mobile-first approach
- Breakpoint consistency
- Touch targets (min 44×44px)
- Viewport meta tag
- Fluid typography/spacing
- Image `srcset`/`sizes`
- No horizontal scroll

### 6. Component Architecture

See [references/component-architecture.md](references/component-architecture.md).

**Evaluate:** single responsibility, props interface clarity, composition over inheritance, state management appropriateness, reusability, naming conventions.

### 7. CSS Quality

See [references/css-review.md](references/css-review.md).

**Check:** naming methodology, specificity management, CSS custom properties usage, no magic numbers, responsive units (rem/em/%/vw/vh), no `!important` abuse, logical properties (`margin-inline`, etc.).

### 8. UX Patterns

See [references/ux-patterns.md](references/ux-patterns.md) and [design-system references/design-imperatives.md](../design-system/references/design-imperatives.md).

**Evaluate:**
- Loading / error / empty states
- Micro-interactions
- Form UX (validation, progress)
- Navigation clarity
- **Progressive disclosure** — complexity revealed gradually, advanced options hidden until needed, smart defaults
- **Cognitive load** — no more than 7 items at any decision point (Hick's law), info chunked (Miller's law)
- **Touch targets** — 44×44px mobile, 24×24px desktop (Fitts's law)
- **Platform patterns** — desktop uses hover/keyboard properly; mobile uses thumb-zone-friendly placement

### 9. Legacy Code & Backwards Compatibility Detection

**Mandatory.** Legacy frontend code and backwards-compat shims are not tolerated.

**Flag:**
- Vendor prefixes (`-webkit-`, `-moz-`) for well-supported properties
- Polyfills for features supported by target browsers
- Float-based layouts, clearfix hacks
- jQuery or lodash when native APIs exist
- Legacy event handlers (`onclick` attributes)
- IE-specific code or conditional comments
- React class components when hooks would work
- Deprecated React lifecycle methods
- Old CSS-in-JS APIs
- `require()`/`module.exports` in ESM projects
- Comments indicating legacy support

**Legacy frontend code = FAIL. Backwards compatibility patterns = FAIL.**

### 10. Browser Compatibility

Confirm target browser support is defined; CSS fallbacks only when truly needed; no unsupported APIs without polyfills; vendor prefixes only for cutting-edge features.

### 11. Issue Verdict

**PASS** — Production-ready frontend code that follows project design conventions.

**REVIEW** — Minor accessibility improvements, small responsive tweaks, minor token deviations, suggested perf optimizations, minor design-system drift.

**FAIL** —
- Ignores the project design system (hardcoded values instead of design tokens)
- Inconsistent with Tailwind config (custom colors/spacing instead of theme values)
- Legacy frontend code (class components, jQuery, float layouts, deprecated APIs)
- Backwards-compatibility patterns (vendor prefixes / polyfills / feature detection for modern features)
- Missing keyboard navigation
- Color contrast failures
- No focus indicators
- Broken responsive layout
- Severe performance issues
- Inaccessible forms

## Output Template

When writing the review report, use the template in [references/output-template.md](references/output-template.md).

## Integration

```
Design → Implementation → Open PR → Style Quality Guardian (review stage, in parallel with code-quality-guardian) → Distilling → PR Ready
```

- **FAIL** → status flips to `in-dev`, dev pair pushes fixes to the same branch / same PR
- **REVIEW** → same as FAIL — address comments, push, re-review
- **PASS** → coordinated with `code-quality-guardian`; status flips to `distilling` only when BOTH guardians PASS

## Guiding Principles

1. Discover context first — read Tailwind / theme configs / design-system doc before reviewing code
2. Design system compliance is mandatory — hardcoded values where tokens exist = FAIL
3. Accessibility is non-negotiable — WCAG failures are automatic FAIL
4. No legacy, no backwards compatibility
5. Design with intention — every choice should be deliberate
6. Performance is UX — slow UI is bad UI
7. Mobile-first — start with constraints, expand with space
8. Consistency over novelty — match the design system exactly
9. Progressive enhancement — core functionality works everywhere
