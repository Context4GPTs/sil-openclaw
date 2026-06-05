# Testing Tiers

## Contents
- Unit Tests
- Integration Tests
- E2E (Acceptance) Tests
- Tier Selection Decision Tree
- Mocking Rules by Tier

---

## Unit Tests

**Scope:** Single function, method, or class in complete isolation.

**Characteristics:**
- Execute in <100ms per test
- No I/O: no filesystem, no network, no database
- No side effects: each test is hermetic
- Dependencies replaced with test doubles (stubs, not mocks when possible)

**What to test:**
- Pure logic and transformations
- Input validation and parsing
- Error handling for individual functions
- State transitions within a single class
- Edge cases for algorithmic code

**What NOT to test at this tier:**
- Database queries (integration tier)
- HTTP endpoints (integration tier)
- Full user flows (e2e tier)
- Framework behavior (trust the framework)

**Naming convention:** `[module].test.[ext]` or `[module].spec.[ext]`

**Example structure:**
```
test('calculateDiscount returns 0 for orders under $50', () => {
  // Arrange
  const order = { total: 49.99, items: [] };

  // Act
  const discount = calculateDiscount(order);

  // Assert
  expect(discount).toBe(0);
});
```

---

## Integration Tests

**Scope:** Interaction between two or more components, modules, or services.

**Characteristics:**
- Execute in <5s per test
- Real dependencies where feasible (test database, local services)
- Test the seams — where components connect
- May involve I/O (database, filesystem, HTTP)

**What to test:**
- API endpoint request/response contracts
- Database query correctness with real schema
- Service-to-service communication
- Middleware chains and request pipelines
- Authentication/authorization flows
- Event publishing and consumption

**What NOT to test at this tier:**
- Pure business logic (unit tier)
- Full browser flows (e2e tier)
- UI rendering (e2e tier)

**Naming convention:** `[module].integration.test.[ext]` or `[module].integration.spec.[ext]`

**Example structure:**
```
test('POST /api/orders creates order and returns 201', async () => {
  // Arrange
  const payload = { items: [{ id: 'sku-1', qty: 2 }] };

  // Act
  const response = await request(app).post('/api/orders').send(payload);

  // Assert
  expect(response.status).toBe(201);
  expect(response.body.orderId).toBeDefined();

  // Verify side effect
  const saved = await db.orders.findById(response.body.orderId);
  expect(saved.items).toHaveLength(1);
});
```

---

## E2E (Acceptance) Tests

**Scope:** Complete user journey through the real system.

**Characteristics:**
- Execute in <30s per test
- Real system — no mocks, no stubs
- Browser-based for web applications
- Test what the user sees and does
- Map directly to acceptance criteria from product docs

**What to test:**
- Critical user journeys (signup, purchase, core workflows)
- Cross-cutting concerns (auth → action → result → notification)
- Error recovery flows (network failure → retry → success)
- Business rule enforcement end-to-end

**What NOT to test at this tier:**
- Individual function behavior (unit tier)
- API contracts in isolation (integration tier)
- Visual regression (separate visual testing)

**Naming convention:** `[flow].e2e.test.[ext]` or `[flow].acceptance.test.[ext]`

**Example structure:**
```
test('user can complete checkout flow', async () => {
  // Navigate to product
  await page.goto('/products/widget-a');

  // Add to cart
  await page.click('[data-testid="add-to-cart"]');
  await expect(page.locator('.cart-count')).toHaveText('1');

  // Checkout
  await page.click('[data-testid="checkout"]');
  await page.fill('#email', 'test@example.com');
  await page.fill('#card', '4242424242424242');
  await page.click('[data-testid="pay"]');

  // Verify confirmation
  await expect(page.locator('.confirmation')).toBeVisible();
  await expect(page.locator('.order-id')).not.toBeEmpty();
});
```

---

## Tier Selection Decision Tree

```
Is it testing a single function/method with no external dependencies?
  YES → Unit test

Is it testing how two or more components interact?
  YES → Integration test

Is it testing a complete user journey through the real system?
  YES → E2E test

Is it testing an API endpoint with a real database?
  YES → Integration test

Is it testing business logic that involves UI interaction?
  YES → E2E test

Is it testing input validation on a single function?
  YES → Unit test

Is it testing that an error in service A propagates correctly to service B?
  YES → Integration test
```

---

## Mocking Rules by Tier

| Tier | Mocking Policy |
|------|---------------|
| **Unit** | Mock external dependencies (DB, HTTP, filesystem). Never mock the unit under test. Prefer stubs over mocks. |
| **Integration** | Use real dependencies. Mock only truly external services (third-party APIs). Use test databases with real schemas. |
| **E2E** | No mocking. Everything real. If a third-party service is unavailable, use a sandbox/staging environment — not a mock. |

**Anti-pattern at all tiers:** Mocking the thing you're testing. If you mock the function under test, the test proves nothing.
