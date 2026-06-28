# Create your sil-wired shopper — the agent-creation engine

**Precondition: run this ONLY after the user has explicitly endorsed the assembled draft from [`brainstorm_interview.md`](brainstorm_interview.md).** Any step below before that endorsement is forbidden — the interview owns the gate.

When the user wants to **set up shopping**, author and persist **one** valid OpenClaw agent profile — the user's **shopper**: a real new agent under the host `agents` config, with the **sil plugin enabled**, the **sil skill attached**, its persona written into the workspace **`SOUL.md`**, plus the shopper's **shared user spec** in the sil data directory — so it shops with **no further setup**. The shopper is a **singleton**: you create it **once**, then it learns **domains** (niches) lazily on first shop — you never mint a second shopper.

The shopper runs **entirely on Spec-Driven Shopping (SDS)** — the operating model, not an optional layer. At create time the engine persists exactly **one** sil artefact: the **shared, agent-level `userSpec`** (the person's cross-niche facts + hard constraints, seeded *partial* by the interview). It does **NOT** research any niche or write any per-domain pack at create time — there is **no** `domainSpec` / `intentSpec` / `playbook` here. Those are minted **lazily, per niche, on first shop** ([`shop_loop.md`](shop_loop.md)) into `domains/<slug>/`. A freshly-created shopper has an **empty `domains` map** — that is **healthy**, not a deficiency.

You are the engine: the host config write (and the `SOUL.md` write) is **you driving the host's own `openclaw …` CLI** — the sil plugin never writes the host config. Run the steps **in order, top to bottom** — the order is the spec.

## The profile spec (input)

The endorsed draft feeds two stores. The **persona** becomes the host workspace **`SOUL.md`** (its identity / voice / standing rules — via the host CLI, **not** a sil artefact). The **shared user spec** becomes the sil data-dir artefact:

| Field | Meaning | Goes to | Required? |
|---|---|---|---|
| **agentId** | Lower-kebab id (e.g. `my-shopper`) → `agents.list[].id`. Unique, never `main`. | host | Required |
| **name** | Human-readable name ("My Shopper"). | sil manifest | Required |
| **persona** | Who this shopper is and how it shops — a generalist, voice/tone, standing rules. | host **`SOUL.md`** (via host CLI — no `persona.md`) | Required (non-empty) |
| **workspace** | The shopper's workspace directory (e.g. `~/.openclaw/workspace-my-shopper`). | host | Required for the non-interactive add |
| **userSpec** | The user's **shared, cross-niche** facts + hard constraints (addresses, sizes, allergy/ethics rules, budget psychology). **Seeded partial** by the interview, then augmented per-query. | sil `user_spec.md` | **Required (non-empty)** |

There is **no** per-niche input at create time. The deep `domainSpec`, the derived `intentSpec` schema, and the niche `playbook` are **not** authored here — they are researched and minted on first shop in each niche.

The **sil plugin** and **sil skill** are always attached (that is what makes it *sil-wired*). Creation is **local and offline** — it does **not** require or perform sil registration, reads no token, and writes nothing to identity storage. The shopper registers the user later, on first shop, via `sil_register`. Do **not** present registration as a prerequisite.

## The created shopper needs WEB tools

The shopper **lazily mints a domain on first shop** (its research pass reaches the web) and **web-refreshes each domain spec on every query**. So the created agent must have **web/fetch tools in its tool profile** — inherited from `agents.defaults` when its shell is created (step 3). Confirm that profile grants a web-fetch/browse capability and **do not deny it** (alongside not denying the `sil_*` tools). If `agents.defaults` does **not** grant a web tool, the shopper cannot research or refresh a domain — surface that to the user as a host-capability gap; do **not** pretend the research happened.

## Engine steps (run in this exact order)

1. **Validate the spec FIRST — before anything is written.** Check `agentId` (present, lower-kebab, unique-looking, ≠ `main`), `name`, `persona`, `workspace`, and the **shared `userSpec` — present and non-blank** (the only sil artefact at create; it is seeded *partial* by the interview, never omitted). There is **no** `domainSpec` / `intentSpec` / `playbook` to validate here — those are minted lazily on first shop. On any failure, stop with **`invalid_request`** naming the field and **write nothing**. This runs ahead of every host command, so a bad spec never reaches the host.

2. **Singleton check — a user has exactly ONE shopper.** The shopper is a singleton: a user creates it **once**, then adds domains to it. Run `openclaw agents list --json` and read the sil artefact store (`sil_profile_list`); if a sil shopper **already exists**, stop with **`collision`** — **"a shopper already exists"** — and **do not** run `openclaw agents add`. Steer the user to **shop a new niche** (which lazily mints a domain on the spot) or **refine the existing shopper** — **never mint a second shopper**. (An `agentId` that collides with any existing agent is likewise refused — never overwrite an existing agent's persona or wiring.)

3. **Create the agent shell (host CLI).** Run:
   ```
   openclaw agents add <agentId> --workspace <workspace> --non-interactive --json
   ```
   This creates the real `agents.list[]` entry and the workspace bootstrap files (`SOUL.md`, `AGENTS.md`, …), inheriting model and **tool profile** (which must grant **web/fetch** — see above) from `agents.defaults`. `--non-interactive --json` lets you drive it without a prompt and read the result.

4. **Write the persona into the workspace `SOUL.md` (host CLI).** The persona is the shopper's soul / system framing — the host's `SOUL.md`, **not** a sil artefact. Write the endorsed persona text straight into the new agent's `SOUL.md` via the host CLI. There is **no** `persona.md` in the sil store and **no** copy step — the persona lives in exactly one place.

5. **Materialize the shared user spec — NO `domain`.** Call **`sil_profile_materialize`** with **`{ agentId, name, userSpec }`** — the shared `userSpec` seeded by the interview (partial, augmented per-query). **Pass NO `domain`** at create: with no `domain`, the tool writes the shared **`user_spec.md`** + **`profile.json`** (with an **empty `domains: {}` map**) into **`$SIL_DATA_DIR/agents/<agentId>/`**, atomically. There is **no** `domain_spec.md` / `intent_spec.md` / `playbook.md` yet — the first shop in a niche mints that niche's pack (with a `domain` object) lazily. There is **no `persona.md`** here. The tool's outcomes are `ok` / `invalid_request` / `persistence_failed` — on `invalid_request` it wrote nothing; on `persistence_failed` it left nothing partial.

6. **Wire the sil skill + plugin (host CLI).** Asserted against the pinned host — **`alpine/openclaw:2026.6.9`** — both value-mode sets with `--strict-json` (the only set mode this image accepts):
   ```
   openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json
   openclaw config set plugins.entries.sil.enabled true --strict-json
   ```
   The skill attach makes the agent **know how** to drive the tools; the plugin enable turns the sil plugin **on** — but it does **not** by itself un-filter the `sil_*` tools (see the admission step next). Keep `sil` in the agent's skill list and do not deny the `sil_*` tools.

7. **Admit sil at the host allow surfaces — run the shipped helper.** Enabling the plugin is necessary but not sufficient: until `sil` is admitted at the **global** allow surfaces `plugins.allow` + **`tools.alsoAllow`**, the host keeps the `sil_*` tools **filtered**, so the shopper can't call them. Admission is **plugin-ID only** — there is no per-tool key. The value-mode `openclaw config set` above is **overwrite-only** on this image, so it cannot additively merge those shared global arrays without clobbering another already-admitted plugin (e.g. `klodi`). Run the shipped admission helper — the package `bin` that ships with the plugin (same artefact as the `openclaw:allowlist` script) — which performs the **additive, idempotent, atomic, self-validating** three-surface merge (`plugins.allow` + `tools.alsoAllow` + `plugins.entries.sil`):
   ```
   sil-openclaw-allowlist
   ```
   It re-confirms the plugin-enable as an idempotent no-op, so re-running it on every creation never duplicates or clobbers an existing entry. **If the helper exits non-zero (a failed admission), report `persistence_failed` with the path + cause and do NOT declare `created`** — never a green `created` over still-filtered tools, exactly as a rejected `openclaw config validate` is handled in the next step.

8. **Validate with the host's OWN check, THEN declare created.** Run `openclaw config validate --json`. The verdict is `{ valid, path, issues? }` — success keys off **`.valid`**, never an `ok` field. Only when `valid: true` **and** the allow-list admission (step 7) succeeded do you report **`created`**. If `valid: false`, the admission helper exited non-zero, or any CLI step failed, report **`persistence_failed`** with the failing **path** + **cause** (the `issues?`), leaving nothing partial.

9. **Tell the user it is ready.** On `created`, tell them their shopper exists and how to open it. Opening it loads the persona (`SOUL.md`) and the shared user spec + the (empty) `domains` map (`profile.json`), and — because the `sil_*` tools were admitted in step 7 — the shopper calls `sil_search` / `sil_product_get` (and `sil_register` / `sil_whoami` as needed) on the user's intent with **no further setup**, **minting each niche's domain pack on the fly** the first time the user shops it.

## Status taxonomy (agent-creation engine)

| `status` | Meaning | What to do |
|---|---|---|
| `created` | Shopper added, shared user spec materialized, sil plugin + skill wired, `openclaw config validate` accepted it. | Tell the user it's ready and how to open it. |
| `invalid_request` | Spec failed validation (missing/blank field). **Nothing written.** | Name the field, fix it, run again — do NOT proceed to `openclaw agents add`. |
| `collision` | A shopper already exists (the singleton). | Surface it — "a shopper already exists"; steer to shop-a-new-niche (lazy mint) or refine. **Never mint a second shopper.** |
| `persistence_failed` | A write, the allow-list admission helper (non-zero exit), or `openclaw config validate` step failed. **Nothing partial** left. | Fix the reported path/cause, create again. |

## Runtime — how the shopper loads its behaviour

When you (the sil skill) start a session as the shopper, the host has already injected the persona via the workspace **`SOUL.md`**. Then read `$SIL_DATA_DIR/agents/<agentId>/profile.json` and load:
- the **shared `user_spec.md`** — the person's cross-niche facts + hard constraints (seeded partial, augmented per-query), reused across **every** niche;
- the slug-keyed **`domains`** map — the niches the shopper has already learned. An **empty** map is healthy; the per-domain packs (`domains/<slug>/{domain_spec,intent_spec,playbook}.md`) load **lazily at shop time**, not here.

Loading these is what lets the shopper shop any niche with no further setup. When the user states a shopping intent, shop per [`shop_loop.md`](shop_loop.md) — the loop that classifies the niche, **reuses an existing domain or mints one on the fly**, then on **every query** web-refreshes that domain's spec, decomposes the request along its intent-spec dimensions (the ephemeral per-query intent), and **learns** every query (a fact → the shared `user_spec.md`, a taste → the active domain's `playbook.md`, each via a single `sil_remember` append). To sharpen the shopper or one of its domains from observed sessions, see [`refine_shopper.md`](refine_shopper.md).
