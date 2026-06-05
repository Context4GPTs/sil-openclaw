# Visual Design Review Guide

Evaluate frontend implementations against high-quality design standards, avoiding generic AI aesthetics.

## Typography

### Good - Intentional Typography

```css
/* Good - Clear hierarchy with distinctive fonts */
:root {
  --font-display: 'Playfair Display', serif;
  --font-body: 'Source Sans Pro', sans-serif;

  --text-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);
  --text-sm: clamp(0.875rem, 0.8rem + 0.35vw, 1rem);
  --text-base: clamp(1rem, 0.9rem + 0.5vw, 1.125rem);
  --text-lg: clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem);
  --text-xl: clamp(1.5rem, 1.2rem + 1.5vw, 2.25rem);
  --text-2xl: clamp(2rem, 1.5rem + 2.5vw, 3.5rem);
}

h1 {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
```

### REVIEW - Generic Typography

```css
/* REVIEW - Default system fonts, no personality */
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 16px;
  line-height: 1.5;
}

h1 { font-size: 2rem; }
h2 { font-size: 1.5rem; }
/* No letter-spacing, no fluid sizing, no character */
```

### Typography Checklist

- [ ] Distinctive, intentional font choices (not Inter, Roboto, Arial)
- [ ] Clear typographic hierarchy (3-4 levels)
- [ ] Proper line-height for readability (1.4-1.6 for body)
- [ ] Letter-spacing adjustments for headings
- [ ] Fluid typography (clamp or media queries)
- [ ] Consistent vertical rhythm

## Color System

### Good - Cohesive Color System

```css
:root {
  /* Semantic color system */
  --color-primary: hsl(220, 90%, 56%);
  --color-primary-light: hsl(220, 90%, 70%);
  --color-primary-dark: hsl(220, 90%, 40%);

  --color-surface: hsl(220, 20%, 98%);
  --color-surface-elevated: hsl(0, 0%, 100%);

  --color-text: hsl(220, 20%, 10%);
  --color-text-muted: hsl(220, 10%, 40%);

  /* Functional colors */
  --color-success: hsl(150, 60%, 40%);
  --color-warning: hsl(40, 90%, 50%);
  --color-error: hsl(0, 70%, 50%);
}
```

### REVIEW - Disconnected Colors

```css
/* REVIEW - Random colors, no system */
.header { background: #6366f1; }  /* Purple */
.button { background: #22c55e; }  /* Green */
.card { background: #fafafa; }
.text { color: #1a1a1a; }
/* No relationship between colors */
```

### FAIL - Contrast Violations

```css
/* FAIL - Low contrast, unreadable */
.subtle-text {
  color: #999999;
  background: #f5f5f5;  /* ~2:1 contrast ratio */
}
```

### Color Checklist

- [ ] Defined color system with CSS variables
- [ ] Semantic color naming (not color-blue, color-red)
- [ ] Proper contrast ratios (4.5:1 text, 3:1 UI elements)
- [ ] Color not sole indicator of meaning
- [ ] Cohesive palette with clear relationships
- [ ] Dark mode support (if applicable)

## Spacing System

### Good - Consistent Spacing Scale

```css
:root {
  /* 4px base scale */
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-12: 3rem;    /* 48px */
  --space-16: 4rem;    /* 64px */
}

.card {
  padding: var(--space-6);
  margin-bottom: var(--space-4);
  gap: var(--space-3);
}
```

### REVIEW - Inconsistent Spacing

```css
/* REVIEW - Magic numbers everywhere */
.card {
  padding: 23px;
  margin-bottom: 17px;
}

.button {
  padding: 11px 19px;
  margin-right: 7px;
}
/* No system, hard to maintain */
```

### Spacing Checklist

- [ ] Defined spacing scale (4px or 8px base)
- [ ] Consistent use of scale throughout
- [ ] No magic numbers
- [ ] Logical properties used (margin-inline, padding-block)
- [ ] Gap for flex/grid layouts (not margin hacks)

## Layout & Composition

### Good - Intentional Layout

```css
/* Good - Purposeful grid with asymmetry */
.hero {
  display: grid;
  grid-template-columns: 1fr 1.618fr; /* Golden ratio */
  gap: var(--space-8);
  align-items: center;
}

/* Good - Interesting whitespace */
.section {
  padding-block: var(--space-16);
}

.section-header {
  margin-bottom: var(--space-12);
}
```

### REVIEW - Generic Layout

```css
/* REVIEW - Cookie-cutter centered layout */
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

/* Everything centered, no visual interest */
.hero {
  text-align: center;
  padding: 60px 20px;
}
```

### Layout Checklist

- [ ] Purposeful composition (not everything centered)
- [ ] Appropriate content width (60-80ch for reading)
- [ ] Visual hierarchy through spacing
- [ ] Interesting negative space
- [ ] Grid/flexbox used appropriately

## Motion & Animation

### Good - Meaningful Motion

```css
/* Good - Purposeful, refined animation */
:root {
  --ease-out: cubic-bezier(0.33, 1, 0.68, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
}

.button {
  transition: transform var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Staggered entrance animation */
.card {
  animation: fadeInUp var(--duration-normal) var(--ease-out) backwards;
}

.card:nth-child(1) { animation-delay: 0ms; }
.card:nth-child(2) { animation-delay: 100ms; }
.card:nth-child(3) { animation-delay: 200ms; }

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
}
```

### REVIEW - Generic/Excessive Motion

```css
/* REVIEW - Default linear timing */
.button {
  transition: all 0.3s linear;  /* 'all' is expensive, linear is mechanical */
}

/* REVIEW - Motion without purpose */
.logo {
  animation: spin 2s infinite;  /* Why is it spinning? */
}
```

### FAIL - Inaccessible Motion

```css
/* FAIL - No reduced motion support */
.hero {
  animation: parallax 1s;
}

/* Should include: */
@media (prefers-reduced-motion: reduce) {
  .hero {
    animation: none;
  }
}
```

### Motion Checklist

- [ ] Custom easing curves (not linear)
- [ ] Appropriate durations (150-400ms typically)
- [ ] `prefers-reduced-motion` respected
- [ ] Motion has purpose (feedback, orientation, delight)
- [ ] GPU-accelerated properties (transform, opacity)
- [ ] No janky animations (avoid animating layout properties)

## Visual Polish

### Good - Refined Details

```css
/* Good - Thoughtful shadows */
.card {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 4px 8px rgba(0, 0, 0, 0.04),
    0 12px 24px rgba(0, 0, 0, 0.06);
}

/* Good - Subtle texture/depth */
.surface {
  background:
    linear-gradient(180deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 100%),
    var(--color-surface);
}

/* Good - Refined borders */
.input {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
}

.input:focus {
  border-color: var(--color-primary);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.05),
    0 0 0 3px rgba(var(--color-primary-rgb), 0.2);
}
```

### REVIEW - Flat/Unrefined

```css
/* REVIEW - No depth or polish */
.card {
  background: white;
  border: 1px solid #eee;
}

.button {
  background: blue;
  color: white;
}
/* No shadows, no gradients, no refinement */
```

## Anti-Patterns to Flag

### Generic AI Aesthetics (REVIEW/FAIL)

```css
/* FAIL - Classic AI slop */
.hero {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  /* Purple gradient on white - seen 10,000 times */
}

body {
  font-family: 'Inter', sans-serif;
  /* The most generic choice possible */
}

.card {
  border-radius: 16px;
  background: white;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  /* Template card styling */
}
```

### Inconsistency (REVIEW)

```css
/* REVIEW - Inconsistent radius */
.card { border-radius: 8px; }
.button { border-radius: 4px; }
.modal { border-radius: 12px; }
.input { border-radius: 6px; }

/* REVIEW - Inconsistent shadows */
.card { box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.dropdown { box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
.tooltip { box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
```

## Visual Design Checklist

### Typography
- [ ] Distinctive font choices
- [ ] Clear hierarchy
- [ ] Proper line-height and letter-spacing
- [ ] Fluid sizing

### Color
- [ ] Defined system with CSS variables
- [ ] Proper contrast ratios
- [ ] Cohesive palette
- [ ] Semantic naming

### Spacing
- [ ] Consistent scale
- [ ] No magic numbers
- [ ] Logical properties

### Layout
- [ ] Purposeful composition
- [ ] Appropriate content width
- [ ] Visual hierarchy

### Motion
- [ ] Meaningful animations
- [ ] Custom easing
- [ ] Reduced motion support
- [ ] GPU-accelerated

### Polish
- [ ] Refined shadows
- [ ] Thoughtful borders
- [ ] Consistent radius scale
- [ ] Attention to detail

### Avoid
- [ ] No generic AI aesthetics
- [ ] No inconsistent values
- [ ] No cookie-cutter layouts
- [ ] No meaningless motion
