---
name: agent-creation-engine
description: The ordered, one-command engine that persists the single sil-wired shopper after the user endorses the assembled draft. Load only after explicit endorsement in the interview.
---

# Create your sil-wired shopper — the agent-creation engine

**Precondition: run this ONLY after the user has explicitly endorsed the assembled draft from [`brainstorm_interview.md`](brainstorm_interview.md).** Anything below before that endorsement is forbidden — the interview owns the gate.

When the user wants to **set up shopping**, author and persist **one** valid OpenClaw agent profile — the user's **shopper**: a real new agent under the host `agents` config, with the **sil plugin enabled**, the **sil skill attached**, its persona written into the workspace **`SOUL.md`**, plus the shopper's **shared user spec** in the sil data directory — so it shops with **no further setup**. The shopper is a **singleton**: you create it **once**, then it learns **domains** (niches) lazily on first shop — you never mint a second shopper.

The shopper runs **entirely on Spec-Driven Shopping (SDS)** — the operating model, not an optional layer. At create time exactly **one** sil artefact is persisted: the **shared, agent-level `userSpec`** (the person's cross-niche facts + hard constraints, seeded *partial* by the interview). **No** niche is researched and **no** per-domain pack is written at create time — there is **no** `domainSpec` / `intentSpec` / `playbook` here. Those are minted **lazily, per niche, on first shop** ([`shop_loop.md`](shop_loop.md)) into `domains/<slug>/`. A freshly-created shopper has an **empty `domains` map** — that is **healthy**, not a deficiency.

## The one command

After the explicit endorsement, you run exactly **ONE** shipped command — the package `bin` **`sil-openclaw-create-shopper`** — and it runs the whole choreography **atomically** and fail-closed. You do **NOT** hand-run the ten host-CLI steps yourself; the bin runs them **for you, in order, as one transaction**, then returns a single structured JSON result. Feed it the endorsed spec as **one JSON object on `stdin`** (or via **`--spec <path>`**):

```
sil-openclaw-create-shopper <<'JSON'
{ "agentId": "my-shopper", "name": "My Shopper", "workspace": "~/.openclaw/workspace-my-shopper",
  "persona": "…the endorsed persona…", "userSpec": "…the seeded shared user spec…",
  "channel": "telegram" }
JSON
```

Pass **`channel`** with the channel the setup conversation is running on (e.g. `telegram`) — that is what auto-routes the new shopper so the user's next message reaches it with **no manual bind and no restart**. It is **optional and fail-open**: absent/blank/unresolvable, or already owned by another agent, the bin still creates the shopper and returns a manual-bind hint (step 10). Passing the multiline `persona` / `userSpec` as JSON dodges shell-arg escaping. The bin is **non-interactive**: it executes an **already-assembled, already-endorsed** spec — it never re-runs the interview and never prompts (the endorsement gate lives upstream in the interview; the bin's own validate-first + singleton pre-flight still protect a direct caller). Creation is **local and offline** — the bin reads **no token**, performs **no** `sil_register` / `sil_whoami`, and makes **no network call**. The `sil` **plugin** and `sil` **skill** are always wired (that is what makes it *sil-wired*). Do **not** present sil registration as a prerequisite — the shopper registers the user later, on first shop, via `sil_register`.

> The bin is a standalone operator script (the same class as the other shipped `sil-openclaw` operator bins), **not** the plugin process — so the plugin's `noChildProcess` / "never write host config" guarantee is intact; the bin legitimately drives the host `openclaw …` CLI on your behalf.

## The profile spec (input) — the JSON the bin reads

The endorsed draft feeds two stores. The **persona** becomes the host workspace **`SOUL.md`** (its identity / voice / standing rules — via the host CLI, **not** a sil artefact). The **shared user spec** becomes the sil data-dir artefact:

| Field | Meaning | Goes to | Required? |
|---|---|---|---|
| **agentId** | Lower-kebab id (e.g. `my-shopper`) → `agents.list[].id`. Unique, never `main`. | host | Required |
| **name** | Human-readable name ("My Shopper"). | sil manifest | Required |
| **persona** | Who this shopper is and how it shops — a generalist, voice/tone, standing rules. | host **`SOUL.md`** (via host CLI — no `persona.md`) | Required (non-empty) |
| **workspace** | The shopper's workspace directory (e.g. `~/.openclaw/workspace-my-shopper`). | host | Required for the non-interactive add |
| **userSpec** | The user's **shared, cross-niche** facts + hard constraints (addresses, sizes, allergy/ethics rules, budget psychology). **Seeded partial** by the interview, then augmented per-query. | sil `user_spec.md` | **Required (non-empty)** |
| **channel** | The communication channel the setup conversation is on (e.g. `telegram`) — bound to the new shopper so the user's next message reaches it. Populate it when you know the channel; the bin also falls back to the host's `OPENCLAW_MCP_MESSAGE_CHANNEL` on a live turn. | host `openclaw.json` `bindings[]` | **Optional (fail-open)** — absent/blank/unresolvable ⇒ manual-bind hint, never `invalid_request` |

There is **no** per-niche input at create time. The deep `domainSpec`, the derived `intentSpec` schema, and the niche `playbook` are **not** authored here — they are researched and minted on first shop in each niche.

## The created shopper needs WEB tools

The shopper **lazily mints a domain on first shop** (its research pass reaches the web) and **web-refreshes each domain spec on every query**. So the created agent must have **web/fetch tools in its tool profile** — inherited from `agents.defaults` when its shell is created. If `agents.defaults` does **not** grant a web tool, the bin reports **`created` with a `warnings` entry** naming the gap (bare `sil_search` still works, so it does **not** hard-fail) — it never silently swallows the gap and never pretends the research happened. Surface that warning to the user.

## What the bin does atomically (the choreography it runs for you, in this exact order)

1. **Validates the spec FIRST — before anything is written.** It checks `agentId` (present, lower-kebab, ≠ `main`), `name`, `persona`, `workspace`, and the **shared `userSpec` — present and non-blank** (the only sil artefact at create; seeded *partial* by the interview, never omitted). There is **no** `domainSpec` / `intentSpec` / `playbook` to validate here. On any failure it stops with **`invalid_request`** naming the field and **writes nothing**. This runs ahead of every host command, so a bad spec never reaches the host.

2. **Singleton check — a user has exactly ONE shopper.** The bin runs `openclaw agents list --json` and reads the sil artefact store (the no-args `sil_profile_get` overview, `ok` empty-is-healthy when no shopper exists) **before** the add; if a sil shopper **already exists**, it stops with **`collision`** — **"a shopper already exists"** — and **does not** run `openclaw agents add`. That steers the user to **shop a new niche** (which lazily mints a domain on the spot) or **refine the existing shopper** — **never mint a second shopper**. An `agentId` that collides with any existing agent is likewise refused (`collision`) — never overwriting an existing agent's persona or wiring. If either read is **inconclusive** (a CLI error, a degraded store), the bin fails closed rather than fabricate a "no shopper" verdict.

3. **Creates the agent shell (host CLI).** It runs:
   ```
   openclaw agents add <agentId> --workspace <workspace> --non-interactive --json
   ```
   This creates the real `agents.list[]` entry and the workspace bootstrap files (`SOUL.md`, `AGENTS.md`, …), inheriting model and **tool profile** (which must grant **web/fetch** — see above) from `agents.defaults`. `--non-interactive --json` drives it without a prompt.

4. **Writes the persona into the workspace `SOUL.md` (host CLI).** The persona is the shopper's soul / system framing — the host's `SOUL.md`, **not** a sil artefact. The bin writes the endorsed persona text **straight into** the new agent's `SOUL.md`. There is **no** `persona.md` in the sil store and **no copy** step — the persona lives in exactly one place.

5. **Materializes the shared user spec — NO `domain`.** The bin calls **`sil_profile_materialize`** with **`{ name, userSpec }`** — the shared `userSpec` seeded by the interview. The shopper is a singleton, so this takes **no `agentId`**. **With no `domain`** at create, the tool writes the shared **`user_spec.md`** + **`profile.json`** (with an **empty `domains: {}` map**) into the fixed **`$SIL_DATA_DIR/shopper/`**, atomically. There is **no** `domain_spec.md` / `intent_spec.md` / `playbook.md` yet — the first shop in a niche mints that niche's pack (with a `domain` object) lazily. On `invalid_request` it wrote nothing; on `persistence_failed` it left nothing partial.

6. **Wires the sil skill + plugin (host CLI).** Asserted against the pinned host — **`alpine/openclaw:2026.6.9`** — both value-mode sets with `--strict-json` (the only set mode this image accepts):
   ```
   openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json
   openclaw config set plugins.entries.sil.enabled true --strict-json
   ```
   The skill **attach** makes the agent **know how** to drive the tools; the plugin **enable** turns the sil plugin **on** — but it does **not** by itself un-filter the `sil_*` tools (see the admission step next). `sil` stays in the agent's skill list and the `sil_*` tools are not denied.

7. **Admits sil at the host allow surfaces — the shipped helper.** Enabling the plugin is necessary but not sufficient: until `sil` is admitted at the **global** allow surfaces `plugins.allow` + **`tools.alsoAllow`**, the host keeps the `sil_*` tools **filtered**. Admission is **plugin-ID only** — no per-tool key. The value-mode `openclaw config set` above is **overwrite-only** on this image, so it cannot additively merge those shared global arrays without clobbering another already-admitted plugin (e.g. `klodi`). The bin therefore runs the shipped admission helper — the sibling package `bin` `sil-openclaw-allowlist` (same artefact as the `openclaw:allowlist` script) — which performs the **additive, idempotent, atomic, self-validating** three-surface merge (`plugins.allow` + `tools.alsoAllow` + `plugins.entries.sil`). **If the helper exits non-zero (a failed admission), the bin reports `persistence_failed` with the path + cause and does NOT declare `created`** — never a green `created` over still-filtered tools.

8. **Binds the current channel to the new shopper — FAIL-OPEN, never a precondition.** It resolves the channel (`spec.channel`, else the `OPENCLAW_MCP_MESSAGE_CHANNEL` the host sets on the live turn) and, if one resolves, runs `openclaw agents bind --agent <agentId> --bind <channel> --json`, then **verifies** the route actually stuck — the bind verdict shows it applied with **no conflict**, the `openclaw agents bindings --json` read-back shows `<channel> → <agentId>`, **and** `openclaw config validate` still passes. A **verified** route means the user's next message on that channel reaches the new shopper with no manual bind or restart. If the channel is **undetermined**, already owned by **another agent** (there is no `--force` — the prior owner is left in place, never silently stolen), or the bind **cannot be verified**, the bin reverts any partial route and degrades to a **manual-bind hint** in `warnings` — it **NEVER fails creation**. This is the **one step that does not tear the create down**: it is a convenience, not a precondition.

9. **Validates with the host's OWN check, THEN declares created.** The bin runs `openclaw config validate --json`. The verdict is `{ valid, path, issues? }` — success keys off **`.valid`**, never an `ok` field. Only when `valid: true` **and** the admission (step 7) succeeded does it report **`created`**, carrying `boundChannel` — the channel the route was **verified**-bound to, or `null` when nothing was bound. A channel is named **only** once the read-back + validate confirm it; issuing the bind write is not enough. If `valid: false`, the admission helper exited non-zero, or any step failed, it reports **`persistence_failed`** with the failing **path** + **cause** (the `issues?`).

10. **On any failure after writes begin, tears down — leaving nothing partial.** The bin snapshots `openclaw.json` before step 3 and, on any failure, **restores that whole-file snapshot** (reversing the `agents.list` entry + the skill + the plugin + the trust admission **+ any verified channel binding** in one atomic op — the binding lives in `openclaw.json`, so the same snapshot reverses it for free), then removes the workspace dir (only if it created it) and the singleton shopper dir (only if it did not pre-exist). This returns the host to its **exact pre-run state** — a co-installed `klodi` that was trusted pre-run stays trusted — so `persistence_failed` truthfully means **nothing partial** is left.

The bin emits **one** `{ status, … }` JSON result and exits 0 **only** on `created`.

## Status taxonomy (agent-creation engine)

| `status` | Meaning | What to do |
|---|---|---|
| `created` | Shopper added, shared user spec materialized, sil plugin + skill wired, `openclaw config validate` accepted it. Carries `name` + `agentId` + `workspace` + `boundChannel` (the verified-bound channel, or `null`). A manual-bind `warnings` entry rides here when the channel could not be auto-routed. | Tell the user it's ready and how to open it; if `boundChannel` is `null`, relay the manual-bind hint. |
| `invalid_request` | Spec failed validation (missing/blank field). **Nothing attempted.** | Name the field, fix it, run the command again — nothing reached `openclaw agents add`. |
| `collision` | A shopper already exists (the singleton), or the `agentId` clashes. **Nothing written.** | Surface it — "a shopper already exists"; steer to shop-a-new-niche (lazy mint) or refine. **Never mint a second shopper.** |
| `persistence_failed` | A write, the allow-list admission helper (non-zero exit), or `openclaw config validate` step failed. Teardown ran — **nothing partial** left. | Fix the reported path/cause, run the command again (a re-run is safe). |

In the **rare** case teardown itself cannot fully revert (e.g. the agent was added but reverting it fails), the bin reports a **distinct, louder** outcome that **names the residue** — do **not** voice that as `persistence_failed`'s "nothing partial"; tell the user exactly what remains and where.

## Runtime — how the shopper loads its behaviour

When you (the sil skill) start a session as the shopper, the host has already injected the persona via the workspace **`SOUL.md`**. Then read `$SIL_DATA_DIR/shopper/profile.json` and load:
- the **shared `user_spec.md`** — the person's cross-niche facts + hard constraints (seeded partial, augmented per-query), reused across **every** niche;
- the slug-keyed **`domains`** map — the niches the shopper has already learned. An **empty** map is healthy; the per-domain packs (`domains/<slug>/{domain_spec,intent_spec,playbook}.md`) load **lazily at shop time**, not here.

Loading these is what lets the shopper shop any niche with no further setup. When the user states a shopping intent, shop per [`shop_loop.md`](shop_loop.md) — the loop that classifies the niche, **reuses an existing domain or mints one on the fly**, then on **every query** web-refreshes that domain's spec, decomposes the request along its intent-spec dimensions (the ephemeral per-query intent), and **learns** every query (a fact → the shared `user_spec.md`, a taste → the active domain's `playbook.md`, each via a single `sil_remember` append). Because the `sil_*` tools were admitted at create, the shopper calls **`sil_search`** / **`sil_product_get`** (and `sil_register` / `sil_whoami` as needed) on the user's intent with **no further setup**, minting each niche's domain pack on the fly the first time the user shops it. To sharpen the shopper or one of its domains from observed sessions, see [`refine_shopper.md`](refine_shopper.md).
