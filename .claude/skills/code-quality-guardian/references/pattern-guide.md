# Design Pattern Guide

When to recommend, and when to avoid, common design patterns during code quality review.

## Decision Framework

Before recommending a pattern, answer:
1. Does the current code have a specific problem the pattern solves?
2. Will the pattern reduce overall complexity (not just move it)?
3. Are there at least 2-3 concrete variants/uses that justify the abstraction?

If any answer is NO, the pattern is premature.

## Pattern Reference

### Factory Pattern

**Recommend when:**
- Object creation involves conditional logic based on type/config
- Multiple similar objects are created with varying initialization
- Creation logic is duplicated across the codebase
- New types are expected and creation should be extensible

**Avoid when:**
- Only one type exists with no foreseeable variants
- Constructor is straightforward with no branching
- The factory would just wrap a single `new` call

**Example trigger (code smell):**
```python
# Multiple if/elif for object creation → Factory
if type == "email":
    notifier = EmailNotifier(smtp_host, smtp_port)
elif type == "sms":
    notifier = SMSNotifier(api_key)
elif type == "push":
    notifier = PushNotifier(device_token)
```

### Strategy Pattern

**Recommend when:**
- Algorithm/behavior varies and is selected at runtime
- Multiple if/elif branches choose between behaviors
- New behaviors are expected to be added over time
- Behaviors are independently testable

**Avoid when:**
- Only one strategy exists
- The branching is simple and unlikely to grow
- The "strategies" are one-liners that don't warrant separate classes

**Example trigger:**
```python
# Growing switch on behavior → Strategy
if format == "csv":
    # 20 lines of CSV export logic
elif format == "json":
    # 20 lines of JSON export logic
elif format == "xml":
    # 20 lines of XML export logic
```

### Inheritance (Class Hierarchy)

**Recommend when:**
- Genuine "is-a" relationship exists
- Shared behavior across types with specialized overrides
- Framework requires it (e.g., Django models, Java abstract classes)
- Liskov Substitution Principle holds naturally

**Avoid when:**
- Relationship is "has-a" (use composition instead)
- Inheriting just to share one method (use a mixin or utility function)
- Hierarchy would exceed 2-3 levels deep
- Child classes override most parent behavior

**Prefer composition when:**
- Behaviors are mix-and-match rather than hierarchical
- Multiple inheritance would be needed
- The shared code is utility-style rather than identity-defining

### Composition

**Recommend when:**
- Object needs capabilities from multiple sources
- Behaviors are independent and combinable
- "Has-a" relationship is more natural than "is-a"
- Flexibility to swap components at runtime is valuable

**Avoid when:**
- There's a clear, single inheritance hierarchy
- Composition adds indirection without flexibility benefit
- The composed objects have only one possible implementation

### Observer / Event Pattern

**Recommend when:**
- Multiple components need to react to state changes
- Publisher shouldn't know about subscribers
- New subscribers may be added without modifying the publisher
- Decoupling is needed between modules

**Avoid when:**
- Only one listener exists (direct call is simpler)
- Event ordering matters critically (use explicit orchestration)
- Debugging the event chain would be harder than the problem it solves

### Template Method

**Recommend when:**
- A process has fixed steps but varying implementations per step
- Multiple classes follow the same algorithm skeleton
- The invariant parts of the algorithm should be enforced

**Avoid when:**
- Steps don't vary (just write the procedure)
- Only one concrete implementation exists
- The "template" would have only one abstract method (use Strategy instead)

### Decorator Pattern

**Recommend when:**
- Behavior needs to be added to objects dynamically
- Multiple independent enhancements can be layered
- Subclassing would create a combinatorial explosion

**Avoid when:**
- Only one decoration is ever applied
- The decoration is always required (just put it in the class)
- Debugging through multiple layers would be prohibitive

## Complexity vs Pattern Trade-offs

| Situation | Simple Code | Pattern |
|-----------|-------------|---------|
| 2 variants, unlikely to grow | Direct if/else | Unnecessary |
| 3+ variants, growing | Hard to maintain | Recommended |
| Single implementation | Clear and direct | Over-engineering |
| Shared behavior, 2+ classes | Duplicated code | Extract base/mixin |
| One-time configuration | Inline setup | Unnecessary factory |
| Runtime behavior switching | Messy conditionals | Strategy |

## Red Flags for Over-Engineering

- Abstract class with only one concrete implementation
- Interface with only one implementor
- Factory that creates only one type
- Strategy with only one strategy
- Event system with only one subscriber
- Decorator applied only once, always
- 3+ layers of indirection for a simple operation

## Red Flags for Under-Engineering

- Switch/if statements that grow with each new feature
- Copy-pasted blocks with minor variations
- God classes with 500+ lines and 10+ responsibilities
- Functions with 8+ parameters (missing a value object)
- Deeply nested conditionals (3+ levels)
- Same validation/transformation logic in multiple places
