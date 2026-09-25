# Where these twenty-two files come from

Copied verbatim from `sil-services` `packages/schemas/schema/`, commit
`3781741d0470ef136ba9363b8e26e70aa8bb99b9`. One request and one response artifact per
shopping tool; each is `JSON.stringify` of the TypeBox object the API serialises against.

**Re-copy, never hand-edit.** A local edit is drift the moment the sibling moves, and the
plugin registers these bytes as each tool's `parameters` — an edited artifact is a
contract the API never agreed to.

```sh
cp <sil-services>/packages/schemas/schema/shopping-*.schema.json schema/
```

Byte-identity against the sibling is graded by sil-stage, not here.
