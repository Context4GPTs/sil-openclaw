# Python Style Guide

## Naming Conventions

```python
# snake_case for functions and variables
def get_user_by_id(user_id: str) -> User:
    ...

# PascalCase for classes
class UserRepository:
    ...

# SCREAMING_SNAKE_CASE for constants
MAX_RETRY_ATTEMPTS = 3
```

## Import Organization

```python
# 1. Standard library
import os
import sys
from typing import List, Optional

# 2. Third-party packages
import requests
from flask import Flask, request

# 3. Local modules
from .models import User
from .services import UserService
```

## Best Practices

```python
# Type hints for function signatures
def get_user(user_id: str) -> Optional[User]:
    ...

# f-strings for formatting
message = f"Hello, {user.name}!"

# Context managers for resources
with open("file.txt") as f:
    content = f.read()

# List comprehensions (when readable)
names = [user.name for user in users if user.active]

# Explicit is better than implicit
if user is None:  # Not: if not user
    ...
```

## Docstring Format

```python
def process_order(order: Order, user: User) -> Receipt:
    """
    Process an order for a user and generate a receipt.

    Args:
        order: The order to process
        user: The user placing the order

    Returns:
        Receipt for the processed order

    Raises:
        InsufficientFundsError: If user cannot afford the order
        InvalidOrderError: If order contains invalid items
    """
    ...
```

## Indentation

- **4 spaces** (never tabs)
- Configure editor to insert spaces

## Formatter

- Use `black` for auto-formatting
- Runs automatically via PostToolUse hook if installed
