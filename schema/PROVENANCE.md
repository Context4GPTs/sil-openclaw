# Where these fourteen files come from

Copied verbatim from `sil-services` `packages/schemas/schema/`, commit
`1d6c3b0d59f0c49e809d5ca6b10ccc727316cd19`. One request and one response artifact per
shopping tool; each is `JSON.stringify` of the TypeBox object the API serialises against.

**Re-copy, never hand-edit.** A local edit is drift the moment the sibling moves, and the
plugin registers these bytes as each tool's `parameters` — an edited artifact is a
contract the API never agreed to.

```sh
cp <sil-services>/packages/schemas/schema/shopping-*.schema.json schema/
```

Byte-identity against the sibling is graded by sil-stage, not here.
