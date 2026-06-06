---
name: ref-klodi-openclaw-adapter
description: Filesystem location of the klodi OpenClaw plugin adapter — the canonical structural reference for sil-openclaw plugin work
metadata:
  type: reference
---

The klodi OpenClaw plugin adapter (the structural reference that `sil-openclaw` mirrors) lives at:

`/Users/knitlybak/GitHub/4gpts/klodi/klodi-plugin/adapters/openclaw`

(Note: task prompts have occasionally given the path as `/Users/knitlybak/GitHub/klodi/...` — the real path is under `/Users/knitlybak/GitHub/4gpts/klodi/...`.)

Key reference files used when scaffolding the sil plugin:
- `src/index.ts` — `definePluginEntry` entry; `register()` wires tool groups + logs `<id>_plugin_loaded`
- `src/types/openclaw.d.ts` — ambient `declare module "openclaw/plugin-sdk"` + `.../plugin-entry` SDK contract
- `src/lib/tool-result.ts` — `jsonResult(data): ToolResult` ⇒ `{ content: [{ type:"text", text: JSON.stringify(data,null,2) }] }`
- `src/lib/paths.ts` — `applyPluginConfigOverrides` + getter/setter env-fallback pattern (call-time resolve, empty-string guard)
- `src/tools/setup.ts` — clean `registerXTools(api)` register-fn example
- `src/__tests__/helpers/mock-plugin-api.ts` — `createMockPluginApi()` capturing registerTool into a Map + `getTool()`
- `openclaw.plugin.json`, `package.json`, `tsconfig*.json`, `vitest.config.ts`

Pinned versions (mirror these): pluginApi `>=2026.4.1`, minGatewayVersion/build `2026.4.15`, `@sinclair/typebox` 0.34.14, typescript 5.8.3, vitest 4.1.2, @types/node 22.x. ESM `"type":"module"`, TS `target ES2022 / module ESNext / moduleResolution bundler / strict`. Imports use `.js` specifiers from `.ts` sources.

The klodi adapter's `.gitignore` carries a `skill/` line (its skill is a build-time copy via `copy-skill.mjs`). In a standalone single-host repo the skill is source — do NOT copy that line.
