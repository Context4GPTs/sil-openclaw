---
name: sil-repo-topology
description: Where the sil sibling repos live under /Users/knitlybak/GitHub/4gpts/sil and what each owns. No klodi repo is present in this workspace.
metadata:
  type: reference
---

Workspace root `/Users/knitlybak/GitHub/4gpts/sil` holds four sibling repos:

- `sil-openclaw/` — the OpenClaw plugin (TypeScript, ESM, Node 22+). Plugin at repo root, no `adapters/` nesting. Registers tools the agent calls.
- `sil-services/` — pnpm/turbo monorepo. `apps/sil-web` (Next.js — auth + onboarding + PKCE/claim/refresh routes), `services/sil-api` (the Bearer-JWT API the agent hits via `sil_whoami`), `packages/db` (Postgres schema + migrations + queries).
- `sil-stage/` — docker-compose topology + golden e2e harness (boots the full stack against a real Auth0 tenant, PASS/FAIL).
- `mission-control-sil/` — the autonomous goal-orchestrator's versioned state repo (goals, plans, logs). Hosts no cards.

**No klodi repo exists here.** Cards that say "follow the klodi pattern" mean the conceptual pattern (PKCE agent flow, on-disk credential storage); the concrete contract is whatever `sil-services/apps/sil-web` actually implements. Don't search for a klodi checkout — it isn't vendored.

These are absolute paths on this machine; if the workspace moves, re-derive by listing the parent of the repo you're in.
