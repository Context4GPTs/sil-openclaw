/**
 * INTEGRATION — the ONE-HOP store migration off the legacy `domains/<slug>/` layout
 * (card acceptance G6). Real filesystem, real store, driven through the registered
 * `shopping_doc_*` tools — the migration runs on first TOUCH of the document surface, so
 * driving the store function directly would test a path production never takes.
 *
 * WHY THIS TEST EXISTS AT ALL. `0.3.7 → 0.4.0` changed the store's shape and shipped
 * no transform: every live store read `unreadable` and the shopper silently vanished.
 * The standing rule since (`CLAUDE.md`, "Changing the store format") is that a format
 * change ships its migration in the same PR — and a migration nobody ran against a
 * real legacy tree is the same defect one commit later.
 *
 * ONE HOP OFF ONE BASELINE: probe, transform, verify. No registry, no version marker,
 * no ordering — PR #63 built that machinery for a hop that was already dead and was
 * closed for it. The absence of the legacy tree IS the completion marker, which makes
 * the no-op path (below) load-bearing rather than an optimisation.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken one to match the transform.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { registerDocTools } from "../tools/doc.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

let dataDir: string;
let priorSilDataDir: string | undefined;
let api: MockPluginAPI;

function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error(`tool result has no text payload: ${String(text)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

const call = async (
  tool: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => payloadOf(await getTool(api, tool).execute("c", params));

const shopperDir = (): string => join(dataDir, "shopper");
const legacyDir = (slug: string): string => join(shopperDir(), "domains", slug);

/** The lines under one H2, up to the next H2 — the SCOPE the "already carried over"
 * probe must respect. A `### <slug>` heading somewhere else in the person's document
 * is not evidence that this method was migrated. Absent heading ⇒ `""`, which fails
 * every positive assertion below (the safe direction). */
function section(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** Every path under the shopper root, relative and sorted — the whole-tree assertion
 * the "no code path afterwards creates a legacy path" clause needs. */
const tree = (): string[] =>
  existsSync(shopperDir())
    ? (readdirSync(shopperDir(), { recursive: true }) as string[]).sort()
    : [];

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, contents, { mode: 0o600 });
}

const artefact = (fields: Record<string, string>, body: string): string =>
  `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${body}`;

/** The 0.4.x store shape, exactly as it sits on a live disk today: the shopper's
 * `user_spec.md`, one domain pack per niche, intent-keyed PRDs under it, and the
 * `assets/` bytes `sil_learn attach-asset` wrote. */
const ASSET_BYTES = "PNG\r\n\n-- pretend image bytes --";
function seedLegacy(): void {
  write(
    join(shopperDir(), "user_spec.md"),
    artefact({ name: "Ioannis" }, "## Who\nBuys once and keeps it.\n\n## Constraints\nShips to Greece.\n"),
  );
  write(
    join(legacyDir("ski"), "method.md"),
    artefact({ domain: "ski", name: "Ski", updated_at: "2026-01-01T00:00:00.000Z" },
      "## Taste & stance\nPrefers last-year models. Never a narrow last.\n"),
  );
  write(
    join(legacyDir("ski"), "prds", "boots-slope.md"),
    artefact(
      { key: "boots-slope", product: "boots", intent: "slope", title: "Slope boots",
        domain: "ski", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-02T00:00:00.000Z" },
      "Boots that won't blister. Wide at the ball.\n",
    ),
  );
  write(
    join(legacyDir("coffee"), "method.md"),
    artefact({ domain: "coffee", name: "Coffee", updated_at: "2026-01-01T00:00:00.000Z" },
      "## Taste & stance\nSingle-origin, medium roast.\n"),
  );
  write(join(legacyDir("coffee"), "assets", "a1b2c3.png"), ASSET_BYTES);
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-doc-migration-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  api = createMockPluginApi();
  registerDocTools(api);
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("G6 — the one-hop migration off `domains/<slug>/{method.md, prds/*.md}`", () => {
  it("G6 — a legacy store migrates in ONE touch: methods → `## Shopping ### <domain>`, PRDs → one-row-`## Items` Briefs, `assets/` bytes untouched", async () => {
    seedLegacy();

    // FIRST TOUCH — any doc verb. The migration is not a separate command an operator
    // has to know about; a store that only ever gets read must still come across.
    const found = await call("shopping_doc_find");
    expect(found["status"]).toBe("ok");

    // TRANSFORM, half 1 — each method becomes a `## Shopping` `### <domain>` section
    // on the shopper document, and the person's own sections survive beside it.
    const shopper = await call("shopping_doc_read", { ref: "shopper" });
    expect(shopper["status"]).toBe("ok");
    const body = String(shopper["body"]);
    // SCOPED: G6 puts each method UNDER `## Shopping`, so a heading loose in the
    // document is not the claim. This is also what pins the heading demotion — an
    // undemoted `##` inside a method body closes the very section it was put in.
    const shopping = section(body, "## Shopping");
    expect(shopping).toMatch(/^### coffee$/m);
    expect(shopping).toMatch(/^### ski$/m);
    expect(shopping).toContain("Prefers last-year models");
    expect(shopping).toContain("Single-origin, medium roast");
    // The taste moved; the person did not get overwritten by it.
    expect(body).toContain("Buys once and keeps it");
    expect(body).toContain("Ships to Greece");
    expect((shopper["fields"] as Record<string, string>)["name"]).toBe("Ioannis");

    // TRANSFORM, half 2 — each PRD becomes a Brief with a ONE-ROW `## Items` table.
    // Not "a Brief exists": the row is the Brief's whole scope mechanism, and a PRD
    // that arrives with an empty table is a job the loop cannot fan out.
    const briefs = (found["briefs"] ?? []) as Array<Record<string, unknown>>;
    const migrated = (await call("shopping_doc_find", { query: "boots" }))["briefs"] as Array<
      Record<string, unknown>
    >;
    expect(migrated).toHaveLength(1);
    expect(briefs.length).toBeGreaterThan(0); // guard-of-the-guard: the first touch DID list
    const items = migrated[0]!["items"] as Array<Record<string, string>>;
    expect(items).toHaveLength(1);
    expect(items[0]!["item"]).toBe("boots");
    const brief = await call("shopping_doc_read", { ref: String(migrated[0]!["ref"]) });
    expect(String(brief["body"])).toContain("Boots that won't blister");

    // VERIFY + drop — the legacy source is gone only because its replacement read
    // back. Both halves matter: a transform that leaves the old tree runs forever,
    // and one that deletes first loses the buyer's words on any write failure.
    expect(existsSync(join(legacyDir("ski"), "method.md"))).toBe(false);
    expect(existsSync(join(legacyDir("ski"), "prds", "boots-slope.md"))).toBe(false);
    expect(existsSync(join(legacyDir("coffee"), "method.md"))).toBe(false);

    // ASSETS ARE NEVER DELETED. They have no home in the flat store and no other
    // copy anywhere — so the directory holding them survives, bytes intact, and the
    // empty ski tree is pruned around it.
    expect(readFileSync(join(legacyDir("coffee"), "assets", "a1b2c3.png"), "utf8")).toBe(ASSET_BYTES);
    expect(existsSync(legacyDir("ski"))).toBe(false);

    // …and NOTHING afterwards re-creates a legacy path. A normal write cycle over the
    // migrated store must add no `method.md`, no `prds/`, no new `domains/` leaf.
    expect(
      (await call("shopping_doc_write", { ref: "brief:new-job", mode: "create", title: "New", body: "## Items\n" }))[
        "status"
      ],
    ).toBe("ok");
    expect(
      (await call("shopping_doc_write", { ref: "shopper", mode: "replace", body: `${body}\n## Fit\n| a | b | c |\n` }))[
        "status"
      ],
    ).toBe("ok");
    const after = tree();
    expect(after.filter((p) => /(^|\/)method\.md$/.test(p))).toEqual([]);
    expect(after.filter((p) => /(^|\/)prds(\/|$)/.test(p))).toEqual([]);
    // The only surviving `domains/` entries are the asset container and its bytes.
    expect(after.filter((p) => p.startsWith("domains")).sort()).toEqual([
      "domains",
      "domains/coffee",
      "domains/coffee/assets",
      "domains/coffee/assets/a1b2c3.png",
    ]);
  });

  it("G6 — a store ALREADY in the flat layout is not touched: no rewrite, no new document, no marker", async () => {
    // The probe half, and the one with teeth. The migration runs on EVERY doc call,
    // so a transform that cannot tell "already migrated" from "legacy" rewrites the
    // shopper document on every read — churning `updated_at`, re-appending sections,
    // and eventually duplicating the person. The absence of the legacy tree is the
    // only completion marker there is, so this is what proves it works.
    expect(
      (
        await call("shopping_doc_write", {
          ref: "shopper",
          mode: "create",
          name: "Ioannis",
          body: "## Who\nBuys once.\n\n## Shopping\n### ski\nPrefers last-year models.\n",
        })
      )["status"],
    ).toBe("ok");
    expect(
      (await call("shopping_doc_write", { ref: "brief:chamonix", mode: "create", title: "Chamonix", body: "## Items\n" }))[
        "status"
      ],
    ).toBe("ok");

    const snapshot = tree().map((p) => {
      const abs = join(shopperDir(), p);
      return statSync(abs).isFile() ? `${p}:${readFileSync(abs, "utf8")}` : `${p}/`;
    });

    // Three more touches, one per remaining verb.
    await call("shopping_doc_find");
    await call("shopping_doc_read", { ref: "shopper" });
    await call("shopping_doc_read", { ref: "brief:chamonix" });

    // Byte-identical: not one document rewritten, none added, none removed.
    expect(
      tree().map((p) => {
        const abs = join(shopperDir(), p);
        return statSync(abs).isFile() ? `${p}:${readFileSync(abs, "utf8")}` : `${p}/`;
      }),
    ).toEqual(snapshot);
    // …and the migration announced nothing, because it did nothing.
    expect(
      vi
        .mocked(api.logger.info)
        .mock.calls.filter(([marker]) => marker === "shopping_doc_store_migrated"),
    ).toEqual([]);
  });

  // =========================================================================
  // The VERIFY, four ways. A migration's verify must prove THE UNIT landed —
  // not that the destination file re-parses. `migrateMethods` folds N methods
  // into ONE `user_spec.md`, so "it still parses" is true even when this
  // method's section is nowhere in it and the source is dropped anyway.
  // Review round 1, P1: reproduced as unrecoverable loss under `failed: []`.
  // =========================================================================

  it("G6 — a `### <slug>` heading OUTSIDE `## Shopping` is not proof of migration: the taste is carried, and only then is the source dropped", async () => {
    // The buyer's own document already says `### ski` — under `## Fit`, about their
    // feet. A whole-body scan reads that as "already carried over", skips the
    // transform, and deletes `method.md`: the taste is gone, and the summary says
    // it succeeded. That is the `0.3.7 → 0.4.0` class this migration exists to stop.
    write(
      join(shopperDir(), "user_spec.md"),
      artefact(
        { name: "Ioannis" },
        "## Who\nBuys once and keeps it.\n\n## Fit\n### ski\nNarrow heel, 27.5 Mondo.\n",
      ),
    );
    write(
      join(legacyDir("ski"), "method.md"),
      artefact({ domain: "ski", name: "Ski" }, "Prefers last-year models. Never a narrow last.\n"),
    );

    expect((await call("shopping_doc_find"))["status"]).toBe("ok");

    const body = String((await call("shopping_doc_read", { ref: "shopper" }))["body"]);
    // The section landed where G6 puts it — scoped, because placement is the claim.
    expect(section(body, "## Shopping")).toMatch(/^### ski$/m);
    // …carrying the taste. Unscoped: this one is the data-loss assertion.
    expect(body).toContain("Never a narrow last");
    // …and the buyer's own `### ski` is still under `## Fit`, untouched. Also the
    // guard-of-the-guard: it proves the two scopes above are genuinely distinct.
    expect(section(body, "## Fit")).toMatch(/^### ski$/m);
  });

  it("G6 — a `### <slug>` heading under `## Shopping` carrying DIFFERENT words is not this method: the probe compares the section, not the heading", async () => {
    // Beat 7 writes `## Shopping ### <domain>` sections itself, so a store can hold the
    // buyer's own `### ski` AND a pre-0.5 `method.md` for the same niche. A probe that
    // matches on the heading alone calls that "already carried over" and deletes the
    // source — the same unrecoverable loss as above, one level in.
    write(
      join(shopperDir(), "user_spec.md"),
      artefact(
        { name: "Ioannis" },
        "## Who\nBuys once.\n\n## Shopping\n### ski\nWhatever the shop recommends.\n",
      ),
    );
    write(
      join(legacyDir("ski"), "method.md"),
      artefact({ domain: "ski", name: "Ski" }, "Prefers last-year models. Never a narrow last.\n"),
    );

    expect((await call("shopping_doc_find"))["status"]).toBe("ok");

    const shopping = section(String((await call("shopping_doc_read", { ref: "shopper" }))["body"]), "## Shopping");
    expect(shopping).toContain("Never a narrow last"); // the legacy taste came across
    expect(shopping).toContain("Whatever the shop recommends"); // …beside the buyer's own
  });

  it("G6 — a legacy directory name carrying a regex metacharacter migrates through a structural probe, and never throws across the tool boundary", async () => {
    // A slug interpolated into `new RegExp(...)` is a SyntaxError waiting on a live
    // disk: `foo(bar` makes every `shopping_doc_*` call throw for that store, forever, against
    // `doc-store.ts`'s standing invariant that the store never throws across the tool
    // boundary. A line-equality probe cannot throw and needs no escaping.
    write(join(shopperDir(), "user_spec.md"), artefact({ name: "Ioannis" }, "## Who\nBuys once.\n"));
    write(
      join(legacyDir("foo(bar"), "method.md"),
      artefact({ domain: "foo(bar" }, "Only the wide last fits.\n"),
    );

    expect((await call("shopping_doc_find"))["status"]).toBe("ok");

    const body = String((await call("shopping_doc_read", { ref: "shopper" }))["body"]);
    expect(section(body, "## Shopping")).toMatch(/^### foo\(bar$/m);
    expect(body).toContain("Only the wide last fits");
  });

  it("G6 — a RESUMED migration carries a section once: `### ski` already under `## Shopping` with the source still on disk is recognised, not appended twice", async () => {
    // The other side of the probe, and what an over-correction breaks. The run that
    // wrote the section but died before the unlink leaves exactly this state; a
    // transform that stopped probing would stack a second `### ski` on the person's
    // document — the contradicting-row failure the whole write model exists to stop.
    write(
      join(shopperDir(), "user_spec.md"),
      artefact({ name: "Ioannis" }, "## Who\nBuys once.\n\n## Shopping\n### ski\nPrefers last-year models.\n"),
    );
    write(
      join(legacyDir("ski"), "method.md"),
      artefact({ domain: "ski", name: "Ski" }, "Prefers last-year models.\n"),
    );

    expect((await call("shopping_doc_find"))["status"]).toBe("ok");

    const body = String((await call("shopping_doc_read", { ref: "shopper" }))["body"]);
    expect(body.split(/\r?\n/).filter((l) => l.trim() === "### ski")).toHaveLength(1);
    // …and the hop still COMPLETES: recognising the section is not a reason to leave
    // the legacy tree behind, which would re-run the migration on every call forever.
    expect(existsSync(join(legacyDir("ski"), "method.md"))).toBe(false);
  });
});
