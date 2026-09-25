/**
 * The committed request artifacts under `schema/`, as the plugin uses them: a tool's
 * `parameters`. Never a hand-mirror — the bytes are the contract, and a second copy of a
 * shape is the first to drift from it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TSchema } from "typebox";

/** The repo root's `schema/`, resolved from both `src/lib/` and `dist/lib/`. It
 * ships via `package.json#files`. */
const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema");

/**
 * The tool's request artifact as the host's `parameters`, with the three FILE annotations
 * stripped: `$schema`, `$id` and `title` describe the file rather than the value, and a
 * `$id` on a tool input invites a host to resolve a URL nobody serves. A missing or
 * shapeless artifact throws at the call site — a broken build, not a runtime state to
 * model.
 */
export function requestSchema(tool: string): TSchema {
  const stem = tool.slice("shopping_".length).replaceAll("_", "-");
  const path = join(SCHEMA_DIR, `shopping-${stem}-request.schema.json`);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: request artifact is not a JSON Schema object`);
  }
  const schema: Record<string, unknown> = { ...parsed };
  for (const annotation of ["$schema", "$id", "title"]) delete schema[annotation];
  return schema as TSchema;
}
