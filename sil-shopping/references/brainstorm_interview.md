# Set up your shopper — the onboarding interview

When the user asks to **set up shopping** — "create my shopper", "set up an agent that shops for me", "I want something that shops for me" — do **not** jump to the engine. Run a short, **two-touchpoint** onboarding that shapes the shopper *with* the user — **pre-seeded from what they already said this session** — then **create nothing** until the user endorses the assembled draft. The agent-creation engine ([`agent_creation_engine.md`](agent_creation_engine.md)) only runs **after** that explicit endorsement.

This is a **conversation, not a form-fill** — and a **short** one. Because you **pre-seed** from the session, you open by **reflecting a filled draft back**, not with a cold question. The shopper is a **generalist**: it goes deep on whatever the user later buys, **lazily minting a domain on first shop in each niche**. So onboarding does **NOT** research any niche and does **NOT** ask the user to pick one. It touches exactly **two** things: the **persona** (how their shopper should behave) and a **shared user-spec seed** (cross-niche facts + hard constraints). Everything niche-specific — how to shop a niche well, what each request in it should resolve, the niche shopping taste — is **deferred to first shop**, not authored here.

## Session pre-seed — open with a reflected draft, never a cold question

Before you ask anything, assemble a **draft** from what the user has **already said** *this session*: the **persona** (their own words on how the shopper should behave) and the **shared user-spec seed** (any sizes, hard limits, or ethics rules they mentioned in passing). Then **open by reflecting that draft back** — *"from what you've told me, here's the shopper I'd set up…"* — and ask only to **confirm-or-adjust**. That is the **rich** (a filled draft, so the shopper demonstrably listened) + **light** (one confirm) shape.

- **Pre-seed, don't interrogate.** **Pre-fill** the persona + the shared `user_spec` from the session; ask only to fill genuine gaps, never to re-collect what the user already told you.
- **Never invent facts you did not hear.** If the session gave little, seed a **minimal honest** draft ("cross-niche facts to be learned as we shop; no hard constraints stated yet") and say so — never fabricate a size or a limit.
- **Session-only — local + offline.** The seed is assembled **only** from this conversation. It does **NOT** pull `sil_whoami`, reads **no** token, and makes no network call. (The shopper registers the user later, on first shop, via `sil_register` — never a prerequisite here.)
- **The endorsement gate is untouched.** A rich pre-fill is a **proposal**, never consent — see the gate in §3 below.

## The two onboarding touchpoints — persona + shared user spec

A created shopper runs on a persona (`SOUL.md`) plus the **shared, agent-level `user_spec.md`**, both seeded here. The per-domain packs are minted lazily at shop time, not at onboarding.

| Artefact | Where | What it holds | Seeded |
|---|---|---|---|
| **`SOUL.md`** (persona) | host workspace (via host CLI) | the shopper's identity / voice / standing rules — a **generalist**, not a niche specialist | pre-seeded from the session (§1 below); refined on persona refine, stable per query |
| **`user_spec.md`** (shared) | sil data dir (**required**) | the user's **cross-niche** facts + hard constraints (addresses, sizes, allergy/ethics rules, budget psychology) | pre-seeded partial from the session (§2); augmented every query, reused across **every** niche |

The niche packs — the deep niche know-how, the per-request template a query is resolved against, and the niche shopping taste — are **NOT** authored here; they are minted **on first shop in each niche** ([`shop_loop.md`](shop_loop.md)). The per-query fill (the template filled in for one request) is **ephemeral** — never persisted, never authored here.

## Principles for the interview

- **Pre-seed from the session; open with the draft.** Assemble the persona + shared user-spec draft from what the user already said, and lead with it (reflect-back), not a cold questionnaire. The interview is **rich but light** — a filled draft plus one confirm-or-adjust per touchpoint.
- **Two touchpoints, no niche research.** Touch the persona and the shared user spec — that is the whole onboarding. The shopper is a **generalist**; there is **no narrow-the-niche step** and **no domain interview**. The deep niche expertise is researched **lazily, at first shop**, never interrogated here.
- **The persona question shapes voice, not a niche.** The persona surfaces the **voice / standing rules** — terse vs. chatty, cautious vs. opinionated, any never-break rules. It does **not** bind the shopper to one niche.
- **Seed the shared facts, ask little.** The shared user spec holds cross-niche facts + hard constraints that carry across every niche. Seed what the user volunteered — don't run a questionnaire; the rest is **augmented per-query** at shop time.
- **Converge, don't accumulate.** Reflect a short summary back and get a yes/adjust before advancing. The flow is **collaborative** and **re-entrant** — the user can revise an earlier touchpoint at any point.
- **Endorsement is a gate, not a formality.** Until the user explicitly says "create it", run **zero** engine steps. The draft lives only in the conversation.

## Run the interview in this order — two touchpoints

### 1. `SOUL.md` — persona + behaviour (a generalist shopper), pre-seeded

Open by **reflecting the session-seeded persona draft back** ("from what you've told me, your shopper sounds like…"), then confirm-or-adjust its **voice/tone** (terse vs. chatty, cautious vs. opinionated) and any **standing rules** it should always follow. Only ask the persona/identity question cold if the session gave you nothing to reflect. This is the shopper's **system framing**, a **generalist** that will shop whatever the user buys — **not** a niche choice; the niche is decided later, per query, when the user actually shops. This becomes the host workspace **`SOUL.md`** (the persona is the agent's system framing — **not** a sil artefact, no `persona.md`).

### 2. `user_spec.md` (shared) — seed the cross-niche facts + hard constraints

**Pre-fill** the **shared user spec** from the session: the user's **cross-niche** facts and any **hard constraints** that should hold in *every* niche — addresses / sizes the user volunteered, an allergy or ethics rule ("never leather"), a budget psychology. Reflect the pre-filled seed back and mark each as **hard** (inviolable — an allergy, an ethics rule, an age gate) vs **soft** (a bendable preference). Don't run a questionnaire — seed what the user offered; the rest is **augmented per-query** at shop time, and a niche-specific fact is learned when that niche is first shopped. If the user gave little, seed a minimal honest body (e.g. "cross-niche facts to be learned as we shop; no hard constraints stated yet") — non-blank, but partial. This lands in `userSpec` (→ the shared `user_spec.md`). **No niche taste, no domain question, no intent dimensions are gathered here** — those belong to first-shop lazy mint.

### 3. Derive the identity, assemble, endorse

- **Identity.** Propose an `agentId` (lower-kebab, `^[a-z0-9][a-z0-9-]*$`, never `main`) and a human-readable `name` ("My Shopper" / `my-shopper`). **Confirm both** — never silently invent them.
- **Assemble + present.** Compose **`{ agentId, name, persona, userSpec }`** and present a **readable summary**: who the shopper is (its persona/voice + standing rules) and the **seeded shared user spec** (cross-niche facts + hard constraints, partial, to grow per-query). Self-check the shape against the engine's contract: `agentId` lower-kebab & ≠ `main` (it keys the host `openclaw agents add`, not the sil tool), non-blank `name`/`persona`, and a non-blank shared `userSpec` — the only sil artefact at create (the engine passes just `name` + `userSpec` to the singleton `sil_profile_materialize`; no niche pack is authored here). This is shape-only — it writes nothing; the engine's validate-first step is the authoritative gate.
- **Endorse — the gate.** Ask for an explicit go-ahead ("shall I create your shopper?"). Endorsement is an **affirmative user act** on the assembled draft — "yes, create it" / "go ahead". It is **NOT** inferred from the user answering the last question, and **NOT** from silence. **Only on that explicit endorsement** do you proceed to the engine ([`agent_creation_engine.md`](agent_creation_engine.md)) and run the one command.

## Edge cases the interview handles gracefully

- **A shopper already exists (the singleton).** The shopper is a singleton — the engine refuses a second create (its `collision` outcome, "a shopper already exists") and never clobbers the existing one. Surface it and steer the user to **shop a new niche** (which lazily mints a domain on the spot) or **refine the existing shopper** — **never** mint a second shopper, never silently mutate the existing one.
- **Abandon mid-flow.** Because **no engine step runs before endorsement**, abandonment leaves **nothing created** — no host agent, no artefacts, no wiring, no teardown. Never "save progress" by writing artefacts early.
- **Creation is local + offline (for the user's identity).** Creating a shopper neither requires nor performs sil registration. Do **NOT** present sil registration or a token as a prerequisite to create the shopper; the session seed does **not** pull `sil_whoami`, reads no token, and never reaches the network. It registers the user later, on first shop, via `sil_register`. (No web access is needed at onboarding either — the niche research that reaches the web happens later, at first shop.)

## Business rules (invariants the interview holds on every path)

1. **No creation without explicit endorsement.** Nothing is written — not the host agent, the `SOUL.md`, the shared user spec, or the wiring — until the user explicitly endorses. The draft lives only in the conversation until then.
2. **Abandon-mid-flow creates nothing.** No engine step runs pre-endorsement (**zero engine steps** before the explicit "yes"), so an abandoned interview leaves no partial shopper — automatic, not a teardown. Nothing is created, nothing partial.
3. **Two touchpoints only — persona, then shared user spec.** `SOUL.md` (persona/voice, a generalist, NOT a niche) and the shared `user_spec.md` (cross-niche facts + hard constraints), both **pre-seeded from the session**. **No** niche know-how, no niche shopping taste, and no per-request template work at onboarding — those move to first-shop lazy mint.
4. **No niche is researched or chosen at onboarding.** The shopper is a generalist; the deep niche know-how, the per-request template, and the niche shopping taste are minted **lazily, on first shop** in each niche ([`shop_loop.md`](shop_loop.md)). Onboarding never interrogates a niche or asks the user to pick one.
5. **Converge each touchpoint before advancing; stay re-entrant.** Reflect-and-confirm per touchpoint; let the user revise an earlier one.
6. **Singleton: refuse a second shopper; never clobber.** Defer to the engine's `collision` refusal ("a shopper already exists"); steer to shop-a-new-niche or refine.
7. **Creation is local + offline for the user's identity.** Never present sil registration / a token as a prerequisite to create, and never pull `sil_whoami` to seed — the seed is session-only.
8. **The persona is the host `SOUL.md`, not a sil artefact.** No `persona.md` in the sil store. The only sil artefact seeded at create is the **shared** `user_spec.md`; the niche packs (the deep niche know-how, the per-request template, the niche shopping taste) are minted later, per niche.

## After endorsement

Once the user has **explicitly endorsed** the assembled draft, proceed to [`agent_creation_engine.md`](agent_creation_engine.md) and run the **one command**. Until that explicit endorsement, **zero engine steps** have run.
