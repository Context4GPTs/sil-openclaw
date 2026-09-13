# Where these sixteen files come from

Copied verbatim from `sil-services` `packages/schemas/schema/`, commit
`66b708aaefb600b7c8d1d24a07b5a393c8b106c8`. One request and one response artifact per
shopping tool; each is `JSON.stringify` of the TypeBox object the API serialises against.
`shopping_brief_compile` is local to the plugin, so its pair has no route behind it — the
request artifact is still the tool's `parameters`, and the response artifact is the shape
the tool answers and validates against before returning.

**Re-copy, never hand-edit.** A local edit is drift the moment the sibling moves, and the
plugin registers these bytes as each tool's `parameters` — an edited artifact is a
contract the API never agreed to.

```sh
cp <sil-services>/packages/schemas/schema/shopping-*.schema.json schema/
```

Byte-identity against the sibling is graded by sil-stage, not here.
