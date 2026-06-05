# Responsive Design Review Guide

Mobile-first, fluid, accessible on all devices.

## Breakpoint System

### Standard Breakpoints

```css
/* Mobile-first approach */
:root {
  --breakpoint-sm: 640px;   /* Small devices */
  --breakpoint-md: 768px;   /* Tablets */
  --breakpoint-lg: 1024px;  /* Laptops */
  --breakpoint-xl: 1280px;  /* Desktops */
  --breakpoint-2xl: 1536px; /* Large screens */
}

/* Base styles (mobile) */
.container {
  padding: 1rem;
}

/* Progressive enhancement */
@media (min-width: 768px) {
  .container {
    padding: 2rem;
  }
}

@media (min-width: 1024px) {
  .container {
    padding: 3rem;
    max-width: 1200px;
    margin: 0 auto;
  }
}
```

### REVIEW - Inconsistent Breakpoints

```css
/* REVIEW - Random breakpoints */
@media (max-width: 767px) { }
@media (min-width: 768px) and (max-width: 991px) { }
@media (min-width: 992px) and (max-width: 1199px) { }
@media (min-width: 1200px) { }
/* Not using a consistent system */
```

## Mobile-First Approach

### Good - Mobile-First

```css
/* Good - Start with mobile, enhance upward */
.grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

@media (min-width: 768px) {
  .grid {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .grid-item {
    flex: 0 0 50%;
  }
}

@media (min-width: 1024px) {
  .grid-item {
    flex: 0 0 33.333%;
  }
}
```

### REVIEW - Desktop-First

```css
/* REVIEW - Desktop-first (harder to maintain) */
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}

@media (max-width: 1023px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 767px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
```

## Touch Targets

### Good - Adequate Touch Targets

```css
/* Good - 44x44px minimum touch targets */
.button {
  min-height: 44px;
  min-width: 44px;
  padding: 12px 24px;
}

/* Good - Spacing between touch targets */
.nav-list {
  display: flex;
  gap: 8px;  /* Prevents accidental taps */
}

.nav-link {
  padding: 12px 16px;
  min-height: 44px;
  display: flex;
  align-items: center;
}

/* Good - Larger tap area than visual */
.icon-button {
  width: 32px;
  height: 32px;
  padding: 6px;  /* Total: 44x44px tap area */
  position: relative;
}

.icon-button::before {
  content: '';
  position: absolute;
  inset: -6px;  /* Extend tap area */
}
```

### FAIL - Small Touch Targets

```css
/* FAIL - Too small for touch */
.small-button {
  width: 24px;
  height: 24px;
  padding: 4px;
}

/* FAIL - Links too close together */
.footer-links a {
  font-size: 12px;
  margin-right: 4px;  /* Easy to tap wrong link */
}
```

### Touch Target Checklist

- [ ] All interactive elements ≥44x44px on touch devices
- [ ] Minimum 8px spacing between touch targets
- [ ] Form inputs have adequate height
- [ ] Links have sufficient padding

## Viewport and Zoom

### Good - Proper Viewport

```html
<!-- Good - Standard responsive viewport -->
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

```css
/* Good - Respects user zoom preferences */
html {
  font-size: 100%;  /* Don't set fixed px size */
}

body {
  font-size: 1rem;
}

/* Good - Text readable without zoom */
body {
  font-size: clamp(1rem, 0.9rem + 0.5vw, 1.125rem);
  line-height: 1.6;
}
```

### FAIL - Blocking Zoom

```html
<!-- FAIL - Blocks user zoom (accessibility violation) -->
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
```

```css
/* FAIL - Fixed font sizes */
body {
  font-size: 14px;  /* Can't scale with user preferences */
}
```

## Fluid Typography & Spacing

### Good - Fluid Sizing

```css
/* Good - Fluid typography with clamp */
:root {
  --text-sm: clamp(0.875rem, 0.8rem + 0.25vw, 1rem);
  --text-base: clamp(1rem, 0.9rem + 0.5vw, 1.125rem);
  --text-lg: clamp(1.25rem, 1rem + 1vw, 1.5rem);
  --text-xl: clamp(1.5rem, 1rem + 2vw, 2.5rem);
  --text-2xl: clamp(2rem, 1rem + 4vw, 4rem);

  /* Fluid spacing */
  --space-sm: clamp(0.5rem, 0.25rem + 1vw, 1rem);
  --space-md: clamp(1rem, 0.5rem + 2vw, 2rem);
  --space-lg: clamp(2rem, 1rem + 4vw, 4rem);
}

h1 {
  font-size: var(--text-2xl);
  margin-bottom: var(--space-md);
}
```

### REVIEW - Fixed Sizing

```css
/* REVIEW - Fixed sizes requiring many breakpoints */
h1 {
  font-size: 24px;
}

@media (min-width: 768px) {
  h1 { font-size: 32px; }
}

@media (min-width: 1024px) {
  h1 { font-size: 48px; }
}

/* Better: clamp(1.5rem, 1rem + 2vw, 3rem) */
```

## Responsive Images

### Good - Responsive Images

```html
<!-- Good - Art direction with picture -->
<picture>
  <source
    media="(min-width: 1024px)"
    srcset="/hero-wide.webp"
  />
  <source
    media="(min-width: 640px)"
    srcset="/hero-medium.webp"
  />
  <img
    src="/hero-mobile.webp"
    alt="Hero image"
    width="400"
    height="300"
    loading="eager"
  />
</picture>

<!-- Good - Resolution switching -->
<img
  srcset="
    /product-400.jpg 400w,
    /product-800.jpg 800w,
    /product-1200.jpg 1200w
  "
  sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
  src="/product-800.jpg"
  alt="Product"
  width="800"
  height="600"
  loading="lazy"
/>
```

### FAIL - Non-Responsive Images

```html
<!-- FAIL - Same large image for all devices -->
<img src="/hero-2000px.jpg" alt="Hero" />

<!-- FAIL - No srcset for varying screens -->
<img src="/product.jpg" width="400" alt="Product" />
```

## Layout Patterns

### Good - Responsive Layout

```css
/* Good - Fluid grid */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: var(--space-md);
}

/* Good - Container queries (where supported) */
.card-container {
  container-type: inline-size;
}

@container (min-width: 400px) {
  .card {
    display: flex;
    flex-direction: row;
  }
}

/* Good - Flexible sidebar layout */
.page-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-lg);
}

@media (min-width: 1024px) {
  .page-layout {
    grid-template-columns: 1fr 300px;
  }
}
```

### FAIL - Rigid Layout

```css
/* FAIL - Fixed widths causing overflow */
.container {
  width: 1200px;  /* Overflows on smaller screens */
}

.sidebar {
  width: 300px;
  float: left;  /* Breaks on mobile */
}
```

## No Horizontal Scroll

### Good - Contained Content

```css
/* Good - Prevent overflow */
html, body {
  overflow-x: hidden;
}

img, video, iframe {
  max-width: 100%;
  height: auto;
}

/* Good - Handle long words */
.content {
  overflow-wrap: break-word;
  word-wrap: break-word;
  hyphens: auto;
}

/* Good - Responsive tables */
.table-container {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
```

### FAIL - Horizontal Overflow

```css
/* FAIL - Fixed width causing scroll */
.hero-image {
  width: 1400px;  /* Wider than viewport */
}

/* FAIL - Uncontained absolute positioning */
.decoration {
  position: absolute;
  right: -200px;  /* Extends beyond viewport */
}
```

### Horizontal Scroll Checklist

- [ ] No fixed widths exceeding viewport
- [ ] All images have `max-width: 100%`
- [ ] Tables wrapped in scrollable container
- [ ] Absolute positioned elements contained
- [ ] Long words/URLs break properly

## Responsive Navigation

### Good - Mobile Navigation

```tsx
// Good - Hamburger menu for mobile
function Navigation() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav>
      {/* Desktop nav */}
      <ul className="nav-desktop">
        <li><a href="/">Home</a></li>
        <li><a href="/about">About</a></li>
      </ul>

      {/* Mobile hamburger */}
      <button
        className="nav-toggle"
        aria-expanded={isOpen}
        aria-controls="mobile-nav"
        aria-label="Toggle navigation"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="hamburger" />
      </button>

      {/* Mobile nav */}
      <ul
        id="mobile-nav"
        className={`nav-mobile ${isOpen ? 'is-open' : ''}`}
      >
        <li><a href="/">Home</a></li>
        <li><a href="/about">About</a></li>
      </ul>
    </nav>
  );
}
```

```css
.nav-desktop {
  display: none;
}

.nav-toggle {
  display: flex;
  min-width: 44px;
  min-height: 44px;
}

.nav-mobile {
  display: none;
}

.nav-mobile.is-open {
  display: flex;
  flex-direction: column;
}

@media (min-width: 768px) {
  .nav-desktop {
    display: flex;
  }

  .nav-toggle,
  .nav-mobile {
    display: none;
  }
}
```

## Testing Responsive Design

### Devices to Test

1. **Mobile portrait**: 320px, 375px, 414px
2. **Mobile landscape**: 568px, 667px, 896px
3. **Tablet portrait**: 768px, 820px
4. **Tablet landscape**: 1024px, 1180px
5. **Desktop**: 1280px, 1440px, 1920px

### Testing Checklist

- [ ] Chrome DevTools device emulation
- [ ] Real device testing (iOS, Android)
- [ ] Portrait and landscape orientations
- [ ] Touch interactions work
- [ ] No horizontal scroll at any size
- [ ] Text readable without zoom
- [ ] Images scale properly
- [ ] Navigation usable at all sizes

## Responsive Design Checklist

### Viewport
- [ ] Proper viewport meta tag
- [ ] User zoom not disabled
- [ ] Content fits viewport

### Breakpoints
- [ ] Consistent breakpoint system
- [ ] Mobile-first approach
- [ ] Fluid layouts preferred

### Touch
- [ ] Touch targets ≥44px
- [ ] Adequate spacing
- [ ] Touch-friendly interactions

### Typography
- [ ] Fluid font sizes
- [ ] Readable at all sizes
- [ ] Proper line lengths (45-75ch)

### Images
- [ ] srcset/sizes for resolution switching
- [ ] Art direction with picture element
- [ ] max-width: 100%

### Layout
- [ ] Flexible grids
- [ ] No horizontal overflow
- [ ] Content reflows properly

### Navigation
- [ ] Accessible mobile navigation
- [ ] Touch-friendly menu
- [ ] ARIA attributes correct
