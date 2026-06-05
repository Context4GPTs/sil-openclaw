# Performance Review Guide

Performance issues can cause system degradation, poor UX, and increased costs.

## Database Performance

### N+1 Query Pattern

**FAIL - N+1 queries**

```python
# FAIL - Executes N+1 queries (1 for orders + N for users)
orders = Order.objects.all()
for order in orders:
    print(order.user.name)  # Each access triggers a query
```

**Good - Eager loading**

```python
# Good - Single query with join
orders = Order.objects.select_related('user').all()
for order in orders:
    print(order.user.name)  # No additional queries

# Good - Prefetch for many-to-many
users = User.objects.prefetch_related('orders').all()
```

### Missing Indexes

Flag queries that filter/sort on non-indexed columns in high-traffic code paths.

```python
# Review - Likely needs index
User.objects.filter(email=email)  # email should be indexed
Order.objects.filter(created_at__gte=date).order_by('-total')  # created_at, total

# Flag in migration review
class Migration:
    operations = [
        migrations.AddField('User', 'status', ...),
        # REVIEW: Add index if filtering by status is common
    ]
```

### Query Optimization

```python
# FAIL - Fetching all columns when only some needed
users = User.objects.all()
names = [u.name for u in users]

# Good - Only fetch needed columns
names = User.objects.values_list('name', flat=True)

# FAIL - Multiple queries for counts
total = Order.objects.count()
pending = Order.objects.filter(status='pending').count()
shipped = Order.objects.filter(status='shipped').count()

# Good - Single query with aggregation
from django.db.models import Count, Q
stats = Order.objects.aggregate(
    total=Count('id'),
    pending=Count('id', filter=Q(status='pending')),
    shipped=Count('id', filter=Q(status='shipped'))
)
```

## Memory Management

### Unbounded Collections

```python
# FAIL - Loading all records into memory
all_records = list(Record.objects.all())  # Could be millions

# Good - Iterate in batches
def process_records():
    batch_size = 1000
    offset = 0
    while True:
        batch = Record.objects.all()[offset:offset + batch_size]
        if not batch:
            break
        for record in batch:
            process(record)
        offset += batch_size

# Good - Use iterator() for large querysets
for record in Record.objects.all().iterator(chunk_size=1000):
    process(record)
```

### Resource Leaks

```python
# FAIL - File handle leak
def read_files(paths):
    contents = []
    for path in paths:
        f = open(path)  # Never closed
        contents.append(f.read())
    return contents

# Good - Context managers
def read_files(paths):
    contents = []
    for path in paths:
        with open(path) as f:
            contents.append(f.read())
    return contents

# FAIL - Connection leak
def get_data():
    conn = psycopg2.connect(dsn)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM data")
    return cursor.fetchall()  # Connection never closed

# Good - Connection pool with context manager
def get_data():
    with connection_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM data")
            return cursor.fetchall()
```

### Growing Collections

```python
# REVIEW - Potential memory issue with growing cache
class DataProcessor:
    def __init__(self):
        self.cache = {}  # Grows unbounded

    def process(self, key, data):
        self.cache[key] = expensive_computation(data)
        return self.cache[key]

# Good - Bounded cache
from functools import lru_cache

class DataProcessor:
    @lru_cache(maxsize=1000)
    def process(self, key, data):
        return expensive_computation(data)
```

## Async Performance

### Blocking in Async Code

```python
# FAIL - Blocking call in async function
async def fetch_user_data(user_id: str):
    # This blocks the event loop!
    response = requests.get(f"/api/users/{user_id}")
    return response.json()

# Good - Use async HTTP client
async def fetch_user_data(user_id: str):
    async with aiohttp.ClientSession() as session:
        async with session.get(f"/api/users/{user_id}") as response:
            return await response.json()

# FAIL - Blocking file I/O in async
async def read_config():
    with open("config.yaml") as f:  # Blocks
        return yaml.load(f)

# Good - Use async file I/O
async def read_config():
    async with aiofiles.open("config.yaml") as f:
        content = await f.read()
        return yaml.safe_load(content)
```

### Missing Concurrency

```python
# FAIL - Sequential when parallel is possible
async def fetch_all_users(user_ids: list[str]):
    users = []
    for user_id in user_ids:
        user = await fetch_user(user_id)  # Sequential
        users.append(user)
    return users

# Good - Concurrent execution
async def fetch_all_users(user_ids: list[str]):
    tasks = [fetch_user(user_id) for user_id in user_ids]
    return await asyncio.gather(*tasks)

# Good - With concurrency limit
async def fetch_all_users(user_ids: list[str]):
    semaphore = asyncio.Semaphore(10)  # Max 10 concurrent

    async def fetch_with_limit(user_id):
        async with semaphore:
            return await fetch_user(user_id)

    tasks = [fetch_with_limit(uid) for uid in user_ids]
    return await asyncio.gather(*tasks)
```

## Algorithmic Complexity

### Unbounded Operations

```python
# FAIL - O(n²) nested loop
def find_duplicates(items):
    duplicates = []
    for i, item in enumerate(items):
        for j, other in enumerate(items):
            if i != j and item == other:
                duplicates.append(item)
    return duplicates

# Good - O(n) with set
def find_duplicates(items):
    seen = set()
    duplicates = set()
    for item in items:
        if item in seen:
            duplicates.add(item)
        seen.add(item)
    return list(duplicates)
```

### Missing Pagination

```python
# FAIL - Returns potentially millions of records
@app.get("/api/users")
def list_users():
    return User.objects.all()  # Unbounded

# Good - Paginated response
@app.get("/api/users")
def list_users(page: int = 1, page_size: int = 50):
    if page_size > 100:
        page_size = 100  # Enforce max
    offset = (page - 1) * page_size
    users = User.objects.all()[offset:offset + page_size]
    total = User.objects.count()
    return {
        "data": users,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size
    }
```

## Caching

### Missing Caching for Expensive Operations

```python
# REVIEW - Expensive operation without caching
def get_user_permissions(user_id: str) -> list[str]:
    # Complex query joining multiple tables
    return db.query("""
        SELECT DISTINCT p.name
        FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        JOIN user_roles ur ON rp.role_id = ur.role_id
        WHERE ur.user_id = %s
    """, [user_id])

# Good - Cached with appropriate TTL
from functools import lru_cache
from cachetools import TTLCache

permissions_cache = TTLCache(maxsize=1000, ttl=300)  # 5 min TTL

def get_user_permissions(user_id: str) -> list[str]:
    if user_id in permissions_cache:
        return permissions_cache[user_id]

    perms = db.query(...)
    permissions_cache[user_id] = perms
    return perms
```

### Cache Invalidation

```python
# REVIEW - Cache without invalidation strategy
def update_user(user_id: str, data: dict):
    User.objects.filter(id=user_id).update(**data)
    # Cache still has stale data!

# Good - Invalidate on update
def update_user(user_id: str, data: dict):
    User.objects.filter(id=user_id).update(**data)
    cache.delete(f"user:{user_id}")
    cache.delete(f"user_permissions:{user_id}")
```

## Object Creation

### Hot Path Object Creation

```python
# REVIEW - Creating objects in hot loop
def process_items(items):
    for item in items:
        formatter = DataFormatter()  # New instance each iteration
        result = formatter.format(item)
        yield result

# Good - Reuse objects
def process_items(items):
    formatter = DataFormatter()  # Single instance
    for item in items:
        result = formatter.format(item)
        yield result

# REVIEW - String concatenation in loop
def build_report(rows):
    report = ""
    for row in rows:
        report += f"{row.name}: {row.value}\n"  # O(n²)
    return report

# Good - Use list and join
def build_report(rows):
    lines = [f"{row.name}: {row.value}" for row in rows]
    return "\n".join(lines)
```

## Frontend Performance (if applicable)

### Bundle Size

```javascript
// REVIEW - Importing entire library
import _ from 'lodash';
const result = _.pick(obj, ['a', 'b']);

// Good - Import only what's needed
import pick from 'lodash/pick';
const result = pick(obj, ['a', 'b']);
```

### Render Performance

```javascript
// REVIEW - Expensive computation on every render
function UserList({ users }) {
    const sortedUsers = users.sort((a, b) => a.name.localeCompare(b.name));
    return <List items={sortedUsers} />;
}

// Good - Memoize expensive computations
function UserList({ users }) {
    const sortedUsers = useMemo(
        () => [...users].sort((a, b) => a.name.localeCompare(b.name)),
        [users]
    );
    return <List items={sortedUsers} />;
}
```

## Performance Checklist

### Database
- [ ] No N+1 query patterns
- [ ] Indexes present for filtered/sorted columns
- [ ] Only needed columns fetched
- [ ] Large datasets paginated or streamed

### Memory
- [ ] No unbounded collections
- [ ] Resources properly closed (files, connections)
- [ ] Caches have size limits and TTLs
- [ ] Large data processed in batches

### Async
- [ ] No blocking calls in async code
- [ ] Concurrent operations where possible
- [ ] Proper concurrency limits

### Algorithms
- [ ] No O(n²) or worse in hot paths
- [ ] Appropriate data structures used
- [ ] Pagination for list endpoints

### Caching
- [ ] Expensive operations cached
- [ ] Cache invalidation implemented
- [ ] Appropriate TTLs set

### Objects
- [ ] Minimize object creation in loops
- [ ] String building uses efficient patterns
- [ ] Frontend: memoization where appropriate
