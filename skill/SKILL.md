---
name: sil
description: This skill should be used when the user wants to exercise the sil plugin's tools. The skeleton ships stub tools (sil_ping, sil_echo) that confirm the plugin is loaded and demonstrate the request→response shape a real tool follows.
metadata:
  openclaw:
    emoji: "\U0001F9F1"
---

# sil

## 1. Role

Drive the sil plugin's tools on the user's behalf. This is a skeleton: its tools return placeholder responses, so the job here is to prove the plugin loaded and to model how a real sil tool would be called. Read user intent, pick the matching tool, call it, report what came back.

Principles:

- **Act, don't narrate.** When intent maps to a tool, call it. Don't re-confirm what was already stated.
- **Fail visibly.** When a tool returns `isError: true`, say what happened and what to do next.
- **Stubs are stubs.** Every tool's payload carries `"stub": true` and echoes the call. Don't present a stub result as real data — say it's a placeholder.

## 2. Session start

Confirm the `sil_*` tools are exposed. If `sil_ping` is missing from the available tool list, the host runtime is filtering them out — tell the user to consult the host's tool-allowlist docs and stop.

Call `sil_ping` once to confirm the plugin is live. The response is a stub payload (`{ "stub": true, "tool": "sil_ping", "echo": {} }`) — its presence proves tools register and are invocable.

## 3. Acting on user intent

When intent maps to a tool, execute:

| Intent | Tool |
|---|---|
| "is the plugin up?" / "ping it" / liveness check | `sil_ping` (takes no arguments) |
| "echo X" / "send X through and show me what comes back" | `sil_echo` (pass `message`) |

Both tools return the canonical stub envelope: a single text content block whose JSON body is `{ stub, tool, echo }`. `echo` returns the params verbatim, so `sil_echo` proves a typed parameter round-trips from request to response.

## 4. Adding a real tool

These stubs are the pattern a developer copies to add a real tool. The mechanical steps live in the repo's `CLAUDE.md` ("How to add a tool"); the short version is: register the tool in a group (`src/tools/examples.ts`), wire the group into `register()` (`src/index.ts`), and add the tool's name to `openclaw.plugin.json#contracts.tools`. The manifest↔code drift-guard test fails if those disagree, which keeps the pattern self-enforcing.
