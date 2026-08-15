# Golden wire fixtures — the plugin's only honest link to `@sil/schemas`

Wire types are **mirrored, never imported** (no cross-repo dependency; `@ucp-js/sdk`
carries zero catalog types). That leaves nothing binding this plugin's mirrored types to
the bodies sil-services actually emits — except these files.

Both are copied from the sibling and **re-validated at authoring time** against the
committed JSON-schema artifacts under **Ajv 2020, strict mode** (the same compile the
sibling's own `response-schema-contract.unit.test.ts` performs). A hand-invented fixture
would omit exactly the fields that carry the honesty contract — `offers[].observed` is the
named one — and certify a wire that does not exist.

| file | source | provenance |
|---|---|---|
| `catalog-result-response.golden.json` | `sil-services` `dev` @ **`6a2b5ba`** — `services/sil-api/src/handlers/../__tests__/response-schema-contract.unit.test.ts`'s `SEARCH_RESPONSE`, the wire spec written as an instance | validates against `packages/schemas/schema/catalog-result-response.schema.json` |
| `catalog-stores-response.golden.json` | `sil-services` `dev` @ **`6a2b5ba`** — assembled to `packages/db/src/stores.ts#buildStore`'s emission (all three serviceability states, `policy_evidence` on the negative one only) | validates against `packages/schemas/schema/catalog-stores-response.schema.json` |

## What makes them load-bearing

`catalog-result-response.golden.json` exercises **both sides of every honesty rule that has
two**: a `set` value beside an `unset` one, `applied: true` beside `'partial'` beside
`false`, `observed: 'stored'` beside `'live'`, an absent `description`/`buy_url`/
`display_name` beside a present one, `maturity: 'catalog'` beside `'web'`. The three-state
veto is computable from it, so a projection that drops any input is caught.

`catalog-stores-response.golden.json` carries `serviceable` · `unknown` · `not_serviceable`
in one body — `unknown` is the state the whole product turns on, and it is the one a
filtering consumer would silently drop.

## When the sibling's contract moves

Re-copy from the sibling and re-validate; **never** hand-edit a golden to make a plugin
test pass. A golden edited to fit the code is the code certifying itself.
