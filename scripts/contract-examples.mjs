#!/usr/bin/env node
/**
 * Extract the agent contract's own worked examples into
 * `src/__tests__/fixtures/contract-examples.json`, so the pass-through suite pins the
 * bodies the founder signed rather than bodies a test author invented.
 *
 * Run by hand against a sil-services checkout; the OUTPUT is committed, so the sibling
 * is not a test-time dependency.
 *
 *   node scripts/contract-examples.mjs <sil-services>/packages/schemas/schema/agent-contract.md
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "__tests__",
  "fixtures",
  "contract-examples.json",
);

/** §3.N heading → the key the fixture is filed under, in the contract's own order. */
const SECTIONS = [
  ["3.1", "shopping_domain_search"],
  ["3.2", "shopping_domain_get"],
  ["3.3", "shopping_domain_create"],
  ["3.4", "shopping_search"],
  ["3.5", "shopping_product_get"],
  ["3.6", "shopping_offers"],
  ["3.7", "shopping_seller_get"],
];

const source = process.argv[2];
if (source === undefined) {
  console.error("usage: contract-examples.mjs <path to agent-contract.md>");
  process.exit(2);
}
const contract = readFileSync(source, "utf8");

/** The prose between `### <n>` and the next `###`, headings excluded. */
function sectionBody(number) {
  const start = contract.indexOf(`### ${number} `);
  if (start < 0) throw new Error(`agent-contract.md: no § ${number}`);
  const rest = contract.slice(start);
  const end = rest.indexOf("\n### ", 1);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Every fenced block's contents, fence language ignored. */
function fences(body) {
  return [...body.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/**
 * Every top-level `{…}` in a fence, in order. §3.3 puts a request and its reply in one
 * block separated by `→`, so a block is scanned by brace depth rather than parsed whole.
 */
function objectsIn(text) {
  const found = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) found.push(JSON.parse(text.slice(start, i + 1)));
    }
  }
  return found;
}

const examples = {};
for (const [number, tool] of SECTIONS) {
  const bodies = fences(sectionBody(number)).flatMap(objectsIn);
  // A response states `status`; anything else in these sections is the request beside it.
  const responses = bodies.filter((b) => b.status === "ok");
  const requests = bodies.filter((b) => b.status === undefined);
  if (responses.length === 0) throw new Error(`§${number}: no example response`);
  examples[tool] = {
    response: responses[0],
    ...(responses.length > 1 ? { alternate: responses[1] } : {}),
    ...(requests.length > 0 ? { request: requests[0] } : {}),
  };
}

writeFileSync(OUT, `${JSON.stringify(examples, null, 2)}\n`);
console.log(`wrote ${OUT}`);
for (const [tool, e] of Object.entries(examples)) {
  console.log(`  ${tool}: ${Object.keys(e).join(", ")}`);
}
