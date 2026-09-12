/**
 * INTEGRATION — `doc-store.ts`'s standing invariant: THE STORE NEVER THROWS
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
 *
 * The two describes below name the contract by its SYMBOL, never by a line number: a
 * `:52` anchor is a claim nothing verifies, and one added import silently made it a lie.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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

function seedBrief(slug = "chamonix", body = "## Items\n"): void {
  write(
    join(briefsDir(), `${slug}.md`),
    artefact({ slug, title: "Chamonix", status: "active", updated_at: "2026-08-01" }, body),
  );
}

/**
 * Take a reading with `path` at `mode`, and RESTORE before any expectation runs — a
 * bar that fails mid-fault must not leave an unreadable tree for the next one (or
 * for `afterEach`'s rm). `0o000`, `0o400` and `0o300` are three DIFFERENT states of
 * the same directory and no one of them stands in for another.
 */
async function underMode<T>(path: string, mode: number, take: () => Promise<T>): Promise<T> {
  chmodSync(path, mode);
  try {
    return await take();
  } finally {
    chmodSync(path, 0o700);
  }
}

interface DoctorFinding {
  id: string;
  severity: string;
  detected: string;
}

/** `sil_doctor` through its REGISTERED tool, version probe doubled as up-to-date so
 * the only thing a finding can come from is the store on disk. */
async function runDoctor(): Promise<{ healthy: boolean; findings: DoctorFinding[] }> {
  const doctor = createMockPluginApi();
  registerDoctorTools(doctor, async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      package: { name: "@4gpts/sil", latestVersion: INSTALLED, tags: { latest: INSTALLED } },
      owner: { handle: "4gpts" },
    }),
  }));
  return JSON.parse(
    (await getTool(doctor, "sil_doctor").execute("c", {})).content[0]?.text as string,
  ) as { healthy: boolean; findings: DoctorFinding[] };
}

/** Replace a directory with a FILE of the same name — `existsSync` still passes,
 * `readdirSync` raises ENOTDIR. Deterministic, and independent of uid. */
function replaceDirWithFile(path: string): void {
  rmSync(path, { recursive: true, force: true });
  write(path, "this is a file where the store expects a directory\n");
}

/** `readShopperIdentity`'s one NON-agent consumer. Its singleton pre-flight (step 3)
 * is terminal, so no host command is ever reached — `openclaw` is deliberately absent
 * from PATH, and a run that got past the pre-flight would die there, loudly. */
const CREATE_SHOPPER_BIN = join(REPO_ROOT, "scripts", "create-shopper.mjs");

function runCreateShopper(): { status: number; stdout: string; marker: Record<string, unknown> } {
  const configPath = join(dataDir, "openclaw.json");
  writeFileSync(configPath, JSON.stringify({ gateway: { mode: "local" } }) + "\n");
  const r = spawnSync(process.execPath, [CREATE_SHOPPER_BIN], {
    input: JSON.stringify({
      name: "Second Person",
      workspace: join(dataDir, "workspace"),
      persona: "A careful generalist buyer.",
      userSpec: "Ships to Athens.",
    }),
    env: { PATH: "/usr/bin:/bin", HOME: dataDir, OPENCLAW_CONFIG_PATH: configPath, SIL_DATA_DIR: dataDir },
    encoding: "utf8",
    timeout: 20_000,
  });
  const line = (r.stderr ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "";
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    marker: line === "" ? {} : (JSON.parse(line) as Record<string, unknown>),
  };
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

describe("`doc-store.ts`'s never-throws boundary — a store the OS will not let us list is REPORTED, never thrown", () => {
  it("`briefs` present as a FILE (ENOTDIR): shopping_doc_find answers, names it, and still reports the shopper", async () => {
    // `existsSync(briefsDir)` passes on a file, and the very next `readdirSync`
    // raises ENOTDIR straight out of `execute()`. The shopper clause is what
    // forbids the lazy fix — wrapping the whole scan in a try/catch that returns
    // an empty result loses the person along with the unlistable directory.
    seedShopper();
    seedBrief();

    // Guard-of-the-guard: healthy, this store reports NOTHING unreadable, so the
    // assertion below cannot pass on a store that was already broken.
    const healthy = await call("shopping_doc_find");
    expect(healthy["status"]).toBe("ok");
    expect(healthy["unreadable"]).toEqual([]);
    expect((healthy["briefs"] as unknown[]).length).toBe(1);

    replaceDirWithFile(briefsDir());

    const found = await call("shopping_doc_find");
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

      const found = await call("shopping_doc_find");
      expect(found["shopper"]).toMatchObject({ ref: "shopper", name: "Ioannis" });
      expect(reported(found)).toContain("briefs");
    },
  );

  it("`domains` present as a FILE: ALL FOUR doc verbs answer — the legacy scan runs on every one of them", async () => {
    // `legacyDirs()` sits behind `migrateOnTouch`, which every verb calls, so this
    // site is not a `shopping_doc_find` bug: unguarded it throws out of read, write and
    // remove too. It is also reached TWICE per call — once by the scan, once by
    // `pruneLegacyTree` — so a guard on the scan alone still throws on the prune.
    seedShopper();
    replaceDirWithFile(legacyRoot());

    const found = await call("shopping_doc_find");
    expect(found["status"]).toBe("ok");
    expect((await call("shopping_doc_read", { ref: "shopper" }))["status"]).toBe("ok");
    expect(
      (await call("shopping_doc_write", { ref: "brief:new-job", mode: "create", title: "New", body: "## Items\n" }))[
        "status"
      ],
    ).toBe("ok");
    expect((await call("shopping_doc_remove", { ref: "brief:new-job" }))["status"]).toBe("removed");

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

    const found = await call("shopping_doc_find");
    expect(found["status"]).toBe("ok");

    const body = String((await call("shopping_doc_read", { ref: "shopper" }))["body"]);
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
    // through `shopping_doc_*`. A guard placed in `doc.ts`'s `execute()` passes every
    // bar above and leaves the one surface whose job is to diagnose a broken store
    // dying on it — with `dir.usable` true, because the DATA dir is fine.
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
 * conflation `doc-store.ts`'s `Unreadable` forbids in as many words, and it is the more
 * dangerous shape, because a throw at least stops the agent.
 */
describe("`doc-store.ts`'s `Unreadable` contract — an unlistable store ROOT is UNREADABLE, never absent", () => {
  it.skipIf(AS_ROOT)("shopping_doc_read {ref: shopper} answers `unreadable` — `not_found` steers a re-mint over the buyer's own words", async () => {
    // The whole cost is the recovery: `not_found`'s message names shopping_doc_write
    // (mode: create), and the shopper document is the one `shopping_doc_remove` refuses to
    // delete precisely because nothing else on disk reproduces it.
    seedShopper();

    // Guard-of-the-guard: readable, this document reads back — so the bar below
    // cannot pass on a store that simply never had a shopper.
    const healthy = await call("shopping_doc_read", { ref: "shopper" });
    expect(healthy["status"]).toBe("ok");
    expect(healthy["fields"]).toMatchObject({ name: "Ioannis" });

    chmodSync(shopperDir(), 0o000);

    const read = await call("shopping_doc_read", { ref: "shopper" });
    expect(read["status"]).toBe("unreadable");
    expect(read["recovery"]).toBe("inspect_document");
  });

  it.skipIf(AS_ROOT)("shopping_doc_find REPORTS it — a clean empty result tells sil_doctor a broken store is a healthy one", async () => {
    // The read verb and the find verb reach the root through separate paths, so a
    // guard on `readDocument` alone leaves this one answering `{briefs: [],
    // unreadable: []}` — healthy, empty, and wrong. `checkStore()` believes it.
    seedShopper();
    seedBrief();

    const healthy = await call("shopping_doc_find");
    expect(healthy["status"]).toBe("ok");
    expect(healthy["unreadable"]).toEqual([]);
    expect((healthy["briefs"] as unknown[]).length).toBe(1);

    chmodSync(shopperDir(), 0o000);

    const found = await call("shopping_doc_find");
    expect(found["status"]).toBe("ok");
    expect(found["unreadable"]).not.toEqual([]);
    expect(reported(found)).toContain("shopper");
  });

  it.skipIf(AS_ROOT)("the create-shopper BIN fails closed on it — an empty read mints a SECOND person over the buyer it could not see", () => {
    // The one entry point whose consumer is not an agent: `create-shopper.mjs:474`
    // treats a non-empty `unreadable[]` as INCONCLUSIVE. Drop the root probe and
    // `readShopperIdentity` answers `{unreadable: []}` — indistinguishable from a fresh
    // machine — so the singleton gate opens and the bin walks on to `agents add`.
    seedShopper();

    // Guard-of-the-guard: readable, this same store makes the bin REFUSE — proof it
    // reaches the pre-flight and reads this person, so the bar below turns on the lock.
    const readable = runCreateShopper();
    expect(readable.status).not.toBe(0);
    expect(readable.marker["status"]).toBe("collision");

    chmodSync(shopperDir(), 0o000);

    const locked = runCreateShopper();
    // Restored first: a failed assertion must not poison the afterEach cleanup.
    chmodSync(shopperDir(), 0o700);

    expect(locked.status).not.toBe(0);
    expect(locked.stdout).not.toContain("sil_shopper_created");
    expect(locked.marker["status"]).toBe("persistence_failed");
    // …and it fails HERE, at the store, not two steps later at the host CLI: the path
    // it names is the store it could not read, and the cause says so.
    expect(locked.marker["path"]).toBe(shopperDir());
    expect(String(locked.marker["cause"])).toMatch(/degraded/);
    // The person is exactly as they were — nothing minted over them.
    expect(readFileSync(join(shopperDir(), "user_spec.md"), "utf8")).toContain("Buys once and keeps it.");
  });

  it.skipIf(AS_ROOT)("shopping_doc_write answers `unreadable` in BOTH modes — create fell to persistence_failed, replace to `mint it with mode: create`", async () => {
    // Two branches of ONE `shopperDirError()` call, and both steered wrong without it:
    // `create` blamed the data directory (`fix_data_dir`) for a store whose documents
    // are intact, and `replace` said the document does not exist — an invitation to
    // mint a fresh one over the buyer's own words.
    seedShopper();
    seedBrief();

    // Guard-of-the-guard: readable, both modes land on this very store.
    expect(
      (await call("shopping_doc_write", { ref: "brief:new-job", mode: "create", title: "New", body: "## Items\n" }))["status"],
    ).toBe("ok");
    expect(
      (await call("shopping_doc_write", { ref: "brief:chamonix", mode: "replace", title: "Chamonix", body: "## Items\n" }))["status"],
    ).toBe("ok");

    chmodSync(shopperDir(), 0o000);

    const created = await call("shopping_doc_write", { ref: "brief:another-job", mode: "create", title: "Another", body: "## Items\n" });
    expect(created["status"]).toBe("unreadable");
    expect(created["recovery"]).toBe("inspect_document");

    const replaced = await call("shopping_doc_write", { ref: "shopper", mode: "replace", name: "Ioannis", body: "## Who\nrewritten\n" });
    expect(replaced["status"]).toBe("unreadable");
    expect(replaced["recovery"]).toBe("inspect_document");
  });

  it.skipIf(AS_ROOT)("shopping_doc_remove answers `unreadable`, never `not_found` — \"already gone\" said of a Brief that is on disk", async () => {
    // `not_found` here reads as "your delete already happened", so the agent stops
    // asking. The Brief is still there, and nothing will look for it again.
    seedShopper();
    seedBrief();
    chmodSync(shopperDir(), 0o000);

    const removed = await call("shopping_doc_remove", { ref: "brief:chamonix" });
    expect(removed["status"]).toBe("unreadable");
    expect(removed["recovery"]).toBe("inspect_document");

    // Guard-of-the-guard, taken after: unlocked, that exact ref is present and
    // removable — so the answer above was about the LOCK, not a ref that never was.
    chmodSync(shopperDir(), 0o700);
    expect(existsSync(join(briefsDir(), "chamonix.md"))).toBe(true);
    expect((await call("shopping_doc_remove", { ref: "brief:chamonix" }))["status"]).toBe("removed");
  });
});

/**
 * THE CONTAINING-DIRECTORY RULE, one level down from the root. `briefs/` is the only
 * other containing directory in the ref grammar, and the root's probe never fires for
 * it: `readdirSync(shopper)` succeeds, so every ref-addressed verb falls straight to
 * `existsSync(briefs/<slug>.md)` — a boolean over a `stat()` that swallows EVERY errno.
 * `false` means ENOENT **or** "I was not allowed to look", and the store records the
 * second as the first.
 *
 * A ref-addressed verb may answer `not_found` ONLY when it listed the directory that
 * would contain the document and the document was not in it. When that listing fails,
 * present-or-absent is unknown — and unknown is STATED, never guessed as absence.
 */
describe("the CONTAINING directory — an unlistable `briefs/` is UNREADABLE, never absent", () => {
  it.skipIf(AS_ROOT)("AC1 — shopping_doc_read answers `unreadable`; `not_found`'s own message IS the re-mint instruction", async () => {
    seedShopper();
    seedBrief();

    // Guard-of-the-guard: listable, this exact ref reads back — so the answer below is
    // about the LOCK, not a Brief that never existed.
    expect((await call("shopping_doc_read", { ref: "brief:chamonix" }))["status"]).toBe("ok");

    const read = await underMode(briefsDir(), 0o000, () =>
      call("shopping_doc_read", { ref: "brief:chamonix" }),
    );

    expect(read["status"]).toBe("unreadable");
    expect(read["recovery"]).toBe("inspect_document");
    // …and it says WHAT it could not settle, about WHICH document. The store's OTHER
    // `unreadable` reads "malformed or absent frontmatter", which is nonsense for a
    // chmod fault and steers the repair at a file that is perfectly fine.
    expect(String(read["message"])).toContain("brief:chamonix");
    expect(String(read["message"])).toMatch(/presence could not be determined/i);
    expect(String(read["message"])).not.toMatch(/malformed/i);
    // The ref, never the file: where the store keeps its bytes is an internal, and the
    // errno MESSAGE embeds it, which is why the cause reaches the agent as a code.
    expect(String(read["message"])).not.toContain(dataDir);
  });

  it.skipIf(AS_ROOT)("AC2 — shopping_doc_write {mode: replace} answers `unreadable`, never \"mint it with mode: create first\"", async () => {
    seedShopper();
    seedBrief();

    // Guard-of-the-guard: listable, this same replace lands on this same store.
    expect(
      (await call("shopping_doc_write", { ref: "brief:chamonix", mode: "replace", title: "Chamonix", body: "## Items\n" }))["status"],
    ).toBe("ok");

    const replaced = await underMode(briefsDir(), 0o000, () =>
      call("shopping_doc_write", { ref: "brief:chamonix", mode: "replace", title: "Chamonix", body: "## Items\n" }),
    );

    expect(replaced["status"]).toBe("unreadable");
    expect(replaced["recovery"]).toBe("inspect_document");
    expect(String(replaced["message"])).not.toMatch(/mode: create/);
  });

  it.skipIf(AS_ROOT)("AC3 — a `create` over a slug that IS on disk answers `unreadable` and leaves the bytes exactly as they were", async () => {
    seedShopper();
    seedBrief();
    const path = join(briefsDir(), "chamonix.md");
    // Reading the bytes here is also the guard-of-the-guard: the document is on disk
    // and readable before the lock goes on.
    const before = readFileSync(path, "utf8");

    const created = await underMode(briefsDir(), 0o000, () =>
      call("shopping_doc_write", { ref: "brief:chamonix", mode: "create", title: "Chamonix", body: "## Items\n| new | | open |\n" }),
    );

    expect(created["status"]).toBe("unreadable");
    // NOT `persistence_failed` / `fix_data_dir`: that blames the data directory for a
    // store whose documents are intact, and sends the buyer to repair the wrong thing.
    expect(created["recovery"]).toBe("inspect_document");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it.skipIf(AS_ROOT)("AC4 — a `create` for a slug that is NOT on disk also abstains: \"a mint never clobbers\" cannot be upheld over a directory it cannot enumerate", async () => {
    seedShopper();
    seedBrief();

    // Guard-of-the-guard: listable, a mint at a free slug lands — so the answer below
    // is the lock, not a rejected slug.
    expect(
      (await call("shopping_doc_write", { ref: "brief:new-job", mode: "create", title: "New", body: "## Items\n" }))["status"],
    ).toBe("ok");

    const created = await underMode(briefsDir(), 0o000, () =>
      call("shopping_doc_write", { ref: "brief:another-job", mode: "create", title: "Another", body: "## Items\n" }),
    );

    expect(created["status"]).toBe("unreadable");
    expect(created["recovery"]).toBe("inspect_document");
  });

  it.skipIf(AS_ROOT)("AC5 — shopping_doc_remove answers `unreadable` and the Brief is still on disk — \"(already gone)\" said of a document that is not", async () => {
    seedShopper();
    seedBrief();
    const path = join(briefsDir(), "chamonix.md");

    // Guard-of-the-guard: listable, that exact ref is present and readable.
    expect((await call("shopping_doc_read", { ref: "brief:chamonix" }))["status"]).toBe("ok");

    const removed = await underMode(briefsDir(), 0o000, () =>
      call("shopping_doc_remove", { ref: "brief:chamonix" }),
    );

    expect(removed["status"]).toBe("unreadable");
    expect(removed["recovery"]).toBe("inspect_document");
    // `not_found` here reads as "your delete already happened", so the agent stops
    // asking — and the Brief it reported deleted is still sitting here.
    expect(existsSync(path)).toBe(true);
  });

  it("AC6 — `briefs` present as a regular FILE (ENOTDIR) reaches the same answer through a different mechanism", async () => {
    // EACCES and ENOTDIR are distinct: an `isDirectory()` guard passes one and not the
    // other. The agent-facing answer must not depend on which one the store hit.
    seedShopper();
    seedBrief();
    expect((await call("shopping_doc_read", { ref: "brief:chamonix" }))["status"]).toBe("ok");

    replaceDirWithFile(briefsDir());

    const read = await call("shopping_doc_read", { ref: "brief:chamonix" });
    expect(read["status"]).toBe("unreadable");
    expect(read["recovery"]).toBe("inspect_document");
  });
});

/**
 * THE OTHER DIRECTION, and the more expensive one to get wrong. `unreadable` is the
 * answer that STOPS the agent: a false one is not a cosmetic wrong answer, it is a
 * refusal to shop. A shopper who has simply never written a Brief must never be told
 * their store is corrupt.
 *
 * AC7 (a miss inside a LISTABLE, non-empty `briefs/`) has no bar here, for AC14's
 * reason: `tools/doc-surface.test.ts` G4 pins `not_found` on `brief:never-existed`
 * inside a populated `briefs/`, at this same boundary. Measured — an over-broad read
 * gate reds G4 beside AC8 / AC9 / AC23. Do not re-add it.
 */
describe("…and real absence still reads as absence", () => {
  it("AC8 — an ABSENT `briefs/` is the normal mintable state: `not_found` on read, `ok` on create (beat 1, fresh machine)", async () => {
    seedShopper();
    expect(existsSync(briefsDir())).toBe(false); // guard-of-the-guard

    expect((await call("shopping_doc_read", { ref: "brief:chamonix" }))["status"]).toBe("not_found");
    expect(
      (await call("shopping_doc_write", { ref: "brief:chamonix", mode: "create", title: "Chamonix", body: "## Items\n" }))["status"],
    ).toBe("ok");
  });

  it("AC9 — a genuinely empty store is an ANSWERED emptiness, never a fault", async () => {
    mkdirSync(shopperDir(), { recursive: true, mode: 0o700 });

    expect((await call("shopping_doc_read", { ref: "shopper" }))["status"]).toBe("not_found");

    const found = await call("shopping_doc_find");
    expect(found["status"]).toBe("ok");
    expect(found).not.toHaveProperty("shopper");
    expect(found["briefs"]).toEqual([]);
    expect(found["unreadable"]).toEqual([]);
  });

  it.skipIf(AS_ROOT)("AC10 — at `briefs/` 0o300 the probe fires on the MISS, not on the directory: the read is `ok`, and find still names it", async () => {
    seedShopper();
    seedBrief("chamonix", "## Items\n| skis |  | open |\n\n### skis\nthe buyer's own words\n");

    const [read, found] = await underMode(briefsDir(), 0o300, async () => [
      await call("shopping_doc_read", { ref: "brief:chamonix" }),
      await call("shopping_doc_find"),
    ]);

    // The store CAN hand this document over. A probe on the DIRECTORY downgrades it to
    // `unreadable` and sends the buyer to repair a store that works.
    expect(read["status"]).toBe("ok");
    expect(String(read["body"])).toContain("the buyer's own words");
    // …while enumeration stays honestly partial. This is also the fault-injection
    // proof: over a listable `briefs/` the same call reports nothing.
    expect(reported(found)).toContain("briefs");
  });
});

describe("scope and agreement — one fault, one state, three surfaces", () => {
  it.skipIf(AS_ROOT)("AC11 — one broken directory never blacks out a ref it does not contain", async () => {
    seedShopper();
    seedBrief();

    const read = await underMode(briefsDir(), 0o000, async () => {
      // Guard-of-the-guard: the fault is REALLY injected — this is the listing the
      // store is about to fail at.
      expect(() => readdirSync(briefsDir())).toThrow();
      return call("shopping_doc_read", { ref: "shopper" });
    });

    expect(read["status"]).toBe("ok");
    expect(read["fields"]).toMatchObject({ name: "Ioannis" });
    expect(String(read["body"])).toContain("Buys once and keeps it.");
  });

  it.skipIf(AS_ROOT)("AC12 — the two AGENT verbs describe one state: find names `briefs`, and read does not call the document absent", async () => {
    seedShopper();
    seedBrief();

    const [found, read] = await underMode(briefsDir(), 0o000, async () => [
      await call("shopping_doc_find"),
      await call("shopping_doc_read", { ref: "brief:chamonix" }),
    ]);

    expect(reported(found)).toContain("briefs");
    // Sharper than the operator/agent split: `not_found` here would have the same
    // surface contradict itself inside one call pair.
    expect(read["status"]).not.toBe("not_found");
  });

  it.skipIf(AS_ROOT)("AC13 — the OPERATOR and AGENT surfaces agree: sil_doctor is unhealthy about `shopper/briefs`, and the read does not call the document absent", async () => {
    seedShopper();
    seedBrief();

    // Guard-of-the-guard: with a real `briefs/` the doctor is quiet and healthy, so
    // the finding below is caused by the fault and nothing else.
    const before = await runDoctor();
    expect(before.healthy).toBe(true);

    const [report, read] = await underMode(briefsDir(), 0o000, async () => [
      await runDoctor(),
      await call("shopping_doc_read", { ref: "brief:chamonix" }),
    ]);

    expect(report.findings.filter((f) => f.id === "fs.unreadable_dir:shopper/briefs")).toEqual([
      expect.objectContaining({ severity: "warn" }),
    ]);
    expect(report.healthy).toBe(false);
    expect(read["status"]).not.toBe("not_found");
  });
});

/**
 * THE ROOT'S OWN TWO DOORS — neither of which `briefs/` reaches, and both of which
 * survive `shopperDirError()`. It early-outs on `!existsSync(shopper)`, so an
 * un-stat-able `$SIL_DATA_DIR` is recorded as "there is no store"; and at `shopper/`
 * 0o400 its `readdirSync` probe SUCCEEDS while every child stat EACCESes — the state a
 * listability probe cannot see, and the only one where the operator surface is blind
 * too.
 */
describe("the ROOT's own two doors — an un-stat-able data dir, and a `shopper/` that lists but does not traverse", () => {
  it.skipIf(AS_ROOT)("AC17 — with `$SIL_DATA_DIR` itself at 0o000, shopping_doc_read {ref: shopper} answers `unreadable`", async () => {
    seedShopper();
    expect((await call("shopping_doc_read", { ref: "shopper" }))["status"]).toBe("ok"); // guard-of-the-guard

    const read = await underMode(dataDir, 0o000, () => call("shopping_doc_read", { ref: "shopper" }));

    expect(read["status"]).toBe("unreadable");
    expect(read["recovery"]).toBe("inspect_document");
  });

  it.skipIf(AS_ROOT)("AC18 — …and shopping_doc_find names the store rather than answering a CLEAN empty one", async () => {
    seedShopper();
    seedBrief();

    const healthy = await call("shopping_doc_find");
    expect(healthy["unreadable"]).toEqual([]); // guard-of-the-guard

    const found = await underMode(dataDir, 0o000, () => call("shopping_doc_find"));

    expect(found["status"]).toBe("ok");
    // A clean empty result is what `checkStore()` turns into zero findings — the
    // doctor believing a locked store is a healthy one.
    expect(found["unreadable"]).not.toEqual([]);
    expect(reported(found)).toContain("shopper");
  });

  it.skipIf(AS_ROOT)("AC19 — at `shopper/` 0o400 the listing SUCCEEDS and every child stat EACCESes: the read answers `unreadable`", async () => {
    seedShopper();
    expect((await call("shopping_doc_read", { ref: "shopper" }))["status"]).toBe("ok"); // guard-of-the-guard

    const read = await underMode(shopperDir(), 0o400, async () => {
      // The state's whole signature, asserted so this bar cannot pass on the wrong
      // fault: the directory lists (a listability probe sees nothing) while
      // `existsSync` on the document sitting right there answers false.
      expect(readdirSync(shopperDir())).toContain("user_spec.md");
      expect(existsSync(join(shopperDir(), "user_spec.md"))).toBe(false);
      return call("shopping_doc_read", { ref: "shopper" });
    });

    expect(read["status"]).toBe("unreadable");
    expect(read["recovery"]).toBe("inspect_document");
  });

  it.skipIf(AS_ROOT)("AC20 — …and shopping_doc_find names BOTH the shopper and `briefs` in unreadable[]", async () => {
    seedShopper();
    seedBrief();

    const healthy = await call("shopping_doc_find");
    expect(healthy["unreadable"]).toEqual([]); // guard-of-the-guard

    const found = await underMode(shopperDir(), 0o400, () => call("shopping_doc_find"));

    expect(found["status"]).toBe("ok");
    const ids = (found["unreadable"] as Array<{ id: string }>).map((u) => u.id);
    expect(ids).toContain("shopper");
    expect(ids.filter((id) => id.includes("briefs"))).not.toEqual([]);
  });

  it.skipIf(AS_ROOT)("AC21 — sil_doctor is `healthy: false` with a store.unreadable finding — today the ONE state no surface sees", async () => {
    seedShopper();
    seedBrief();

    // Guard-of-the-guard: healthy and silent about the store beforehand. The walk's
    // per-entry `lstat` EACCES is swallowed as the vanished-tmp-file race and
    // `tightenMode` ignores a too-TIGHT mode, so `find` is the only reporter left.
    const before = await runDoctor();
    expect(before.healthy).toBe(true);
    expect(before.findings.filter((f) => f.id.startsWith("store.unreadable:"))).toEqual([]);

    const report = await underMode(shopperDir(), 0o400, () => runDoctor());

    expect(report.findings.filter((f) => f.id.startsWith("store.unreadable:"))).not.toEqual([]);
    expect(report.healthy).toBe(false);
  });

  it.skipIf(AS_ROOT)("AC22 — the create-shopper bin's singleton pre-flight fails CLOSED at `shopper/` 0o400, over a buyer it cannot see", () => {
    seedShopper();
    const specPath = join(shopperDir(), "user_spec.md");
    const before = readFileSync(specPath, "utf8");

    // Guard-of-the-guard: readable, this same store makes the bin REFUSE — proof it
    // reaches the pre-flight and reads this person.
    expect(runCreateShopper().marker["status"]).toBe("collision");

    chmodSync(shopperDir(), 0o400);
    const locked = runCreateShopper();
    // Restored first: a failed assertion must not poison the afterEach cleanup.
    chmodSync(shopperDir(), 0o700);

    expect(locked.status).not.toBe(0);
    expect(locked.stdout).not.toContain("sil_shopper_created");
    expect(locked.marker["status"]).toBe("persistence_failed");
    // It fails HERE, at the store it could not read — not two steps later at the host
    // CLI. `path` is the only field that tells those two apart.
    expect(locked.marker["path"]).toBe(shopperDir());
    expect(String(locked.marker["cause"])).toMatch(/degraded/);
    // The person is exactly as they were — no second shopper minted over them.
    expect(readFileSync(specPath, "utf8")).toBe(before);
  });

  it("AC23 — with NO `shopper/` at all: an empty store, `not_found`, and a mint that lands (the bar that stops the fix bricking onboarding)", async () => {
    expect(existsSync(shopperDir())).toBe(false); // guard-of-the-guard: a fresh machine

    const found = await call("shopping_doc_find");
    expect(found["status"]).toBe("ok");
    expect(found).not.toHaveProperty("shopper");
    expect(found["briefs"]).toEqual([]);
    expect(found["unreadable"]).toEqual([]);

    expect((await call("shopping_doc_read", { ref: "shopper" }))["status"]).toBe("not_found");

    // The bin's singleton gate OPENS on "nothing yet": it walks PAST the store
    // pre-flight and dies at the host CLI, which is absent from PATH by design — so
    // `path` is the config it could not drive, never the store, and the cause is not
    // the degraded-store refusal. (The end-to-end mint from this same baseline is
    // `create-shopper.integration.test.ts`'s happy path.)
    const fresh = runCreateShopper();
    expect(fresh.marker["status"]).toBe("persistence_failed");
    expect(fresh.marker["path"]).toBe(join(dataDir, "openclaw.json"));
    expect(String(fresh.marker["cause"])).not.toMatch(/degraded/);

    // …and the mint itself lands: `create` over an absent store directory is beat 1,
    // not a fault.
    expect(
      (await call("shopping_doc_write", { ref: "shopper", mode: "create", name: "Ioannis", body: "## Who\nnew here\n" }))["status"],
    ).toBe("ok");
  });
});
