# Logging & Observability Review Guide

Effective logging and observability enable debugging, monitoring, and incident response.

## Logging Levels

Use appropriate log levels consistently.

| Level | Purpose | Examples |
|-------|---------|----------|
| DEBUG | Detailed diagnostic info | Variable values, execution flow |
| INFO | Normal operation events | User login, request completed |
| WARNING | Unexpected but handled | Cache miss, retry triggered |
| ERROR | Operation failed | Database error, API failure |
| CRITICAL | System-level failure | Service unavailable, data loss risk |

```python
# Good - Appropriate levels
logger.debug(f"Processing request with params: {params}")
logger.info(f"User {user_id} logged in successfully")
logger.warning(f"Cache miss for {key}, falling back to database")
logger.error(f"Failed to process payment for order {order_id}: {e}")
logger.critical(f"Database connection pool exhausted, service degraded")

# REVIEW - Misused levels
logger.error(f"User {user_id} logged in")  # Should be INFO
logger.debug(f"Critical system failure")   # Should be CRITICAL
logger.info(f"Exception occurred: {e}")    # Should be ERROR
```

## Structured Logging

Use structured logging for machine-parseable logs.

```python
# Good - Structured logging
import structlog

logger = structlog.get_logger()

logger.info(
    "payment_processed",
    order_id=order_id,
    amount=amount,
    currency=currency,
    user_id=user_id,
    processing_time_ms=elapsed_ms
)

# Output (JSON):
# {"event": "payment_processed", "order_id": "123", "amount": 99.99, ...}

# REVIEW - Unstructured logging
logger.info(f"Payment processed: order={order_id}, amount={amount}")
# Hard to parse, inconsistent format
```

### Python structlog Example

```python
import structlog

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
)
```

## Correlation IDs / Request Tracing

Track requests across services with correlation IDs.

```python
# Good - Correlation ID middleware
import uuid

@app.middleware("http")
async def add_correlation_id(request, call_next):
    correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))

    # Bind to logger context
    structlog.contextvars.bind_contextvars(correlation_id=correlation_id)

    response = await call_next(request)
    response.headers["X-Correlation-ID"] = correlation_id
    return response

# Good - Include in all logs automatically
logger.info("processing_request", endpoint=request.path)
# Output includes correlation_id automatically

# Good - Pass to downstream services
async def call_external_service(data):
    correlation_id = structlog.contextvars.get_contextvars().get("correlation_id")
    headers = {"X-Correlation-ID": correlation_id}
    return await client.post(url, json=data, headers=headers)
```

## What to Log

### Good - Meaningful Events

```python
# Request lifecycle
logger.info("request_started", method=method, path=path, user_id=user_id)
logger.info("request_completed", status=status, duration_ms=duration)

# Business events
logger.info("order_created", order_id=order_id, user_id=user_id, total=total)
logger.info("payment_successful", order_id=order_id, payment_method=method)

# Security events
logger.info("user_login", user_id=user_id, ip=ip, user_agent=ua)
logger.warning("login_failed", username=username, ip=ip, reason=reason)
logger.warning("rate_limit_exceeded", user_id=user_id, endpoint=endpoint)

# System events
logger.info("cache_hit", key=key)
logger.warning("cache_miss", key=key)
logger.info("db_query", query_name=name, duration_ms=duration)
```

### REVIEW - Too Verbose

```python
# REVIEW - Logging in hot loops
for item in items:  # 10,000 items
    logger.debug(f"Processing item {item.id}")  # 10,000 log lines

# Good - Log aggregates
logger.info("batch_processed", count=len(items), duration_ms=elapsed)

# REVIEW - Logging unchanged state
def process():
    logger.info("Starting process")
    logger.info("Step 1 starting")
    logger.info("Step 1 completed")
    logger.info("Step 2 starting")
    # ... excessive granularity
```

### FAIL - Sensitive Data in Logs

```python
# FAIL - Logging passwords
logger.info(f"User login attempt: {username}:{password}")

# FAIL - Logging tokens
logger.debug(f"API call with token: {api_token}")

# FAIL - Logging PII
logger.info(f"Processing user: {full_ssn}, {credit_card}")

# Good - Mask or omit sensitive data
logger.info("login_attempt", username=username)  # No password
logger.debug("api_call", token_prefix=api_token[:8])  # Truncated
logger.info("processing_user", user_id=user_id)  # ID only
```

## Error Logging

```python
# Good - Complete error context
try:
    result = process_order(order_id)
except OrderProcessingError as e:
    logger.error(
        "order_processing_failed",
        order_id=order_id,
        user_id=user_id,
        error_type=type(e).__name__,
        error_message=str(e),
        exc_info=True  # Include stack trace
    )
    raise

# REVIEW - Missing context
except Exception as e:
    logger.error(f"Error: {e}")  # No context, no stack trace
```

## Metrics and Health Checks

### Health Check Endpoints

```python
# Good - Comprehensive health check
@app.get("/health")
async def health_check():
    checks = {
        "database": check_database(),
        "cache": check_cache(),
        "external_api": check_external_api()
    }

    status = "healthy" if all(c["status"] == "ok" for c in checks.values()) else "degraded"

    return {
        "status": status,
        "checks": checks,
        "timestamp": datetime.utcnow().isoformat()
    }

# Good - Separate liveness and readiness
@app.get("/health/live")  # Kubernetes liveness
async def liveness():
    return {"status": "ok"}

@app.get("/health/ready")  # Kubernetes readiness
async def readiness():
    if not database_pool.is_ready():
        raise HTTPException(503, "Database not ready")
    return {"status": "ok"}
```

### Application Metrics

```python
# Good - Key metrics to track
from prometheus_client import Counter, Histogram, Gauge

# Request metrics
request_count = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"]
)

request_duration = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration",
    ["method", "endpoint"]
)

# Business metrics
orders_created = Counter("orders_created_total", "Total orders created")
order_value = Histogram("order_value_dollars", "Order values in dollars")

# System metrics
db_pool_size = Gauge("db_pool_connections", "Database pool size", ["state"])
cache_hit_rate = Gauge("cache_hit_rate", "Cache hit rate")
```

## Distributed Tracing

For microservices, implement distributed tracing.

```python
# Good - OpenTelemetry integration
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

tracer = trace.get_tracer(__name__)

FastAPIInstrumentor.instrument_app(app)

@app.get("/orders/{order_id}")
async def get_order(order_id: str):
    with tracer.start_as_current_span("fetch_order") as span:
        span.set_attribute("order_id", order_id)
        order = await fetch_order(order_id)

    with tracer.start_as_current_span("enrich_order") as span:
        order = await enrich_with_user_data(order)

    return order
```

## Log Retention and Rotation

```python
# Good - Configure log rotation
import logging
from logging.handlers import RotatingFileHandler

handler = RotatingFileHandler(
    "app.log",
    maxBytes=10_000_000,  # 10MB
    backupCount=5
)

# Good - Different handlers for different purposes
file_handler = RotatingFileHandler("app.log", ...)
error_handler = RotatingFileHandler("error.log", ...)
error_handler.setLevel(logging.ERROR)

logger.addHandler(file_handler)
logger.addHandler(error_handler)
```

## Logging Checklist

### Log Levels
- [ ] Appropriate levels used (DEBUG, INFO, WARNING, ERROR, CRITICAL)
- [ ] ERROR used only for actual errors
- [ ] DEBUG not used in production hot paths

### Content
- [ ] Meaningful event names
- [ ] Relevant context included (IDs, durations)
- [ ] No sensitive data (passwords, tokens, PII)
- [ ] No excessive verbosity

### Structure
- [ ] Structured logging format (JSON)
- [ ] Consistent field names across codebase
- [ ] Correlation IDs for request tracing

### Errors
- [ ] All errors logged with context
- [ ] Stack traces included (`exc_info=True`)
- [ ] Error type and message captured

### Observability
- [ ] Health check endpoints (/health, /health/live, /health/ready)
- [ ] Key metrics exposed (request count, duration, error rate)
- [ ] Business metrics tracked (orders, payments, etc.)

### Configuration
- [ ] Log levels configurable per environment
- [ ] Log rotation configured
- [ ] Log aggregation set up (production)

### Anti-patterns to Flag
- [ ] `print()` statements instead of logging
- [ ] Sensitive data in logs
- [ ] Missing correlation IDs
- [ ] Logging in tight loops
- [ ] No error context
