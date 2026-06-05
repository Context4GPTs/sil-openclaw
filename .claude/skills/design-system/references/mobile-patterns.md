# Mobile Design Patterns

Reference guide for mobile-specific UI patterns, touch interaction, and responsive strategies. Mobile design is not "desktop shrunk down" -- it is a fundamentally different interaction model driven by touch, limited viewport, and context of use.

## Mobile-First Philosophy

Design for mobile first, then enhance for larger viewports. This forces clarity of purpose: if it doesn't work on a 375px screen, it might not need to exist.

### Why Mobile-First

1. **Constraint-driven design:** Small screens force you to prioritize what matters
2. **Progressive enhancement:** Add complexity for larger screens rather than removing it
3. **Performance:** Mobile-first CSS is smaller (base styles + additions vs base + overrides)
4. **Reach:** Mobile traffic dominates most categories globally

### Breakpoint Strategy

```css
/* Mobile-first: base styles are mobile */
.component { /* mobile layout */ }

@media (min-width: 640px)  { /* sm: large phones, landscape */ }
@media (min-width: 768px)  { /* md: tablets */ }
@media (min-width: 1024px) { /* lg: laptops, small desktops */ }
@media (min-width: 1280px) { /* xl: desktops */ }
@media (min-width: 1536px) { /* 2xl: large screens */ }
```

---

## Touch Interaction Model

### Touch Targets

Human fingertips are ~11mm wide. Touch targets must accommodate imprecise input.

| Element | Minimum Size | Recommended Size | Minimum Spacing |
|---------|-------------|-----------------|-----------------|
| Buttons | 44x44px | 48x48px | 8px between targets |
| Icons | 44x44px (tap area) | 48x48px | 8px |
| List items | 44px height | 48-56px height | 0 (border separates) |
| Checkboxes | 44x44px (tap area) | 48x48px | 12px |
| Text links | 44px height (tap area) | -- | 8px between links |

**The visual element can be smaller than the touch target.** A 24px icon should have a 48px tap area (padding).

```css
/* Visual icon is 24px, but tap target is 48px */
.icon-button {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-button svg {
  width: 24px;
  height: 24px;
}
```

### Touch Gestures

| Gesture | Usage | Example |
|---------|-------|---------|
| Tap | Primary action | Button press, selection |
| Long press | Secondary actions, context menu | Copy/paste, reorder mode |
| Swipe horizontal | Navigate between pages, dismiss | Carousel, dismiss notification |
| Swipe vertical | Scroll | Natural scrolling |
| Swipe-to-reveal | Row actions | iOS mail: swipe to delete/archive |
| Pull-to-refresh | Reload content | Feed refresh |
| Pinch | Zoom | Images, maps |
| Two-finger scroll | Scroll within scrollable container | Nested scroll areas |

**Rules:**
- Every gesture must have a visible alternative (button, menu item)
- Gestures are not discoverable -- never make them the only way to do something
- Swipe conflicts: horizontal swipe on a vertically scrolling page must be clearly scoped
- Pull-to-refresh only at the top of scrollable content

### Thumb Zone (Reachability)

On mobile, the thumb is the primary input device. Design for the natural thumb arc.

```
ONE-HANDED PHONE USE:

     ┌─────────────────┐
     │ HARD TO REACH   │  ← Navigation, secondary actions
     │                 │
     │ OK TO REACH     │  ← Content, reading area
     │                 │
     │ EASY TO REACH   │  ← Primary actions, bottom nav
     │                 │
     │ ████ NAV BAR ████│  ← Most accessible zone
     └─────────────────┘
```

**Practical implication:**
- Primary actions at the bottom of the screen, not the top
- Navigation bar at the bottom (iOS, Material Design 3)
- FAB (Floating Action Button) in bottom-right corner
- Critical actions should never require reaching the top-left corner

---

## Mobile Navigation

### Bottom Navigation

Primary mobile navigation pattern. Always visible, maximum 5 items.

```
┌─────────────────────────────────────┐
│                                     │
│           Content Area              │
│                                     │
├─────────────────────────────────────┤
│  🏠      📊      ➕      👤      ⚙  │
│ Home  Dashboard  New   Profile  More│
└─────────────────────────────────────┘
```

**Rules:**
- Maximum 5 items (3-5 is ideal)
- Icon + label (icon-only is ambiguous)
- Active state clearly indicated (filled icon, color change, or both)
- No horizontal scrolling in bottom nav
- If more than 5 top-level sections: use "More" item that opens a menu

### Tab Bar (Horizontal Scrolling)

For sub-navigation within a section.

```
┌─────────────────────────────────────┐
│ [All] [Active] [Pending] → scroll  │
├─────────────────────────────────────┤
│                                     │
│ Filtered content here               │
│                                     │
└─────────────────────────────────────┘
```

**Rules:**
- Scrollable horizontally when tabs exceed viewport
- Active tab has clear indicator (underline, filled background)
- Swipe between tab content (gesture optional, not required)

### Hamburger Menu (Drawer)

For secondary navigation. Do NOT use as primary navigation -- it hides discoverability.

```
CLOSED:                    OPEN:
┌─────────────────┐        ┌───────────┬──────┐
│ ☰ App Title     │        │ ☰ Menu    │      │
├─────────────────┤        │           │ dim  │
│                 │        │ Dashboard │ med  │
│ Content         │        │ Settings  │      │
│                 │        │ Help      │      │
│                 │        │ Logout    │      │
└─────────────────┘        └───────────┴──────┘
```

**When to use hamburger:**
- 6+ navigation items that won't fit in bottom nav
- Secondary navigation alongside a bottom nav
- Admin/settings areas with many sections

**When NOT to use:**
- As the only navigation (hides everything)
- For 3-4 items (use bottom nav instead)

### Stack Navigation (Push/Pop)

Mobile's primary navigation model for depth. Screens push onto a stack, back button pops.

```
Screen 1:                Screen 2:                Screen 3:
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ Products        │  →   │ ← Laptops       │  →   │ ← MacBook Pro   │
├─────────────────┤      ├─────────────────┤      ├─────────────────┤
│ Laptops ▸       │      │ MacBook Pro ▸   │      │ Detail view     │
│ Phones ▸        │      │ ThinkPad ▸      │      │                 │
│ Tablets ▸       │      │ XPS ▸           │      │ [Add to Cart]   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

**Rules:**
- Back button (← or swipe from left edge) always goes one level up
- Page title reflects current location
- Swipe-back gesture on iOS (standard, do not override)
- Android: system back button must work correctly

---

## Mobile Progressive Disclosure

Progressive disclosure is even more critical on mobile because viewport space is extremely limited.

### Bottom Sheet

The mobile equivalent of a desktop modal or sidebar. Slides up from the bottom, thumb-reachable.

```
PEEK STATE:          HALF STATE:           FULL STATE:
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│                 │  │                 │  │ ─── (drag)      │
│ Content         │  │                 │  │ Sheet Title      │
│                 │  │ ─── (drag)      │  │                 │
│                 │  │ Sheet Title      │  │ Full content    │
├─ ─── (drag) ───┤  │                 │  │ with actions    │
│ 3 items nearby  │  │ List of items   │  │ and details     │
└─────────────────┘  │ with details    │  │                 │
                     └─────────────────┘  │                 │
                                          └─────────────────┘
```

**Use for:**
- Filters and sort options
- Share menus
- Detail views that don't need a full screen
- Action menus (alternative to dropdowns)
- Map/content overlays

**Rules:**
- Drag handle visible at top (users expect to swipe)
- Dismiss by swiping down or tapping backdrop
- Snap to predefined heights (peek, half, full)
- Never block the status bar

### Action Sheets

Contextual actions triggered by a button or long-press. Mobile equivalent of desktop's context menu.

```
┌─────────────────────────────────────┐
│                                     │
│ Content (dimmed)                    │
│                                     │
├─────────────────────────────────────┤
│ ─── (drag handle)                   │
│                                     │
│ Edit                                │
│ ────────────────────────            │
│ Duplicate                           │
│ ────────────────────────            │
│ Share                               │
│ ────────────────────────            │
│ Delete                    (red)     │
│                                     │
│ ════════════════════════            │
│ Cancel                              │
└─────────────────────────────────────┘
```

**Rules:**
- Destructive actions in red, separated from safe actions
- Cancel always present at bottom
- Maximum 6-7 actions (otherwise use a full screen)
- Each action item: minimum 48px height

### Expandable Cards

Mobile progressive disclosure for lists of content.

```
COLLAPSED:                     EXPANDED:
┌─────────────────────────┐    ┌─────────────────────────┐
│ Order #A8F3  ▾  $127.50 │    │ Order #A8F3  ▴  $127.50 │
└─────────────────────────┘    ├─────────────────────────┤
┌─────────────────────────┐    │ Items: Widget Pro (2)   │
│ Order #B2C1  ▾  $45.00  │    │ Status: Shipped         │
└─────────────────────────┘    │ Tracking: 1Z999...      │
                               │ [View Details] [Help]   │
                               └─────────────────────────┘
                               ┌─────────────────────────┐
                               │ Order #B2C1  ▾  $45.00  │
                               └─────────────────────────┘
```

### Skeleton Screens

Mobile's primary loading pattern. Shows the layout shape before content arrives.

```
LOADING:                       LOADED:
┌─────────────────────────┐    ┌─────────────────────────┐
│ ██████████              │    │ John Doe                │
│ ████████████████        │    │ Software Engineer       │
│                         │    │                         │
│ ┌──────┐ ████████████   │    │ ┌──────┐ Posted 2h ago │
│ │ ░░░░ │ ████████████   │    │ │ IMG  │ Great article │
│ │ ░░░░ │ ██████████     │    │ │      │ about React...│
│ └──────┘                │    │ └──────┘               │
└─────────────────────────┘    └─────────────────────────┘
```

**Rules:**
- Match the actual layout shape (not a generic spinner)
- Animate with a subtle shimmer (left-to-right pulse)
- Load above-the-fold content first
- Transition smoothly from skeleton to content (fade-in)

---

## Mobile Form Patterns

### Input Design

```
LABEL ABOVE INPUT (standard):
┌─────────────────────────────────────┐
│ Email                               │
│ ┌─────────────────────────────────┐ │
│ │ you@example.com                 │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Password                            │
│ ┌─────────────────────────────┬───┐ │
│ │ ••••••••                    │ 👁 │ │
│ └─────────────────────────────┴───┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │          Sign In                │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Rules:**
- Labels above inputs (not beside -- mobile has no horizontal space)
- Input height: minimum 48px
- Full-width inputs (no side-by-side on narrow screens, except short fields like month/year)
- Show/hide password toggle
- Appropriate keyboard type (`inputmode="email"`, `inputmode="tel"`, `inputmode="numeric"`)
- Autocomplete attributes for browser autofill
- Clear button (✕) inside text inputs for quick clearing

### Multi-Step Forms (Progressive Disclosure)

Long forms must be broken into steps on mobile. Never show a 10-field form on a 375px screen.

```
Step 1 of 3:                   Step 2 of 3:
┌─────────────────────────┐    ┌─────────────────────────┐
│ ● ○ ○  Create Account   │    │ ● ● ○  Your Details     │
├─────────────────────────┤    ├─────────────────────────┤
│                         │    │                         │
│ Email                   │    │ First Name              │
│ [                     ] │    │ [                     ] │
│                         │    │                         │
│ Password                │    │ Last Name               │
│ [                     ] │    │ [                     ] │
│                         │    │                         │
│                         │    │ Phone (optional)        │
│                         │    │ [                     ] │
│                         │    │                         │
│          [Next →]       │    │   [← Back]   [Next →]  │
└─────────────────────────┘    └─────────────────────────┘
```

**Rules:**
- Progress indicator (dots, steps, or progress bar)
- 2-4 fields per step
- Back button to revisit previous steps
- Validate each step before advancing
- Final step shows summary for review before submit

### Native Input Types

| Input | `type` / `inputmode` | Keyboard |
|-------|---------------------|----------|
| Email | `type="email"` | @ key prominent |
| Phone | `type="tel"` | Numeric pad |
| Number | `inputmode="numeric"` | Number pad |
| Search | `type="search"` | Search/Go button |
| URL | `type="url"` | .com key, / key |
| Date | `type="date"` | Native date picker |
| Password | `type="password"` | Standard + show/hide |

---

## Mobile Content Patterns

### Lists

Lists are the fundamental mobile content pattern. Optimize for scanning.

```
SIMPLE LIST:                   LIST WITH ACTIONS:
┌─────────────────────────┐    ┌─────────────────────────┐
│ 🟢 John Doe       ▸    │    │ John Doe         [Edit] │
│ ─────────────────────── │    │ john@example.com        │
│ 🔴 Jane Smith      ▸    │    │ ─────────────────────── │
│ ─────────────────────── │    │ Jane Smith       [Edit] │
│ 🟡 Bob Johnson     ▸    │    │ jane@example.com        │
└─────────────────────────┘    └─────────────────────────┘
```

**Rules:**
- Item height: 48-72px depending on content density
- Left-to-right: icon/avatar, primary text, secondary text, chevron/action
- Swipe-to-reveal for secondary actions (delete, archive)
- Pull-to-refresh at top
- Infinite scroll for feeds, pagination for reference data

### Cards

Cards group related content and actions. Mobile cards are full-width.

```
┌─────────────────────────────────────┐
│ ┌─────────────────────────────────┐ │
│ │         Image Area              │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
│ Title                               │
│ Description text that wraps to      │
│ multiple lines on narrow screens.   │
│                                     │
│ [Action 1]              [Action 2]  │
└─────────────────────────────────────┘
```

**Rules:**
- Full-width on phones (no side-by-side cards below 640px)
- 2 columns on tablets (640px+)
- Maximum 2 actions per card
- Image aspect ratio consistent within a list of cards

### Empty States

Critical on mobile where the screen is limited and emptiness feels broken.

```
┌─────────────────────────────────────┐
│                                     │
│                                     │
│           📭                        │
│                                     │
│      No messages yet               │
│                                     │
│   When you receive messages,       │
│   they'll appear here.             │
│                                     │
│   [Compose Message]                │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

**Rules:**
- Illustration or icon (not blank space)
- Clear explanation of why it's empty
- Action to resolve the empty state (if applicable)
- Don't show empty containers that the user can't fill

---

## Mobile Performance

### Critical Metrics

| Metric | Target | Impact |
|--------|--------|--------|
| First Contentful Paint | < 1.8s | User sees something fast |
| Largest Contentful Paint | < 2.5s | Main content visible |
| Time to Interactive | < 3.8s | User can interact |
| Cumulative Layout Shift | < 0.1 | Nothing jumps around |
| First Input Delay | < 100ms | Taps respond instantly |

### Mobile-Specific Optimizations

- **Image optimization:** WebP/AVIF, srcset for device pixel ratio, lazy loading below the fold
- **Font loading:** `font-display: swap`, subset fonts, preload critical fonts
- **Touch responsiveness:** No 300ms tap delay (`touch-action: manipulation`)
- **Viewport stability:** Set explicit dimensions on images/videos to prevent layout shift
- **Reduce motion:** Respect `prefers-reduced-motion` (conserve battery, reduce distraction)
- **Offline support:** Service worker for core functionality, offline-first for data entry

---

## Verification Checklist

### Touch
- [ ] All touch targets minimum 44x44px
- [ ] Minimum 8px spacing between touch targets
- [ ] Primary actions in thumb-reachable zone (bottom of screen)
- [ ] No hover-dependent functionality
- [ ] Gestures have visible button alternatives

### Navigation
- [ ] Bottom navigation for 3-5 primary sections
- [ ] Back button / swipe-back works correctly
- [ ] No nested scroll conflicts (horizontal inside vertical)
- [ ] Deep links work (URL opens correct screen state)

### Progressive Disclosure
- [ ] Forms broken into steps (max 3-4 fields visible at once)
- [ ] Bottom sheets for contextual actions (not modals)
- [ ] Expandable cards for list detail
- [ ] Skeleton screens for loading states

### Content
- [ ] Full-width cards on phones (no cramped side-by-side)
- [ ] Lists optimized for scanning (icon + primary + secondary + action)
- [ ] Empty states designed (illustration + explanation + CTA)
- [ ] Text readable without zooming (minimum 16px body)

### Performance
- [ ] LCP under 2.5s on 3G connection
- [ ] No layout shift (CLS < 0.1)
- [ ] Images lazy-loaded below the fold
- [ ] Touch interactions respond in < 100ms
- [ ] `prefers-reduced-motion` respected

### Input
- [ ] Correct keyboard type for each input (`email`, `tel`, `numeric`)
- [ ] Autocomplete attributes set for browser autofill
- [ ] Input height minimum 48px
- [ ] Labels above inputs (not beside)
- [ ] Clear button on text inputs
