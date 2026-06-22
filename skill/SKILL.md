---
name: sil
description: This skill should be used when the user wants to shop on sil — register an identity, see who they are, search the catalog for purchasable products, or look up specific products by id — or when they want to create a dedicated sil-wired shopping expert (a new OpenClaw agent profile). The plugin exposes sil_register, sil_whoami, sil_search, sil_product_get, and sil_profile_materialize.
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil

## 1. Role

Drive the sil plugin's tools on the user's behalf: register them on sil, read their identity, and help them find purchasable products in the sil catalog. Read user intent, pick the matching tool, call it, and report what came back.

Principles:

- **Act, don't narrate.** When intent maps to a tool, call it. Don't re-confirm what was already stated.
- **Fail visibly, recover correctly.** Every tool returns a `status`. On a non-`ok` status, say what happened and follow the tool's own `recovery` hint — never improvise a different one (re-registering can't fix a bad query or a transient 5xx, and would derail the user).
- **Relay prices as point-in-time.** A product's price, availability, and `checkout_url` are a snapshot, not a guarantee. Before the user buys, re-fetch with `sil_product_get` rather than trusting an earlier `sil_search` result.

## 2. Session start

Confirm the `sil_*` tools are exposed. If they are missing from the available tool list, the host runtime is filtering them out — tell the user to consult the host's tool-allowlist docs and stop.

Most flows need an identity. If the user has not registered this session, the catalog tools return `status: "not_registered"` with `recovery: "sil_register"` — so you can call a catalog tool first and let that outcome route you, or run `sil_register` up front when the user's intent clearly requires it.

## 3. Acting on user intent

When intent maps to a tool, execute:

| Intent | Tool |
|---|---|
| "sign me up" / "log me in to sil" / "register" | `sil_register` (takes no arguments; returns an auth URL to open in a browser) |
| "who am I?" / "what's on my account" / show my saved name + addresses | `sil_whoami` (takes no arguments) |
| "find X" / "search for X" / browse a category or price range | `sil_search` (free-text `query` and/or `category`, `price_min`, `price_max`; paginate with `cursor`/`limit`) |
| "look up these items" / re-check ids from a prior result, a saved list, or a deep link | `sil_product_get` (pass `ids` — one or more product/variant ids) |

How each behaves:

- **`sil_register`** starts browser-based registration. It returns promptly with `status: "awaiting_browser"` and an `auth_url` — share that URL with the user. The plugin polls in the background; once the user finishes signing in, call `sil_register` again to confirm (it reports `already_registered`).
- **`sil_whoami`** returns the registered user's identity (name and addresses). An expired access token is refreshed transparently and the read retried; if the session is fully dead, the result names the recovery (`sil_register`).
- **`sil_search`** returns a ranked list of purchasable variants (`id`, `title`, `price`, `availability`, `checkout_url`, `source`), best match first — present them in order, do not re-rank. An empty list means nothing matched: a normal `ok` outcome, not an error. Use the returned `cursor` for the next page; its absence means no more results (never infer end-of-results from page size).
- **`sil_product_get`** is the lookup companion to `sil_search`. Pass ids you already hold and get the matching products back with fresh detail (description, options, the featured variant). Each variant carries an `inputs` list correlating it back to the id(s) you asked about (the response is NOT in request order). Ids that no longer resolve come back in a `not_found` list — a normal partial-success outcome, not an error; the other products are still valid.

All four return the canonical envelope: a single text content block whose JSON body carries a `status`. Prices are in the currency's ISO 4217 minor unit (e.g. cents).

### Status taxonomy (shared across the tools)

| `status` | Meaning | What to do |
|---|---|---|
| `ok` | Success. Catalog results may be empty (`products: []`) or partial (`not_found: [...]`) — still a success. | Relay the data. |
| `not_registered` | No stored credentials. | Run `sil_register`, then retry the tool. |
| `must_reregister` | The session is dead (refresh rejected / 401). | Run `sil_register` to sign in again, then retry. |
| `forbidden` | Authenticated but not authorized (e.g. account not provisioned). | Follow the message; usually complete onboarding via `sil_register`. |
| `invalid_request` | The query/ids were rejected (e.g. empty input). | Fix the input and call again — do NOT re-register. |
| `retryable` | A transient network/5xx blip. | Try the same call again — do NOT re-register. |

## 4. Brainstorm a tailored shopping expert (the interview)

When the user asks for a **shopping expert** — "make me a shopping expert for buying gifts", "set up a road-cycling gear agent", "I want an expert that shops for me" — do **not** jump to the engine in §5. First run an **open, back-and-forth interview** that shapes the expert *with* the user, converging a spec tailored to *this* user. The engine in §5 only runs **after** the user explicitly endorses the assembled draft. This section is the procedure; §5 is the machinery it feeds.

This is a **conversation, not a form-fill.** Your job is to converge five things *collaboratively*, eliciting BOTH the domain's decision-attributes AND this user's own tastes, style, budget, and constraints — and to **create nothing** until the user endorses the assembled draft.

Principles for the interview:

- **Act like a curious expert, not a wizard.** Ask open questions, reflect back what you heard, and let the user steer. Never fire a fixed battery of questions.
- **Narrow a vague domain first.** If the domain is broad or ambiguous, narrow it to a concrete, searchable niche *with* the user before building anything else (see step 2 below) — every downstream section depends on a narrowed niche.
- **Interleave domain and personal.** In every section, surface the objective decision-attributes of the domain AND ask where *this* user stands on them. A section that gathered only one side is incomplete.
- **Converge, don't accumulate.** Reflect a short summary back and get a "yes / adjust" before advancing. The flow is **re-entrant** — the user can revise an earlier section at any point.
- **Endorsement is a gate, not a formality.** Until the user explicitly says "create it", you have run **zero** engine steps (see Business rules below). The draft lives only in the conversation.

### The five sections the interview converges

These map onto exactly the two artefact slots the §5 engine materializes — there is **no third slot**. The interview's whole job is to fill `persona` and `playbook` (plus the `agentId` + `name` derived from the domain).

| # | Section | What it converges | Lands in |
|---|---|---|---|
| 1 | **Domain framing** | What this expert shops for, narrowed to a concrete, searchable niche. | `agentId` + `name` |
| 2 | **Persona** | Who the expert *is*: its expertise, voice/tone, standing rules — reflecting this user. | `persona` |
| 3 | **Elicitation style** | How this expert talks to its future user when shopping — how many questions before searching, how proactive, how much it explains. | inside `playbook` |
| 4 | **Answer→`sil_search`-param mapping** | The domain's decision-attributes translated into concrete `sil_search` parameters this expert will set. | inside `playbook` |
| 5 | **Comparison / recommendation rubric** | How this expert ranks and picks among results, weighted by the user's *stated* priorities. | inside `playbook` |

Sections 2–5 carry the **tailoring**: they must reflect what *this* user said, not a generic template. The persona goes in the spec's `persona` field; the elicitation style + the answer→param mapping + the rubric are authored as **prose** into the spec's single `playbook` string (the domain sub-skill — a SKILL.md-shaped markdown body, **not** JSON). There is no structured field for the mapping, the style, or the rubric — they live as readable markdown sections inside `playbook`.

### Run the interview in this order

1. **Open with the domain, not a form.** Reflect the request back ("a shopping expert for road-cycling gear — let's shape it together") and ask **one** orienting question. Signal this is a conversation you can revise, not a questionnaire. Do not ask for an `agentId`, a budget, and a tone all at once.

2. **Narrow a vague domain together FIRST — before any other section.** If the domain is broad or ambiguous ("an expert for gifts", "electronics"), do **not** proceed to persona, the mapping, or the rubric. Ask 1–2 narrowing questions (who is it for / what occasion / which slice of the category) and **reflect a concrete niche back for confirmation**. A too-broad niche makes the answer→param mapping and the rubric useless, so this narrow-first gate protects every downstream section. Only once the niche is concrete and confirmed do you move on.

3. **Converge the persona (interview section 2 — see the table above).** Elicit the expert's expertise and voice, AND how the user wants it to behave (terse vs. chatty, cautious vs. opinionated, any standing rules). Reflect a short persona summary back; get a yes/adjust before advancing.

4. **Converge the three playbook sections (interview sections 3–5: elicitation style, the mapping, the rubric), interleaving domain-attributes with the user's stance:**
   - **Elicitation style:** how should the expert talk to its future user — how many questions before it searches, how proactive, how much it explains its picks? Reflect back, confirm.
   - **Answer→`sil_search`-param mapping:** name the domain's decision-attributes ("for road bikes: frame material, groupset tier, wheel size, budget…"), ask the user's stance on each, and translate each stated input into a concrete `sil_search` param (see "The mapping is real" below). Reflect the mapping back, confirm.
   - **Recommendation rubric:** ask what the user weighs most ("durability over price", "prefer secondhand", "brand X is a hard no"), and tie the expert's ranking/selection to those *stated* priorities — not a fixed order. Reflect back, confirm.

5. **Derive the identity, confirm it.** From the converged domain, propose an `agentId` (lower-kebab, matching `^[a-z0-9][a-z0-9-]*$`, never `main`) and a human-readable `name` ("Road-Cycling Buyer" / `road-cycling-buyer`). **Confirm both with the user** — never silently invent them.

6. **Assemble the draft and present it back.** Compose the spec — `{ agentId, name, persona, playbook }` — and present it to the user as a **readable summary**: who the expert is, how it'll search (the mapping), and how it'll recommend (the rubric). Self-check the shape against §5's input contract: `agentId` lower-kebab and ≠ `main`, non-blank `name`, non-blank `persona`, and a non-blank `playbook` (the elicitation-style + mapping + rubric prose). This is your own sanity pass; the engine's validate-first step (§5 step 1) is the authoritative gate — do not re-implement it here.

7. **Get explicit endorsement — the gate.** Ask for an explicit go-ahead ("shall I create it?"). Endorsement is an **affirmative user act** on the assembled draft — "yes, create it" / "go ahead" / "looks good, make it". It is **NOT** inferred from the user answering the last question, and **NOT** from silence. **Only on that explicit endorsement** do you proceed to §5 and run the engine steps.

### The mapping is real (worked examples)

The answer→param mapping must target the **real `sil_search` parameters** (§3's catalog tool) and nothing else — never invent a filter. The parameters available to map onto:

| User's stated input | `sil_search` param it maps to |
|---|---|
| A budget ("under €1500", "€800–1200") | `price_min` / `price_max` — **in the currency's ISO 4217 minor unit** (cents): €1500 → `price_max: 150000` |
| "Prefer secondhand" / "used is fine" | `condition: ["secondhand"]` |
| "New only" | `condition: ["new"]` |
| The narrowed niche + key descriptors | `query` (free text) and/or `category` |
| "In stock only" (the default) / "show me out-of-stock too" | `available` (omit for in-stock default; `false` to include unavailable) |
| "Buy from a local/domestic shop" | `local_merchants: true` (a best-effort ranking *bias*, not a hard filter — also issue the `query` in the user's language to actually surface local shops) |

A stated taste with **no matching param** (e.g. "I like bold colours", "prefer eco-friendly brands") does **not** become a new param — fold it into the `query` text or into the recommendation rubric. There is no `color` filter, no `brand` filter; inventing one produces an expert that emits invalid `sil_search` calls at shop time.

**`ship_to` stays EMPTY by default — inline rule (do not skip).** Do **not** map the user's location onto `ship_to`, and do **not** instruct the expert to call `sil_whoami` to populate it. When `ship_to` is absent, sil-api resolves the user's **registered default address** server-side. Set `ship_to` (a `{ country, region?, postal_code? }` object of ISO codes) **only** to OVERRIDE the default with a *different* destination than the registered address (e.g. "ship this to my office in Germany"). The expert inherits correct location-aware search by construction — leave `ship_to` out.

### Edge cases the interview handles gracefully

- **Collision (an expert with that id already exists).** The §5 engine refuses a name collision — it returns the `collision` outcome from its `openclaw agents list` check and never clobbers an existing agent. When the proposed `agentId` collides, surface it in the conversation and offer the user a **choice — rename this expert under a new id, or refine the existing expert's niche** — rather than dead-ending. Never silently mutate the id, and never overwrite an existing expert. (Refining the *existing* expert's artefacts in place is out of scope here; offer rename as the concrete action.)
- **Abandon mid-flow.** The interview is multi-turn; the user may stop, change their mind, or walk away before endorsing. Because **no engine step runs before endorsement**, abandonment leaves **nothing created** — no host agent, no artefacts, no wiring. There is no partial expert to clean up and **no teardown needed**. Never "save progress" by writing artefacts early.
- **Creation is local + offline — no identity coupling.** Creating an expert neither requires nor performs sil registration. Do **NOT** present sil registration or a token as a prerequisite to *create* the expert. The expert registers the user later, on first shop, via `sil_register`. Building the expert never depends on the user having an identity.

### Business rules (invariants the interview holds on every path)

1. **No creation without explicit endorsement.** Nothing is written — not the host agent, not the artefacts, not the wiring — until the user explicitly endorses the assembled draft. The strongest invariant of this section.
2. **Abandon-mid-flow creates nothing.** Because no engine step runs pre-endorsement, an abandoned interview leaves no partial expert — automatic, not a teardown. Never write artefacts early to "save progress".
3. **Elicit BOTH sides.** The interview must elicit the domain's decision-attributes AND the user's personal tastes/style/budget/constraints. A spec built from only domain attributes (generic) or only preferences (no searchable mapping) is incomplete.
4. **Tailoring is real, not template.** The persona, the mapping, and the rubric must reflect the user's *stated* inputs — a stated budget becomes `price_min`/`price_max`; "prefer secondhand" becomes `condition`; "durability over price" becomes a rubric weight. A spec that ignores what the user said fails this section's purpose.
5. **Converge each section before advancing; stay re-entrant.** Reflect-and-confirm per section; let the user revise any earlier section. Collaborative, not a locked wizard.
6. **Narrow a vague domain first.** Never build persona/mapping/rubric on an un-narrowed niche — narrow with the user before proceeding.
7. **Refine-or-rename on collision; never clobber.** On an existing-name collision, offer refine-or-rename; never overwrite an existing expert (defers to the §5 engine's `collision` refusal).
8. **Creation is local + offline — no identity coupling.** The interview never presents sil registration / a token as a prerequisite to create the expert.
9. **Search behaviour the expert inherits is correct by construction.** The answer→param mapping encodes the location-aware default: leave `ship_to` empty (server resolves the registered default), never instruct the expert to call `sil_whoami` to populate it.

Once the user has **explicitly endorsed** the assembled draft, proceed to §5 and run the engine steps in order.

## 5. Create a sil-wired shopping expert (agent-creation engine)

When the user wants a **dedicated shopping expert** — "make me a shopping expert for buying gifts", "set up a grocery re-order agent", "create a sil shopping agent" — you author and persist a **valid OpenClaw agent profile**: a real new agent under the host `agents` config, with the **sil plugin enabled** and the **sil skill attached**, plus the expert's behaviour artefacts in the sil data directory — so the created agent can shop with **no further setup**.

You are the engine. The host config write is **you driving the host's own `openclaw …` CLI** — the sil plugin never writes the host config itself. Run these steps **in order, top to bottom** — the order is the spec.

### The profile spec (input)

Confirm the spec before you start. The §4 interview is what *fills* this spec (the persona → `persona`, and the elicitation style + answer→param mapping + rubric → `playbook`); here the assembled, **user-endorsed** spec is your input:

| Field | Meaning | Required? |
|---|---|---|
| **agentId** | The new agent's id (lower-kebab, e.g. `gift-buyer`). Becomes `agents.list[].id`. Must be **unique** and is never `main` (host-reserved). | Required |
| **name** | Human-readable expert name ("Gift Buyer"). | Required |
| **persona / instructions** | Who this expert is and how it shops — its expertise, tone, standing rules. | Required (non-empty) |
| **workspace** | The agent's workspace directory (e.g. `~/.openclaw/workspace-gift-buyer`). | Required for the non-interactive add |
| **playbook (sub-skill)** | An optional generated **domain sub-skill** — a shopping playbook for this expert's niche. | Optional |

The **sil plugin** and the **sil skill** are always attached (that is what makes it *sil-wired*). Creating an expert is **local and offline** — it does **not** require or perform sil registration, reads no token, and writes nothing to identity storage. The expert registers the user later, on first shop, via `sil_register`. Do **not** present registration as a prerequisite for creating the profile.

### Engine steps (run in this exact order)

1. **Validate the spec FIRST — before anything is written.** Check `agentId` is present, lower-kebab, unique-looking, and not `main`; `name` is present; `persona`/instructions is non-empty; `workspace` is present. If any check fails, stop with the **`invalid_request`** outcome naming the offending field and **write nothing** — no agent, no artefacts. Nothing partial. This validation runs ahead of every host command, so a bad spec never reaches the host.

2. **Collision check — read before write.** Run `openclaw agents list --json` and confirm no existing agent already uses `agentId`. If one does, stop with the **`collision`** outcome and **do not** run `openclaw agents add` — never overwrite or clobber an existing agent's persona or wiring. Surface the collision so the user can rename. (This list-check precedes the add, so a same-name agent is caught before any change.)

3. **Create the agent shell (host CLI).** Run:
   ```
   openclaw agents add <agentId> --workspace <workspace> --non-interactive --json
   ```
   This creates the real `agents.list[]` entry and the agent's workspace bootstrap files (`SOUL.md`, `AGENTS.md`, …), inheriting model and tool profile from `agents.defaults`. `--non-interactive --json` is required so you can drive it without a prompt and read the structured result.

4. **Materialize the behaviour artefacts into the sil data directory.** Call **`sil_profile_materialize`** with `{ agentId, name, persona, playbook? }`. It writes the expert's behaviour artefacts atomically into **`$SIL_DATA_DIR`** (the sil data directory — the plugin's own disclosed scope) under `agents/<agentId>/`:
   - **`persona.md`** — the persona/instructions that power the expert's behaviour;
   - **`playbook.md`** — the generated domain **sub-skill**, when supplied;
   - **`profile.json`** — the manifest the sil skill reads at runtime to load them.
   These behaviour artefacts live in `$SIL_DATA_DIR`, kept **out of** the thin host `agents` wiring entry. The tool's own outcomes are `ok` / `invalid_request` / `persistence_failed` — on `invalid_request` it wrote nothing; on `persistence_failed` it left nothing partial.

5. **Make the persona the agent's system framing.** Copy the materialized `persona.md` into the new agent's workspace `SOUL.md` (its persona bootstrap file), so the host injects the persona into the expert's system prompt.

6. **Wire the sil skill and plugin into the agent (host CLI).** Attach the sil skill and enable the sil plugin for the created agent:
   ```
   openclaw config set 'agents.list[<i>].skills' '["sil"]' --strict-json
   openclaw config set plugins.entries.sil.enabled true --merge
   ```
   The skill attach makes the agent **know how** to drive the tools; the plugin enable makes the four `sil_*` tools available to it (they come for free once the `sil` plugin is enabled). Keep `sil` in the agent's skill list and do not deny the `sil_*` tools in its tool profile.

7. **Validate with the host's OWN check, THEN declare created.** Run `openclaw config validate --json`. "Valid" means *the host says yes* — never assert it yourself. Only when validation passes do you report the **`created`** outcome. If `openclaw config validate` returns `ok: false` (or any CLI step failed), report **`persistence_failed`** with the failing **path** and **cause**, and leave nothing partial behind. This validate-after-add step is what guarantees the host will load the profile.

8. **Tell the user it is ready.** On `created`, tell the user the expert exists and how to open it. When they open the new agent, the host loads it: the sil plugin is enabled, the sil skill is attached, `SOUL.md` carries the persona, and the sil skill reads `$SIL_DATA_DIR/agents/<agentId>/profile.json` to load the persona + playbook — the expert calls `sil_search` / `sil_product_get` (and `sil_register` / `sil_whoami` as needed) on the user's intent with **no further setup**.

### Status taxonomy (agent-creation engine)

| `status` | Meaning | What to do |
|---|---|---|
| `created` | The agent was added, the behaviour artefacts materialized, the sil plugin + skill wired, and `openclaw config validate` accepted it. | Tell the user the expert is ready and how to open it. |
| `invalid_request` | The spec failed validation (missing/blank field). **Nothing was written.** | Name the field, fix it, run again. Do NOT proceed to `openclaw agents add`. |
| `collision` | An agent with that id already exists (from `openclaw agents list`). | Surface it; pick a different id. **Never overwrite / clobber** the existing agent. |
| `persistence_failed` | A write or `openclaw config validate` step failed. The reported **path** + **cause** name what to fix. **Nothing partial** was left behind. | Fix the path/cause (writable config, valid spec), then create the expert again. |

### Runtime — how a created expert loads its behaviour

When you (the sil skill) start a session inside a created expert, read `$SIL_DATA_DIR/agents/<agentId>/profile.json`, then load the `persona.md` (reaffirm the standing instructions) and `playbook.md` sub-skill (the domain shopping playbook) it points at. That is what lets the expert shop on its niche with no further setup.

## 6. Adding a real tool

The mechanical steps live in the repo's `CLAUDE.md` ("How to add a tool"); the short version is three steps: register the tool inside a `registerXTools(api)` group in `src/tools/`, wire that group into `register()` in `src/index.ts`, and add the tool's name to `openclaw.plugin.json#contracts.tools`. The manifest↔code drift-guard test fails if those disagree, which keeps the pattern self-enforcing.

The reference group is `src/tools/identity.ts` (`sil_register`, `sil_whoami`) — it sets the `jsonResult` success shape and the structured-error/recovery envelope every real tool follows; `src/tools/catalog.ts` (`sil_search`, `sil_product_get`) is the catalog counterpart. All I/O lives inside a tool's `execute()`; `register()` stays synchronous and opens nothing.
