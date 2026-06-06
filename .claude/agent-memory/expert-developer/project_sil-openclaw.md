---
name: project-sil-openclaw
description: What the sil-openclaw repo is — a standalone OpenClaw plugin scaffolded to mirror klodi's openclaw adapter structurally
metadata:
  type: project
---

`sil-openclaw` is a standalone single-language (TypeScript/Node 24+, ESM) OpenClaw plugin repo. The plugin lives at the **repo root** (not under `adapters/`).

**Why:** It is the OpenClaw publish target for the "sil" product, scaffolded to be *structurally consistent* with klodi's `adapters/openclaw` — but flattened to a standalone repo, minus klodi's marketplace machinery (NATS/JetStream wake pump, `@klodi/*` workspace deps, `vendor.mjs` publish pipeline, `copy-skill.mjs`, dockerized smoke, credential seeding). It is "klodi's openclaw adapter minus the marketplace, flattened to one repo."

**How to apply:** When building here, MIRROR a shape that exists in the klodi reference; never reinvent it. Respect the "Surfaces NOT created" non-goal boundary — no service/, no NATS, no @klodi deps, no vendoring, no adapters/ nesting. Plugin id `sil` / npm `@4gpts/sil`, tool namespace `sil_*`. Skill lives in-repo at `skill/`, committed, NOT gitignored. `register()` is strictly synchronous and starts the onboarding flow.

The repo carries the cc-setup kanban harness (tracked-mode: `cards/` IS committed). License is Apache-2.0.

The skeleton was built by card `plugin-skeleton` (epic `scaffold-sil`): plugin id `sil`, npm `@4gpts/sil`, two stub tools `sil_ping`/`sil_echo`, package manager pnpm, vitest 4. The TDD pair shares ONE worktree on `card/<slug>` — qa's commits advance HEAD directly (no separate fetch/merge needed; `git status` shows qa's uncommitted test files appearing in your working tree as they write). qa owns `src/__tests__/**` exclusively; dev never edits tests — dispute via a card note instead.

