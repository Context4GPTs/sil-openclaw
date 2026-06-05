# Error Handling Review Guide

Proper error handling is critical for reliability, debuggability, and security.

## Core Principles

1. **Fail fast** - Detect and report errors as early as possible
2. **Be specific** - Catch specific exceptions, not generic ones
3. **Preserve context** - Include relevant information for debugging
4. **Don't expose internals** - User-facing errors should be helpful but not revealing
5. **Log appropriately** - All errors should be logged with context
6. **Recover when possible** - Implement graceful degradation where appropriate

## Exception Specificity

### Good - Specific exception types

```python
try:
    user = get_user(user_id)
    validate_permissions(user)
    result = process_request(user, data)
except UserNotFoundError as e:
    logger.warning(f"User {user_id} not found: {e}")
    raise HTTPException(404, "User not found")
except PermissionDeniedError as e:
    logger.warning(f"Permission denied for {user_id}: {e}")
    raise HTTPException(403, "Permission denied")
except ValidationError as e:
    logger.info(f"Validation failed: {e}")
    raise HTTPException(400, str(e))
except ProcessingError as e:
    logger.error(f"Processing failed for {user_id}: {e}")
    raise HTTPException(500, "Processing failed")
```

### FAIL - Bare except clause

```python
try:
    result = process_data(data)
except:  # FAIL - Catches everything including SystemExit, KeyboardInterrupt
    pass
```

### FAIL - Overly broad exception

```python
try:
    result = process_data(data)
except Exception as e:  # FAIL - Masks all errors
    return None
```

### REVIEW - Broad exception with logging

```python
try:
    result = process_data(data)
except Exception as e:
    logger.error(f"Unexpected error processing data: {e}", exc_info=True)
    raise  # At least re-raises
```

## Error Propagation Strategies

### Strategy 1: Re-raise with Context

```python
def process_order(order_id: str) -> Order:
    try:
        order = fetch_order(order_id)
        return validate_and_process(order)
    except DatabaseError as e:
        raise OrderProcessingError(
            f"Failed to process order {order_id}"
        ) from e  # Preserves original traceback
```

### Strategy 2: Transform to Application Error

```python
def get_user_profile(user_id: str) -> UserProfile:
    try:
        data = external_api.fetch_user(user_id)
        return UserProfile.from_dict(data)
    except requests.HTTPError as e:
        if e.response.status_code == 404:
            raise UserNotFoundError(user_id) from e
        raise ExternalServiceError("User service unavailable") from e
```

### Strategy 3: Return Result Objects (Optional)

```python
from dataclasses import dataclass
from typing import TypeVar, Generic

T = TypeVar('T')

@dataclass
class Result(Generic[T]):
    value: T | None
    error: str | None

    @property
    def is_ok(self) -> bool:
        return self.error is None

def parse_config(path: str) -> Result[Config]:
    try:
        with open(path) as f:
            return Result(Config.from_yaml(f), None)
    except FileNotFoundError:
        return Result(None, f"Config file not found: {path}")
    except yaml.YAMLError as e:
        return Result(None, f"Invalid YAML: {e}")
```

## Error Message Quality

### Good - Specific and actionable

```python
raise ValueError(
    f"User ID must be a non-empty alphanumeric string, "
    f"got: {repr(user_id)!r} (type: {type(user_id).__name__})"
)

raise ConfigurationError(
    f"Database URL must start with 'postgresql://', "
    f"got: {db_url[:20]}..."
)

raise ValidationError(
    f"Email address '{email}' is invalid. "
    f"Expected format: user@domain.com"
)
```

### REVIEW - Vague errors

```python
raise ValueError("Invalid input")  # What input? What's invalid?
raise RuntimeError("Operation failed")  # What operation? Why?
raise Exception("Error")  # Completely useless
```

### FAIL - Exposing sensitive data

```python
# FAIL - Exposes password
raise AuthError(f"Invalid password: {password}")

# FAIL - Exposes internal path
raise FileError(f"Cannot read /var/secrets/api_keys.json")

# FAIL - Exposes SQL
raise DatabaseError(f"Query failed: SELECT * FROM users WHERE id={user_id}")
```

## Graceful Degradation

Implement fallback behavior when non-critical operations fail.

```python
def get_user_with_preferences(user_id: str) -> User:
    user = get_user(user_id)  # Critical - let it fail

    # Non-critical - degrade gracefully
    try:
        user.preferences = get_user_preferences(user_id)
    except PreferencesServiceError as e:
        logger.warning(f"Could not load preferences for {user_id}: {e}")
        user.preferences = DEFAULT_PREFERENCES

    # Non-critical - degrade gracefully
    try:
        user.avatar_url = get_avatar_url(user_id)
    except AvatarServiceError as e:
        logger.warning(f"Could not load avatar for {user_id}: {e}")
        user.avatar_url = DEFAULT_AVATAR

    return user
```

## Resource Cleanup

Always clean up resources, even on error.

### Good - Context managers

```python
# Files
with open(path) as f:
    data = f.read()

# Database connections
with db.connection() as conn:
    with conn.cursor() as cursor:
        cursor.execute(query)

# Locks
with threading.Lock():
    shared_resource.update(data)
```

### Good - Try/finally for custom cleanup

```python
def process_temp_file(data: bytes) -> Result:
    temp_path = create_temp_file(data)
    try:
        return process_file(temp_path)
    finally:
        os.unlink(temp_path)  # Always cleanup
```

### FAIL - Resource leak on error

```python
def process_file(path: str) -> str:
    f = open(path)  # FAIL - Not closed on error
    data = f.read()
    process(data)  # If this raises, file handle leaks
    f.close()
    return data
```

## Error Logging Best Practices

### Good - Comprehensive error logging

```python
try:
    result = process_payment(order_id, amount)
except PaymentError as e:
    logger.error(
        "Payment processing failed",
        extra={
            "order_id": order_id,
            "amount": amount,
            "error_type": type(e).__name__,
            "error_message": str(e),
            "correlation_id": request.correlation_id,
        },
        exc_info=True  # Include stack trace
    )
    raise
```

### Good - Different log levels

```python
# DEBUG - Detailed diagnostic info
logger.debug(f"Processing request with params: {params}")

# INFO - Normal operations
logger.info(f"User {user_id} logged in")

# WARNING - Unexpected but handled
logger.warning(f"Cache miss for {key}, falling back to database")

# ERROR - Failure requiring attention
logger.error(f"Failed to send email to {email}: {e}")

# CRITICAL - System-level failure
logger.critical(f"Database connection pool exhausted")
```

### FAIL - No logging

```python
try:
    process_data(data)
except Exception:
    pass  # Silent failure - impossible to debug
```

## Retry Patterns

For transient failures, implement retry with backoff.

```python
import time
from functools import wraps

def retry_with_backoff(max_retries=3, base_delay=1.0, max_delay=30.0):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except (ConnectionError, TimeoutError) as e:
                    last_error = e
                    delay = min(base_delay * (2 ** attempt), max_delay)
                    logger.warning(
                        f"Attempt {attempt + 1}/{max_retries} failed: {e}. "
                        f"Retrying in {delay}s"
                    )
                    time.sleep(delay)
            raise last_error
        return wrapper
    return decorator

@retry_with_backoff(max_retries=3)
def call_external_api(endpoint: str) -> dict:
    return requests.get(endpoint, timeout=10).json()
```

## User-Facing Error Messages

### Good - Helpful without exposing internals

```python
# Internal error with detailed logging
logger.error(f"Database query failed: {sql_error}", exc_info=True)

# User-facing response
return {
    "error": "Unable to retrieve your data. Please try again later.",
    "error_code": "DATA_RETRIEVAL_FAILED",
    "support_id": correlation_id  # For support reference
}
```

### FAIL - Exposing internals to users

```python
return {
    "error": str(e),  # Stack trace, SQL, file paths
    "query": sql_query,
    "traceback": traceback.format_exc()
}
```

## Error Handling Checklist

### Exception Handling
- [ ] Specific exception types caught (no bare `except:`)
- [ ] Exceptions preserve context with `from e`
- [ ] Resources cleaned up with context managers or finally
- [ ] Retries implemented for transient failures

### Error Messages
- [ ] Messages are specific and actionable
- [ ] No sensitive data in error messages
- [ ] User-facing errors are helpful but not revealing

### Logging
- [ ] All errors logged with appropriate level
- [ ] Context included (IDs, parameters)
- [ ] Stack traces preserved (`exc_info=True`)
- [ ] Correlation IDs for request tracing

### Recovery
- [ ] Graceful degradation for non-critical failures
- [ ] Fallback values where appropriate
- [ ] Circuit breakers for external services

### Anti-patterns to Flag
- [ ] Silent error swallowing (`except: pass`)
- [ ] Bare except clauses
- [ ] Generic "Error" messages
- [ ] Missing resource cleanup
- [ ] Sensitive data in logs or messages
