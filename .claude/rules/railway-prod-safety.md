# Railway — Production Safety

Railway is the **production infrastructure**. Two ways to reach it, **both live**:
the `railway` CLI and the Railway MCP tools (`mcp__railway__*`). Treat everything
they return as real production state.

For docs, prefer the MCP doc servers over web search — `context7` for libraries,
frameworks, and SDKs; Railway's own `docs_search` / `docs_fetch` for the platform.

**Observe freely.** Read-only actions take no permission: logs, metrics, status,
error rates, listing projects / services / deployments / variables, `whoami`.

**Confirm before you change prod.** Anything that alters live production state
needs the user's explicit go-ahead first — say what will change, then wait.
That includes deploys and redeploys, variable changes, and creating, updating,
or removing services, volumes, or environments — by CLI or MCP, no difference.
The only exception is an action the user has already authorized for the task in hand.
