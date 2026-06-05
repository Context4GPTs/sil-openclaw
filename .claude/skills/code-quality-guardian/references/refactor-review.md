# Refactor-Consolidation & Re-Architecture Review

Guide for evaluating module cohesion, coupling, dependency direction, layer integrity, and consolidation opportunities during code quality review.

## Decision Framework

Before recommending a refactor, verify:
1. The structural problem is real (not just aesthetic preference)
2. The fix reduces total complexity rather than redistributing it
3. The change scope is proportional to the benefit

## Analysis Dimensions

### 1. Cohesion Analysis

Modules should contain related functionality that changes for the same reasons.

**Low cohesion signals:**
- A module contains functions that never call each other
- Unrelated imports at the top of a file (database + email + PDF generation)
- File named `utils.ts`, `helpers.py`, `misc.go`, `common.rs`
- A class where methods can be split into independent groups with no shared state

**The "utils" smell:**
- A `utils` or `helpers` module is a symptom of missing domain concepts
- Each function in `utils` likely belongs in a specific domain module
- If `utils` exceeds 100 lines, it must be decomposed

**Trigger: REVIEW** for low cohesion in non-critical modules; **FAIL** for `utils` files exceeding 200 lines or containing 3+ unrelated domains.

**Evaluation approach:**
```
For each module, ask:
  - Can you describe what this module does in one sentence without "and"?
  - Do all exported symbols relate to that sentence?
  - Would adding a new feature in this domain naturally land in this file?

If any answer is NO → cohesion problem.
```

### 2. Coupling Analysis

Modules should depend on abstractions, not concrete implementations of other modules.

**Tight coupling signals:**
- Module A imports 5+ symbols from Module B
- Changing one module's internal structure breaks another module
- Circular dependencies between modules
- Shared mutable state between modules
- Direct database access from presentation layer

**Trigger: FAIL** for circular dependencies. **REVIEW** for high fan-in coupling (module imported by >10 other modules).

**Evaluation approach:**
```
For each module, check:
  - How many other modules import from this one? (fan-out)
  - How many modules does this one import from? (fan-in)
  - Are imports restricted to public contracts, or reaching into internals?
  - Does removing this module cascade failures across unrelated areas?

Fan-out > 8 or circular deps → coupling problem.
```

### 3. Module Boundary Assessment

Module boundaries should align with domain concepts, not technical layers.

**Misaligned boundary signals:**
- A "shared" module that grows faster than domain modules
- Cross-cutting concerns duplicated because the boundary is wrong
- Feature changes requiring coordinated edits across 3+ modules
- "Shared" used as a dumping ground for anything two modules need

**The shared-as-dumping-ground smell:**
- Shared should contain contracts (types, interfaces, constants)
- Business logic in shared is a boundary violation
- If shared has more code than any domain module, boundaries are wrong

**Trigger: REVIEW** when shared contains business logic; **FAIL** when shared is the largest module by line count.

### 4. Dependency Direction

Dependencies must flow inward: presentation → application → domain → infrastructure abstractions. Never the reverse.

**Layering rules:**
```
UI / API handlers
    ↓ depends on
Application services / Use cases
    ↓ depends on
Domain models / Business logic
    ↓ depends on (abstractions only)
Infrastructure interfaces (repos, clients)

Infrastructure implementations → implement domain interfaces
```

**Violations:**
- Domain importing from infrastructure (`import { PgPool } from "pg"` in a domain model)
- Domain depending on application services
- Application layer importing UI/API framework types
- Business logic importing HTTP/transport concerns

**Trigger: FAIL** for domain depending on infrastructure or presentation layers.

**Evaluation approach:**
```
For each import in a domain file:
  - Is the import from a lower layer? → OK
  - Is the import from the same layer? → OK (watch for circular)
  - Is the import from a higher layer? → FAIL — dependency inversion needed
```

### 5. Consolidation Signals

Detect parallel implementations, duplicate types, and scattered logic that should be unified.

**Consolidation needed when:**
- Two types represent the same domain concept (`User` and `UserDTO` and `UserModel` and `UserEntity`)
- Same validation logic exists in API handler AND service layer AND domain
- Parallel implementations of the same algorithm in different modules
- Multiple configuration sources for the same concern
- Duplicate error handling strategies across services

**Trigger: FAIL** for duplicate types representing the same concept without clear transformation reason. **REVIEW** for minor duplication.

**Evaluation approach:**
```
Search for:
  - Type names that are the same concept with different suffixes
  - Functions with similar names across modules
  - Identical error handling blocks in multiple files
  - Same regex/validation pattern in multiple locations

Each duplicate → ask: is the difference intentional and meaningful?
If not → consolidate.
```

### 6. When to Extract vs Inline

Not every shared piece of code deserves extraction. Not every standalone module should stay separate.

**Extract when:**
- 3+ callers use the same logic (Rule of Three)
- The extracted unit has a clear name and single purpose
- The logic is non-trivial (>5 lines of meaningful code)
- Tests would be simpler targeting the extracted unit

**Inline when:**
- Only 1 caller exists
- The function name just restates the body
- The abstraction adds indirection without clarity
- The extracted function requires passing 5+ parameters for context

**Trigger: REVIEW** for premature extractions (1 caller) or missed extractions (3+ duplications).

### 7. Service/Module Extraction Signals

When a module outgrows its boundaries, it may need to split.

**Extract a new service/module when:**
- Module exceeds 1000 lines with 2+ distinct responsibility groups
- A subset of the module has a different scaling requirement
- A subset requires different deployment cadence
- A subset has different ownership/team boundaries
- The module's tests are slow because of unrelated setup

**Do NOT extract when:**
- The split would create circular dependencies
- The two halves share significant mutable state
- The communication overhead between halves exceeds the cohesion benefit
- The module is large but cohesive (single responsibility, just detailed)

### 8. Interface/Contract Consolidation

Interfaces and contracts should be minimal, focused, and non-overlapping.

**Consolidation signals:**
- Two interfaces with 80%+ method overlap
- An interface with only one implementor that isn't at a module boundary
- Multiple event types that carry identical payloads
- Overlapping API endpoints returning the same data in different shapes

**Trigger: REVIEW** for single-implementor interfaces not at boundaries; **FAIL** for overlapping interfaces with divergent evolution.

### 9. Responsibility Distribution

Logic should live at the appropriate level — not too high, not too low.

**Imbalanced distribution signals:**
- One module has 5x the code of its peers at the same level
- Controllers/handlers contain business logic (should be in services/domain)
- Database queries contain business rules (should be in domain)
- Domain models import framework-specific types
- Utility functions contain domain knowledge

**Trigger: REVIEW** for logic at the wrong layer; **FAIL** when business rules live in infrastructure.

### 10. Layer Violation Detection

Systematic check for code that crosses architectural boundaries.

| Violation | Severity | Example |
|-----------|----------|---------|
| Domain → Infrastructure | FAIL | Domain model imports database driver |
| Domain → Presentation | FAIL | Domain model imports HTTP types |
| Domain → Application | FAIL | Domain model calls application service |
| Application → Presentation | REVIEW | Service references API-specific types |
| Infrastructure → Domain | OK | Repository implements domain interface |
| Presentation → Application | OK | Handler calls application service |

**Detection approach:**
```
1. Identify which layer each file belongs to (by path convention)
2. For each import, check the layer of the imported module
3. Flag imports that violate the dependency direction table above
```

### 11. Data Model Normalization

Data structures should be normalized enough to prevent inconsistency, but not so normalized that every read requires joins across the codebase.

**Over-normalization signals:**
- Every read operation requires assembling 4+ separate lookups
- Types are so decomposed that the full picture is never in one place
- Excessive ID-reference indirection where embedding would be simpler

**Under-normalization signals:**
- Same data embedded in multiple types with no single source of truth
- Updates require finding and modifying 3+ locations
- Inconsistent state is possible because data is duplicated

**Trigger: REVIEW** for either extreme; **FAIL** when duplicated data has caused or will cause inconsistency.

## Refactor Decision Matrix

| Signal | Action | Confidence Threshold |
|--------|--------|---------------------|
| Circular dependency | Break the cycle | Always — FAIL |
| Domain → infrastructure import | Invert with interface | Always — FAIL |
| 3+ duplications of same logic | Extract shared abstraction | High |
| Utils file > 200 lines | Decompose by domain | High |
| Module > 1000 lines, 2+ responsibilities | Split module | Medium-High |
| Shared contains business logic | Move to domain module | High |
| Single-implementor interface (not at boundary) | Inline or remove | Medium |
| 1-caller extracted function | Inline back | Medium |
| Parallel types for same concept | Consolidate | High |
| Logic at wrong layer | Move to correct layer | High |

## Refactor-Consolidation Checklist

### Cohesion & Boundaries

- [ ] No `utils`/`helpers` files exceeding 200 lines
- [ ] Each module describable in one sentence without "and"
- [ ] Shared module contains only contracts (types, interfaces, constants)
- [ ] Module boundaries align with domain concepts

### Coupling & Dependencies

- [ ] No circular dependencies
- [ ] Dependencies flow inward (presentation → application → domain)
- [ ] No domain imports from infrastructure or presentation
- [ ] Fan-out per module ≤ 8

### Consolidation

- [ ] No parallel types for the same domain concept
- [ ] No duplicate validation/business logic across layers
- [ ] No premature extractions (1-caller abstractions)
- [ ] No missed extractions (3+ duplications without shared abstraction)

### Responsibility Distribution

- [ ] Business logic in domain layer (not handlers, not DB queries)
- [ ] No framework types in domain models
- [ ] Module sizes roughly balanced at each architectural level
- [ ] Data model neither over- nor under-normalized
