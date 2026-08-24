/**
 * INTEGRATION — `doc-store.ts:52`'s standing invariant: THE STORE NEVER THROWS
 * ACROSS THE TOOL BOUNDARY. Real filesystem, real store, driven through the
 * REGISTERED tools, because an exception's entire cost is paid at `execute()` —
 * calling the store function directly would test a path production never takes.
 *
 * WHY THESE BARS EXIST. `existsSync` answers "is there something here", not "can
 * I list it", so every `existsSync`-then-`readdirSync` pair in the store is a
 * throw waiting on a real disk. Two states reach it and neither is exotic: a
 * directory an untarred backup or a stray umask left unreadable (EACCES), and a
 * directory replaced by a FILE of the same name (ENOTDIR — `existsSync` passes,
 * `readdirSync` does not). A broken store must be DIAGNOSED, never crashed on:
 * that is the whole reason `sil_doctor` exists, and `checkStore()` reads the
 * store through the very scan that throws.
 *
 * THESE ASSERTIONS ARE THE SPEC. Do NOT weaken one to match the store.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { registerDocTools } from "../tools/doc.js";
import { registerDoctorTools } from "../tools/doctor.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALLED = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version as string;

/** chmod-based fault injection is meaningless as root (root bypasses every
 * permission bit), so the EACCES bar skips rather than false-pass. */
const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

let dataDir: string;
let priorSilDataDir: string | undefined;
let api: MockPluginAPI;

function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error(`tool result has no text payload: ${String(text)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

/** Drive a registered tool. Any throw here IS the defect under test — it escapes
 * `execute()` exactly as it would in the host. */
const call = async (
  tool: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => payloadOf(await getTool(api, tool).execute("c", params));

const shopperDir = (): string => join(dataDir, "shopper");
const briefsDir = (): string => join(shopperDir(), "briefs");
const legacyRoot = (): string => join(shopperDir(), "domains");

/** Everything the envelope offers about a path it could NOT read — the two
 * sanctioned reported shapes unioned (`unreadable[]` entries, or a failure
 * envelope's own status + `error`). A guard that swallows the exception silently
 * yields nothing here, which is the second half of the contract: a failed listing
 * becomes a REPORTED entry, not an empty result. */
function reported(payload: Record<string, unknown>): string {
  return JSON.stringify({
    status: payload["status"] ?? null,
    error: payload["error"] ?? null,
    message: payload["status"] === "ok" ? null : (payload["message"] ?? null),
    unreadable: Array.isArray(payload["unreadable"]) ? payload["unreadable"] : [],
  });
}

/** The lines under one H2, up to the next H2 — placement is the claim, so the
 * migration assertions below are scoped rather than whole-body. */
function section(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, contents, { mode: 0o600 });
}

const artefact = (fields: Record<string, string>, body: string): string =>
  `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${body}`;

function seedShopper(): void {
  write(join(shopperDir(), "user_spec.md"), artefact({ name: "Ioannis" }, "## Who\nBuys once and keeps it.\n"));
}

function seedBrief(slug = "chamonix"): void {
  write(
    join(briefsDir(), `${slug}.md`),
    artefact({ slug, title: "Chamonix", status: "active", updated_at: "2026-08-01" }, "## Items\n"),
  );
}

/** Replace a directory with a FILE of the same name — `existsSync` still passes,
 * `readdirSync` raises ENOTDIR. Deterministic, and independent of uid. */
function replaceDirWithFile(path: string): void {
  rmSync(path, { recursive: true, force: true });
  write(path, "this is a file where the store expects a directory\n");
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-doc-boundary-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  api = createMockPluginApi();
  registerDocTools(api);
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  // Best-effort: a 0o000 directory is not recursively removable until it is not.
  for (const dir of [briefsDir(), legacyRoot(), shopperDir(), dataDir]) {
    try {
      if (existsSync(dir)) chmodSync(dir, 0o700);
    } catch {
      /* already gone, or a file — the rm below handles both */
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("`doc-store.ts:52` — a store the OS will not let us list is REPORTED, never thrown", () => {
  it("`briefs` present as a FILE (ENOTDIR): sil_doc_find answers, names it, and still reports the shopper", async () => {
    // `existsSync(briefsDir)` passes on a file, and the very next `readdirSync`
    // raises ENOTDIR straight out of `execute()`. The shopper clause is what
    // forbids the lazy fix — wrapping the whole scan in a try/catch that returns
    // an empty result loses the person along with the unlistable directory.
    seedShopper();
    seedBrief();

    // Guard-of-the-guard: healthy, this store reports NOTHING unreadable, so the
    // assertion below cannot pass on a store that was already broken.
    const healthy = await call("sil_doc_find");
    expect(healthy["status"]).toBe("ok");
    expect(healthy["unreadable"]).toEqual([]);
    expect((healthy["briefs"] as unknown[]).length).toBe(1);

    replaceDirWithFile(briefsDir());

    const found = await call("sil_doc_find");
    expect(found["shopper"]).toMatchObject({ ref: "shopper", name: "Ioannis" });
    expect(reported(found)).toContain("briefs");
  });

  it.skipIf(AS_ROOT)(
    "`briefs` present but UNREADABLE (EACCES): the same contract — an `isDirectory()` guard passes the file case and still throws here",
    async () => {
      // The distinct failure mode. `statSync(p).isDirectory()` is the obvious fix
      // for the ENOTDIR bar above and it does nothing for a directory the process
      // may stat but not read — which is the state an untarred backup or a stray
      // umask actually produces on a live disk.
      seedShopper();
      seedBrief();
      chmodSync(briefsDir(), 0o000);

      const found = await call("sil_doc_find");
      expect(found["shopper"]).toMatchObject({ ref: "shopper", name: "Ioannis" });
      expect(reported(found)).toContain("briefs");
    },
  );

  it("`domains` present as a FILE: ALL FOUR doc verbs answer — the legacy scan runs on every one of them", async () => {
    // `legacyDirs()` sits behind `migrateOnTouch`, which every verb calls, so this
    // site is not a `sil_doc_find` bug: unguarded it throws out of read, write and
    // remove too. It is also reached TWICE per call — once by the scan, once by
    // `pruneLegacyTree` — so a guard on the scan alone still throws on the prune.
    seedShopper();
    replaceDirWithFile(legacyRoot());

    const found = await call("sil_doc_find");
    expect(found["status"]).toBe("ok");
    expect((await call("sil_doc_read", { ref: "shopper" }))["status"]).toBe("ok");
    expect(
      (await call("sil_doc_write", { ref: "brief:new-job", mode: "create", title: "New", body: "## Items\n" }))[
        "status"
      ],
    ).toBe("ok");
    expect((await call("sil_doc_remove", { ref: "brief:new-job" }))["status"]).toBe("removed");

    // …and the unlistable legacy tree is DIAGNOSED, not silently skipped: a store
    // stuck one hop behind forever is exactly what the report is for.
    expect(reported(found)).toContain("domains");
  });

  it("an unlistable `prds` does not cost the `method.md` beside it: the sibling still migrates, and the file is never deleted", async () => {
    // The third site, one level down. A guard that abandons the whole legacy walk
    // on the first bad `prds` silently drops every method in the store — the
    // `0.3.7 → 0.4.0` class of loss, arriving through the fix rather than the bug.
    seedShopper();
    write(
      join(legacyRoot(), "ski", "method.md"),
      artefact({ domain: "ski", name: "Ski" }, "Prefers last-year models. Never a narrow last.\n"),
    );
    const prds = join(legacyRoot(), "ski", "prds");
    replaceDirWithFile(prds);

    const found = await call("sil_doc_find");
    expect(found["status"]).toBe("ok");

    const body = String((await call("sil_doc_read", { ref: "shopper" }))["body"]);
    expect(section(body, "## Shopping")).toMatch(/^### ski$/m);
    expect(body).toContain("Never a narrow last");
    expect(existsSync(join(legacyRoot(), "ski", "method.md"))).toBe(false);
    // The bytes the store could not read are left exactly where a human can find
    // them — the store never deletes what it could not parse.
    expect(readFileSync(prds, "utf8")).toContain("this is a file");
    expect(reported(found)).toContain("prds");
  });

  it("sil_doctor DIAGNOSES an unlistable `briefs` rather than throwing — the guard belongs in the store, not in the tool wrapper", async () => {
    // `sil_doctor` reads the store through `checkStore()` → `findDocuments()`, NOT
    // through `sil_doc_*`. A guard placed in `doc.ts`'s `execute()` passes every
    // bar above and leaves the one surface whose job is to diagnose a broken store
    // dying on it — with `dir.usable` true, because the DATA dir is fine.
    const doctor = createMockPluginApi();
    registerDoctorTools(doctor, async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        package: { name: "@4gpts/sil", latestVersion: INSTALLED, tags: { latest: INSTALLED } },
        owner: { handle: "4gpts" },
      }),
    }));
    const runDoctor = async (): Promise<{
      healthy: boolean;
      findings: Array<{ id: string; detected: string }>;
    }> =>
      JSON.parse(
        (await getTool(doctor, "sil_doctor").execute("c", {})).content[0]?.text as string,
      ) as { healthy: boolean; findings: Array<{ id: string; detected: string }> };

    seedShopper();
    seedBrief();

    // Guard-of-the-guard: with a real `briefs/` directory the doctor is quiet
    // about it, so the finding below is caused by the fault and nothing else.
    const before = await runDoctor();
    expect(before.findings.filter((f) => `${f.id} ${f.detected}`.includes("briefs"))).toEqual([]);
    expect(before.healthy).toBe(true);

    replaceDirWithFile(briefsDir());

    const after = await runDoctor();
    expect(after.findings.filter((f) => `${f.id} ${f.detected}`.includes("briefs")).length).toBeGreaterThan(0);
    // A store the doctor cannot list is not a healthy store.
    expect(after.healthy).toBe(false);
  });
});

/**
 * The FOURTH listing site — the store root — and a different failure than the three
 * above. An unlistable `shopper/` throws NOTHING: `existsSync` on every child of it
 * answers false, so the store reads a present store as an ABSENT one. That is the
 * conflation `doc-store.ts:69` forbids in as many words, and it is the more dangerous
 * shape, because a throw at least stops the agent.
 */
describe("`doc-store.ts:69` — an unlistable store ROOT is UNREADABLE, never absent", () => {
  it.skipIf(AS_ROOT)("sil_doc_read {ref: shopper} answers `unreadable` — `not_found` steers a re-mint over the buyer's own words", async () => {
    // The whole cost is the recovery: `not_found`'s message names sil_doc_write
    // (mode: create), and the shopper document is the one `sil_doc_remove` refuses to
    // delete precisely because nothing else on disk reproduces it.
    seedShopper();

    // Guard-of-the-guard: readable, this document reads back — so the bar below
    // cannot pass on a store that simply never had a shopper.
    const healthy = await call("sil_doc_read", { ref: "shopper" });
    expect(healthy["status"]).toBe("ok");
    expect(healthy["fields"]).toMatchObject({ name: "Ioannis" });

    chmodSync(shopperDir(), 0o000);

    const read = await call("sil_doc_read", { ref: "shopper" });
    expect(read["status"]).toBe("unreadable");
    expect(read["recovery"]).toBe("inspect_document");
  });

  it.skipIf(AS_ROOT)("sil_doc_find REPORTS it — a clean empty result tells sil_doctor a broken store is a healthy one", async () => {
    // The read verb and the find verb reach the root through separate paths, so a
    // guard on `readDocument` alone leaves this one answering `{briefs: [],
    // unreadable: []}` — healthy, empty, and wrong. `checkStore()` believes it.
    seedShopper();
    seedBrief();

    const healthy = await call("sil_doc_find");
    expect(healthy["status"]).toBe("ok");
    expect(healthy["unreadable"]).toEqual([]);
    expect((healthy["briefs"] as unknown[]).length).toBe(1);

    chmodSync(shopperDir(), 0o000);

    const found = await call("sil_doc_find");
    expect(found["status"]).toBe("ok");
    expect(found["unreadable"]).not.toEqual([]);
    expect(reported(found)).toContain("shopper");
  });
});
