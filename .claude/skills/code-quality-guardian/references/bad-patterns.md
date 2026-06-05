# Bad Patterns & Anti-Pattern Catalog

Structural anti-pattern detection guide for the code quality guardian. Each pattern includes signals, severity triggers, and preferred alternatives.

## Detection Framework

Before flagging an anti-pattern, verify:
1. The pattern causes measurable harm (maintainability, testability, readability)
2. The scope is sufficient to warrant the finding (one minor instance in test code ≠ FAIL)
3. A concrete alternative exists that reduces overall complexity

## Anti-Patterns

### God Object

A class or module that knows too much or does too much — accumulates unrelated responsibilities.

**Signals:**
- Class with 10+ public methods spanning unrelated domains
- Module imported by >50% of the codebase
- File exceeding 500 lines with 3+ distinct responsibility groups
- Class name contains "Manager", "Handler", "Processor", "Service" with no qualifier

**Trigger: FAIL** when a single class/module owns 3+ unrelated responsibilities.

```typescript
// FAIL — God Object
class UserManager {
  createUser() { /* ... */ }
  sendEmail() { /* ... */ }
  generateReport() { /* ... */ }
  processPayment() { /* ... */ }
  validateAddress() { /* ... */ }
  syncInventory() { /* ... */ }
}
```

```typescript
// GOOD — Single Responsibility
class UserService {
  create(input: CreateUserInput): User { /* ... */ }
  deactivate(userId: UserId): void { /* ... */ }
}

class NotificationService {
  send(notification: Notification): void { /* ... */ }
}

class PaymentService {
  process(payment: PaymentRequest): PaymentResult { /* ... */ }
}
```

### Feature Envy

A method that uses more data from another class than from its own — the logic belongs elsewhere.

**Signals:**
- Method accesses 3+ properties of another object
- Method's parameters are all from one external type
- Method could move to the other class with fewer dependencies

**Trigger: REVIEW** for mild cases; **FAIL** when the method uses zero own-class state.

```typescript
// FAIL — Feature Envy
class InvoiceRenderer {
  renderTotal(order: Order): string {
    const subtotal = order.items.reduce(
      (sum, i) => sum + i.price * i.quantity, 0
    );
    const tax = subtotal * order.taxRate;
    const discount = subtotal * order.discountRate;
    return formatCurrency(subtotal + tax - discount);
  }
}
```

```typescript
// GOOD — Logic lives with the data
class Order {
  getTotal(): Money {
    const subtotal = this.items.reduce(
      (sum, i) => sum + i.price * i.quantity, 0
    );
    return subtotal + this.tax() - this.discount();
  }
}

class InvoiceRenderer {
  renderTotal(order: Order): string {
    return formatCurrency(order.getTotal());
  }
}
```

### Shotgun Surgery

A single logical change requires edits across many files/classes.

**Signals:**
- Adding a field requires changes in 5+ files
- A business rule is enforced in multiple places
- Related constants/enums duplicated across modules

**Trigger: REVIEW** when a change touches 5+ files for a single concern; **FAIL** when 8+.

```typescript
// FAIL — Adding a new status requires changes everywhere
// file: types.ts
type Status = "active" | "inactive" | "pending";
// file: validator.ts
if (s === "active" || s === "inactive" || s === "pending") ...
// file: formatter.ts
const labels = { active: "Active", inactive: "Inactive", pending: "Pending" };
// file: api.ts
const VALID_STATUSES = ["active", "inactive", "pending"];
// file: migration.ts
enum Status { ACTIVE, INACTIVE, PENDING }
```

```typescript
// GOOD — Single source of truth
// file: status.ts
const Status = {
  Active: "active",
  Inactive: "inactive",
  Pending: "pending",
} as const;

type Status = (typeof Status)[keyof typeof Status];

const STATUS_LABELS: Record<Status, string> = {
  [Status.Active]: "Active",
  [Status.Inactive]: "Inactive",
  [Status.Pending]: "Pending",
};
```

### Divergent Change

A single class changes for many different reasons — the opposite of Shotgun Surgery.

**Signals:**
- A class is modified in most PRs for unrelated features
- Different sections of a file are owned by different teams
- Merge conflicts are frequent in a single file

**Trigger: REVIEW** when a module changes for 3+ unrelated reasons; **FAIL** when it's a persistent blocker.

### Primitive Obsession

Using primitives (strings, numbers) where a domain type would convey intent and enforce invariants.

**Signals:**
- Functions that accept `string` for email, URL, ID, currency
- Validation logic repeated at every call site
- Format-dependent string comparisons (`if (status === "active")`)

**Trigger: REVIEW** for isolated cases; **FAIL** when the same primitive is validated in 3+ places.

```typescript
// FAIL — Primitive Obsession
function sendInvite(email: string, role: string): void {
  if (!email.includes("@")) throw new Error("Invalid email");
  if (!["admin", "member"].includes(role)) throw new Error("Bad role");
  // ...
}
```

```typescript
// GOOD — Domain types
function sendInvite(email: Email, role: Role): void {
  // Email and Role are validated at construction
  // ...
}
```

### Data Clumps

Groups of variables that always travel together but aren't encapsulated in a type.

**Signals:**
- Same 3+ parameters repeated across multiple function signatures
- Parallel arrays/objects that share the same index/key semantics
- Destructured groups of the same fields in multiple places

**Trigger: REVIEW** when the clump appears in 3+ signatures.

```typescript
// REVIEW — Data Clump
function createUser(
  firstName: string, lastName: string,
  street: string, city: string, zip: string
): void { /* ... */ }

function updateAddress(
  street: string, city: string, zip: string
): void { /* ... */ }
```

```typescript
// GOOD — Encapsulated
interface Address {
  street: string;
  city: string;
  zip: string;
}

function createUser(name: Name, address: Address): void { /* ... */ }
function updateAddress(address: Address): void { /* ... */ }
```

### Long Parameter Lists

Functions with too many positional parameters — hard to read, easy to misorder.

**Signals:**
- Function with 5+ positional parameters
- Boolean flags as parameters
- Parameters that are always passed together

**Trigger: FAIL** at 6+ positional parameters; **REVIEW** at 5.

```typescript
// FAIL — Long Parameter List
function createOrder(
  userId: string, items: Item[], currency: string,
  discountCode: string, shippingMethod: string,
  giftWrap: boolean, note: string
): Order { /* ... */ }
```

```typescript
// GOOD — Options object
interface CreateOrderInput {
  userId: UserId;
  items: Item[];
  currency: Currency;
  discountCode?: DiscountCode;
  shippingMethod: ShippingMethod;
  giftWrap: boolean;
  note?: string;
}

function createOrder(input: CreateOrderInput): Order { /* ... */ }
```

### Inappropriate Intimacy

Classes that reach deeply into each other's internals instead of using public contracts.

**Signals:**
- Direct property access on another module's internal state
- Importing private/internal symbols across module boundaries
- Reaching through 2+ levels of object graphs

**Trigger: REVIEW** for mild cases; **FAIL** when crossing module boundaries.

```typescript
// FAIL — Inappropriate Intimacy
class OrderService {
  confirm(order: Order): void {
    order._internalState.status = "confirmed";
    order._internalState.confirmedAt = new Date();
    this.db._pool.query("UPDATE orders ...");
  }
}
```

```typescript
// GOOD — Use public contracts
class OrderService {
  confirm(order: Order): void {
    order.confirm();
    this.orderRepo.save(order);
  }
}
```

### Message Chains

Long chains of method calls navigating an object graph — fragile to structural changes.

**Signals:**
- Chains with 4+ navigation steps
- `a.getB().getC().getD().doThing()`
- Null checks required at each step

**Trigger: REVIEW** at 4+ steps; **FAIL** at 6+ steps or when chained across module boundaries.

```typescript
// FAIL — Message Chain
const city = order
  .getCustomer()
  .getAddress()
  .getCity()
  .getName()
  .toUpperCase();
```

```typescript
// GOOD — Ask, don't navigate
const city = order.shippingCity();
```

### Middle Man

A class that delegates almost everything without adding value.

**Signals:**
- >80% of methods are one-line delegations
- Class exists "just in case" or for future extensibility
- No state, no logic, no transformation — pure pass-through

**Trigger: REVIEW** when >50% delegation; **FAIL** when >80%.

```typescript
// FAIL — Middle Man
class UserController {
  getUser(id: string) { return this.service.getUser(id); }
  createUser(d: UserData) { return this.service.createUser(d); }
  deleteUser(id: string) { return this.service.deleteUser(id); }
  updateUser(id: string, d: UserData) {
    return this.service.updateUser(id, d);
  }
}
```

### Arrow Anti-Pattern

Deeply nested conditionals forming an arrow shape — hard to read and reason about.

**Signals:**
- Nesting depth > 3 levels
- Multiple early-return opportunities missed
- Nested try/catch/if combinations

**Trigger: FAIL** at nesting depth > 3.

```typescript
// FAIL — Arrow Anti-Pattern
function process(input: Input): Result {
  if (input) {
    if (input.isValid) {
      if (input.hasPermission) {
        if (input.data) {
          try {
            return transform(input.data);
          } catch (e) {
            throw new ProcessError("transform failed", { cause: e });
          }
        }
      }
    }
  }
  throw new ProcessError("invalid input");
}
```

```typescript
// GOOD — Guard clauses
function process(input: Input): Result {
  if (!input) throw new ProcessError("missing input");
  if (!input.isValid) throw new ProcessError("invalid input");
  if (!input.hasPermission) throw new ProcessError("no permission");
  if (!input.data) throw new ProcessError("missing data");

  try {
    return transform(input.data);
  } catch (e) {
    throw new ProcessError("transform failed", { cause: e });
  }
}
```

### Stringly-Typed Code

Using strings where enums, union types, or structured types would prevent errors.

**Signals:**
- String comparisons for branching (`if (type === "admin")`)
- String concatenation to build structured data
- Free-form strings for status, roles, event types

**Trigger: REVIEW** for isolated cases; **FAIL** when string matching drives core logic in 3+ places.

```typescript
// FAIL — Stringly-Typed
function handleEvent(type: string, payload: string): void {
  if (type === "user.created") {
    const data = JSON.parse(payload);
    // ...
  }
}
```

```typescript
// GOOD — Typed events
interface UserCreatedEvent {
  type: "user.created";
  payload: { userId: UserId; email: Email };
}

type DomainEvent = UserCreatedEvent | OrderPlacedEvent;

function handleEvent(event: DomainEvent): void {
  switch (event.type) {
    case "user.created":
      // event.payload is typed
      break;
  }
}
```

### Boolean Blindness

Functions that accept or return raw booleans without conveying what true/false means.

**Signals:**
- `doThing(true, false, true)` — impossible to read without docs
- Return type `boolean` where the caller must remember what it means
- Multiple boolean parameters on the same function

**Trigger: REVIEW** for 2 boolean params; **FAIL** for 3+.

```typescript
// FAIL — Boolean Blindness
createUser("Alice", true, false, true);
```

```typescript
// GOOD — Named options
createUser("Alice", {
  isAdmin: true,
  sendWelcomeEmail: false,
  requireMfa: true,
});
```

### Lava Flow

Dead or unreachable code left behind from old implementations — nobody dares remove it.

**Signals:**
- Commented-out code blocks
- Functions/classes with zero callers
- `TODO: remove` comments older than the current branch
- Conditional paths that can never execute

**Trigger: FAIL** — dead code must be deleted, not commented out.

```typescript
// FAIL — Lava Flow
// function oldCalculation(x: number): number {
//   return x * 1.5; // old rate
// }

function calculation(x: number): number {
  // if (useOldMethod) return oldCalculation(x); // TODO: remove
  return x * 1.8;
}
```

```typescript
// GOOD — Clean removal
function calculation(x: number): number {
  return x * CURRENT_RATE;
}
```

### Golden Hammer

Using a familiar tool/pattern for every problem regardless of fit.

**Signals:**
- Every module uses the same pattern (e.g., everything is an Observable)
- Technology choice doesn't match the problem (e.g., Redis for relational data)
- Forced abstractions that fight the language idioms

**Trigger: REVIEW** when the pattern creates unnecessary complexity.

### Copy-Paste Programming

Duplicated blocks with minor variations instead of shared abstractions.

**Signals:**
- 10+ lines of near-identical code in 2+ locations
- Same bug fixed in multiple places independently
- Parallel test setups with identical structure

**Trigger: FAIL** when duplicated blocks exceed 10 lines in 2+ locations.

```typescript
// FAIL — Copy-Paste
// file: userApi.ts
async function getUser(id: string): Promise<User> {
  const res = await fetch(`${BASE}/users/${id}`);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

// file: orderApi.ts
async function getOrder(id: string): Promise<Order> {
  const res = await fetch(`${BASE}/orders/${id}`);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}
```

```typescript
// GOOD — Shared abstraction
async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

const getUser = (id: string) => apiGet<User>(`/users/${id}`);
const getOrder = (id: string) => apiGet<Order>(`/orders/${id}`);
```

### Anemic Domain Model

Domain objects that are pure data bags with no behavior — all logic lives in service classes.

**Signals:**
- Model classes with only getters/setters and no methods
- Service classes with methods like `calculateOrderTotal(order)`
- Business rules scattered across multiple services instead of on the entity

**Trigger: REVIEW** when domain logic is consistently external to models.

```typescript
// REVIEW — Anemic Domain Model
class Order {
  items: OrderItem[] = [];
  status: OrderStatus = "draft";
  customerId: string = "";
}

class OrderService {
  calculateTotal(order: Order): Money {
    return order.items.reduce(
      (sum, i) => sum + i.price * i.quantity, 0
    );
  }

  canCancel(order: Order): boolean {
    return order.status === "draft" || order.status === "pending";
  }
}
```

```typescript
// GOOD — Rich Domain Model
class Order {
  private items: OrderItem[] = [];
  private status: OrderStatus = "draft";

  getTotal(): Money {
    return this.items.reduce(
      (sum, i) => sum + i.price * i.quantity, 0
    );
  }

  canCancel(): boolean {
    return this.status === "draft" || this.status === "pending";
  }

  cancel(): void {
    if (!this.canCancel()) {
      throw new DomainError("Cannot cancel order in this state");
    }
    this.status = "cancelled";
  }
}
```

## Severity Table

| Pattern | Default Severity | Escalates to FAIL When |
|---------|-----------------|----------------------|
| God Object | FAIL | 3+ unrelated responsibilities |
| Feature Envy | REVIEW | Method uses zero own-class state |
| Shotgun Surgery | REVIEW | 8+ files for single change |
| Divergent Change | REVIEW | Persistent merge conflict source |
| Primitive Obsession | REVIEW | Same primitive validated 3+ times |
| Data Clumps | REVIEW | Clump in 3+ signatures |
| Long Parameter Lists | REVIEW | 6+ positional parameters |
| Inappropriate Intimacy | REVIEW | Crosses module boundaries |
| Message Chains | REVIEW | 6+ steps or cross-module |
| Middle Man | REVIEW | >80% delegation |
| Arrow Anti-Pattern | FAIL | Nesting depth > 3 |
| Stringly-Typed Code | REVIEW | String matching drives core logic 3+ places |
| Boolean Blindness | REVIEW | 3+ boolean parameters |
| Lava Flow | FAIL | Any dead/commented-out code |
| Golden Hammer | REVIEW | Creates unnecessary complexity |
| Copy-Paste Programming | FAIL | 10+ duplicated lines in 2+ locations |
| Anemic Domain Model | REVIEW | Domain logic consistently external |

## Detection Checklist

### Structural

- [ ] No God Objects (classes with 3+ responsibilities)
- [ ] No Arrow Anti-Pattern (nesting > 3)
- [ ] No Long Parameter Lists (>5 positional)
- [ ] No Middle Man (>80% delegation)
- [ ] No Inappropriate Intimacy (cross-boundary internal access)

### Type Safety

- [ ] No Primitive Obsession (repeated validation of same primitive)
- [ ] No Stringly-Typed Code (string matching for core logic)
- [ ] No Boolean Blindness (3+ boolean params)

### Design Smells

- [ ] No Feature Envy (logic belongs elsewhere)
- [ ] No Shotgun Surgery (change scattered across 8+ files)
- [ ] No Divergent Change (module changes for unrelated reasons)
- [ ] No Data Clumps (same params in 3+ signatures)
- [ ] No Message Chains (6+ navigation steps)

### Code Hygiene

- [ ] No Lava Flow (dead/commented-out code)
- [ ] No Copy-Paste Programming (10+ duplicated lines)
- [ ] No Golden Hammer (forced patterns)
- [ ] No Anemic Domain Model (pure data bags)
