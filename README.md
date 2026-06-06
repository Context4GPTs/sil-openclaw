# sil — OpenClaw plugin

A skeleton [OpenClaw](https://docs.openclaw.ai) plugin for **sil**. It registers stub tools that load in an OpenClaw host and return placeholder responses — the starting point you copy to build real tools.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `sil_ping` | _(none)_ | Stub payload confirming the plugin's tools are registered and invocable. |
| `sil_echo` | `message: string` | Stub payload echoing the supplied `message` back, proving a typed parameter round-trips. |

Every tool returns the same envelope — a single text content block whose JSON body is `{ "stub": true, "tool": "<name>", "echo": <params> }`. No tool performs network, filesystem, or credential I/O.

## Configuration

One optional plugin-scoped key, resolved at call time (override → env → default):

| Key | Env fallback | Default | Purpose |
|---|---|---|---|
| `sil_api_url` | `SIL_API_URL` | `https://sil.4gpts.com` | Backend URL. Unused by the stub tools; demonstrates the plugin-config override path. |

Set it under `plugins.sil.config.sil_api_url` in your OpenClaw config.

## Developing

```bash
pnpm install     # install dependencies (Node 22+)
pnpm build       # tsc → dist/  (emits the plugin entry dist/index.js)
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

### How to add a tool

The stubs in `src/tools/examples.ts` are the pattern. Adding a real tool is three steps:

1. Register the tool with `api.registerTool({...})` inside a `registerXTools(api)` group in `src/tools/`.
2. Wire that group into `register()` in `src/index.ts` (only needed for a new group).
3. Add the tool's `name` to `openclaw.plugin.json#contracts.tools`.

A drift-guard test set-compares the manifest's `contracts.tools` against the names `register()` registers and fails if they disagree, so step 3 is enforced, not optional. The full contributor guide — including why `register()` must stay synchronous — is in [`CLAUDE.md`](./CLAUDE.md).

## License

[Apache-2.0](./LICENSE). See [`NOTICE`](./NOTICE).
