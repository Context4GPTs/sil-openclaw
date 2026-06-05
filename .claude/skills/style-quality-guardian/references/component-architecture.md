# Component Architecture Review Guide

Well-structured components are reusable, maintainable, and testable.

## Single Responsibility

### Good - Focused Components

```tsx
// Good - Each component has one job
function UserAvatar({ user, size = 'md' }) {
  return (
    <img
      src={user.avatarUrl}
      alt={user.name}
      className={`avatar avatar-${size}`}
    />
  );
}

function UserName({ user, variant = 'default' }) {
  return (
    <span className={`user-name user-name-${variant}`}>
      {user.name}
    </span>
  );
}

function UserCard({ user }) {
  return (
    <article className="user-card">
      <UserAvatar user={user} size="lg" />
      <UserName user={user} />
      <UserBio user={user} />
    </article>
  );
}
```

### FAIL - God Component

```tsx
// FAIL - Does too much
function UserCard({ userId, showComments, onFollow, onBlock, theme }) {
  const [user, setUser] = useState(null);
  const [comments, setComments] = useState([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchUser(userId).then(setUser);
    if (showComments) {
      fetchComments(userId).then(setComments);
    }
  }, [userId, showComments]);

  const handleFollow = async () => { /* ... */ };
  const handleBlock = async () => { /* ... */ };
  const handleReport = async () => { /* ... */ };
  const handleShare = () => { /* ... */ };

  // 200+ lines of JSX mixing user info, comments, modals, etc.
  return (/* ... */);
}
```

### Responsibility Checklist

- [ ] Component does one thing well
- [ ] Can describe purpose in one sentence
- [ ] Under 100-150 lines (guideline, not rule)
- [ ] Minimal state management
- [ ] Clear boundaries with other components

## Props Interface Design

### Good - Clear, Minimal Props

```tsx
// Good - Typed, documented, sensible defaults
interface ButtonProps {
  /** Button text or content */
  children: React.ReactNode;
  /** Visual style variant */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Size of the button */
  size?: 'sm' | 'md' | 'lg';
  /** Whether button is disabled */
  disabled?: boolean;
  /** Whether button shows loading state */
  loading?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** HTML button type */
  type?: 'button' | 'submit' | 'reset';
}

function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onClick,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={clsx('btn', `btn-${variant}`, `btn-${size}`)}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
```

### REVIEW - Prop Sprawl

```tsx
// REVIEW - Too many props, unclear interface
interface ButtonProps {
  text?: string;
  children?: React.ReactNode;
  label?: string;  // Redundant with text/children
  className?: string;
  style?: CSSProperties;
  customStyles?: Record<string, string>;  // Redundant
  onClick?: () => void;
  onPress?: () => void;  // Redundant with onClick
  handleClick?: () => void;  // Redundant
  isDisabled?: boolean;
  disabled?: boolean;  // Duplicate
  isLoading?: boolean;
  loading?: boolean;  // Duplicate
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  // ... 20 more props
}
```

### FAIL - Opaque Props

```tsx
// FAIL - options object hides interface
function Button({ options }) {
  // What's in options? Who knows!
  return <button style={options.style}>{options.text}</button>;
}

// FAIL - any type
function DataTable({ data, config }: { data: any; config: any }) {
  // No type safety
}
```

### Props Checklist

- [ ] TypeScript interfaces or PropTypes defined
- [ ] No duplicate/redundant props
- [ ] Sensible defaults provided
- [ ] Props are documented (JSDoc or comments)
- [ ] Under 10-12 props (consider composition if more)
- [ ] No `any` types

## Composition Patterns

### Good - Composition Over Configuration

```tsx
// Good - Composable card
function Card({ children, className }) {
  return (
    <article className={clsx('card', className)}>
      {children}
    </article>
  );
}

Card.Header = function CardHeader({ children }) {
  return <header className="card-header">{children}</header>;
};

Card.Body = function CardBody({ children }) {
  return <div className="card-body">{children}</div>;
};

Card.Footer = function CardFooter({ children }) {
  return <footer className="card-footer">{children}</footer>;
};

// Usage - flexible composition
<Card>
  <Card.Header>
    <h3>Title</h3>
  </Card.Header>
  <Card.Body>
    <p>Content here</p>
  </Card.Body>
  <Card.Footer>
    <Button>Action</Button>
  </Card.Footer>
</Card>
```

### REVIEW - Over-Configuration

```tsx
// REVIEW - Trying to anticipate every use case
function Card({
  title,
  subtitle,
  headerIcon,
  headerAction,
  body,
  bodyClassName,
  footer,
  footerAlign,
  showDividers,
  elevation,
  variant,
  // ... many more props
}) {
  return (
    <article className={/* complex className logic */}>
      {title && (
        <header>
          {headerIcon && <Icon name={headerIcon} />}
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
          {headerAction}
        </header>
      )}
      {showDividers && <hr />}
      <div className={bodyClassName}>{body}</div>
      {footer && (
        <footer style={{ textAlign: footerAlign }}>
          {footer}
        </footer>
      )}
    </article>
  );
}
```

### Composition Checklist

- [ ] `children` prop used for flexible content
- [ ] Compound components for complex structures
- [ ] Render props or slots for customization
- [ ] Not trying to anticipate every use case

## State Management

### Good - State at Right Level

```tsx
// Good - Local state for local concerns
function SearchInput({ onSearch }) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
    </form>
  );
}

// Good - Lifted state when needed
function ProductFilters({ filters, onChange }) {
  // Filters managed by parent, this component just renders
  return (
    <div className="filters">
      {filters.map(filter => (
        <FilterControl
          key={filter.id}
          filter={filter}
          onChange={(value) => onChange(filter.id, value)}
        />
      ))}
    </div>
  );
}
```

### FAIL - State Management Issues

```tsx
// FAIL - State that should be derived
function ProductList({ products }) {
  const [filteredProducts, setFilteredProducts] = useState(products);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    setFilteredProducts(
      products.filter(p => p.name.includes(searchTerm))
    );
  }, [products, searchTerm]);

  // filteredProducts should just be computed, not state!
}

// Good - Derived value
function ProductList({ products }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredProducts = useMemo(
    () => products.filter(p => p.name.includes(searchTerm)),
    [products, searchTerm]
  );
}
```

```tsx
// FAIL - Prop drilling through many levels
function App() {
  const [user, setUser] = useState(null);
  return (
    <Layout user={user} setUser={setUser}>
      <Main user={user} setUser={setUser}>
        <Content user={user} setUser={setUser}>
          <DeepComponent user={user} setUser={setUser} />
        </Content>
      </Main>
    </Layout>
  );
}

// Good - Context for cross-cutting concerns
const UserContext = createContext(null);

function App() {
  const [user, setUser] = useState(null);
  return (
    <UserContext.Provider value={{ user, setUser }}>
      <Layout>
        <Main>
          <Content>
            <DeepComponent />
          </Content>
        </Main>
      </Layout>
    </UserContext.Provider>
  );
}
```

### State Checklist

- [ ] State lives at appropriate level
- [ ] No unnecessary derived state (compute instead)
- [ ] No excessive prop drilling (use Context)
- [ ] Local state for local concerns
- [ ] Server state handled appropriately (React Query, SWR)

## Naming Conventions

### Good - Descriptive Names

```tsx
// Good - Clear component names
function UserProfileCard() { }
function ProductListItem() { }
function CheckoutPaymentForm() { }
function NavigationMenuDropdown() { }

// Good - Event handler naming
function Form() {
  const handleSubmit = () => { };
  const handleInputChange = () => { };
  const handleValidationError = () => { };
}

// Good - Boolean props
<Button disabled isLoading hasError />

// Good - Render function naming
function UserList() {
  const renderUserItem = (user) => <UserItem user={user} />;
  const renderEmptyState = () => <EmptyState />;
}
```

### REVIEW - Unclear Names

```tsx
// REVIEW - Vague or inconsistent names
function Card() { }  // What kind of card?
function Item() { }  // Item of what?
function Comp1() { }  // Meaningless

// REVIEW - Inconsistent event handlers
function Form() {
  const submit = () => { };       // Not prefixed
  const onChangeName = () => { }; // on- prefix
  const handleEmail = () => { };  // handle- prefix
  const clickButton = () => { };  // Mixed style
}
```

### Naming Checklist

- [ ] Component names describe what they render
- [ ] Event handlers use consistent prefix (handle-)
- [ ] Boolean props use is/has/should prefix
- [ ] File names match component names
- [ ] Consistent casing (PascalCase for components)

## Component Files Structure

### Good - Organized File Structure

```
components/
├── Button/
│   ├── index.ts           # Re-exports
│   ├── Button.tsx         # Main component
│   ├── Button.test.tsx    # Tests
│   ├── Button.module.css  # Styles
│   └── types.ts           # Types/interfaces
├── Card/
│   ├── index.ts
│   ├── Card.tsx
│   ├── CardHeader.tsx
│   ├── CardBody.tsx
│   └── Card.module.css
└── Form/
    ├── index.ts
    ├── Form.tsx
    ├── FormField.tsx
    ├── FormError.tsx
    └── useForm.ts         # Related hook
```

### REVIEW - Disorganized Structure

```
components/
├── Button.tsx
├── button.css
├── ButtonStyles.ts
├── Card.tsx
├── CardOld.tsx           # Stale file
├── CardNew.tsx           # Confusing naming
├── card-styles.module.css
├── utils.ts              # Everything dumped here
├── types.ts              # All types in one file
└── index.ts              # Barrel exporting everything
```

## Reusability

### Good - Reusable Design

```tsx
// Good - Works in many contexts
function Badge({ children, variant = 'default' }) {
  return (
    <span className={clsx('badge', `badge-${variant}`)}>
      {children}
    </span>
  );
}

// Used in many places:
<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>
<Badge>Default</Badge>
```

### FAIL - Context-Dependent

```tsx
// FAIL - Tied to specific use case
function UserStatusBadge({ user }) {
  // Hard-coded business logic
  if (user.subscription === 'premium') {
    return <span className="badge-gold">Premium</span>;
  }
  if (user.isAdmin) {
    return <span className="badge-admin">Admin</span>;
  }
  return <span className="badge-free">Free</span>;
}

// Better - Generic badge + logic in parent
function UserStatus({ user }) {
  const { variant, label } = getUserStatusInfo(user);
  return <Badge variant={variant}>{label}</Badge>;
}
```

### Reusability Checklist

- [ ] Component works in multiple contexts
- [ ] Business logic separated from presentation
- [ ] No hard-coded values that should be props
- [ ] Styling can be customized (className prop)
- [ ] No implicit dependencies on parent structure

## Component Architecture Checklist

### Responsibility
- [ ] Single responsibility
- [ ] Clear purpose
- [ ] Appropriate size

### Props
- [ ] Typed interface
- [ ] Sensible defaults
- [ ] No redundant props
- [ ] Documented

### Composition
- [ ] Uses children for flexibility
- [ ] Compound components where appropriate
- [ ] Not over-configured

### State
- [ ] State at right level
- [ ] No unnecessary state
- [ ] No prop drilling

### Naming
- [ ] Descriptive component names
- [ ] Consistent event handler naming
- [ ] File names match components

### Reusability
- [ ] Context-independent
- [ ] Business logic separated
- [ ] Customizable styling
