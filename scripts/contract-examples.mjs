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

/** §3.N heading → the tools it defines, in the contract's own order. §3.5 defines two
 * under one heading, and its blocks name which one they are. */
const SECTIONS = [
  ["3.1", ["sil_whoami"]],
  ["3.2", ["shopping_user_read"]],
  ["3.3", ["shopping_user_remember"]],
  ["3.4", ["shopping_user_forget"]],
  ["3.5", ["shopping_brief_write", "shopping_brief_read"]],
  ["3.6", ["shopping_domain_search"]],
  ["3.7", ["shopping_domain_get"]],
  ["3.8", ["shopping_content"]],
  ["3.9", ["shopping_search"]],
  ["3.10", ["shopping_product_get"]],
  ["3.11", ["shopping_offers"]],
  ["3.12", ["shopping_seller_get"]],
];

const TOOLS = SECTIONS.flatMap(([, tools]) => tools);

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
 * A fence cut into the calls it prints, each under the tool it belongs to. A line that is
 * a bare tool name opens a call and names it (a block may print several calls); a fence that names nothing belongs to the section's READ, which is the only
 * one a bare `json` body can be.
 */
function chunks(block, tools) {
  const fallback = tools.length === 1 ? tools[0] : tools.find((t) => t.endsWith("_read"));
  if (fallback === undefined) throw new Error(`§ for ${tools.join(", ")} has no read`);
  const calls = [];
  for (const line of block.split("\n")) {
    const named = TOOLS.includes(line.trim());
    if (named || calls.length === 0) {
      calls.push({ tool: named ? line.trim() : fallback, lines: [] });
    }
    if (!named) calls[calls.length - 1].lines.push(line);
  }
  return calls.map((c) => ({ tool: c.tool, text: c.lines.join("\n") }));
}

/**
 * Every top-level `{…}` in a chunk, in order. A request and its reply share one block
 * either side of a `→`, so a chunk is scanned by brace depth rather than parsed whole —
 * which is also what keeps the `→` inside a `decision` sentence out of the way.
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
for (const [number, tools] of SECTIONS) {
  const bodies = {};
  for (const tool of tools) bodies[tool] = [];
  for (const block of fences(sectionBody(number))) {
    for (const chunk of chunks(block, tools)) bodies[chunk.tool].push(...objectsIn(chunk.text));
  }
  for (const tool of tools) {
    // A response states `status`; anything else beside it is the request. Only `ok` is an
    // artifact instance — the contract may print an `invalid_request` to show what the registry refuses.
    const responses = bodies[tool].filter((b) => b.status === "ok");
    const requests = bodies[tool].filter((b) => b.status === undefined);
    if (responses.length === 0) throw new Error(`§${number}: no example response for ${tool}`);
    examples[tool] = {
      response: responses[0],
      ...(responses.length > 1 ? { alternate: responses[1] } : {}),
      ...(requests.length > 0 ? { request: requests[0] } : {}),
    };
  }
}

writeFileSync(OUT, `${JSON.stringify(examples, null, 2)}\n`);
console.log(`wrote ${OUT}`);
for (const [tool, e] of Object.entries(examples)) {
  console.log(`  ${tool}: ${Object.keys(e).join(", ")}`);
}
