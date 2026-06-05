# Token Generation Guide

Detailed guidance for Phase 2 of the design system generation workflow. Each section below describes how to derive design tokens from brand identity inputs.

## Color Palette

Generate a complete color system:

1. **Primary palette** -- 3 shades (light, base, dark) derived from brand personality
   - Bold/energetic brands: saturated, high-contrast primaries
   - Calm/trustworthy brands: desaturated, cooler primaries
   - Playful brands: warm, vibrant primaries
   - Technical/precise brands: cooler, muted primaries

2. **Secondary palette** -- complementary or analogous to primary, 3 shades

3. **Neutral scale** -- 10-step scale (50-900)
   - Warm brands: neutrals with warm undertones
   - Cool brands: neutrals with cool undertones
   - The neutral scale must work for text, borders, backgrounds

4. **Semantic colors** -- success (green), warning (amber), error (red), info (blue)
   - Adjust hue/saturation to harmonize with the primary palette

5. **Surface colors** -- background, elevated, sunken, overlay

6. **Dark mode** -- invert the hierarchy, adjust contrast

**CRITICAL: Calculate WCAG contrast ratios.** Every color pairing used for text must meet:
- 4.5:1 for normal text (AA)
- 3:1 for large text and UI elements (AA)

Document the contrast ratio in the table. If a color fails, adjust it.

## Typography

1. **Font selection** based on brand personality:
   - Display font: distinctive, characterful (NOT Inter, Roboto, Arial, system fonts)
   - Body font: readable, pairs well with display
   - Mono font: for code blocks if relevant

2. **Type scale** using a modular ratio:
   - Compact/technical: 1.2 (minor third)
   - Balanced/general: 1.25 (major third)
   - Spacious/editorial: 1.333 (perfect fourth)
   - Dramatic/hero: 1.5 (perfect fifth)

3. **Fluid sizing** with `clamp()` for every step

4. **Text styles** -- define weight, letter-spacing, line-height for each semantic style (Display, H1-H3, Body, Caption, Code)

## Spacing, Borders, Shadows, Motion

Generate scales that match the brand:
- Dense/technical interfaces: tighter spacing (4px base), smaller radii, subtle shadows
- Spacious/luxury interfaces: generous spacing (8px base), larger radii, layered shadows
- Playful interfaces: rounded radii, bouncy easing, visible shadows
- Minimal interfaces: sharp or subtle radii, restrained motion, barely-there shadows

## Component Patterns & Signature Elements

Define 3-5 visual elements unique to this product. These create recognition:
- What makes a button in this product different from a generic button?
- What visual detail would someone remember after using the product once?
- What micro-interaction is distinctly "this product"?

## Progressive Disclosure Strategy

Every design system must define how complexity is managed. Reference [design-imperatives.md](design-imperatives.md) for the full framework, then document:

1. **Disclosure levels** for the product's primary interface:
   - Level 0 (Core): What does the user see on first load?
   - Level 1 (Common): What appears after the first interaction?
   - Level 2 (Advanced): What requires deliberate exploration?
   - Level 3 (Expert): What is hidden behind settings or developer tools?

2. **Platform-specific disclosure patterns:**
   - Desktop: hover reveals, command palette, sidebar collapse, expandable sections
   - Mobile: bottom sheets, action sheets, expandable cards, multi-step forms
   - Reference [desktop-patterns.md](desktop-patterns.md) and [mobile-patterns.md](mobile-patterns.md) for pattern details

3. **Smart defaults:** What decisions does the system make for the user? What does the 80% path look like?

## Anti-Patterns

Based on Q5 (what this must NOT look like), document specific anti-patterns with "Instead" alternatives. Also consult the design imperatives (Hick's law, Fitts's law, etc.) to identify cognitive load violations.
