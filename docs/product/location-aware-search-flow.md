---
id: location-aware-search-flow
title: Location-aware search — empty ship_to ⇒ the buyer's registered default address, resolved server-side (the agent must NOT round-trip sil_whoami)
tags: [catalog, search, ship-to, serviceability, localization, agent-steering, cross-sibling, epic, flow]
card: add-ship-to-filter-args-to-the-sil-search-tool
commit: f99b2d8
updated_at: 2026-06-11
updated_by_card: add-ship-to-filter-args-to-the-sil-search-tool
---

When the agent leaves `sil_search`'s `ship_to` **empty**, sil-api resolves the buyer's **registered default address server-side** and localizes results to it — so the agent must **never** call `sil_whoami` to fetch the address and resubmit it; doing so wastes a turn and yields the identical result. `ship_to` is supplied **only to override** — to ship somewhere other than the registered default. This is the headline product behavior of the `location-aware-search-2026-06` epic, and the `sil_search` tool **description** is its only control surface (an LLM reads the description to decide whether to round-trip identity first).

## The contract the description encodes (and a test pins)

The description string and the `ship_to` per-field description both state, verbatim and load-bearing — guarded by description-string unit assertions so a future edit can't silently drop them:

1. **Empty `ship_to` = "ship to me."** Absent ⇒ sil-api uses the user's REGISTERED DEFAULT ADDRESS (resolved server-side); the agent gets localized/serviceable results without supplying anything.
2. **Do NOT call `sil_whoami` (or any identity read) to populate `ship_to`.** The redundant round-trip is named as the anti-pattern to avoid — fetching the address to resubmit it produces the same result as omitting it.
3. **`ship_to` is an OVERRIDE**, not a required input — set it only for a destination *different* from the registered default ("ship it to my office in Berlin").

The other three filters are plain optional refinements, each omittable, none implying a prior tool call: `ships_from` (merchant origin country), `condition` (`["new"]`/`["secondhand"]`), `available` (server returns sale-ready only by default; set `false` to include out-of-stock).

## What the plugin does and does NOT do (the lane boundary)

The plugin's entire job is **(a) forward-or-omit** — forward each of the four filters only when the agent supplies it, omit when absent (no client-injected defaults) — and **(b) the steering description**. It performs **NO** address fetching, NO identity read, and NO default resolution: it never reads `sil_whoami`, never inspects stored identity, never synthesizes a `ship_to`. An omitted `ship_to` is sent to sil-api as *nothing* (no `filters.ships_to`); the server fills the default. (Rejected alternative: the plugin resolving the default itself just re-creates the `sil_whoami` round-trip agent→plugin and adds a network hop to every search — the epic's thesis is that **sil-api owns this**.)

## Cross-sibling: the end-to-end promise spans three repos (this one ships first)

The description **promises** server-side default resolution, but that resolution lives in a *different* repo. The epic `location-aware-search-2026-06` is three siblings, sequenced:

| Sibling | Repo | Role |
|---|---|---|
| `add-ship-to-filter-args-to-the-sil-search-tool` (this) | sil-openclaw | The agent-facing args + the steering description. Forwards-or-omits only. |
| `attach-buyer-ship-to-context-server-side-in-sil-ap` | sil-services | Resolves the empty-`ship_to` default — reads the buyer's DB default and attaches `ships_to` + localization `context` server-side. |
| `live-catalog-serviceability-localization-eval` | sil-stage | The live end-to-end eval that verifies the promise against a real sil-api. |

**Two facts a future agent on any sibling needs:**
- **Until the sil-services sibling merges, an omitted `ship_to` localizes to nothing** (un-localized search), not the registered default — so the description's promise is only end-to-end *true* once that sibling ships. The plugin's own contract (forward-or-omit) is correct independently and can merge ahead; the wire mechanics + the fail-green hazard of the shared key are in [[sil-api-catalog-contract]].
- **The wire key is `filters.ships_to` (plural object `{ country, region?, postal_code? }`), NOT request-level `context`.** `context` is the *server's* to fill from the DB default — the plugin emitting it would collide with the sibling's resolution and would require the plugin to hold the address it refuses to fetch. Both siblings must keep `filters.ships_to` byte-identical; see the rename + open-schema gotcha in [[sil-api-catalog-contract]].
