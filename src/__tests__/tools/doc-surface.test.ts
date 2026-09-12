/**
 * UNIT — the shopper's DOCUMENT surface, driven end-to-end at the registered-tool
 * boundary (tier: unit, mock api + temp `$SIL_DATA_DIR`, no network, no host).
 *
 * Card acceptance G2–G5. Replaces `tools/profile-sds.test.ts`, deleted with the five
 * profile verbs it covered: this card retires `sil_learn` / `sil_profile_*` outright
 * (founder, 2026-08-21 — no shim, no side-by-side), so its coverage is retired with
 * them rather than ported. What survives is the harness shape, which was right.
 *
 * The surface is FOUR operations over ONE ref scheme (`shopper` | `brief:<slug>`):
 *   shopping_doc_find    coordinates only — bodies come from shopping_doc_read
 *   shopping_doc_read    one whole body; unreadable is never re-minted over
 *   shopping_doc_write   the WHOLE reconciled markdown; create/replace, both fail-closed
 *   shopping_doc_remove  one document, never a cascade
 *
 * Nothing is stubbed but the registration-capture api: these tools are LOCAL (no
 * bearer, no network), so a double would only be testing itself.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken one to match the store.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { registerDocTools } from "../../tools/doc.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const READ = "shopping_doc_read";
const WRITE = "shopping_doc_write";
const REMOVE = "shopping_doc_remove";
const FIND = "shopping_doc_find";

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
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> => payloadOf(await getTool(api, tool).execute("c", params));

const shopperDir = (): string => join(dataDir, "shopper");
const briefPath = (slug: string): string => join(shopperDir(), "briefs", `${slug}.md`);

/** Write raw bytes at `path`, creating the tree — used to plant a CORRUPT document
 * the store never wrote, which is the only honest way to reach `unreadable`. */
function plant(path: string, bytes: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, bytes, { mode: 0o600 });
}

const CORRUPT = "no frontmatter fence here at all\njust prose\n";

const SHOPPER_BODY = "## Who\nBuys once and keeps it.\n\n## Constraints\nShips to Greece.\n";
const BRIEF_BODY =
  "## Items\n| item | domain | status |\n|---|---|---|\n| boots |  | open |\n\n### boots\nBoots that won't blister.\n";

/** A shopper document plus one Brief, so the read/find/remove bars start populated. */
async function seed(): Promise<void> {
  expect(
    (await call(WRITE, { ref: "shopper", mode: "create", name: "Ioannis", body: SHOPPER_BODY }))["status"],
  ).toBe("ok");
  expect(
    (await call(WRITE, { ref: "brief:chamonix-feb", mode: "create", title: "Chamonix", body: BRIEF_BODY }))["status"],
  ).toBe("ok");
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-doc-surface-"));
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

// A group-local "registers exactly these four" mirror was written here and DELETED in
// reconciliation: every way it could go red (a surviving `sil_learn`, a missing verb,
// a fifth tool) already turns `manifest-contract`'s AC G1 exact-set literal red, and
// `index` / `plugin-load` red on top of that. Duplicate coverage is cost, not safety —
// and a sixth tool-set mirror is one more place to forget to bump.

describe("G2 — shopping_doc_write: whole-body writes, and mode is load-bearing in BOTH directions", () => {
  it("G2 — `body` is the WHOLE reconciled markdown: a replace REPLACES, it never appends", async () => {
    // The stacking failure the whole surface is shaped around. With no append and no
    // section patch, a correction cannot leave the contradicted row sitting above it.
    await seed();
    const corrected = "## Who\nBuys once and keeps it.\n\n## Constraints\nShips to Cyprus now.\n";
    expect((await call(WRITE, { ref: "shopper", mode: "replace", body: corrected }))["status"]).toBe("ok");

    const after = await call(READ, { ref: "shopper" });
    expect(after["body"]).toBe(corrected);
    // The superseded line is GONE, not demoted below the new one.
    expect(String(after["body"])).not.toContain("Ships to Greece");
    // …and the frontmatter the caller did not resend is carried forward, so a body
    // rewrite can never anonymise the person.
    expect((after["fields"] as Record<string, string>)["name"]).toBe("Ioannis");
  });

  it("G2 — create FAILS if the ref exists and replace FAILS if it does not, and neither writes", async () => {
    await seed();

    const clobber = await call(WRITE, { ref: "brief:chamonix-feb", mode: "create", title: "X", body: "## Items\n" });
    expect(clobber["status"]).toBe("invalid_request");
    // Fail-closed means the on-disk bytes are untouched, not merely that a status came back.
    expect(readFileSync(briefPath("chamonix-feb"), "utf8")).toContain("Boots that won't blister");

    const mintByReplace = await call(WRITE, { ref: "brief:not-a-job", mode: "replace", title: "X", body: "## Items\n" });
    expect(mintByReplace["status"]).toBe("not_found");
    expect(existsSync(briefPath("not-a-job"))).toBe(false);
  });

  it("G2 — a document is written atomically and owner-only (dir 0700, file 0600), with no tmp left behind", async () => {
    // Not in G2's text, but the failure it names ("a correction cannot stack") is only
    // true if a write is all-or-nothing: a half-written body IS a stacked document,
    // and no other test on this surface looks at the mode or the leftovers.
    await seed();
    /* eslint-disable-next-line no-bitwise */
    const bits = (p: string): number => statSync(p).mode & 0o777;
    expect(bits(briefPath("chamonix-feb"))).toBe(0o600);
    expect(bits(join(shopperDir(), "briefs"))).toBe(0o700);
    expect(bits(shopperDir())).toBe(0o700);
    const { readdirSync } = await import("node:fs");
    expect((readdirSync(join(shopperDir(), "briefs")) as string[]).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("G3 — shopping_doc_find: coordinates only, composing filters, and unreadable is surfaced", () => {
  it("G3 — returns COORDINATES and never a body; filters compose; a malformed document surfaces in `unreadable`", async () => {
    await seed();
    // A second Brief, done and in a domain, so `status` and `domain` have something
    // to discriminate. Its `## Items` row carries the domain the filter matches on.
    expect(
      (
        await call(WRITE, {
          ref: "brief:office-chair",
          mode: "create",
          title: "Office chair",
          status: "done",
          body:
            "## Items\n| item | domain | status |\n|---|---|---|\n"
            + "| chair | product.furniture.seating | picked |\n\n### chair\nA chair.\n",
        })
      )["status"],
    ).toBe("ok");
    plant(briefPath("wrecked"), CORRUPT);

    const all = await call(FIND, {});
    const briefs = all["briefs"] as Array<Record<string, unknown>>;
    // COORDINATES ONLY. A body reaching the index makes the index the read, and the
    // agent stops calling shopping_doc_read — every listing then costs a whole store.
    expect(JSON.stringify(all)).not.toContain("won't blister");
    expect(briefs.every((b) => !("body" in b))).toBe(true);
    expect(briefs.map((b) => b["slug"]).sort()).toEqual(["chamonix-feb", "office-chair"]);
    expect(all["shopper"]).toBeDefined();

    // A corrupt document KEEPS ITS PLACE — dropping it silently is how a store looks
    // healthy while a job the buyer wrote is invisible.
    expect((all["unreadable"] as Array<{ id: string }>).map((u) => u.id)).toEqual(["brief:wrecked"]);

    // Filters COMPOSE, and each one narrows on its own axis.
    expect(((await call(FIND, { kind: "brief" }))["shopper"])).toBeUndefined();
    expect(
      ((await call(FIND, { status: "done" }))["briefs"] as Array<Record<string, unknown>>).map((b) => b["slug"]),
    ).toEqual(["office-chair"]);
    expect(
      ((await call(FIND, { domain: "product.furniture" }))["briefs"] as Array<Record<string, unknown>>).map(
        (b) => b["slug"],
      ),
    ).toEqual(["office-chair"]);
    expect(
      ((await call(FIND, { query: "chamonix" }))["briefs"] as Array<Record<string, unknown>>).map((b) => b["slug"]),
    ).toEqual(["chamonix-feb"]);
    // …and composed, they intersect rather than union.
    expect(
      ((await call(FIND, { status: "done", query: "chamonix" }))["briefs"] as unknown[]),
    ).toEqual([]);
  });
});

describe("G4 — shopping_doc_read: unreadable is NOT not_found", () => {
  it("G4 — a present-but-corrupt document answers `unreadable` and steers to inspect, never to re-mint", async () => {
    // The distinction is the whole point: an agent that reads "absent" over a corrupt
    // document writes a fresh one, and the buyer's own words are gone. Both halves —
    // the distinct status AND the recovery it hands back.
    plant(briefPath("wrecked"), CORRUPT);
    const corrupt = await call(READ, { ref: "brief:wrecked" });
    expect(corrupt["status"]).toBe("unreadable");
    expect(corrupt["recovery"]).toBe("inspect_document");

    const absent = await call(READ, { ref: "brief:never-existed" });
    expect(absent["status"]).toBe("not_found");
    expect(absent["status"]).not.toBe(corrupt["status"]);

    // The corrupt bytes survive the read untouched.
    expect(readFileSync(briefPath("wrecked"), "utf8")).toBe(CORRUPT);
  });
});

describe("G5 — a bad slug is rejected BEFORE any path join", () => {
  const BAD: Array<[string, string]> = [
    ["traversal", "brief:../../../etc/passwd"],
    ["separator", "brief:jobs/chamonix"],
    ["uppercase", "brief:Chamonix"],
    ["host-reserved", "brief:main"],
    ["empty", "brief:"],
  ];

  it("G5 — every doc verb rejects a traversal / separator / uppercase / `main` slug as invalid_request, writing and removing nothing", async () => {
    await seed();
    const before = readFileSync(briefPath("chamonix-feb"), "utf8");

    const wrong: string[] = [];
    for (const [why, ref] of BAD) {
      for (const [tool, params] of [
        [READ, { ref }],
        [WRITE, { ref, mode: "create", title: "X", body: "## Items\n" }],
        [REMOVE, { ref }],
      ] as Array<[string, Record<string, unknown>]>) {
        const payload = await call(tool, params);
        if (payload["status"] !== "invalid_request") wrong.push(`${tool} ${why} → ${String(payload["status"])}`);
      }
    }
    expect(wrong).toEqual([]);

    // Nothing escaped the store and nothing inside it moved. `..` resolving anywhere
    // is the failure this guard exists for, so prove the tree is exactly as seeded.
    expect(readFileSync(briefPath("chamonix-feb"), "utf8")).toBe(before);
    expect(existsSync(join(dataDir, "shopper", "briefs", "Chamonix.md"))).toBe(false);
    const { readdirSync } = await import("node:fs");
    expect((readdirSync(join(shopperDir(), "briefs")) as string[]).sort()).toEqual(["chamonix-feb.md"]);
  });
});

describe("shopping_doc_remove — one document, never a cascade", () => {
  it("removes one Brief, leaves every sibling and the shopper alone, and refuses to remove the person", async () => {
    // The cascade failure has no other home on this surface, and it is silent: a
    // removal that also took the shopper document would look like a clean success.
    await seed();
    expect(
      (await call(WRITE, { ref: "brief:office-chair", mode: "create", title: "Chair", body: "## Items\n" }))["status"],
    ).toBe("ok");

    expect((await call(REMOVE, { ref: "brief:chamonix-feb" }))["status"]).toBe("removed");
    expect(existsSync(briefPath("chamonix-feb"))).toBe(false);
    expect(existsSync(briefPath("office-chair"))).toBe(true);
    expect((await call(READ, { ref: "shopper" }))["status"]).toBe("ok");

    // Idempotent: a repeat is not_found, not an error the agent has to interpret.
    expect((await call(REMOVE, { ref: "brief:chamonix-feb" }))["status"]).toBe("not_found");
    // …and the person is not a document you delete.
    expect((await call(REMOVE, { ref: "shopper" }))["status"]).toBe("invalid_request");
    expect((await call(READ, { ref: "shopper" }))["status"]).toBe("ok");
  });
});
