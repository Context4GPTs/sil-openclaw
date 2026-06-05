# Desktop Design Patterns

Reference guide for desktop-specific UI patterns, layouts, and interaction models. Desktop interfaces benefit from larger viewports, precise pointer input, and keyboard shortcuts -- but must still respect cognitive limits.

## Desktop Viewport Strategy

### Layout Architecture

Desktop layouts exploit horizontal space that mobile cannot. The key decision: how to use the extra width without creating cognitive overload.

**Three canonical desktop layouts:**

```
1. SIDEBAR + CONTENT (file managers, email, admin panels)

   ┌──────┬─────────────────────────────────┐
   │ Nav  │ Content Area                    │
   │      │                                 │
   │ Item │   ┌─────────┐  ┌─────────┐     │
   │ Item │   │ Card    │  │ Card    │     │
   │ Item │   └─────────┘  └─────────┘     │
   │ Item │                                 │
   │      │   ┌─────────┐  ┌─────────┐     │
   │ Item │   │ Card    │  │ Card    │     │
   │      │   └─────────┘  └─────────┘     │
   └──────┴─────────────────────────────────┘

2. MASTER-DETAIL (email readers, messaging, settings)

   ┌──────┬────────────┬────────────────────┐
   │ Nav  │ List       │ Detail             │
   │      │            │                    │
   │      │ ► Item 1   │ Title              │
   │      │   Item 2   │ Content here...    │
   │      │   Item 3   │                    │
   │      │   Item 4   │                    │
   └──────┴────────────┴────────────────────┘

3. FULL-WIDTH + TOP NAV (landing pages, dashboards, content sites)

   ┌─────────────────────────────────────────┐
   │ Logo    Nav    Nav    Nav     [Actions] │
   ├─────────────────────────────────────────┤
   │                                         │
   │   Hero / Primary Content                │
   │                                         │
   │   ┌───────┐ ┌───────┐ ┌───────┐        │
   │   │ Col 1 │ │ Col 2 │ │ Col 3 │        │
   │   └───────┘ └───────┘ └───────┘        │
   └─────────────────────────────────────────┘
```

### Content Width

```
Reading content:    max-width: 65ch-80ch (optimal reading line length)
Dashboard content:  max-width: 1440px (with responsive grid inside)
Admin panels:       Full viewport width (sidebar collapses)
Data tables:        Full viewport width (horizontal scroll as last resort)
```

### Multi-Column Grids

| Viewport | Columns | Gutter | Margin |
|----------|---------|--------|--------|
| 1024-1279px | 12 | 24px | 32px |
| 1280-1535px | 12 | 32px | 48px |
| 1536px+ | 12 | 32px | auto (centered) |

---

## Desktop Interaction Model

### Pointer Precision

Desktop users have a precise pointer (mouse/trackpad). This enables:

- **Hover states:** Reveal information and actions on hover (tooltips, preview cards, action buttons)
- **Right-click context menus:** Frequently used by power users
- **Drag and drop:** Reorder lists, move items between containers, resize panels
- **Resize handles:** Let users control panel/column widths
- **Precise selection:** Click exact pixels, select text ranges

### Hover as Progressive Disclosure

Hover is a desktop-exclusive progressive disclosure mechanism. Use it to reveal:

```
DEFAULT STATE:
┌──────────────────────────────────┐
│ Document Title          Mar 15   │
└──────────────────────────────────┘

HOVER STATE:
┌──────────────────────────────────┐
│ Document Title          Mar 15   │
│              [Edit] [Share] [⋯]  │
└──────────────────────────────────┘
```

**Rules:**
- Hover-revealed content must also be accessible via keyboard (focus)
- Never hide critical information behind hover
- Hover delay: 200-300ms before showing (prevents flicker during casual mouse movement)
- Keep hover targets generous (at least 24x24px)

### Keyboard-First Design

Desktop users expect keyboard navigation. This is both a usability and accessibility requirement.

**Essential keyboard patterns:**

| Pattern | Keys | Context |
|---------|------|---------|
| Navigation | Tab, Shift+Tab | Move between interactive elements |
| Activation | Enter, Space | Buttons, links, toggles |
| Escape | Esc | Close modal, cancel, deselect |
| Selection | Arrow keys | Lists, grids, tabs, menus |
| Multi-select | Cmd/Ctrl+Click, Shift+Click | Lists, tables |
| Quick actions | Single-key shortcuts | Gmail-style (j/k for up/down) |
| Command palette | Cmd/Ctrl+K | Power users, universal search |
| Undo/Redo | Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z | Destructive actions |

**Keyboard shortcut design:**

```
GOOD:
- Single keys for frequent actions (j/k navigation, e to edit)
- Cmd+key for system actions (Cmd+S save, Cmd+K command palette)
- Show shortcuts in tooltips and menu items
- ? key opens shortcut reference

BAD:
- Multi-key combinations for frequent actions (Ctrl+Shift+Alt+S)
- Custom shortcuts that conflict with browser/OS (Ctrl+W, Cmd+Q)
- No way to discover shortcuts
- No way to customize shortcuts
```

### Command Palette

A desktop power-user pattern that enables progressive disclosure through search. Type to filter actions, navigate, execute.

```
┌───────────────────────────────────────┐
│ 🔍 Type a command...                  │
├───────────────────────────────────────┤
│ ► Create new document           ⌘N   │
│   Open settings                 ⌘,   │
│   Toggle dark mode              ⌘D   │
│   Export as PDF                  ⌘E   │
│   View keyboard shortcuts       ?    │
└───────────────────────────────────────┘
```

---

## Desktop Navigation

### Sidebar Navigation

Persistent sidebar for applications with many sections. Collapsible for space recovery.

**States:**

```
EXPANDED (default):              COLLAPSED:
┌──────────────┐                 ┌────┐
│ 🏠 Home      │                 │ 🏠 │
│ 📊 Dashboard │                 │ 📊 │
│ 👥 Users     │                 │ 👥 │
│ ⚙ Settings  │                 │ ⚙ │
│              │                 │    │
│ [◀ Collapse] │                 │ [▶]│
└──────────────┘                 └────┘
```

**Rules:**
- Width: 240-280px expanded, 56-72px collapsed
- Show text labels in expanded state, icon-only when collapsed
- Tooltips on icons in collapsed state
- Remember user's collapse preference (localStorage)
- Active item clearly highlighted
- Maximum 7-9 top-level items (Miller's Law)

### Breadcrumbs

Desktop-specific navigation aid for deep hierarchies.

```
Home / Products / Electronics / Laptops / MacBook Pro
```

**Rules:**
- Show on pages 3+ levels deep
- Each segment is a link except the current page
- Use separators (/ or >) between segments
- Truncate long paths with ellipsis: Home / ... / Laptops / MacBook Pro

### Tabs

Organize related content within a single view. Desktop-appropriate because horizontal space allows multiple visible tabs.

```
[Overview] [Analytics] [Settings] [Activity]
──────────────────────────────────────────────
Content for the selected tab appears here.
```

**Rules:**
- Maximum 5-7 tabs visible
- Overflow: scrollable tab strip with arrow buttons, or "More ▾" dropdown
- Active tab visually distinct (bottom border, filled background)
- Tab order: most used first, settings last

---

## Desktop Data Patterns

### Data Tables

Desktop's unique advantage: space for tabular data.

```
┌────────────────────────────────────────────────────────────┐
│ [Search...]            [Filter ▾]  [Export]                │
├──────┬──────────────┬──────────┬──────────┬───────────────┤
│  ☐   │ Name ↕       │ Status ↕ │ Date ↕   │ Actions       │
├──────┼──────────────┼──────────┼──────────┼───────────────┤
│  ☐   │ John Doe     │ Active   │ Mar 15   │ [⋯]           │
│  ☐   │ Jane Smith   │ Pending  │ Mar 14   │ [⋯]           │
│  ☐   │ Bob Johnson  │ Inactive │ Mar 13   │ [⋯]           │
├──────┴──────────────┴──────────┴──────────┴───────────────┤
│ Showing 1-3 of 124  [← 1 2 3 ... 42 →]                   │
└────────────────────────────────────────────────────────────┘
```

**Progressive disclosure in tables:**
- Level 0: Summary columns (name, status, date)
- Level 1: Expandable row reveals additional details
- Level 2: Click row opens detail view (master-detail or slide-over)
- Level 3: Actions in overflow menu (⋯)

**Rules:**
- Sortable columns with clear indicators (↑↓)
- Sticky header on scroll
- Selection via checkbox column
- Bulk actions appear when items selected
- Pagination or infinite scroll (paginate for reference data, infinite for feeds)
- Column resize handles for data-heavy tables
- Row hover highlight
- Minimum column width to prevent content truncation

### Split Panels

Resizable panels for side-by-side content comparison or detail views.

```
┌─────────────────┐┃┌─────────────────┐
│ Left Panel      │┃│ Right Panel     │
│                 │┃│                 │
│ Source Code     │┃│ Preview         │
│                 │┃│                 │
│                 │┃│                 │
└─────────────────┘┃└─────────────────┘
                   ┃
              Drag handle
```

**Rules:**
- Minimum panel width to prevent content collapse
- Double-click handle to reset to default split
- Remember user's split preference
- Collapse one panel fully when viewport is narrow

---

## Desktop Modal & Dialog Patterns

### Modal Dialogs

Desktop modals can be larger and more content-rich than mobile.

```
          ┌─────────────────────────────────┐
          │ Dialog Title              [✕]   │
          ├─────────────────────────────────┤
          │                                 │
          │ Content area. Can contain       │
          │ forms, lists, previews.         │
          │                                 │
          │ Max width: 600px (forms)        │
          │           960px (content)       │
          │                                 │
          ├─────────────────────────────────┤
          │              [Cancel] [Confirm] │
          └─────────────────────────────────┘
```

**Rules:**
- Esc closes the modal
- Click outside (backdrop) closes non-critical modals
- Focus trapped inside modal
- Return focus to trigger element on close
- Scrollable content area, fixed header/footer
- Maximum 2 actions in footer (primary + secondary)

### Slide-Over Panels

Alternative to modals for detail views. Slides in from the right, preserves main content context.

```
┌─────────────────────────┬──────────────────┐
│ Main Content            │ Detail Panel     │
│ (dimmed but visible)    │                  │
│                         │ [✕ Close]        │
│                         │                  │
│                         │ Form or detail   │
│                         │ content here     │
│                         │                  │
└─────────────────────────┴──────────────────┘
```

**Use instead of modals when:**
- The user needs to reference main content while interacting with the panel
- The detail is a form that might take time to complete
- The content is a preview or inspector view

---

## Desktop Form Patterns

### Layout

Desktop forms exploit horizontal space for multi-column layouts when appropriate.

```
SINGLE COLUMN (long forms, sequential):
┌──────────────────────────────────┐
│ Label                            │
│ [Input                         ] │
│                                  │
│ Label                            │
│ [Input                         ] │
│                                  │
│ Label                            │
│ [Textarea                      ] │
│ [                              ] │
│                                  │
│            [Cancel] [Submit]     │
└──────────────────────────────────┘

TWO COLUMN (related fields, address forms):
┌────────────────┬─────────────────┐
│ First Name     │ Last Name       │
│ [            ] │ [             ] │
│                │                 │
│ City           │ State    Zip    │
│ [            ] │ [     ] [    ] │
└────────────────┴─────────────────┘
```

**Rules:**
- Single column by default (faster completion, less eye movement)
- Two columns only for semantically related fields (first/last name, city/state/zip)
- Never 3+ column forms
- Labels above inputs (not beside -- label-above is faster to scan)
- Tab order follows visual order (left-to-right, top-to-bottom)
- Inline validation after field blur, not on every keystroke

### Keyboard Shortcuts in Forms

| Shortcut | Action |
|----------|--------|
| Tab | Next field |
| Shift+Tab | Previous field |
| Enter | Submit (single-line forms) or next field (multi-step) |
| Esc | Cancel / close |
| Cmd+Enter | Submit (when Enter has another purpose, e.g., textarea) |

---

## Desktop-Specific Progressive Disclosure

### Dashboard Progressive Disclosure

Dashboards are the most complex desktop pattern. They must present an overview without overwhelming.

```
LEVEL 0 (Landing):
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ $45.2K │ │ 1,234  │ │ 98.7%  │ │ 42     │
│ Revenue│ │ Users  │ │ Uptime │ │ Issues │
└────────┘ └────────┘ └────────┘ └────────┘

LEVEL 1 (Click metric card):
┌─────────────────────────────────────────┐
│ Revenue                                 │
│ ┌─────────────────────────────────┐     │
│ │ 📈 Line chart over time          │     │
│ └─────────────────────────────────┘     │
│ [Daily] [Weekly] [Monthly]              │
└─────────────────────────────────────────┘

LEVEL 2 (Click data point):
┌─────────────────────────────────────────┐
│ March 15 Revenue Breakdown             │
│ ┌────────────────┬──────────┐           │
│ │ Source         │ Amount   │           │
│ ├────────────────┼──────────┤           │
│ │ Direct         │ $12,400  │           │
│ │ Organic        │ $8,200   │           │
│ │ Referral       │ $6,100   │           │
│ └────────────────┴──────────┘           │
└─────────────────────────────────────────┘
```

### Toolbar Progressive Disclosure

```
ALWAYS VISIBLE:     [Bold] [Italic] [Link] [Image]
OVERFLOW MENU (⋯):  [Strikethrough] [Code] [Quote] [Table] [Divider]
FORMAT MENU (▾):     Heading 1, Heading 2, Heading 3, Bullet List, Numbered List
```

---

## Verification Checklist

### Layout
- [ ] Content width appropriate for content type (65-80ch for reading, wider for data)
- [ ] Grid system consistent across views
- [ ] Responsive within desktop range (1024px to 2560px+)
- [ ] No horizontal scroll except in explicitly scrollable containers (tables, code)

### Interaction
- [ ] All hover states have keyboard equivalents
- [ ] Keyboard shortcuts documented and discoverable
- [ ] Tab order follows visual layout
- [ ] Focus indicators visible on all interactive elements
- [ ] Right-click context menus where appropriate (optional enhancement)
- [ ] Drag and drop has keyboard alternative

### Navigation
- [ ] Sidebar collapses gracefully
- [ ] Breadcrumbs present for deep hierarchies
- [ ] Active state clear in all navigation
- [ ] Command palette available (Cmd+K) for power users

### Data
- [ ] Tables have sorting, filtering, and search
- [ ] Table headers sticky on scroll
- [ ] Bulk actions available for multi-select
- [ ] Row detail accessible via click or keyboard

### Progressive Disclosure
- [ ] Dashboards show overview first, detail on demand
- [ ] Forms are broken into logical sections
- [ ] Toolbars use overflow menus for secondary actions
- [ ] Settings are grouped and collapsible
