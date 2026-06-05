# CSS Quality Review Guide

Maintainable, scalable, performant CSS.

## Naming Methodology

### Good - BEM Naming

```css
/* Good - BEM: Block__Element--Modifier */
.card { }
.card__header { }
.card__title { }
.card__body { }
.card__footer { }
.card--featured { }
.card--compact { }

.button { }
.button--primary { }
.button--secondary { }
.button--large { }
.button__icon { }
.button__text { }
```

### Good - CSS Modules

```tsx
// Good - CSS Modules with meaningful names
import styles from './Button.module.css';

function Button({ variant, children }) {
  return (
    <button className={clsx(styles.button, styles[variant])}>
      {children}
    </button>
  );
}
```

```css
/* Button.module.css */
.button {
  /* Base styles */
}

.primary {
  background: var(--color-primary);
}

.secondary {
  background: var(--color-secondary);
}
```

### REVIEW - Inconsistent Naming

```css
/* REVIEW - Mixed naming conventions */
.card { }
.cardHeader { }           /* camelCase */
.card-body { }            /* kebab-case */
.Card__footer { }         /* Mixed BEM + PascalCase */
.btn-primary { }          /* Different block name */
.button_secondary { }     /* Underscore instead of hyphen */
```

### FAIL - Meaningless Names

```css
/* FAIL - Non-descriptive class names */
.box1 { }
.container2 { }
.wrapper3 { }
.div-style { }
.blue-text { }  /* Describes appearance, not purpose */
.mt-20 { }      /* Hard-coded value */
```

### Naming Checklist

- [ ] Consistent naming methodology (BEM, CSS Modules, etc.)
- [ ] Names describe purpose, not appearance
- [ ] No generic names (box, container, wrapper)
- [ ] No hard-coded values in names (mt-20)

## Specificity Management

### Good - Low Specificity

```css
/* Good - Single class selectors */
.button { }
.button.is-active { }
.card { }
.card-header { }

/* Good - Scoped styles */
.component .element { }  /* Max 2 class depth */
```

### REVIEW - High Specificity

```css
/* REVIEW - Unnecessarily specific */
div.container ul.nav li a.nav-link { }  /* 0,4,4 */

#main .content article .card .card-body p { }  /* 1,4,3 */

/* REVIEW - ID selectors for styling */
#header { }
#navigation { }
```

### FAIL - Specificity Wars

```css
/* FAIL - !important abuse */
.button {
  background: blue !important;
  color: white !important;
  padding: 10px !important;
}

/* FAIL - Extremely high specificity */
body div#app main.container section article.card div.card-body p span {
  color: red;
}
```

### Specificity Guidelines

| Selector Type | Specificity | Use Case |
|---------------|-------------|----------|
| Element | 0,0,1 | Reset styles only |
| Class | 0,1,0 | Primary styling |
| ID | 1,0,0 | Avoid for styling |
| Inline | 1,0,0,0 | Never for styling |
| !important | Trumps all | Avoid except utilities |

### Specificity Checklist

- [ ] No ID selectors for styling
- [ ] No !important (except utility classes)
- [ ] Selectors max 2-3 levels deep
- [ ] Prefer class selectors

## CSS Custom Properties

### Good - Design Tokens

```css
/* Good - Comprehensive custom properties */
:root {
  /* Colors */
  --color-primary: hsl(220, 90%, 56%);
  --color-primary-light: hsl(220, 90%, 70%);
  --color-primary-dark: hsl(220, 90%, 40%);
  --color-text: hsl(220, 20%, 10%);
  --color-text-muted: hsl(220, 10%, 40%);
  --color-background: hsl(0, 0%, 100%);
  --color-surface: hsl(220, 20%, 98%);

  /* Typography */
  --font-family-sans: 'Inter', system-ui, sans-serif;
  --font-family-mono: 'JetBrains Mono', monospace;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.25rem;
  --line-height-tight: 1.25;
  --line-height-normal: 1.5;

  /* Spacing */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-4: 1rem;
  --space-8: 2rem;

  /* Borders */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 1rem;
  --border-width: 1px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);

  /* Transitions */
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --ease-out: cubic-bezier(0.33, 1, 0.68, 1);
}

/* Usage */
.button {
  font-family: var(--font-family-sans);
  font-size: var(--font-size-base);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-primary);
  transition: background var(--duration-fast) var(--ease-out);
}
```

### FAIL - Hard-Coded Values

```css
/* FAIL - Magic numbers everywhere */
.button {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  padding: 8px 16px;
  border-radius: 6px;
  background: #3b82f6;
  transition: background 0.2s ease;
}

.card {
  font-family: 'Inter', sans-serif;  /* Repeated */
  padding: 24px;
  border-radius: 8px;  /* Inconsistent */
  background: #3b82f6;  /* Repeated */
}
```

### Custom Properties Checklist

- [ ] Colors defined as variables
- [ ] Typography scale as variables
- [ ] Spacing scale as variables
- [ ] Border radius scale
- [ ] Shadow scale
- [ ] Transition durations/easings
- [ ] Dark mode uses same variable names

## Responsive Units

### Good - Flexible Units

```css
/* Good - rem for typography */
html {
  font-size: 100%;  /* Respects user preference */
}

body {
  font-size: 1rem;  /* 16px default */
}

h1 {
  font-size: clamp(1.5rem, 1rem + 2vw, 3rem);
}

/* Good - rem/em for spacing */
.section {
  padding: 4rem 2rem;
  max-width: 70ch;  /* Character units for reading */
}

/* Good - Percentage/viewport for layout */
.container {
  width: min(90%, 1200px);
  margin-inline: auto;
}

.hero {
  min-height: 100svh;  /* Small viewport height */
}
```

### REVIEW - Pixel Everything

```css
/* REVIEW - All pixels, not scalable */
body {
  font-size: 14px;
}

h1 {
  font-size: 32px;
  margin-bottom: 24px;
}

.container {
  width: 1200px;
  padding: 20px;
}
```

### Unit Guidelines

| Use Case | Recommended Unit |
|----------|-----------------|
| Font size | rem, clamp() |
| Line height | Unitless (1.5) |
| Spacing | rem, em |
| Border width | px |
| Border radius | rem, px |
| Container width | %, min(), max() |
| Layout | fr, %, vw/vh |
| Media queries | em (for consistency) |

## Modern CSS Features

### Good - Modern Layout

```css
/* Good - Container queries */
.card-container {
  container-type: inline-size;
}

@container (min-width: 400px) {
  .card {
    display: grid;
    grid-template-columns: 200px 1fr;
  }
}

/* Good - Logical properties */
.element {
  margin-inline: auto;
  padding-block: 1rem;
  border-inline-start: 2px solid;
  text-align: start;
}

/* Good - Modern selectors */
.list > :not(:last-child) {
  margin-bottom: 1rem;
}

.input:focus-visible {
  outline: 2px solid var(--color-focus);
}

/* Good - Aspect ratio */
.video-container {
  aspect-ratio: 16 / 9;
}

/* Good - Gap instead of margin */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
}
```

### REVIEW - Outdated Patterns

```css
/* REVIEW - Clearfix (use flexbox/grid) */
.clearfix::after {
  content: '';
  display: table;
  clear: both;
}

/* REVIEW - Float layout */
.sidebar {
  float: left;
  width: 300px;
}

/* REVIEW - Negative margin hacks */
.grid-item {
  margin-right: -1px;
  margin-bottom: -1px;
}
```

## Code Organization

### Good - Organized CSS

```css
/* Good - Logical ordering within rules */
.component {
  /* Positioning */
  position: relative;
  top: 0;
  z-index: 1;

  /* Display & Box Model */
  display: flex;
  align-items: center;
  width: 100%;
  padding: 1rem;
  margin: 0;

  /* Typography */
  font-family: var(--font-sans);
  font-size: 1rem;
  color: var(--color-text);

  /* Visual */
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  /* Animation */
  transition: transform 0.2s ease;
}
```

### REVIEW - Chaotic Order

```css
/* REVIEW - Random property order */
.component {
  color: red;
  position: absolute;
  font-size: 14px;
  display: flex;
  background: blue;
  margin: 10px;
  border: 1px solid;
  width: 100%;
  padding: 20px;
  z-index: 10;
  transition: all 0.3s;
  top: 0;
}
```

## Dead Code & Duplication

### Good - DRY CSS

```css
/* Good - Reusable utilities */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

/* Good - Shared button base */
.btn {
  display: inline-flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-weight: 500;
  transition: all var(--duration-fast) var(--ease-out);
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}

.btn-secondary {
  background: var(--color-surface);
  color: var(--color-text);
}
```

### FAIL - Duplicated Styles

```css
/* FAIL - Same styles repeated */
.card-primary {
  padding: 20px;
  border-radius: 8px;
  background: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.card-secondary {
  padding: 20px;  /* Duplicate */
  border-radius: 8px;  /* Duplicate */
  background: white;  /* Duplicate */
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);  /* Duplicate */
  border: 1px solid #eee;  /* Only difference */
}

/* FAIL - Unused styles */
.old-component { /* Never used */ }
.legacy-button { /* Never used */ }
```

## Performance Considerations

### Good - Efficient CSS

```css
/* Good - Efficient selectors */
.nav-link { }
.card-title { }

/* Good - Contain paint */
.card {
  contain: layout style paint;
}

/* Good - Will-change for animations */
.animated {
  will-change: transform;
}
```

### FAIL - Inefficient CSS

```css
/* FAIL - Universal selector overuse */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: inherit;  /* Don't reset everything */
}

/* FAIL - Expensive selectors */
[class*="btn-"] { }
[data-component] { }

/* FAIL - Will-change overuse */
* {
  will-change: transform, opacity;  /* Memory hog */
}
```

## CSS Quality Checklist

### Naming
- [ ] Consistent methodology (BEM, CSS Modules)
- [ ] Descriptive, purpose-based names
- [ ] No generic or appearance-based names

### Specificity
- [ ] No ID selectors for styling
- [ ] No !important (except utilities)
- [ ] Low specificity selectors

### Custom Properties
- [ ] Design tokens defined
- [ ] Colors, spacing, typography as variables
- [ ] No magic numbers

### Units
- [ ] rem for typography
- [ ] Flexible units for layout
- [ ] px only for borders/small details

### Modern CSS
- [ ] Flexbox/Grid for layout (no floats)
- [ ] Logical properties where appropriate
- [ ] Container queries where beneficial

### Organization
- [ ] Consistent property ordering
- [ ] DRY (Don't Repeat Yourself)
- [ ] No dead/unused code

### Performance
- [ ] Efficient selectors
- [ ] Contain where appropriate
- [ ] Will-change used sparingly
