# Go Style Guide

## Naming Conventions

```go
// camelCase for unexported, PascalCase for exported
func getUserByID(userID string) User {
    ...
}

func GetUserByID(userID string) User {
    ...
}
```

## Best Practices

```go
// Short variable declarations
user := getUser(id)

// Error handling - always check errors
user, err := getUser(id)
if err != nil {
    return nil, fmt.Errorf("failed to get user: %w", err)
}

// Named return values for complex returns
func processOrder(order Order) (receipt Receipt, err error) {
    ...
}

// Defer for cleanup
file, err := os.Open(path)
if err != nil {
    return err
}
defer file.Close()
```

## Indentation

- **tabs** (gofmt standard)
- Let gofmt handle formatting

## Formatter

- Use `gofmt` for auto-formatting
- Runs automatically via PostToolUse hook if installed
