# Accessibility Review Guide (WCAG 2.1)

Accessibility failures are automatic **FAIL** verdicts. Everyone deserves equal access to web content.

## 1. Semantic HTML

### Good - Semantic Structure

```html
<!-- Good - Meaningful HTML structure -->
<header>
  <nav aria-label="Main navigation">
    <ul>
      <li><a href="/">Home</a></li>
      <li><a href="/about">About</a></li>
    </ul>
  </nav>
</header>

<main>
  <article>
    <h1>Article Title</h1>
    <p>Content...</p>

    <section aria-labelledby="comments-heading">
      <h2 id="comments-heading">Comments</h2>
      <!-- Comments -->
    </section>
  </article>

  <aside aria-label="Related articles">
    <!-- Sidebar content -->
  </aside>
</main>

<footer>
  <!-- Footer content -->
</footer>
```

### FAIL - Div Soup

```html
<!-- FAIL - No semantic meaning -->
<div class="header">
  <div class="nav">
    <div class="nav-item" onclick="navigate('/')">Home</div>
    <div class="nav-item" onclick="navigate('/about')">About</div>
  </div>
</div>

<div class="main">
  <div class="content">
    <div class="title">Article Title</div>
    <div class="text">Content...</div>
  </div>
</div>
```

### Semantic HTML Checklist

- [ ] `<header>`, `<nav>`, `<main>`, `<footer>`, `<aside>`, `<section>`, `<article>` used appropriately
- [ ] Single `<main>` element per page
- [ ] Heading hierarchy (`<h1>` → `<h6>`) is logical, no skipped levels
- [ ] Lists use `<ul>`, `<ol>`, `<dl>` appropriately
- [ ] Tables have `<thead>`, `<tbody>`, `<th scope>`
- [ ] `<button>` for actions, `<a>` for navigation

## 2. Keyboard Navigation

### Good - Fully Keyboard Accessible

```tsx
// Good - Custom button is keyboard accessible
function CustomButton({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </button>
  );
}

// Good - Skip link for keyboard users
function SkipLink() {
  return (
    <a
      href="#main-content"
      className="skip-link"
    >
      Skip to main content
    </a>
  );
}
```

```css
/* Skip link styling */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  padding: 8px;
  background: var(--color-primary);
  color: white;
  z-index: 100;
}

.skip-link:focus {
  top: 0;
}
```

### FAIL - Keyboard Trap / Inaccessible

```tsx
// FAIL - Only mouse accessible
function Card({ onClick }) {
  return (
    <div className="card" onClick={onClick}>
      {/* No keyboard support */}
      Click me
    </div>
  );
}

// FAIL - Custom dropdown without keyboard support
function Dropdown() {
  return (
    <div className="dropdown">
      <div className="dropdown-trigger" onClick={toggle}>
        Select option
      </div>
      {/* Arrow keys, Escape, Enter not handled */}
    </div>
  );
}
```

### Keyboard Checklist

- [ ] All interactive elements focusable (Tab)
- [ ] Logical focus order (follows visual order)
- [ ] Skip link to main content
- [ ] No keyboard traps
- [ ] Escape closes modals/dropdowns
- [ ] Arrow keys work in menus/tabs
- [ ] Enter/Space activates buttons

## 3. Focus Indicators

### Good - Visible Focus States

```css
/* Good - Clear, consistent focus indicators */
:root {
  --focus-ring: 0 0 0 3px rgba(66, 153, 225, 0.6);
}

/* Remove default, add custom */
:focus {
  outline: none;
}

:focus-visible {
  box-shadow: var(--focus-ring);
}

/* Specific element focus states */
button:focus-visible {
  box-shadow: var(--focus-ring);
}

a:focus-visible {
  box-shadow: var(--focus-ring);
  border-radius: 2px;
}

input:focus-visible {
  border-color: var(--color-primary);
  box-shadow: var(--focus-ring);
}
```

### FAIL - Hidden Focus

```css
/* FAIL - Focus removed without replacement */
*:focus {
  outline: none;
}

button:focus {
  outline: none;
  /* No alternative indicator! */
}
```

### Focus Checklist

- [ ] All focusable elements have visible focus indicator
- [ ] Focus indicator has 3:1 contrast ratio
- [ ] `:focus-visible` used (not just `:focus`)
- [ ] Custom focus styles match design system

## 4. Color Contrast

### WCAG Contrast Requirements

| Element | Minimum Ratio | Enhanced (AAA) |
|---------|--------------|----------------|
| Normal text | 4.5:1 | 7:1 |
| Large text (18pt+) | 3:1 | 4.5:1 |
| UI components | 3:1 | - |
| Graphical objects | 3:1 | - |

### Good - Adequate Contrast

```css
/* Good - High contrast text */
.text {
  color: #1a1a1a;         /* Very dark */
  background: #ffffff;     /* White */
  /* Contrast: ~17:1 */
}

.muted-text {
  color: #595959;         /* Dark gray */
  background: #ffffff;
  /* Contrast: ~7:1 */
}

/* Good - Button with sufficient contrast */
.button {
  background: #2563eb;    /* Blue */
  color: #ffffff;         /* White */
  /* Contrast: ~7:1 */
}

.button:hover {
  background: #1d4ed8;    /* Darker blue */
  /* Still maintains contrast */
}
```

### FAIL - Low Contrast

```css
/* FAIL - Insufficient contrast */
.placeholder {
  color: #c0c0c0;         /* Light gray */
  background: #ffffff;
  /* Contrast: ~2:1 - FAILS */
}

.subtle-link {
  color: #93c5fd;         /* Light blue */
  background: #ffffff;
  /* Contrast: ~2.5:1 - FAILS */
}

/* FAIL - Disabled state too subtle */
.button:disabled {
  background: #f3f4f6;
  color: #d1d5db;
  /* Nearly invisible */
}
```

### Color Checklist

- [ ] Text contrast 4.5:1 minimum (3:1 for large text)
- [ ] UI components 3:1 minimum
- [ ] Links distinguishable (not color alone)
- [ ] Error states visible (not just red color)
- [ ] Disabled states still readable

## 5. Images and Media

### Good - Accessible Images

```tsx
// Good - Informative image with alt text
<img
  src="/chart.png"
  alt="Sales increased 25% in Q4 2024 compared to Q3"
/>

// Good - Decorative image
<img
  src="/decorative-border.png"
  alt=""
  role="presentation"
/>

// Good - Complex image with long description
<figure>
  <img
    src="/infographic.png"
    alt="Company growth infographic"
    aria-describedby="infographic-desc"
  />
  <figcaption id="infographic-desc">
    Detailed description of the infographic...
  </figcaption>
</figure>

// Good - SVG icon with accessible name
<button aria-label="Close dialog">
  <svg aria-hidden="true" focusable="false">
    <path d="..." />
  </svg>
</button>
```

### FAIL - Inaccessible Images

```tsx
// FAIL - Missing alt text
<img src="/product.jpg" />

// FAIL - Useless alt text
<img src="/chart.png" alt="image" />
<img src="/photo.jpg" alt="photo.jpg" />

// FAIL - Icon button without accessible name
<button>
  <svg>
    <path d="..." />
  </svg>
</button>
```

### Media Checklist

- [ ] All `<img>` have `alt` attribute
- [ ] Alt text is meaningful (describes content/purpose)
- [ ] Decorative images have `alt=""`
- [ ] SVG icons have `aria-hidden="true"` when decorative
- [ ] Icon-only buttons have `aria-label`
- [ ] Videos have captions
- [ ] Audio has transcripts

## 6. Forms

### Good - Accessible Forms

```tsx
// Good - Properly labeled form
<form>
  <div className="form-group">
    <label htmlFor="email">
      Email address
      <span className="required" aria-hidden="true">*</span>
    </label>
    <input
      type="email"
      id="email"
      name="email"
      required
      aria-required="true"
      aria-describedby="email-hint email-error"
    />
    <p id="email-hint" className="hint">
      We'll never share your email.
    </p>
    {error && (
      <p id="email-error" className="error" role="alert">
        Please enter a valid email address.
      </p>
    )}
  </div>

  <fieldset>
    <legend>Notification preferences</legend>
    <div>
      <input type="checkbox" id="newsletter" name="newsletter" />
      <label htmlFor="newsletter">Subscribe to newsletter</label>
    </div>
    <div>
      <input type="checkbox" id="updates" name="updates" />
      <label htmlFor="updates">Receive product updates</label>
    </div>
  </fieldset>

  <button type="submit">Submit</button>
</form>
```

### FAIL - Inaccessible Forms

```tsx
// FAIL - No labels
<form>
  <input type="text" placeholder="Name" />
  <input type="email" placeholder="Email" />
  <div className="checkbox" onClick={toggle}>
    Accept terms
  </div>
  <div className="button" onClick={submit}>Submit</div>
</form>
```

### Form Checklist

- [ ] All inputs have associated `<label>`
- [ ] Labels use `htmlFor` matching input `id`
- [ ] Required fields indicated (not just visually)
- [ ] Error messages associated with inputs
- [ ] Fieldset/legend for grouped inputs
- [ ] `autocomplete` attributes for common fields
- [ ] Submit button is `<button type="submit">`

## 7. ARIA Usage

### Good - ARIA When Necessary

```tsx
// Good - Custom tab panel with ARIA
function Tabs({ tabs, activeTab, onChange }) {
  return (
    <div>
      <div role="tablist" aria-label="Content sections">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === index}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === index ? 0 : -1}
            onClick={() => onChange(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={activeTab !== index}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}

// Good - Live region for dynamic content
<div aria-live="polite" aria-atomic="true">
  {message}
</div>
```

### FAIL - ARIA Misuse

```tsx
// FAIL - Using ARIA instead of semantic HTML
<div role="button" onClick={handleClick}>
  Click me
</div>
{/* Should just be <button> */}

// FAIL - Invalid ARIA
<div aria-label="Main content">
  {/* aria-label on non-interactive div */}
</div>

// FAIL - Redundant ARIA
<button role="button" aria-pressed="false">
  {/* role="button" is redundant on <button> */}
</button>
```

### ARIA Checklist

- [ ] Prefer semantic HTML over ARIA
- [ ] ARIA roles used correctly
- [ ] Required ARIA attributes present
- [ ] `aria-live` for dynamic content
- [ ] `aria-expanded` for collapsible content
- [ ] `aria-current` for navigation
- [ ] No invalid ARIA (validate with tools)

## 8. Motion and Animation

### Good - Respects Preferences

```css
/* Good - Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Good - Pause controls for auto-playing content */
```

```tsx
// Good - Respects reduced motion
function AnimatedComponent() {
  const prefersReducedMotion = useMediaQuery(
    '(prefers-reduced-motion: reduce)'
  );

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 20 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
    >
      Content
    </motion.div>
  );
}
```

### FAIL - Ignores Motion Preferences

```css
/* FAIL - No reduced motion support */
.hero {
  animation: bounce 1s infinite;
}

/* No @media (prefers-reduced-motion) query */
```

### Motion Checklist

- [ ] `prefers-reduced-motion` respected
- [ ] No auto-playing video/audio without controls
- [ ] Animations can be paused
- [ ] No content that flashes more than 3 times/second

## Accessibility Testing Tools

Run these checks before marking PASS:

1. **Automated testing**: axe-core, Lighthouse accessibility audit
2. **Manual keyboard testing**: Tab through entire page
3. **Screen reader testing**: VoiceOver (Mac), NVDA (Windows)
4. **Contrast checking**: WebAIM Contrast Checker
5. **Focus order**: Verify logical progression

## Quick Checklist

### Critical (FAIL if missing)
- [ ] Semantic HTML structure
- [ ] All images have alt text
- [ ] Keyboard accessible
- [ ] Visible focus indicators
- [ ] Form labels present
- [ ] Color contrast 4.5:1

### Important (REVIEW if missing)
- [ ] Skip link to main content
- [ ] Heading hierarchy logical
- [ ] ARIA used correctly
- [ ] Reduced motion respected
- [ ] Error messages accessible
