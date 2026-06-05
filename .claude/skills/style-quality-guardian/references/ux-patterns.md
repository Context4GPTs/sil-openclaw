# UX Patterns Review Guide

Good UX is invisible. Bad UX frustrates. This guide covers interaction patterns that improve user experience.

## Loading States

### Good - Informative Loading

```tsx
// Good - Skeleton that matches content layout
function ProductCardSkeleton() {
  return (
    <div className="product-card skeleton">
      <div className="skeleton-image" />
      <div className="skeleton-text skeleton-title" />
      <div className="skeleton-text skeleton-price" />
    </div>
  );
}

// Good - Loading state with context
function ProductList() {
  const { data, isLoading, error } = useProducts();

  if (isLoading) {
    return (
      <div className="product-grid">
        {[...Array(6)].map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (/* ... */);
}

// Good - Button loading state
function SubmitButton({ isLoading }) {
  return (
    <button disabled={isLoading}>
      {isLoading ? (
        <>
          <Spinner size="sm" />
          <span>Saving...</span>
        </>
      ) : (
        'Save Changes'
      )}
    </button>
  );
}
```

### FAIL - No Loading Feedback

```tsx
// FAIL - No loading indication
function ProductList() {
  const { data } = useProducts();  // No loading state!

  return (
    <div className="product-grid">
      {data?.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

// FAIL - Generic spinner with no context
function Page() {
  if (loading) return <Spinner />;  // What's loading?
  return (/* ... */);
}
```

### Loading Checklist

- [ ] Skeleton loaders match content layout
- [ ] Loading states preserve layout (no CLS)
- [ ] Buttons show loading when submitting
- [ ] Optimistic updates where appropriate
- [ ] Loading context is clear

## Error States

### Good - Helpful Error Messages

```tsx
// Good - Actionable error message
function ErrorMessage({ error, onRetry }) {
  return (
    <div role="alert" className="error-container">
      <ErrorIcon aria-hidden="true" />
      <div className="error-content">
        <h3 className="error-title">Unable to load products</h3>
        <p className="error-message">
          {error.message || 'Something went wrong. Please try again.'}
        </p>
        <button onClick={onRetry} className="error-retry">
          Try again
        </button>
      </div>
    </div>
  );
}

// Good - Inline form validation
function FormField({ error, ...props }) {
  return (
    <div className="form-field">
      <input
        {...props}
        aria-invalid={!!error}
        aria-describedby={error ? `${props.id}-error` : undefined}
      />
      {error && (
        <p id={`${props.id}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Good - Form-level error summary
function FormErrorSummary({ errors }) {
  if (errors.length === 0) return null;

  return (
    <div role="alert" className="error-summary">
      <h4>Please fix the following errors:</h4>
      <ul>
        {errors.map((error, i) => (
          <li key={i}>
            <a href={`#${error.field}`}>{error.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### FAIL - Unhelpful Errors

```tsx
// FAIL - Generic unhelpful error
function Error() {
  return <p>An error occurred</p>;  // What error? What to do?
}

// FAIL - Technical error exposed
function Error({ error }) {
  return <p>{error.stack}</p>;  // Stack trace to user!
}

// FAIL - No recovery option
function Error() {
  return <p>Failed to load. Refresh the page.</p>;
  // Why not offer a retry button?
}
```

### Error Checklist

- [ ] Error messages explain what went wrong
- [ ] Error messages suggest how to fix
- [ ] Recovery options provided (retry button)
- [ ] Form errors linked to fields
- [ ] Errors accessible (role="alert")

## Empty States

### Good - Helpful Empty States

```tsx
// Good - Contextual empty state with action
function EmptyProductList() {
  return (
    <div className="empty-state">
      <IllustrationEmpty aria-hidden="true" />
      <h3>No products yet</h3>
      <p>Add your first product to get started selling.</p>
      <Button href="/products/new">
        Add Product
      </Button>
    </div>
  );
}

// Good - Search empty state
function EmptySearchResults({ query, onClear }) {
  return (
    <div className="empty-state">
      <SearchIcon aria-hidden="true" />
      <h3>No results for "{query}"</h3>
      <p>Try adjusting your search or filters.</p>
      <div className="empty-actions">
        <button onClick={onClear}>Clear search</button>
        <Link href="/products">Browse all products</Link>
      </div>
    </div>
  );
}

// Good - Filtered empty state
function EmptyFilteredResults({ onClearFilters }) {
  return (
    <div className="empty-state">
      <FilterIcon aria-hidden="true" />
      <h3>No products match your filters</h3>
      <p>Try removing some filters to see more results.</p>
      <button onClick={onClearFilters}>
        Clear all filters
      </button>
    </div>
  );
}
```

### FAIL - Blank or Confusing Empty States

```tsx
// FAIL - Just blank
function ProductList({ products }) {
  return (
    <div className="product-grid">
      {products.map(/* ... */)}
      {/* Nothing shown when products is empty! */}
    </div>
  );
}

// FAIL - Confusing message
function EmptyState() {
  return <p>Nothing here</p>;  // Nothing what? Is this an error?
}
```

### Empty State Checklist

- [ ] Empty states explain why empty
- [ ] Provide next action
- [ ] Different messages for different contexts
- [ ] Illustrations/icons for visual interest
- [ ] Never just blank

## Micro-Interactions

### Good - Meaningful Feedback

```tsx
// Good - Copy button with feedback
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button onClick={handleCopy} aria-label="Copy to clipboard">
      {copied ? (
        <>
          <CheckIcon /> Copied!
        </>
      ) : (
        <>
          <CopyIcon /> Copy
        </>
      )}
    </button>
  );
}

// Good - Hover preview
function ProductCard({ product }) {
  return (
    <article className="product-card">
      <div className="product-image-container">
        <img src={product.image} alt={product.name} />
        <div className="product-quick-view">
          <button>Quick View</button>
        </div>
      </div>
      {/* ... */}
    </article>
  );
}

// Good - Confirmation for destructive actions
function DeleteButton({ onDelete, itemName }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="confirm-delete">
        <span>Delete {itemName}?</span>
        <button onClick={onDelete} className="danger">Yes, delete</button>
        <button onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)}>
      Delete
    </button>
  );
}
```

### FAIL - No Feedback

```tsx
// FAIL - No feedback after action
function CopyButton({ text }) {
  return (
    <button onClick={() => navigator.clipboard.writeText(text)}>
      Copy
    </button>
    // User has no idea if it worked!
  );
}

// FAIL - Destructive action with no confirmation
function DeleteButton({ onDelete }) {
  return <button onClick={onDelete}>Delete</button>;
  // Accidental clicks are permanent!
}
```

### Micro-Interaction Checklist

- [ ] Actions provide visual feedback
- [ ] Destructive actions require confirmation
- [ ] Success/failure clearly indicated
- [ ] Hover states for interactive elements
- [ ] Transitions feel smooth (200-300ms)

## Form UX

### Good - User-Friendly Forms

```tsx
// Good - Inline validation with guidance
function EmailField({ value, onChange, error }) {
  const [touched, setTouched] = useState(false);
  const showError = touched && error;

  return (
    <div className="form-field">
      <label htmlFor="email">
        Email address
        <span className="required">*</span>
      </label>
      <input
        id="email"
        type="email"
        value={value}
        onChange={onChange}
        onBlur={() => setTouched(true)}
        aria-invalid={showError}
        aria-describedby="email-hint email-error"
        autoComplete="email"
      />
      <p id="email-hint" className="field-hint">
        We'll send your receipt here
      </p>
      {showError && (
        <p id="email-error" className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Good - Progress indicator for multi-step forms
function FormProgress({ currentStep, totalSteps, steps }) {
  return (
    <nav aria-label="Form progress">
      <ol className="progress-steps">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={clsx(
              'progress-step',
              index < currentStep && 'completed',
              index === currentStep && 'current'
            )}
            aria-current={index === currentStep ? 'step' : undefined}
          >
            <span className="step-number">{index + 1}</span>
            <span className="step-label">{step.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// Good - Preserve user input
function SearchForm() {
  const [query, setQuery] = useLocalStorage('searchQuery', '');
  // Preserved across page reloads
}
```

### FAIL - Frustrating Forms

```tsx
// FAIL - Validation only on submit
function Form() {
  const handleSubmit = (e) => {
    e.preventDefault();
    const errors = validate(formData);
    if (errors.length > 0) {
      alert(errors.join('\n'));  // All errors at once, via alert!
    }
  };
}

// FAIL - Clearing form on error
function Form() {
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await submit(formData);
    } catch {
      setFormData({});  // User loses all input!
    }
  };
}

// FAIL - No autocomplete
<input type="email" autoComplete="off" />
// Makes password managers useless
```

### Form UX Checklist

- [ ] Inline validation (on blur, not on change)
- [ ] Error messages near relevant fields
- [ ] Success confirmation after submit
- [ ] Progress indicator for multi-step
- [ ] Autocomplete attributes set
- [ ] Input never lost on error
- [ ] Tab order makes sense

## Navigation & Orientation

### Good - Clear Navigation

```tsx
// Good - Breadcrumbs for deep pages
function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumbs">
        {items.map((item, index) => (
          <li key={item.href}>
            {index < items.length - 1 ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// Good - Active state in navigation
function NavLink({ href, children }) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <a
      href={href}
      className={clsx('nav-link', isActive && 'active')}
      aria-current={isActive ? 'page' : undefined}
    >
      {children}
    </a>
  );
}

// Good - Back button for flows
function CheckoutHeader() {
  return (
    <header className="checkout-header">
      <button onClick={() => history.back()} className="back-button">
        <ArrowLeft /> Back to cart
      </button>
      <h1>Checkout</h1>
    </header>
  );
}
```

### FAIL - Disorienting Navigation

```tsx
// FAIL - No indication of current page
function Nav() {
  return (
    <nav>
      <a href="/">Home</a>
      <a href="/products">Products</a>
      <a href="/about">About</a>
      {/* Which page am I on? */}
    </nav>
  );
}

// FAIL - Breaking browser navigation
function App() {
  useEffect(() => {
    window.history.pushState({}, '', '/new-url');
    // URL changes but no page navigation!
  }, []);
}
```

### Navigation Checklist

- [ ] Current page indicated (aria-current)
- [ ] Breadcrumbs for deep hierarchies
- [ ] Back button for flows
- [ ] Browser navigation works correctly
- [ ] Links look clickable
- [ ] Focus management on route change

## Notifications & Toasts

### Good - Non-Intrusive Notifications

```tsx
// Good - Toast with auto-dismiss and manual close
function Toast({ message, type, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`toast toast-${type}`}
    >
      {type === 'success' && <CheckIcon aria-hidden="true" />}
      {type === 'error' && <ErrorIcon aria-hidden="true" />}
      <span>{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        <CloseIcon aria-hidden="true" />
      </button>
    </div>
  );
}

// Good - Toast container for stacking
function ToastContainer({ toasts }) {
  return (
    <div className="toast-container" aria-label="Notifications">
      {toasts.map(toast => (
        <Toast key={toast.id} {...toast} />
      ))}
    </div>
  );
}
```

### FAIL - Annoying Notifications

```tsx
// FAIL - Modal for every notification
function App() {
  const [showSuccess, setShowSuccess] = useState(true);

  return (
    <>
      {showSuccess && (
        <Modal>
          <p>Item added to cart!</p>
          <button onClick={() => setShowSuccess(false)}>OK</button>
        </Modal>
      )}
    </>
  );
  // User must dismiss modal to continue!
}

// FAIL - Alert for notifications
const handleSave = async () => {
  await save();
  alert('Saved successfully!');  // Blocks the page!
};
```

### Notification Checklist

- [ ] Toasts auto-dismiss (5-8 seconds)
- [ ] Manual dismiss option
- [ ] Don't block user interaction
- [ ] Stack multiple notifications
- [ ] Accessible (aria-live)
- [ ] Visual distinction for types (success, error, info)

## UX Patterns Checklist

### Loading
- [ ] Skeleton loaders
- [ ] Button loading states
- [ ] Optimistic updates

### Errors
- [ ] Helpful error messages
- [ ] Recovery options
- [ ] Accessible alerts

### Empty States
- [ ] Contextual messaging
- [ ] Call to action
- [ ] Visual interest

### Micro-Interactions
- [ ] Action feedback
- [ ] Confirmation for destructive actions
- [ ] Smooth transitions

### Forms
- [ ] Inline validation
- [ ] Progress indicators
- [ ] Autocomplete support
- [ ] Preserve user input

### Navigation
- [ ] Current page indication
- [ ] Breadcrumbs
- [ ] Working browser navigation

### Notifications
- [ ] Non-blocking toasts
- [ ] Auto-dismiss with manual option
- [ ] Accessible
