/**
 * UNIT — a Brief's own sections, as the store reads them out of one body: the two spec
 * tables and each item's prose subsection.
 *
 * These parsers feed a search body, so every bar here is about a fault that would reach
 * the wire looking healthy — a preference sent ahead of a hard row, a value read as a
 * unit, one item's words searched under another item's domain.
 */

import { describe, it, expect } from "vitest";

import { itemProse, parseSpecRows } from "../../lib/doc-store.js";

/** One Brief, hard-wrapped and two-item, as beats 1 to 3 leave it. */
const BRIEF = [
  "## Items",
  "",
  "| item | domain | status |",
  "|---|---|---|",
  "| ski boots | product.sports.winter.ski.boots | open |",
  "| helmet | product.sports.winter.ski.helmets | open |",
  "",
  "### ski boots",
  "ski boots for the upcoming season, size 27.5, advanced skier, up to 300",
  "euros; GripWalk soles",
  "",
  "### helmet",
  "a ski helmet for the same trip, it has to work with my goggles",
  "",
  "## Hard constraints",
  "",
  "| domain | key | op | value | unit |",
  "|---|---|---|---|---|",
  "| product.sports.winter.ski.boots | mondo_size | eq | 27.5 | cm |",
  "| product | price | lte | 300 | EUR |",
  "| seller | return_window_days | gte | 14 |",
  "",
  "## Preferences",
  "",
  "| domain | key | op | value | unit |",
  "|---|---|---|---|---|",
  "| product.sports.winter.ski.boots | brand | in | Atomic, Salomon | |",
  "",
  "## Notes / open",
  "",
  "| dimension | why it is open |",
].join("\n");

describe("parseSpecRows — the two tables, in the order a search sends them", () => {
  it("reads hard rows first, then preferences, each in document order", () => {
    // The section IS the hardness, and the order IS the ask: a preference compiled ahead
    // of a hard row changes what sil is asked to meet first, and nothing downstream can
    // tell that the Brief said otherwise.
    expect(parseSpecRows(BRIEF).map((r) => [r.key, r.hard])).toEqual([
      ["mondo_size", true],
      ["price", true],
      ["return_window_days", true],
      ["brand", false],
    ]);
  });

  it("a row short of its unit cell reads as an empty unit, never a shifted one", () => {
    // The seller row above omits the trailing `|  |`. Shifted, its value would arrive as
    // its unit — a currency of "14" on a row sil would then refuse for the wrong reason.
    expect(parseSpecRows(BRIEF).find((r) => r.key === "return_window_days")).toEqual({
      domain: "seller",
      key: "return_window_days",
      op: "gte",
      value: "14",
      unit: "",
      hard: true,
    });
  });

  it("neither the header nor the `---` separator is a row", () => {
    // Both are written by every model that writes a markdown table. Read as data they
    // become a spec row keyed `key`, which no registry holds and no search can answer.
    expect(parseSpecRows(BRIEF).map((r) => r.key)).not.toContain("key");
    expect(parseSpecRows(BRIEF).every((r) => !/^:?-{2,}:?$/.test(r.domain))).toBe(true);
  });

  it("a Brief with neither table has no rows, rather than a row of empties", () => {
    expect(parseSpecRows("## Items\n\n### boots\nBoots.\n")).toEqual([]);
  });
});

describe("itemProse — one item's own words", () => {
  it("returns that item's subsection only, stopping at the next item's heading", () => {
    // Prose that ran on would search the helmet's words under the boots' domain, and the
    // answer would look like a perfectly ordinary miss.
    expect(itemProse(BRIEF, "ski boots")).toBe(
      "ski boots for the upcoming season, size 27.5, advanced skier, up to 300\neuros; GripWalk soles",
    );
    expect(itemProse(BRIEF, "helmet")).toBe(
      "a ski helmet for the same trip, it has to work with my goggles",
    );
  });

  it("is empty for an item with no subsection — never the next item's prose", () => {
    // The caller refuses on empty; falling through to the following section would send
    // the buying guide, or another item's words, as this item's query.
    expect(itemProse(BRIEF, "gloves")).toBe("");
  });

  it("matches the item label, not its case", () => {
    expect(itemProse(BRIEF, "Ski Boots")).toBe(itemProse(BRIEF, "ski boots"));
  });
});
