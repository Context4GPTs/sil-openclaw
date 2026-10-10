# Where these twenty-six files come from

Copied verbatim from `sil-services` `packages/schemas/schema/`, commit
`5bf131db59714ec7f969446b8ccb33dc0924eab8`. One request and one response artifact per
`shopping_*` tool, plus `sil-whoami-*`; each is `JSON.stringify` of the TypeBox object the
API serialises against.

**Re-copy, never hand-edit.** A local edit is drift the moment the sibling moves, and the
plugin registers these bytes as each tool's `parameters` — an edited artifact is a
contract the API never agreed to.

```sh
S=<sil-services>/packages/schemas/schema; rm schema/*.schema.json \
  && cp $S/shopping-*.schema.json $S/sil-whoami-*.schema.json schema/ \
  && node scripts/contract-examples.mjs $S/agent-contract.md
```

Byte-identity against the sibling is graded by sil-stage, not here.
