# Frontend Performance Review Guide

Performance is UX. Slow UI is bad UI. This guide covers Core Web Vitals and frontend-specific performance patterns.

## Core Web Vitals

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| LCP (Largest Contentful Paint) | ≤2.5s | ≤4.0s | >4.0s |
| FID (First Input Delay) | ≤100ms | ≤300ms | >300ms |
| CLS (Cumulative Layout Shift) | ≤0.1 | ≤0.25 | >0.25 |
| INP (Interaction to Next Paint) | ≤200ms | ≤500ms | >500ms |

## 1. Bundle Size Optimization

### Good - Optimized Imports

```tsx
// Good - Import only what's needed
import { debounce } from 'lodash-es';
import pick from 'lodash/pick';

// Good - Dynamic import for heavy components
const HeavyChart = dynamic(() => import('./HeavyChart'), {
  loading: () => <ChartSkeleton />,
  ssr: false
});

// Good - Conditional loading
const AdminPanel = dynamic(() => import('./AdminPanel'), {
  loading: () => <Loading />
});

function Dashboard({ isAdmin }) {
  return (
    <div>
      <MainContent />
      {isAdmin && <AdminPanel />}
    </div>
  );
}
```

### FAIL - Bundle Bloat

```tsx
// FAIL - Importing entire library
import _ from 'lodash';  // ~70KB
const value = _.get(obj, 'path');

// FAIL - Importing entire icon library
import * as Icons from 'react-icons/fa';  // Huge bundle

// FAIL - No code splitting
import HeavyComponent from './HeavyComponent';  // Always loaded
```

### Bundle Checklist

- [ ] Tree-shakeable imports (named, not default namespace)
- [ ] Dynamic imports for heavy components
- [ ] Route-based code splitting
- [ ] No barrel file imports that defeat tree-shaking
- [ ] Analyze bundle with `@next/bundle-analyzer` or similar

## 2. Image Optimization

### Good - Optimized Images

```tsx
// Good - Next.js Image with optimization
import Image from 'next/image';

<Image
  src="/hero.jpg"
  alt="Hero image"
  width={1200}
  height={600}
  priority  // For LCP images
  placeholder="blur"
  blurDataURL={blurDataUrl}
/>

// Good - Responsive images with srcset
<picture>
  <source
    srcSet="/hero-800.webp 800w, /hero-1200.webp 1200w, /hero-1600.webp 1600w"
    type="image/webp"
    sizes="(max-width: 800px) 100vw, 1200px"
  />
  <img
    src="/hero-1200.jpg"
    alt="Hero"
    loading="lazy"
    decoding="async"
    width="1200"
    height="600"
  />
</picture>

// Good - Lazy loading below-fold images
<img
  src="/product.jpg"
  alt="Product"
  loading="lazy"
  decoding="async"
/>
```

### FAIL - Unoptimized Images

```tsx
// FAIL - No dimensions (causes CLS)
<img src="/hero.jpg" alt="Hero" />

// FAIL - No lazy loading for below-fold
<img src="/image-500.jpg" alt="Content" />

// FAIL - Serving large images
<img src="/photo-4000x3000.jpg" width="400" height="300" />
// Browser still downloads 4000x3000 image

// FAIL - No modern formats
<img src="/image.png" />  // Should offer WebP/AVIF
```

### Image Checklist

- [ ] Width and height attributes set (prevent CLS)
- [ ] `loading="lazy"` for below-fold images
- [ ] `priority` / `fetchpriority="high"` for LCP image
- [ ] Modern formats (WebP, AVIF) with fallbacks
- [ ] Responsive images with srcset/sizes
- [ ] Properly sized (not oversized)
- [ ] Blur placeholder for large images

## 3. CSS Performance

### Good - Efficient CSS

```css
/* Good - CSS custom properties for theming */
:root {
  --color-primary: hsl(220, 90%, 56%);
}

.button {
  background: var(--color-primary);
}

/* Good - CSS containment */
.card {
  contain: layout style paint;
}

/* Good - Will-change for animated elements */
.animated-element {
  will-change: transform;
}

/* Good - content-visibility for long lists */
.list-item {
  content-visibility: auto;
  contain-intrinsic-size: 0 80px;
}
```

### REVIEW - CSS Issues

```css
/* REVIEW - High specificity */
body div.container ul li a.link { }  /* 0,2,4 */

/* REVIEW - Expensive selectors */
[class*="btn-"] { }  /* Attribute selectors are slow */

/* REVIEW - Layout thrashing */
.element {
  /* Animating width/height triggers layout */
  transition: width 0.3s, height 0.3s;
}
```

### FAIL - Critical CSS Issues

```css
/* FAIL - Render-blocking CSS */
/* Large CSS file loaded synchronously in <head> */

/* FAIL - Excessive !important */
.button {
  background: blue !important;
  color: white !important;
  padding: 10px !important;
}

/* FAIL - Unused CSS */
/* 500KB CSS file with 80% unused styles */
```

### CSS Checklist

- [ ] Critical CSS inlined or preloaded
- [ ] Non-critical CSS loaded asynchronously
- [ ] No excessive specificity
- [ ] CSS custom properties for theming
- [ ] `contain` property for complex components
- [ ] `content-visibility` for long lists
- [ ] Purged unused CSS in production

## 4. Animation Performance

### Good - GPU-Accelerated Animation

```css
/* Good - Only animate transform/opacity */
.card {
  transition: transform 0.2s ease-out, opacity 0.2s ease-out;
}

.card:hover {
  transform: translateY(-4px);
  opacity: 0.9;
}

/* Good - Use transform for position changes */
.slide-in {
  transform: translateX(-100%);
  transition: transform 0.3s ease-out;
}

.slide-in.active {
  transform: translateX(0);
}

/* Good - will-change for known animations */
.animated {
  will-change: transform;
}

.animated.done {
  will-change: auto;  /* Remove after animation */
}
```

### FAIL - Layout-Triggering Animation

```css
/* FAIL - Animating layout properties */
.card:hover {
  width: 110%;      /* Triggers layout */
  height: 110%;     /* Triggers layout */
  margin: -5%;      /* Triggers layout */
  padding: 20px;    /* Triggers layout */
  left: 10px;       /* Triggers layout */
  top: 10px;        /* Triggers layout */
}

/* Use transform: scale() and translate() instead */
```

### Animation Checklist

- [ ] Only animate `transform` and `opacity`
- [ ] Use `will-change` sparingly, remove after animation
- [ ] No animating `width`, `height`, `margin`, `padding`, `left`, `top`
- [ ] Use `requestAnimationFrame` for JS animations
- [ ] Respect `prefers-reduced-motion`

## 5. React Performance

Reference the **react-best-practices** skill for comprehensive React patterns. Key points:

### Good - React Optimization

```tsx
// Good - Memoize expensive computations
const sortedItems = useMemo(
  () => items.sort((a, b) => a.name.localeCompare(b.name)),
  [items]
);

// Good - Stable callback references
const handleClick = useCallback(() => {
  doSomething(id);
}, [id]);

// Good - React.memo for pure components
const ExpensiveList = React.memo(function ExpensiveList({ items }) {
  return items.map(item => <Item key={item.id} {...item} />);
});

// Good - Virtualized long lists
import { FixedSizeList } from 'react-window';

function VirtualList({ items }) {
  return (
    <FixedSizeList
      height={400}
      itemCount={items.length}
      itemSize={50}
    >
      {({ index, style }) => (
        <div style={style}>{items[index].name}</div>
      )}
    </FixedSizeList>
  );
}
```

### FAIL - React Anti-patterns

```tsx
// FAIL - Object/array in dependency array
useEffect(() => {
  doSomething();
}, [{ id: 1 }]);  // New object every render

// FAIL - Inline function causing re-renders
<Child onClick={() => handleClick(id)} />

// FAIL - No virtualization for long lists
{items.map(item => <Item key={item.id} {...item} />)}
// With 10,000 items, this is a performance disaster

// FAIL - State in parent causing child re-renders
function Parent() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  // All children re-render on every mouse move
}
```

### React Checklist

- [ ] `useMemo` for expensive computations
- [ ] `useCallback` for stable callbacks passed to children
- [ ] `React.memo` for pure components
- [ ] Keys are stable and unique (not array index)
- [ ] Virtualization for long lists
- [ ] No state updates in parent causing unnecessary child re-renders
- [ ] Suspense boundaries for code splitting

## 6. Font Loading

### Good - Optimized Font Loading

```html
<!-- Good - Preload critical fonts -->
<link
  rel="preload"
  href="/fonts/inter-var.woff2"
  as="font"
  type="font/woff2"
  crossorigin
/>

<!-- Good - font-display: swap -->
<style>
  @font-face {
    font-family: 'Inter';
    src: url('/fonts/inter-var.woff2') format('woff2');
    font-display: swap;
    font-weight: 100 900;
  }
</style>
```

```css
/* Good - System font fallback stack */
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* Good - Size-adjust for reduced CLS */
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter.woff2') format('woff2');
  font-display: swap;
  size-adjust: 100%;
  ascent-override: 90%;
  descent-override: 20%;
}
```

### FAIL - Poor Font Loading

```html
<!-- FAIL - Blocking Google Fonts -->
<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />

<!-- FAIL - No preload for critical fonts -->
<!-- Font discovered late, causes FOIT/FOUT -->
```

```css
/* FAIL - No font-display */
@font-face {
  font-family: 'Custom';
  src: url('/fonts/custom.woff2');
  /* Causes invisible text (FOIT) */
}
```

### Font Checklist

- [ ] Preload critical fonts
- [ ] `font-display: swap` or `optional`
- [ ] Self-hosted (not Google Fonts blocking)
- [ ] Subset fonts to needed characters
- [ ] Variable fonts where appropriate
- [ ] WOFF2 format

## 7. Third-Party Scripts

### Good - Deferred Loading

```tsx
// Good - Load analytics after hydration
useEffect(() => {
  if (typeof window !== 'undefined') {
    import('analytics').then(({ init }) => init());
  }
}, []);

// Good - Load on interaction
const ChatWidget = dynamic(() => import('./ChatWidget'), {
  ssr: false,
  loading: () => null
});

function App() {
  const [showChat, setShowChat] = useState(false);
  return (
    <>
      <button onClick={() => setShowChat(true)}>Open Chat</button>
      {showChat && <ChatWidget />}
    </>
  );
}
```

```html
<!-- Good - Defer non-critical scripts -->
<script src="analytics.js" defer></script>

<!-- Good - Load after main content -->
<script>
  window.addEventListener('load', () => {
    const script = document.createElement('script');
    script.src = 'heavy-widget.js';
    document.body.appendChild(script);
  });
</script>
```

### FAIL - Blocking Scripts

```html
<!-- FAIL - Blocking third-party -->
<script src="https://heavy-analytics.com/tracker.js"></script>

<!-- FAIL - Too many third-party scripts -->
<script src="analytics1.js"></script>
<script src="analytics2.js"></script>
<script src="chat-widget.js"></script>
<script src="heatmap.js"></script>
<script src="ab-testing.js"></script>
<!-- Each blocks rendering and competes for bandwidth -->
```

### Third-Party Checklist

- [ ] Third-party scripts deferred or async
- [ ] Heavy widgets loaded on interaction
- [ ] Analytics loaded after hydration
- [ ] Minimal third-party scripts
- [ ] Self-hosted where possible (fonts, common libs)

## 8. Cumulative Layout Shift (CLS)

### Good - Stable Layout

```tsx
// Good - Reserved space for images
<img
  src="/hero.jpg"
  alt="Hero"
  width="1200"
  height="600"
  style={{ aspectRatio: '2/1' }}
/>

// Good - Skeleton for async content
function AsyncContent() {
  const { data, isLoading } = useQuery('data');

  if (isLoading) {
    return <Skeleton height={200} />;  // Same height as content
  }

  return <Content data={data} />;
}

// Good - Fixed height for dynamic content
<div style={{ minHeight: '300px' }}>
  {isLoaded ? <DynamicContent /> : <Placeholder />}
</div>
```

### FAIL - Layout Shifts

```tsx
// FAIL - No dimensions on images
<img src="/banner.jpg" alt="Banner" />

// FAIL - Content that shifts layout
function BadComponent() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    setShowBanner(true);  // Shifts all content down
  }, []);

  return (
    <>
      {showBanner && <Banner />}  {/* Inserted above content */}
      <MainContent />
    </>
  );
}

// FAIL - Font swap causing shift
/* No size-adjust, fallback font has different metrics */
```

### CLS Checklist

- [ ] Images have width/height or aspect-ratio
- [ ] Skeleton loaders match content size
- [ ] Fonts use size-adjust or similar metrics
- [ ] Ads/embeds have reserved space
- [ ] No injecting content above existing content
- [ ] Transform for animations (not position/size)

## Performance Checklist

### Bundle
- [ ] Tree-shakeable imports
- [ ] Code splitting / dynamic imports
- [ ] Analyzed with bundle analyzer

### Images
- [ ] Optimized formats (WebP/AVIF)
- [ ] Lazy loading for below-fold
- [ ] Priority for LCP image
- [ ] Dimensions specified

### CSS
- [ ] Critical CSS inlined
- [ ] Unused CSS removed
- [ ] GPU-accelerated animations

### React
- [ ] Memoization where needed
- [ ] Virtualization for long lists
- [ ] Proper key usage

### Fonts
- [ ] Preloaded critical fonts
- [ ] font-display: swap
- [ ] Self-hosted

### Third-Party
- [ ] Deferred/async scripts
- [ ] Minimal third-party code
- [ ] Loaded on interaction where possible

### CLS
- [ ] Image dimensions
- [ ] Skeleton loaders
- [ ] No layout-shifting content injection
