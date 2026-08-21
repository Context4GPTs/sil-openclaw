/**
 * INTEGRATION — the ONE-HOP store migration off the legacy `domains/<slug>/` layout
 * (card acceptance G6). Real filesystem, real store, driven through the registered
 * `sil_doc_*` tools — the migration runs on first TOUCH of the document surface, so
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
    const found = await call("sil_doc_find");
    expect(found["status"]).toBe("ok");

    // TRANSFORM, half 1 — each method becomes a `## Shopping` `### <domain>` section
    // on the shopper document, and the person's own sections survive beside it.
    const shopper = await call("sil_doc_read", { ref: "shopper" });
    expect(shopper["status"]).toBe("ok");
    const body = String(shopper["body"]);
    expect(body).toContain("## Shopping");
    expect(body).toMatch(/^### coffee$/m);
    expect(body).toMatch(/^### ski$/m);
    expect(body).toContain("Prefers last-year models");
    expect(body).toContain("Single-origin, medium roast");
    // The taste moved; the person did not get overwritten by it.
    expect(body).toContain("Buys once and keeps it");
    expect(body).toContain("Ships to Greece");
    expect((shopper["fields"] as Record<string, string>)["name"]).toBe("Ioannis");

    // TRANSFORM, half 2 — each PRD becomes a Brief with a ONE-ROW `## Items` table.
    // Not "a Brief exists": the row is the Brief's whole scope mechanism, and a PRD
    // that arrives with an empty table is a job the loop cannot fan out.
    const briefs = (found["briefs"] ?? []) as Array<Record<string, unknown>>;
    const migrated = (await call("sil_doc_find", { query: "boots" }))["briefs"] as Array<
      Record<string, unknown>
    >;
    expect(migrated).toHaveLength(1);
    expect(briefs.length).toBeGreaterThan(0); // guard-of-the-guard: the first touch DID list
    const items = migrated[0]!["items"] as Array<Record<string, string>>;
    expect(items).toHaveLength(1);
    expect(items[0]!["item"]).toBe("boots");
    const brief = await call("sil_doc_read", { ref: String(migrated[0]!["ref"]) });
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
      (await call("sil_doc_write", { ref: "brief:new-job", mode: "create", title: "New", body: "## Items\n" }))[
        "status"
      ],
    ).toBe("ok");
    expect(
      (await call("sil_doc_write", { ref: "shopper", mode: "replace", body: `${body}\n## Fit\n| a | b | c |\n` }))[
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
        await call("sil_doc_write", {
          ref: "shopper",
          mode: "create",
          name: "Ioannis",
          body: "## Who\nBuys once.\n\n## Shopping\n### ski\nPrefers last-year models.\n",
        })
      )["status"],
    ).toBe("ok");
    expect(
      (await call("sil_doc_write", { ref: "brief:chamonix", mode: "create", title: "Chamonix", body: "## Items\n" }))[
        "status"
      ],
    ).toBe("ok");

    const snapshot = tree().map((p) => {
      const abs = join(shopperDir(), p);
      return statSync(abs).isFile() ? `${p}:${readFileSync(abs, "utf8")}` : `${p}/`;
    });

    // Three more touches, one per remaining verb.
    await call("sil_doc_find");
    await call("sil_doc_read", { ref: "shopper" });
    await call("sil_doc_read", { ref: "brief:chamonix" });

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
        .mock.calls.filter(([marker]) => marker === "sil_doc_store_migrated"),
    ).toEqual([]);
  });
});
