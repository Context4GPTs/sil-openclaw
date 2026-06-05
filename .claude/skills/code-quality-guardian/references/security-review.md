# Security Review Guide (OWASP-Based)

Security issues cause automatic **FAIL** verdict.

## 1. Input Validation

Validate all input at system boundaries (user input, API calls, file uploads, external data).

**Required practices:**
- Whitelist validation over blacklist
- Type checking and coercion
- Length limits
- Format validation (regex for structured data)
- Canonicalization before validation

```python
# Good - Comprehensive validation
def process_user_input(user_id: str, email: str) -> User:
    # Type check
    if not isinstance(user_id, str):
        raise TypeError("user_id must be string")

    # Format validation
    if not re.match(r'^[a-zA-Z0-9_-]{1,64}$', user_id):
        raise ValueError("Invalid user_id format")

    # Email format
    if not re.match(r'^[^@]+@[^@]+\.[^@]+$', email):
        raise ValueError("Invalid email format")

    return create_user(user_id, email)

# FAIL - No validation
def process_user_input(user_id, email):
    return create_user(user_id, email)
```

## 2. Injection Prevention

### SQL Injection

```python
# Good - Parameterized queries
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))

# Good - ORM with built-in protection
User.objects.filter(id=user_id)

# FAIL - String interpolation
cursor.execute(f"SELECT * FROM users WHERE id = '{user_id}'")
```

### Command Injection

```python
# Good - Use subprocess with list arguments
subprocess.run(["ls", "-la", directory], check=True)

# Good - shlex.quote for shell commands when necessary
subprocess.run(f"ls -la {shlex.quote(directory)}", shell=True)

# FAIL - Direct string formatting
os.system(f"ls -la {directory}")
subprocess.run(f"rm -rf {user_input}", shell=True)
```

### LDAP Injection

```python
# Good - Escape special characters
from ldap3.utils.conv import escape_filter_chars
safe_username = escape_filter_chars(username)
search_filter = f"(uid={safe_username})"

# FAIL - Direct interpolation
search_filter = f"(uid={username})"
```

### XPath Injection

```python
# Good - Parameterized query
tree.xpath("//user[@id=$id]", id=user_id)

# FAIL - String concatenation
tree.xpath(f"//user[@id='{user_id}']")
```

## 3. Output Encoding (XSS Prevention)

Encode output based on context:

```python
# HTML context - escape HTML entities
from markupsafe import escape
html_output = f"<p>Hello, {escape(user_name)}</p>"

# JavaScript context - JSON encode
import json
js_output = f"var data = {json.dumps(user_data)};"

# URL context - URL encode
from urllib.parse import quote
url = f"/search?q={quote(user_query)}"

# FAIL - Direct output
html_output = f"<p>Hello, {user_name}</p>"  # XSS vulnerability
```

## 4. Authentication & Session Management

**Required:**
- Cryptographically strong session identifiers
- Regenerate session ID on authentication
- HttpOnly and Secure flags on session cookies
- Session timeout implementation
- Proper logout (server-side session invalidation)

```python
# Good - Secure session configuration
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=1)

# On login - regenerate session
session.regenerate()

# On logout - invalidate server-side
session.clear()
invalidate_session_in_store(session_id)
```

**Password handling:**

```python
# Good - Use strong hashing (bcrypt, argon2)
import bcrypt
hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12))

# FAIL - Weak hashing
import hashlib
hashed = hashlib.md5(password.encode()).hexdigest()
```

## 5. Access Control

**Required:**
- Deny by default
- Enforce on every request
- Use server-side session for authorization decisions
- Validate ownership for resource access

```python
# Good - Explicit authorization check
def get_document(doc_id: str, current_user: User) -> Document:
    document = Document.get(doc_id)
    if document.owner_id != current_user.id and not current_user.is_admin:
        raise PermissionError("Not authorized to access this document")
    return document

# FAIL - Trusting client-provided ownership
def get_document(doc_id: str, user_id: str) -> Document:
    # user_id from request, not verified session
    return Document.get(doc_id)
```

## 6. Secrets Management

**FAIL conditions:**
- Hardcoded secrets, API keys, passwords
- Secrets in comments or documentation
- Secrets in version control (even if removed)
- Secrets in logs or error messages

```python
# Good - Environment variables
api_key = os.environ.get("API_KEY")
if not api_key:
    raise EnvironmentError("API_KEY environment variable required")

# Good - Secret management service
from aws_secretsmanager import get_secret
api_key = get_secret("my-api-key")

# FAIL
api_key = "sk-1234567890abcdef"
API_KEY = "hardcoded_secret"  # Even as constant
```

## 7. Cryptographic Practices

**Required:**
- Use established libraries (not custom crypto)
- Strong algorithms (AES-256, RSA-2048+, SHA-256+)
- Secure random number generation
- Proper key management

```python
# Good - Secure random
import secrets
token = secrets.token_urlsafe(32)
api_key = secrets.token_hex(32)

# Good - Strong encryption
from cryptography.fernet import Fernet
key = Fernet.generate_key()
cipher = Fernet(key)
encrypted = cipher.encrypt(data)

# FAIL - Weak random
import random
token = ''.join(random.choices(string.ascii_letters, k=32))

# FAIL - Weak algorithms
import hashlib
hashed = hashlib.md5(data).hexdigest()  # Use SHA-256+
```

## 8. Error Handling (Security Aspect)

**Required:**
- No sensitive data in error messages
- No stack traces to users
- Generic error messages externally, detailed logs internally

```python
# Good - Generic external, detailed internal
try:
    user = authenticate(username, password)
except AuthenticationError as e:
    logger.warning(f"Auth failed for {username}: {e}")
    raise HTTPException(401, "Invalid credentials")  # Generic to user

# FAIL - Exposes internals
except Exception as e:
    return {"error": str(e), "trace": traceback.format_exc()}
```

## 9. Data Protection

**Required:**
- Encrypt sensitive data at rest
- TLS for data in transit
- Minimize data collection
- Secure data deletion

```python
# Good - Encrypted sensitive fields
class User(Model):
    email = EncryptedField()
    ssn = EncryptedField()

# Good - Secure deletion
def delete_user(user_id):
    user = User.get(user_id)
    user.email = None
    user.pii_data = None
    user.save()
    user.delete()
```

## 10. File Upload Security

**Required:**
- Validate file type by content (magic bytes), not extension
- Limit file size
- Store outside web root
- Generate random filenames
- Scan for malware if possible

```python
# Good - Content-based validation
import magic

def validate_upload(file):
    mime = magic.from_buffer(file.read(1024), mime=True)
    file.seek(0)

    if mime not in ALLOWED_MIMES:
        raise ValueError(f"File type {mime} not allowed")

    if file.content_length > MAX_SIZE:
        raise ValueError("File too large")

    # Generate safe filename
    safe_name = f"{uuid4()}{mimetypes.guess_extension(mime)}"
    return safe_name

# FAIL - Extension-based validation
if not filename.endswith(('.jpg', '.png')):
    raise ValueError("Invalid file type")
```

## Security Checklist

### Input/Output
- [ ] All input validated at system boundaries
- [ ] Whitelist validation used (not blacklist)
- [ ] Output encoded based on context (HTML, JS, URL)

### Injection Prevention
- [ ] Parameterized queries for all database access
- [ ] No shell=True with user input
- [ ] LDAP/XPath queries use escaping

### Authentication & Authorization
- [ ] Strong password hashing (bcrypt, argon2)
- [ ] Session IDs regenerated on auth
- [ ] HttpOnly, Secure, SameSite cookie flags
- [ ] Access control enforced on every request
- [ ] Ownership validated for resource access

### Secrets & Crypto
- [ ] No hardcoded secrets
- [ ] Environment variables or secret managers used
- [ ] Strong algorithms (AES-256, SHA-256+)
- [ ] Secure random number generation

### Data Protection
- [ ] Sensitive data encrypted at rest
- [ ] TLS for data in transit
- [ ] No sensitive data in logs
- [ ] No sensitive data in error messages

### File Handling
- [ ] File types validated by content
- [ ] Files stored outside web root
- [ ] Random filenames generated
