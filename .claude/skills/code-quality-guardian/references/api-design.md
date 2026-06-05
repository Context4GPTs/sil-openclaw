# API Design Review Guide

Well-designed APIs are intuitive, consistent, and maintainable.

## RESTful Conventions

### HTTP Methods

| Method | Purpose | Idempotent | Safe |
|--------|---------|------------|------|
| GET | Retrieve resource(s) | Yes | Yes |
| POST | Create resource | No | No |
| PUT | Replace resource | Yes | No |
| PATCH | Partial update | No | No |
| DELETE | Remove resource | Yes | No |

```python
# Good - Correct method usage
@app.get("/users/{id}")
def get_user(id: str): ...

@app.post("/users")
def create_user(data: UserCreate): ...

@app.put("/users/{id}")
def replace_user(id: str, data: User): ...

@app.patch("/users/{id}")
def update_user(id: str, data: UserUpdate): ...

@app.delete("/users/{id}")
def delete_user(id: str): ...

# REVIEW - Wrong method for operation
@app.post("/users/{id}/get")  # Should be GET /users/{id}
@app.get("/users/{id}/delete")  # Should be DELETE /users/{id}
```

### URL Structure

```python
# Good - Resource-oriented URLs
GET    /users              # List users
GET    /users/123          # Get user 123
POST   /users              # Create user
PUT    /users/123          # Replace user 123
DELETE /users/123          # Delete user 123
GET    /users/123/orders   # User's orders (nested resource)

# REVIEW - Verb-based URLs (RPC style)
GET    /getUser?id=123
POST   /createUser
POST   /deleteUser
GET    /getUserOrders?userId=123
```

### Status Codes

```python
# Good - Appropriate status codes
@app.post("/users")
def create_user(data: UserCreate):
    user = User.create(data)
    return JSONResponse(user.dict(), status_code=201)  # Created

@app.get("/users/{id}")
def get_user(id: str):
    user = User.get(id)
    if not user:
        raise HTTPException(404, "User not found")  # Not Found
    return user

@app.delete("/users/{id}")
def delete_user(id: str):
    User.delete(id)
    return Response(status_code=204)  # No Content

# REVIEW - Incorrect status codes
@app.post("/users")
def create_user(data: UserCreate):
    user = User.create(data)
    return user  # 200 instead of 201 for creation

@app.delete("/users/{id}")
def delete_user(id: str):
    User.delete(id)
    return {"message": "deleted"}  # 200 with body instead of 204
```

### Common Status Code Reference

| Code | Meaning | Use Case |
|------|---------|----------|
| 200 | OK | Successful GET, PUT, PATCH |
| 201 | Created | Successful POST creating resource |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid request body/params |
| 401 | Unauthorized | Missing/invalid authentication |
| 403 | Forbidden | Authenticated but not permitted |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource state conflict |
| 422 | Unprocessable Entity | Validation errors |
| 500 | Internal Server Error | Unexpected server error |

## Request/Response Design

### Consistent Response Structure

```python
# Good - Consistent envelope
{
    "data": {...},
    "meta": {
        "page": 1,
        "total": 100
    }
}

# Good - Error responses
{
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "Invalid email format",
        "details": [
            {"field": "email", "message": "Must be valid email"}
        ]
    }
}

# REVIEW - Inconsistent structures
{"user": {...}}          # One endpoint
{"data": {...}}          # Another endpoint
{"result": {...}}        # Yet another
```

### Naming Conventions

```python
# Good - Consistent snake_case (or camelCase - pick one)
{
    "user_id": "123",
    "created_at": "2024-01-15T10:30:00Z",
    "email_address": "user@example.com"
}

# REVIEW - Mixed conventions
{
    "userId": "123",
    "created_at": "2024-01-15",
    "EmailAddress": "user@example.com"
}
```

### Date/Time Format

```python
# Good - ISO 8601 with timezone
{
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T14:45:30+00:00"
}

# REVIEW - Inconsistent or ambiguous formats
{
    "created_at": "01/15/2024",  # Ambiguous (US vs EU)
    "updated_at": 1705315800     # Unix timestamp (ok but document it)
}
```

## Pagination

### Offset-Based Pagination

```python
# Good - Clear pagination
GET /users?page=2&page_size=20

{
    "data": [...],
    "pagination": {
        "page": 2,
        "page_size": 20,
        "total_items": 150,
        "total_pages": 8
    }
}
```

### Cursor-Based Pagination

```python
# Good - For large datasets or real-time data
GET /users?cursor=abc123&limit=20

{
    "data": [...],
    "pagination": {
        "next_cursor": "xyz789",
        "has_more": true
    }
}
```

### FAIL - No Pagination

```python
# FAIL - Unbounded response
GET /users  # Returns all 10 million users
```

## Filtering and Sorting

```python
# Good - Clear query parameters
GET /users?status=active&role=admin&sort=-created_at&fields=id,name,email

# Good - Documented filter syntax
GET /orders?created_at[gte]=2024-01-01&total[lte]=1000

# REVIEW - Unclear filter syntax
GET /users?filter=status:active;role:admin  # Non-standard
```

## Versioning

```python
# Good - URL versioning (most common)
GET /v1/users
GET /v2/users

# Good - Header versioning
GET /users
Accept: application/vnd.api+json;version=2

# REVIEW - No versioning strategy for public API
GET /users  # What happens when breaking changes needed?
```

## Error Responses

### Good - Structured Error Response

```python
@app.exception_handler(ValidationError)
def validation_error_handler(request, exc):
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": [
                    {
                        "field": err["loc"][-1],
                        "message": err["msg"],
                        "type": err["type"]
                    }
                    for err in exc.errors()
                ]
            }
        }
    )
```

### REVIEW - Unhelpful Error Response

```python
{
    "error": "Bad request"  # No details, no error code
}
```

### FAIL - Exposing Internal Errors

```python
{
    "error": "psycopg2.errors.UniqueViolation: duplicate key value",
    "traceback": "..."
}
```

## Input Validation

```python
# Good - Validate and document constraints
from pydantic import BaseModel, Field, validator

class UserCreate(BaseModel):
    email: str = Field(..., description="User email address")
    username: str = Field(..., min_length=3, max_length=50)
    age: int = Field(None, ge=0, le=150)

    @validator('email')
    def validate_email(cls, v):
        if '@' not in v:
            raise ValueError('Invalid email format')
        return v.lower()

# REVIEW - No validation
class UserCreate(BaseModel):
    email: str
    username: str
    age: int  # No constraints
```

## Documentation

### Good - Self-Documenting API

```python
from fastapi import FastAPI, Query, Path

@app.get(
    "/users/{user_id}",
    summary="Get user by ID",
    description="Retrieve a user's profile by their unique identifier.",
    response_model=User,
    responses={
        404: {"description": "User not found"},
        403: {"description": "Not authorized to view this user"}
    }
)
def get_user(
    user_id: str = Path(..., description="The unique user identifier"),
    include_orders: bool = Query(False, description="Include user's orders")
):
    ...
```

### REVIEW - Undocumented API

```python
@app.get("/users/{id}")
def get_user(id, orders=False):
    ...  # No documentation, unclear parameters
```

## Idempotency

For non-idempotent operations, consider idempotency keys.

```python
# Good - Idempotency key for payment creation
@app.post("/payments")
def create_payment(
    data: PaymentCreate,
    idempotency_key: str = Header(...)
):
    # Check if request with this key was already processed
    existing = Payment.get_by_idempotency_key(idempotency_key)
    if existing:
        return existing  # Return same result

    payment = Payment.create(data, idempotency_key)
    return payment
```

## Rate Limiting

```python
# Good - Rate limit headers
@app.middleware("http")
async def add_rate_limit_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-RateLimit-Limit"] = "100"
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-RateLimit-Reset"] = str(reset_timestamp)
    return response
```

## API Design Checklist

### REST Conventions
- [ ] Correct HTTP methods (GET, POST, PUT, PATCH, DELETE)
- [ ] Resource-oriented URLs (not verb-based)
- [ ] Appropriate status codes (201 for create, 204 for delete, etc.)
- [ ] Consistent URL structure

### Request/Response
- [ ] Consistent response envelope structure
- [ ] Consistent naming convention (snake_case or camelCase)
- [ ] ISO 8601 date/time format
- [ ] Clear field names

### Pagination
- [ ] All list endpoints paginated
- [ ] Consistent pagination structure
- [ ] Max page size enforced

### Errors
- [ ] Structured error responses with codes
- [ ] Validation errors include field details
- [ ] No internal errors exposed to clients

### Documentation
- [ ] All endpoints documented
- [ ] Request/response examples
- [ ] Error responses documented
- [ ] OpenAPI/Swagger spec available

### Security (see security-review.md)
- [ ] Authentication required where needed
- [ ] Authorization checks on resources
- [ ] Input validation on all fields
- [ ] Rate limiting for public APIs

### Versioning
- [ ] Version strategy defined (URL or header)
- [ ] Breaking changes handled gracefully
