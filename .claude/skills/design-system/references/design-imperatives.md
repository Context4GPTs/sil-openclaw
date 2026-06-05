# Design Imperatives & Golden Standards

Reference guide for universal design principles that apply across all platforms. These are not suggestions -- they are laws of human cognition and interaction that interfaces must respect.

## Progressive Disclosure

The single most important pattern for managing complexity. Show only what is needed at each moment. Reveal complexity gradually as the user demonstrates intent.

### The Principle

Users should never see more options, controls, or information than they need for their current task. Complexity exists in the system but is hidden behind progressive layers of interaction.

### Levels of Disclosure

```
Level 0: Core Action     — The one thing most users need most of the time
Level 1: Common Options  — Settings and variations used by power users
Level 2: Advanced Config — Full control for experts who know what they want
Level 3: Developer/Debug — Raw access for troubleshooting and customization
```

### Implementation Patterns

**Staged forms:** Break long forms into steps. Show step 1. When completed, reveal step 2. Never show the full form upfront.

```
BAD:  [Name] [Email] [Address] [City] [State] [Zip] [Phone] [Company] [Role] [Submit]
GOOD: Step 1: [Name] [Email] [Next →]
      Step 2: [Address fields] [Next →]
      Step 3: [Review + Submit]
```

**Expandable sections:** Default to collapsed. Expand on click. Only one section open at a time (accordion) for deeply nested content.

```
BAD:  All settings visible in one scrolling page
GOOD: [Account ▸] [Notifications ▸] [Privacy ▸] [Advanced ▸]
      Click "Advanced" → expands to show options
```

**Contextual actions:** Show actions only when relevant. A delete button appears when hovering over an item. Bulk actions appear only when items are selected.

```
BAD:  [Edit] [Delete] [Archive] [Share] [Export] visible on every row always
GOOD: Hover row → [Edit] [⋯] appear
      Click [⋯] → dropdown with [Delete] [Archive] [Share] [Export]
```

**Layered detail:** Summary first, detail on demand. A dashboard card shows the metric. Click reveals the chart. Click the chart reveals the data table.

```
Level 0: "Revenue: $45.2K ↑12%"
Level 1: Click → line chart of revenue over time
Level 2: Click data point → breakdown by source
Level 3: Click source → raw transaction table
```

**Smart defaults:** Pre-fill the most common choice. Let users change it if they need to. 80% of users should never need to touch defaults.

### Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|-------------|-------------|-----|
| Settings dump | Overwhelming, paralysis of choice | Group and collapse |
| "Advanced mode" toggle | Binary complexity is still a wall | Gradual layering |
| Everything in a modal | Hides context, breaks flow | Inline expansion |
| Tooltip overload | Reading tooltips is work | Better labels, progressive sections |
| Feature flags visible to users | Users shouldn't manage product complexity | Hide behind progressive UI |

### Verification

- [ ] Can a first-time user complete the primary task without seeing advanced options?
- [ ] Are advanced options reachable in 1-2 clicks for power users?
- [ ] Does each disclosure level have a clear trigger (click, hover, scroll)?
- [ ] Is the most common path the shortest path?
- [ ] Can users retreat from disclosed complexity (collapse, go back)?

---

## Fitts's Law

The time to reach a target is a function of the distance to and size of the target. Closer and larger targets are faster to hit.

### Practical Application

| Guideline | Example |
|-----------|---------|
| Primary actions should be large | Main CTA button: full width on mobile, prominent on desktop |
| Destructive actions should be small and distant from primary | Delete button: small, positioned away from Save |
| Related controls should be near each other | Form label directly above or beside its input |
| Edge and corner targets are infinitely tall (on desktop) | Navigation at screen edges, close button in corner |
| Touch targets: minimum 44x44px (mobile), 24x24px (desktop) | Icons, checkboxes, toggle switches |

### Common Violations

```
BAD:  [Submit] ............................... [Cancel]
      (Cancel far from Submit forces long mouse travel for common correction)

GOOD: [Cancel] [Submit]
      (Related actions grouped, primary action rightmost/largest)

BAD:  Tiny 16x16px icon-only buttons on mobile
GOOD: 48x48px touch targets with adequate spacing
```

---

## Hick's Law

Decision time increases logarithmically with the number of choices. Fewer choices = faster decisions.

### Practical Application

| Choices | Response | Strategy |
|---------|----------|----------|
| 1-3 | Instant | Show all options |
| 4-7 | Quick scan | Group visually, highlight recommended |
| 8-15 | Deliberation | Categorize, use tabs or sections |
| 15+ | Paralysis | Search, filter, or progressive disclosure |

### Implementation

**Navigation:** Maximum 5-7 top-level items. Use sub-menus for depth.

**Action menus:** Primary action visible, secondary in overflow (⋯). Never show 10+ actions at once.

**Selection lists:** For 15+ items, provide search/filter. For 50+, use autocomplete. Never a flat dropdown with 50 options.

**Settings:** Group into categories of 3-5 items each. One category visible at a time.

### Anti-Patterns

| Anti-Pattern | Fix |
|-------------|-----|
| Mega-menus with 50+ links | Top-level categories, drill-down |
| Flat dropdown with 20+ options | Searchable combobox |
| Dashboard with 15+ widgets | Customizable, default to essentials |
| Toolbar with 20+ icons | Group by function, overflow menu |

---

## Miller's Law

Working memory holds approximately 7 (plus or minus 2) items. Chunk information into groups of 5-9.

### Practical Application

- **Phone numbers:** 555-123-4567 (3 chunks), not 5551234567 (10 digits)
- **Navigation:** 5-7 top-level items, not 12
- **Form sections:** 3-5 fields per visible group
- **Data tables:** 5-7 columns visible, rest in expandable detail
- **Step indicators:** 3-5 steps. If more, group into phases
- **Card grids:** 3-4 cards per row maximum

### Chunking Strategies

```
BAD:  Order #A8F3B2C1D4E5 placed on 2024-03-15T14:32:00Z for $127.50
GOOD: Order #A8F3-B2C1
      March 15, 2024 • 2:32 PM
      $127.50
```

---

## Jakob's Law

Users spend most of their time on OTHER sites. They expect your site to work like the ones they already know.

### Practical Application

| Convention | What Users Expect | Don't Reinvent |
|-----------|-------------------|----------------|
| Logo | Top-left, links to home | Position, behavior |
| Search | Top area, magnifying glass icon | Icon, position |
| Navigation | Top horizontal or left sidebar | Primary patterns |
| Shopping cart | Top-right, bag/cart icon | Icon, position |
| Forms | Label above input, submit at bottom | Layout, flow |
| Links | Blue/underlined or clearly styled | Visual distinction |
| Back | Top-left arrow, or browser back works | Expected behavior |

### When to Break Convention

Only when the departure creates measurably better outcomes AND users can discover the new pattern without instruction. If users need a tutorial, you broke it wrong.

---

## Aesthetic-Usability Effect

Users perceive aesthetically pleasing design as more usable. Beautiful interfaces get more patience, more trust, and more forgiveness for errors.

### Practical Application

- **First impressions matter most:** The first 50ms determine perceived credibility
- **Visual polish signals quality:** Refined shadows, consistent spacing, and thoughtful typography suggest the underlying code is equally careful
- **Error states need design too:** A well-designed error page gets more patience than an unstyled one
- **Loading states are branding moments:** Skeleton screens and custom loaders maintain trust during waits

### Warning

Aesthetic-usability is a double-edged sword. Users may overlook real usability problems in beautiful interfaces. Always validate with usability testing, not just visual reviews.

---

## Gestalt Principles

How humans perceive visual grouping. These are not design choices -- they are cognitive laws.

### Proximity

Elements close together are perceived as a group. Space is the primary grouping mechanism.

```
BAD:  [Label] [Input] [Label] [Input] [Label] [Input]
      (Equal spacing -- which label belongs to which input?)

GOOD: [Label]        [Label]        [Label]
      [Input]        [Input]        [Input]
      (Vertical proximity binds label to input)
```

### Similarity

Elements that look alike are perceived as related.

```
BAD:  Primary button and destructive button look identical
GOOD: Primary: filled blue. Destructive: outlined red. Clearly different intentions.
```

### Continuity

The eye follows lines and curves. Align elements along clear axes.

```
BAD:  Form fields at different indentation levels for no reason
GOOD: All form fields left-aligned on the same vertical axis
```

### Closure

The mind completes incomplete shapes. Use this for icons, loading indicators, progress rings.

### Common Region

Elements within a boundary (card, section, container) are perceived as a group. Use cards and sections to create visual groups.

---

## The Doherty Threshold

System response time should be under 400ms to keep users in a state of flow. Above 1 second, users lose context. Above 10 seconds, users abandon.

### Response Time Budget

| Threshold | User Perception | Required Action |
|-----------|----------------|-----------------|
| < 100ms | Instant | Direct manipulation, no indicator needed |
| 100-400ms | Responsive | Subtle transition or animation |
| 400ms-1s | Noticeable delay | Show progress indicator |
| 1-5s | Waiting | Skeleton screen or progress bar |
| 5-10s | Frustrated | Explain what's happening, show progress % |
| > 10s | Abandonment risk | Background processing + notification |

### Implementation

- **Optimistic updates:** Show the result immediately, sync in background
- **Skeleton screens:** Show the layout shape before content loads
- **Progressive loading:** Render above-the-fold content first
- **Debounced search:** Wait 300ms after typing stops, then search
- **Infinite scroll vs pagination:** Infinite scroll for browsing, pagination for reference

---

## Postel's Law (Robustness Principle)

Be liberal in what you accept, conservative in what you produce.

### In UI Design

| Accept Liberally | Produce Conservatively |
|-----------------|----------------------|
| Phone: (555) 123-4567, 555-123-4567, 5551234567 | Display: (555) 123-4567 |
| Date: 3/15/24, March 15 2024, 2024-03-15 | Display: March 15, 2024 |
| Search: "  react hooks  " (extra spaces) | Parse as: "react hooks" |
| URL: HTTP, HTTPS, with/without www | Normalize to canonical form |

### Practical Application

- Auto-format inputs as the user types (phone, credit card, date)
- Accept multiple input formats, normalize internally
- Trim whitespace, handle case insensitivity in search
- Parse natural language when possible ("next Tuesday", "2 days ago")

---

## Principle of Least Surprise

The system should behave in a way that most users would expect. If an action has surprising consequences, it fails this principle.

### Common Violations

| Surprise | Expected Behavior |
|---------|-------------------|
| Clicking "Save" navigates away from the page | Stay on page, show confirmation |
| Closing a modal discards unsaved changes without warning | Warn if changes exist |
| Selecting an item in a list opens it for editing | Select/highlight it, require explicit edit action |
| Tab key moves focus out of a multi-line text area | Tab inserts a tab character in text editors |
| Back button doesn't go back (SPA routing issue) | Browser back works as expected |

---

## Verification Checklist (All Imperatives)

### Progressive Disclosure
- [ ] Primary task is achievable without encountering advanced options
- [ ] Complexity is layered, not dumped
- [ ] Power users can reach full control in 1-2 interactions
- [ ] Smart defaults eliminate choices for 80% of users

### Cognitive Load
- [ ] No more than 7 items at any decision point (Hick's + Miller's)
- [ ] Information is chunked into scannable groups
- [ ] Navigation has 5-7 top-level items maximum
- [ ] Forms are broken into digestible sections

### Interaction Quality
- [ ] All interactive targets meet minimum size (Fitts's)
- [ ] Primary actions are large and prominent
- [ ] Destructive actions require confirmation and are visually distinct
- [ ] Response time under 400ms for direct manipulation (Doherty)
- [ ] Loading states exist for any operation over 1 second

### Consistency
- [ ] Conventions match what users expect from other products (Jakob's)
- [ ] Similar elements look and behave similarly (Gestalt similarity)
- [ ] Grouping uses proximity and boundaries consistently (Gestalt proximity + common region)
- [ ] No surprising behaviors from common actions (Least Surprise)

### Robustness
- [ ] Inputs accept multiple formats and normalize (Postel's)
- [ ] Error recovery is possible from every state
- [ ] Undo is available for destructive actions
