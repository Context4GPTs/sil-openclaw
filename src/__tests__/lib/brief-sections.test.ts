/**
 * UNIT — a Brief's own sections, as the store reads them out of one body: the two spec
 * tables and each item's `search:` line.
 *
 * These parsers feed a search body, so every bar here is about a fault that would reach
 * the wire looking healthy — a preference sent ahead of a hard row, a value read as a
 * unit, one item's words searched under another item's domain.
 */

import { describe, it, expect } from "vitest";

import { itemSearchLine, parseSpecRows } from "../../lib/doc-store.js";

/** One Brief, hard-wrapped and two-item, as beats 1 to 3 leave it. */
const BRIEF = [
  "## Items",
  "",
  "| item | domain | status |",
  "|---|---|---|",
  "| ski boots | product.sports.winter.ski.boots | open |",
  "| gloves | product.sports.winter.ski.gloves | open |",
  "| helmet | product.sports.winter.ski.helmets | open |",
  "",
  "### ski boots",
  "ski boots for the upcoming season, size 27.5, advanced skier, up to 300",
  "euros; GripWalk soles",
  "applies: mondo_size, flex_index, price",
  "search: ski boots 27.5 flex 110",
  "",
  "### gloves",
  "warm gloves, nothing bulky",
  "",
  "### helmet",
  "a ski helmet for the same trip, it has to work with my goggles",
  "- **search:** ski helmet 58 cm",
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

/** A one-item Brief carrying exactly these subsection lines. */
const briefWith = (...subsection: string[]): string =>
  [
    "## Items",
    "",
    "| item | domain | status |",
    "|---|---|---|",
    "| boots | product.sports.winter.ski.boots | open |",
    "",
    "### boots",
    ...subsection,
    "",
  ].join("\n");

/** The label as models actually format it, each with the words it must yield. */
const MARKUP: [string, string][] = [
  ["search: ski boots 27.5", "ski boots 27.5"],
  ["- **search:** ski boots 27.5", "ski boots 27.5"],
  ["`search:` ski boots 27.5", "ski boots 27.5"],
  ["`search: ski boots 27.5`", "ski boots 27.5"],
  ["**search: ski boots 27.5**", "ski boots 27.5"],
  ["- **search:** **ski boots 27.5**", "ski boots 27.5"],
];

/** Lines that are NOT the label, and each of which a Brief can legitimately carry. */
const NOT_THE_LABEL = [
  "research: how ski boots are bought",
  "searches: two so far",
  "applies: mondo_size, flex_index",
  "I will search: for boots",
  "# search: ski boots 27.5",
];

describe("itemSearchLine — the shopping words one item is searched by", () => {
  it("returns that item's `search:` line, never the sentence or the `applies:` line beside it", () => {
    // The boots' subsection carries all three, in that order. A reader that took the
    // first line, or any `<word>:` line, would send the buyer's sentence or a list of
    // key names — the two bodies the index answers nothing for.
    expect(itemSearchLine(BRIEF, "ski boots")).toBe("ski boots 27.5 flex 110");
  });

  it("reads the label through the markup a model wraps it in — and only that label", () => {
    // Measured before this: a backticked label or value read as absent (a refused
    // compile), and a bolded one put `**` on the wire, where it is a token no listing
    // can match. The near-misses have to stay near-misses — `research:` is a line the
    // buyer's own prose can begin with.
    expect(MARKUP.map(([line]) => itemSearchLine(briefWith(line), "boots"))).toEqual(
      MARKUP.map(([, words]) => words),
    );
    for (const line of NOT_THE_LABEL) {
      expect({ line, read: itemSearchLine(briefWith(line), "boots") }).toEqual({ line, read: "" });
    }
  });

  it("folds a hard-wrapped line, and stops at the blank line or the next label", () => {
    // The Brief is hard-wrapped at ~88 columns and a query on the wire is ONE line, so a
    // continuation left behind silently searches half the words the guide settled.
    expect(
      itemSearchLine(
        briefWith(
          "search: ski boots 27.5 flex 110 last 100 mm",
          "gripwalk soles 2026",
          "applies: mondo_size, flex_index",
        ),
        "boots",
      ),
    ).toBe("ski boots 27.5 flex 110 last 100 mm gripwalk soles 2026");
    expect(itemSearchLine(briefWith("search: ski boots 27.5", "", "an aside"), "boots")).toBe(
      "ski boots 27.5",
    );
    // …and a line that reads as prose or a table stops it with no blank line at all. Beat
    // 3 puts the line last, but a sentence folded in is the body the index answers
    // nothing for, so the reader may not depend on that.
    expect(
      itemSearchLine(
        briefWith("search: ski boots 27.5 flex 110", "ski boots for the season, 300 euros"),
        "boots",
      ),
    ).toBe("ski boots 27.5 flex 110");
    expect(
      itemSearchLine(briefWith("search: ski boots 27.5", "| colour | no preference |"), "boots"),
    ).toBe("ski boots 27.5");
  });

  it("the LAST `search:` line wins — a correction appended below the stale one", () => {
    // Beat 4 rewrites the line when an answer settles a picking number. A model that
    // appends the correction instead would otherwise search the size it just replaced.
    expect(
      itemSearchLine(
        briefWith("search: ski boots 26.5 flex 90", "search: ski boots 27.5 flex 110"),
        "boots",
      ),
    ).toBe("ski boots 27.5 flex 110");
  });

  it("stops at the next item's heading — an item beat 3 has not reached yet is empty", () => {
    // `gloves` has a subsection and no `search:` line; the helmet's sits four lines
    // below it. Run on, the gloves would be searched with the helmet's words under the
    // gloves' domain, and the answer would read as a perfectly ordinary miss.
    expect(itemSearchLine(BRIEF, "gloves")).toBe("");
    expect(itemSearchLine(BRIEF, "no such item")).toBe("");
    // Guard-of-the-guard: the line the gloves must not reach is really there.
    expect(itemSearchLine(BRIEF, "helmet")).toBe("ski helmet 58 cm");
  });

  it("matches the item label, not its case", () => {
    expect(itemSearchLine(BRIEF, "Ski Boots")).toBe(itemSearchLine(BRIEF, "ski boots"));
  });
});
