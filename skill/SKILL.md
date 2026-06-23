---
name: sil
description: This skill should be used when the user wants to shop on sil — register an identity, see who they are, search the catalog for purchasable products, or look up specific products by id — or when they want to create a dedicated sil-wired shopping expert (a new OpenClaw agent profile) and then list, view, or remove the experts they have created. The plugin exposes sil_register, sil_whoami, sil_search, sil_product_get, sil_profile_materialize, sil_profile_list, sil_profile_get, and sil_profile_remove.
metadata:
  openclaw:
    emoji: "\U0001F6D2"
---

# sil

Drive the sil plugin's tools on the user's behalf: register them on sil, read their identity, help them find purchasable products in the sil catalog — and, when asked, create a dedicated sil-wired shopping expert, then list, view, or remove the experts they have created. Read user intent, route to the matching tool (loading its reference on demand), call it, and report what came back.

## Always-on behavioural contract

These three principles hold on every path, before any reference is loaded:

- **Act, don't narrate.** When intent maps to a tool, call it. Don't re-confirm what was already stated.
- **Fail visibly, recover correctly.** Every tool returns a `status`. On a non-`ok` status, say what happened and follow the tool's own `recovery` hint — never improvise a different one.
- **Relay prices as point-in-time.** A product's price, availability, and `checkout_url` are a snapshot, not a guarantee. Before the user buys, re-fetch with `sil_product_get` rather than trusting an earlier `sil_search` result.

## Session start

Confirm the `sil_*` tools are exposed. If they are missing from the available tool list, the host runtime is filtering them out — tell the user to consult the host's tool-allowlist docs and stop. Most flows need an identity: if the user has not registered this session, the catalog tools return an unregistered status whose `recovery` points at `sil_register` (the [catalog tools reference](references/catalog_tools_reference.md) has the full taxonomy) — so calling a catalog tool first lets that outcome route, or run `sil_register` up front when the user's intent clearly requires it.

## Routing — match intent to a tool, load its reference on demand

| Intent | Tool | Reference to load |
|---|---|---|
| "sign me up" / "log me in to sil" / "register" | `sil_register` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "who am I?" / "what's on my account" / show my saved name + addresses | `sil_whoami` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "find X" / "search for X" / browse a category or price range | `sil_search` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "look up these items" / re-check ids from a prior result, a saved list, or a deep link | `sil_product_get` | [`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) |
| "make me a shopping expert" / "set up an agent that shops for me" / build a dedicated shopping expert | (interview, then the engine) | see the two-step gate below |
| "what experts do I have?" / "list my experts" | `sil_profile_list` | [`references/manage_experts.md`](references/manage_experts.md) |
| "show me / tell me about &lt;expert&gt;" | `sil_profile_get` | [`references/manage_experts.md`](references/manage_experts.md) |
| "remove / delete &lt;expert&gt;" | `sil_profile_remove` (host-CLI-first — see the reference) | [`references/manage_experts.md`](references/manage_experts.md) |
| (inside a created expert) a shopping intent — "find me something for X" on the expert's niche | `sil_search` → `sil_product_get` (driven by the loaded profile) | [`references/expert_shopping.md`](references/expert_shopping.md) |
| "refine / sharpen / improve &lt;expert&gt;" / "the gift buyer keeps surfacing the wrong stuff — fix it" | (load → propose → confirm → persist — see the reference) | [`references/refine_expert.md`](references/refine_expert.md) |

[`references/catalog_tools_reference.md`](references/catalog_tools_reference.md) holds the per-tool behaviour for the four core tools and the shared status taxonomy. Basic shopping needs only that one reference.

When the session is running **inside a created expert** (a loaded profile under `$SIL_DATA_DIR/agents/<agentId>/`) and the user states a shopping intent, follow [`references/expert_shopping.md`](references/expert_shopping.md) — the profile-driven, **Spec-Driven Shopping (SDS)** shop-time loop that web-refreshes the domain spec, decomposes the request along the intent spec, and lazily captures the user spec + buying taste. A created expert runs entirely on SDS; a plain, profile-less session keeps shopping via the "find X" → `sil_search` row above, unchanged.

[`references/manage_experts.md`](references/manage_experts.md) holds the list / view / remove flow for the experts the user has created — including the host-CLI-first remove ordering and the confirm-before-remove gate. Load it the moment the user wants to see or remove an existing expert.

[`references/refine_expert.md`](references/refine_expert.md) holds the refinement loop for an *existing* expert — sharpening it from observed sessions, with a confirm-before-persist gate (nothing changes silently). Load it when the user wants to refine, sharpen, or amend an expert they already have.

### Creating a shopping expert — the endorsement-gated two-step

When the user asks to create / set up / build a dedicated shopping expert:

1. **Interview first.** Read and run [`references/brainstorm_interview.md`](references/brainstorm_interview.md) — the open, back-and-forth interview that converges a tailored spec *with* the user. While running it, load [`references/search_param_mapping.md`](references/search_param_mapping.md) when authoring the answer→`sil_search`-param mapping section.
2. **Engine only after explicit endorsement.** Only after the user explicitly endorses the assembled draft, read and follow [`references/agent_creation_engine.md`](references/agent_creation_engine.md) — the ordered engine that persists the sil-wired agent. Running ANY engine step before that explicit endorsement is forbidden (the interview reference owns the endorsement gate).

Want a concrete walkthrough? [`examples/road_cycling_expert_walkthrough.md`](examples/road_cycling_expert_walkthrough.md) is an end-to-end worked example: a free-form request → interview convergence → assembled spec → created expert.
