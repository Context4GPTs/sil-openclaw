/**
 * INTEGRATION — repo scaffolding consistent with the klodi pattern
 * (tier: integration — stats the real filesystem tree and reads real
 * doc files; structural assertions over shipped artifacts).
 *
 * Covers the card's "Repo scaffolding consistent with the klodi
 * pattern" + the "add a tool" documentation criteria:
 *   - CLAUDE.md exists at the repo root;
 *   - docs/decisions/, docs/knowledge/, docs/product/ each exist with an
 *     INDEX.md (the established docs taxonomy);
 *   - the "how to add a tool" note (in CLAUDE.md and/or README.md)
 *     states the THREE required steps: register the tool in a group,
 *     wire the group into register(), and add the name to
 *     contracts.tools.
 *
 * The three-step assertion is adversarial about completeness: a note
 * that mentions registerTool but forgets the manifest step (the #1 way
 * "follow the pattern" silently breaks — architect Risk #3) FAILS here.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   CLAUDE.md exists; docs/{decisions,knowledge,product}/INDEX.md all
 *   exist; CLAUDE.md or README.md carries an "add a tool" section that
 *   names all three steps including `contracts.tools`.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

function readIfExists(rel: string): string | null {
  const path = join(REPO_ROOT, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

describe("repo scaffolding — top-level files", () => {
  it("has CLAUDE.md at the repo root", () => {
    expect(existsSync(join(REPO_ROOT, "CLAUDE.md"))).toBe(true);
  });

  it("has a README.md at the repo root", () => {
    expect(existsSync(join(REPO_ROOT, "README.md"))).toBe(true);
  });
});

describe("repo scaffolding — docs taxonomy (decisions/knowledge/product)", () => {
  for (const folder of ["decisions", "knowledge", "product"]) {
    it(`docs/${folder}/ exists as a directory`, () => {
      const dir = join(REPO_ROOT, "docs", folder);
      expect(existsSync(dir)).toBe(true);
      expect(statSync(dir).isDirectory()).toBe(true);
    });

    it(`docs/${folder}/INDEX.md exists`, () => {
      expect(existsSync(join(REPO_ROOT, "docs", folder, "INDEX.md"))).toBe(true);
    });
  }
});

describe('repo scaffolding — the "how to add a tool" note states all three steps', () => {
  // The note may live in CLAUDE.md or README.md (the card names both).
  // We concatenate whichever exist and assert the THREE steps appear
  // across the combined contributor surface.
  const claude = readIfExists("CLAUDE.md") ?? "";
  const readme = readIfExists("README.md") ?? "";
  const combined = `${claude}\n${readme}`;

  it("mentions step 1 — registering a tool via registerTool inside a group", () => {
    expect(combined).toMatch(/registerTool/);
  });

  it("mentions step 2 — wiring the group into register()", () => {
    // Accept `register(` or `register()` — the call that runs at load.
    expect(combined).toMatch(/register\s*\(/);
  });

  it("mentions step 3 — adding the name to contracts.tools (the drift-guard step)", () => {
    // This is the step a careless dev forgets; the note MUST state it,
    // because the manifest drift guard is what makes the pattern
    // self-enforcing only if the dev knows to update the manifest.
    expect(combined).toMatch(/contracts\.tools/);
  });

  it("frames it as an ordered, multi-step procedure (not a vague mention)", () => {
    // Adversarial: a single sentence that happens to contain the three
    // tokens is not a procedure. Require evidence of enumeration —
    // either numbered list markers or the word "step(s)" — somewhere
    // in the combined surface.
    const looksEnumerated =
      /\b(step|steps)\b/i.test(combined) ||
      /(^|\n)\s*(1\.|1\)|- )/.test(combined);
    expect(looksEnumerated).toBe(true);
  });
});
