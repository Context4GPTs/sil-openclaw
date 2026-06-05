# JavaScript/TypeScript Style Guide

## Naming Conventions

```typescript
// camelCase for functions and variables
function getUserById(userId: string): User {
  ...
}

// PascalCase for classes and types
class UserRepository {
  ...
}

interface UserConfig {
  ...
}

// SCREAMING_SNAKE_CASE for constants
const MAX_RETRY_ATTEMPTS = 3;
```

## Import Organization

```typescript
// 1. Node built-ins
import fs from 'fs';
import path from 'path';

// 2. Third-party packages
import express from 'express';
import { z } from 'zod';

// 3. Local modules
import { User } from './models';
import { UserService } from './services';
```

## Best Practices

```typescript
// Use const by default, let when needed
const user = getUser();
let count = 0;

// Prefer arrow functions for callbacks
users.map((user) => user.name);

// Use async/await over .then()
const user = await getUser(id);

// Destructuring
const { name, email } = user;

// Template literals
const message = `Hello, ${user.name}!`;
```

## Indentation

- **2 spaces** (never tabs)
- Configure editor to insert spaces

## Formatter

- Use `prettier` for auto-formatting
- Runs automatically via PostToolUse hook if installed
