/**
 * INTEGRATION — Migration #1 (0.3.x legacy → 0.4.x frontmatter-as-truth) + the
 * on-load self-migrate gate, driven through a REAL registered tool `execute()`
 * against a real temp $SIL_DATA_DIR seeded with a v0.3.9 legacy tree (tier:
 * integration, real fs, no network, no host).
 *
 * Card: versioned-store-migrations-on-load-self-migrate. THESE ASSERTIONS ARE THE
 * SPEC (RED-first). Incident #2: `0.3.7 → 0.4.0` dropped `profile.json` for
 * frontmatter-as-truth with no back-compat, so every pre-existing store went
 * `unreadable` and the shopper vanished. This file pins the resurrection:
 *
 *   - AC1 resurrection / preservation floor — the legacy `profile.json` name + the
 *     frontmatter-LESS legacy `user_spec.md` body fold into ONE frontmatter-as-truth
 *     `user_spec.md` (non-blank frontmatter `name` == the legacy name, body preserved
 *     byte-for-byte); the shopper reads as existing again.
 *   - AC2 silent success + per-process memo — the triggering tool returns its NORMAL
 *     result (no prompt / confirmation / re-onboarding); a second touch never re-migrates.
 *   - AC4 fail-closed revert — a forced Migration #1 failure reverts to the BYTE-EXACT
 *     pre-migration store, does NOT advance the version, fails the tool closed with a
 *     structured status + recovery hint, and the store still reads its honest prior state.
 *   - AC6 un-revertable revert — a failure whose revert ALSO fails surfaces the DISTINCT,
 *     louder `reverted:false` (store-left-dirty), never green-washed as a clean revert.
 *   - AC7 idempotent no-op — an already-current store rewrites nothing.
 *   - AC8 never fabricate — a fresh/empty store creates no shopper + invents no user_spec/
 *     name; it just stamps the current version.
 *   - Heal-before-serve / on-load gate — the migration runs on the first store-path tool
 *     `execute()`, NOT in register(); a behind-version store does not serve until healed.
 *
 * The legacy fixture is built from the REAL v0.3.9 store shape (`git show
 * v0.3.9:src/lib/profile-store.ts`): `shopper/{user_spec.md (frontmatter-LESS body),
 * profile.json (the { name, userSpecPath, createdAt, domains } manifest)}` and
 * `shopper/domains/<slug>/{domain_spec.md, intent_spec.md, playbook.md}` (all
 * frontmatter-less bodies). No stubbed store — the migration's whole point is real
 * prior data.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - src/lib/migrations/runner.ts exports `ensureStoreMigrated(): MigrationRunResult`,
 *     the memoized on-load gate wired as the FIRST line of the five store primitives in
 *     profile-store.ts (searchProfileFrontmatter / readArtefactBody / learnArtefact /
 *     materializeProfile / removeArtefact). The memo MUST key on the resolved data dir
 *     (NOT a single global slot) so that (a) AC2 holds within a process and (b) each
 *     hermetic test with a fresh $SIL_DATA_DIR re-arms the gate — the whole suite below
 *     depends on this, since with pool:'forks' + isolate all tests in this file share the
 *     module-level memo.
 *   - src/tools/profile.ts `mapFailure` gains a `status:"migration_failed"` arm that
 *     surfaces `reverted` (+ version, reason, recovery) so the agent distinguishes
 *     "safely reverted, prior state intact" from "store left dirty".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  statSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerProfileTools } from "../tools/profile.js";
import { readShopperIdentity } from "../lib/profile-store.js";
import { readStoreVersion } from "../lib/migrations/runner.js";
import { CURRENT_STORE_VERSION } from "../lib/migrations/registry.js";
import {
  createMockPluginApi,
  getTool,
  type MockPluginAPI,
} from "./helpers/mock-plugin-api.js";

const SEARCH = "sil_profile_search";
const GET = "sil_profile_get";
const MATERIALIZE = "sil_profile_materialize";
const MARKER = "store-format.json";
const BACKUP_DIR = ".sil-migration-backup";

const AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

let dataDir: string;
let priorSilDataDir: string | undefined;
let api: MockPluginAPI;

function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error(`tool result has no text payload: ${String(text)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function shopperDir(): string {
  return join(dataDir, "shopper");
}
function domainDir(slug: string): string {
  return join(shopperDir(), "domains", slug);
}

// ---------------------------------------------------------------------------
// The REAL v0.3.9 legacy tree (git show v0.3.9:src/lib/profile-store.ts):
//   shopper/user_spec.md   — a FRONTMATTER-LESS plain body (name lived in profile.json).
//   shopper/profile.json   — { name, userSpecPath, createdAt, domains: {<slug>: {...}} }.
//   shopper/domains/<slug>/{domain_spec.md, intent_spec.md, playbook.md} — plain bodies.
// Distinctive tokens per body so preservation (or its loss) is unambiguous.
// ---------------------------------------------------------------------------

const LEGACY_NAME = "Ada Lovelace";
const LEGACY_USER_SPEC =
  "# The person\n- Ships to Berlin.\n- HARD-NO: leather.\n- USERSPEC-TOKEN-Δ (must survive)\n";

interface LegacyDomain {
  slug: string;
  name: string;
  domainSpec: string;
  intentSpec: string;
  playbook: string;
}

const SKI: LegacyDomain = {
  slug: "ski",
  name: "Ski",
  domainSpec: "# Ski domain guide\nDOMAINSPEC-TOKEN-α\n",
  intentSpec: "# Ski intent dimensions\nINTENTSPEC-TOKEN-β\n",
  playbook: "# Ski taste\nPLAYBOOK-TOKEN-γ\n",
};
const ESPRESSO: LegacyDomain = {
  slug: "espresso",
  name: "Espresso",
  domainSpec: "# Espresso domain guide\nDOMAINSPEC-TOKEN-ε\n",
  intentSpec: "# Espresso intent dimensions\nINTENTSPEC-TOKEN-ζ\n",
  playbook: "# Espresso taste\nPLAYBOOK-TOKEN-η\n",
};

interface SeedOptions {
  name?: string;
  userSpec?: string;
  domains?: LegacyDomain[];
}

/** Write a faithful v0.3.9 legacy store under `$SIL_DATA_DIR/shopper`. */
function seedLegacyStore(opts: SeedOptions = {}): void {
  const name = opts.name ?? LEGACY_NAME;
  const userSpec = opts.userSpec ?? LEGACY_USER_SPEC;
  const domains = opts.domains ?? [SKI];
  const dir = shopperDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const userSpecPath = join(dir, "user_spec.md");
  // FRONTMATTER-LESS body — exactly how v0.3.9 atomicWrite(userSpecPath, spec.userSpec) wrote it.
  writeFileSync(userSpecPath, userSpec, { mode: 0o600 });

  const now = "2025-01-01T00:00:00.000Z";
  const manifestDomains: Record<string, unknown> = {};
  for (const d of domains) {
    const leaf = domainDir(d.slug);
    mkdirSync(leaf, { recursive: true, mode: 0o700 });
    writeFileSync(join(leaf, "domain_spec.md"), d.domainSpec, { mode: 0o600 });
    writeFileSync(join(leaf, "intent_spec.md"), d.intentSpec, { mode: 0o600 });
    writeFileSync(join(leaf, "playbook.md"), d.playbook, { mode: 0o600 });
    manifestDomains[d.slug] = {
      slug: d.slug,
      name: d.name,
      domainSpecPath: join(leaf, "domain_spec.md"),
      intentSpecPath: join(leaf, "intent_spec.md"),
      playbookPath: join(leaf, "playbook.md"),
      createdAt: now,
      updatedAt: now,
    };
  }
  const manifest = { name, userSpecPath, createdAt: now, domains: manifestDomains };
  writeFileSync(join(dir, "profile.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
}

/** Snapshot every file under the shopper subtree as relPath → bytes (for byte-exact
 * revert assertions). */
function snapshotShopper(): Map<string, string> {
  const out = new Map<string, string>();
  const root = shopperDir();
  if (!existsSync(root)) return out;
  for (const rel of readdirSync(root, { recursive: true }) as string[]) {
    const abs = join(root, rel);
    if (statSync(abs).isFile()) out.set(rel, readFileSync(abs, "utf8"));
  }
  return out;
}

/** Parse the `--- k: v --- body` of a written artefact. */
function parseArtefact(raw: string): { fields: Record<string, string>; body: string } {
  expect(raw.startsWith("---")).toBe(true);
  const close = raw.slice(3).match(/\n---[ \t]*\r?\n/)!;
  const fmRaw = raw.slice(3, 3 + close.index!);
  const body = raw.slice(3 + close.index! + close[0].length);
  const fields: Record<string, string> = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m && m[2] !== "") fields[m[1] as string] = (m[2] as string).trim();
  }
  return { fields, body };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-store-mig-integ-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  api = createMockPluginApi();
  registerProfileTools(api);
});

afterEach(() => {
  // Defensive: restore perms an AC6-style test may have dropped, so teardown succeeds.
  try {
    chmodSync(shopperDir(), 0o700);
  } catch {
    /* dir may not exist */
  }
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

// ===========================================================================
// Heal-before-serve / on-load gate — the migration runs on the first store-path
// tool execute(), NOT at register(); a behind-version store does not serve until
// healed. This is the exact step missing when incident #2 happened.
// ===========================================================================
describe("on-load gate — heal on first tool execute(), NEVER at register()", () => {
  it("registerProfileTools() does NOT migrate — the legacy store is untouched after register (register opens nothing)", () => {
    seedLegacyStore();
    // register() already ran in beforeEach. The sync/opens-nothing invariant forbids
    // migrating here — so the legacy signature must still be fully present.
    expect(existsSync(join(shopperDir(), "profile.json"))).toBe(true);
    expect(existsSync(join(dataDir, MARKER))).toBe(false);
    expect(existsSync(join(domainDir("ski"), "domain_spec.md"))).toBe(true);
  });

  it("the FIRST store-path tool execute() heals the store before it serves (profile.json consumed, marker stamped)", async () => {
    seedLegacyStore();
    // A behind-version store must not serve stale — the gate heals first.
    await getTool(api, SEARCH).execute("g1", {});
    expect(existsSync(join(shopperDir(), "profile.json"))).toBe(false);
    expect(readStoreVersion(dataDir)).toBe(CURRENT_STORE_VERSION);
  });

  it("the gate is on MULTIPLE store primitives, not one tool — sil_profile_get also triggers the heal", async () => {
    seedLegacyStore();
    // Drive a DIFFERENT gated primitive (readArtefactBody) as the first touch.
    await getTool(api, GET).execute("g2", { domainSlug: "ski" });
    expect(existsSync(join(shopperDir(), "profile.json"))).toBe(false);
    expect(readStoreVersion(dataDir)).toBe(CURRENT_STORE_VERSION);
  });
});

// ===========================================================================
// AC1 — resurrection / preservation floor. The shopper survives ⇔ user_spec.md
// exists with a non-blank frontmatter name AND the legacy user_spec body is preserved.
// ===========================================================================
describe("AC1 — resurrection: the preservation floor holds after Migration #1", () => {
  it("folds the legacy name + frontmatter-less user_spec body into ONE frontmatter-as-truth user_spec.md (name preserved, body preserved byte-for-byte)", async () => {
    seedLegacyStore();
    await getTool(api, SEARCH).execute("a1", {});

    const userSpecPath = join(shopperDir(), "user_spec.md");
    expect(existsSync(userSpecPath)).toBe(true);
    const raw = readFileSync(userSpecPath, "utf8");
    const { fields, body } = parseArtefact(raw);
    // Floor part 1: a NON-BLANK frontmatter name == the legacy profile.json name.
    expect(fields["name"]).toBe(LEGACY_NAME);
    expect(fields["name"]!.trim().length).toBeGreaterThan(0);
    // Floor part 2: the legacy body is preserved byte-for-byte (the store only appends a
    // trailing newline, never rewrites content — so the raw legacy body is a substring).
    expect(raw).toContain(LEGACY_USER_SPEC.trimEnd());
    expect(body).toContain("USERSPEC-TOKEN-Δ (must survive)");
    expect(body).toContain("HARD-NO: leather.");
  });

  it("readShopperIdentity returns the resurrected name — the shopper reads as existing again (no re-onboarding)", async () => {
    seedLegacyStore();
    // Pre-flight before the heal: the legacy frontmatter-less user_spec reads unreadable.
    expect(readShopperIdentity().name).toBeUndefined();

    await getTool(api, SEARCH).execute("a2", {});

    const identity = readShopperIdentity();
    expect(identity.name).toBe(LEGACY_NAME);
    expect(identity.unreadable).toEqual([]);
  });

  it("records the store-format version as current after a successful heal", async () => {
    seedLegacyStore();
    await getTool(api, SEARCH).execute("a3", {});
    expect(readStoreVersion(dataDir)).toBe(CURRENT_STORE_VERSION);
  });

  it("preserves the per-domain legacy triple LOSSLESSLY into method.md and deletes the legacy files — across ALL domains", async () => {
    seedLegacyStore({ domains: [SKI, ESPRESSO] });
    await getTool(api, SEARCH).execute("a4", {});

    for (const d of [SKI, ESPRESSO]) {
      const methodPath = join(domainDir(d.slug), "method.md");
      expect(existsSync(methodPath)).toBe(true);
      const raw = readFileSync(methodPath, "utf8");
      const { fields } = parseArtefact(raw);
      // Method frontmatter carries a non-blank name + the domain coordinate.
      expect(fields["name"]!.trim().length).toBeGreaterThan(0);
      expect(fields["domain"]).toBe(d.slug);
      // LOSSLESS: all three legacy bodies survive verbatim (headings are the dev's call —
      // the invariant is that not one body is dropped).
      for (const token of [d.domainSpec, d.intentSpec, d.playbook]) {
        expect(raw).toContain(token.split("\n")[1]!); // the distinctive token line
      }
      // The three deleted legacy files are GONE (converted, not left as dead bytes).
      expect(existsSync(join(domainDir(d.slug), "domain_spec.md"))).toBe(false);
      expect(existsSync(join(domainDir(d.slug), "intent_spec.md"))).toBe(false);
      expect(existsSync(join(domainDir(d.slug), "playbook.md"))).toBe(false);
    }
    // No manifest survives the frontmatter-as-truth conversion.
    expect(existsSync(join(shopperDir(), "profile.json"))).toBe(false);
  });

  it("does NOT fabricate methods/PRDs from the deleted triple — no prds/ dir is invented", async () => {
    seedLegacyStore();
    await getTool(api, SEARCH).execute("a5", {});
    // The triple folds into method.md ONLY — a PRD is buyer requirements, never in the
    // legacy per-domain data, so no PRD may be conjured.
    expect(existsSync(join(domainDir("ski"), "prds"))).toBe(false);
  });
});

// ===========================================================================
// AC2 — silent success + per-process memo.
// ===========================================================================
describe("AC2 — silent success on heal; the migration never re-runs in-process", () => {
  it("the triggering tool returns its NORMAL result — no prompt / confirmation / re-onboarding / migration noise", async () => {
    seedLegacyStore();
    const payload = payloadOf(await getTool(api, SEARCH).execute("s1", {}));
    // The search just returns its normal ok result over the healed store.
    expect(payload["status"]).toBe("ok");
    const domains = payload["domains"] as Array<Record<string, unknown>>;
    expect(domains.map((d) => d["slug"])).toContain("ski");
    // Silent = no migration/onboarding signal is added to the success envelope.
    for (const key of ["migration", "migrated", "prompt", "confirm", "reonboard", "onboarding"]) {
      expect(payload).not.toHaveProperty(key);
    }
    // A healed identity-carrying store with a domain is a MATCH → no mint trigger either.
    expect(payload).not.toHaveProperty("next_step");
  });

  it("a second store-path touch never re-migrates — the gate is memoized per process/data-dir", async () => {
    seedLegacyStore();
    // First touch heals (marker → current, profile.json consumed).
    await getTool(api, SEARCH).execute("m1", {});
    expect(readStoreVersion(dataDir)).toBe(CURRENT_STORE_VERSION);

    // Adversarial memo probe: DELETE the marker AND re-drop a fresh legacy profile.json.
    // If the gate re-ran, it would read the (now-absent) marker as 0, detect the legacy
    // signature, and RE-MIGRATE (consuming profile.json + re-stamping). If it is memoized,
    // it returns the cached result and touches nothing.
    rmSync(join(dataDir, MARKER), { force: true });
    writeFileSync(join(shopperDir(), "profile.json"), '{"name":"x","userSpecPath":"","createdAt":"","domains":{}}', {
      mode: 0o600,
    });

    await getTool(api, SEARCH).execute("m2", {});

    // Memoized: the re-dropped profile.json is untouched and no new marker was written.
    expect(existsSync(join(shopperDir(), "profile.json"))).toBe(true);
    expect(existsSync(join(dataDir, MARKER))).toBe(false);
  });
});

// ===========================================================================
// AC4 — fail-closed revert to the BYTE-EXACT prior state (Migration #1 forced to
// fail). A legacy profile.json whose `name` is blank is genuine corruption:
// Migration #1 throws rather than fabricate a name → the runner reverts.
// ===========================================================================
describe("AC4 — a failed Migration #1 reverts to the byte-exact prior store + fails the tool closed", () => {
  it("reverts every byte, does NOT advance the version, and the store still reads its honest prior (unreadable) state", async () => {
    // A blank name in profile.json = corruption Migration #1 must refuse (never fabricate).
    seedLegacyStore({ name: "   " });
    const before = snapshotShopper();

    const payload = payloadOf(await getTool(api, SEARCH).execute("f1", {}));

    // The tool fails closed with a structured migration failure + recovery hint.
    expect(payload["status"]).toBe("migration_failed");
    expect(payload["reverted"]).toBe(true);
    expect(typeof payload["recovery"]).toBe("string");
    expect((payload["recovery"] as string).length).toBeGreaterThan(0);
    expect(String(payload["message"] ?? payload["reason"]).length).toBeGreaterThan(0);

    // Byte-exact restore: every file identical to the pre-migration snapshot, nothing added.
    const after = snapshotShopper();
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [rel, bytes] of before) expect(after.get(rel)).toBe(bytes);

    // The version is NOT advanced — a still-legacy store is not falsely "current".
    expect(readStoreVersion(dataDir)).toBe(0);
    // Honest prior state: the frontmatter-less user_spec still reads unreadable (no name),
    // never a false-healthy shopper.
    expect(readShopperIdentity().name).toBeUndefined();
    expect(readShopperIdentity().unreadable.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC6 — un-revertable revert (the louder honesty rail). A failure whose revert-
// from-backup ALSO fails surfaces reverted:false (store-left-dirty), never a clean
// revert. Real-fs fault injection: shopper/ is chmod 0500, so apply's first write
// EACCESes (failure) AND the revert's rmSync of shopper's children EACCESes (revert
// fails) — while the data-dir root stays writable so the backup snapshot still succeeds.
// Skipped as root (root bypasses the permission bits).
// ===========================================================================
describe("AC6 — an un-revertable revert is a DISTINCT louder outcome (never green-washed)", () => {
  it.skipIf(AS_ROOT)(
    "a failed heal whose backup-restore also fails surfaces reverted:false + names the store as left-dirty",
    async () => {
      seedLegacyStore();
      // Drop write on the shopper subtree AFTER seeding: apply can't write (→ failure) and
      // the revert's rmSync can't remove shopper's children (→ revert fails). The data-dir
      // root stays 0700 so the backup snapshot under .sil-migration-backup still succeeds.
      chmodSync(shopperDir(), 0o500);

      let payload: Record<string, unknown>;
      try {
        payload = payloadOf(await getTool(api, SEARCH).execute("d1", {}));
      } finally {
        chmodSync(shopperDir(), 0o700);
      }

      expect(payload["status"]).toBe("migration_failed");
      // The louder rail: revert could NOT be guaranteed → reverted:false, NOT true.
      expect(payload["reverted"]).toBe(false);
      // The message tells the agent the store is left dirty / to inspect it — never a
      // green-washed clean revert.
      expect(typeof payload["recovery"]).toBe("string");
      expect((payload["recovery"] as string).length).toBeGreaterThan(0);
      expect(String(payload["message"] ?? payload["reason"])).toMatch(
        /dirt|inspect|manual|revert|left|restore|recover|inconsist|backup/i,
      );
      // The version is NOT advanced (a failed heal never records success).
      expect(readStoreVersion(dataDir)).toBe(0);
      // The backup is retained for recovery.
      expect(existsSync(join(dataDir, BACKUP_DIR))).toBe(true);
    },
  );
});

// ===========================================================================
// AC7 — idempotent no-op on an already-current REAL store: rewrites nothing.
// ===========================================================================
describe("AC7 — an already-current store is a no-op (no file / marker / version churn)", () => {
  it("no shopper file mtimes change, the marker is untouched, and no backup is created", async () => {
    // Build a real CURRENT-format store, then stamp the marker to current.
    await getTool(api, MATERIALIZE).execute("i0", {
      name: "sil shopper",
      userSpec: "# person\n- ships to Berlin\n",
    });
    writeFileSync(join(dataDir, MARKER), JSON.stringify({ version: CURRENT_STORE_VERSION }), { mode: 0o600 });

    // Snapshot mtimes of everything under shopper/ + the marker.
    const mtimes = new Map<string, number>();
    for (const rel of readdirSync(shopperDir(), { recursive: true }) as string[]) {
      const abs = join(shopperDir(), rel);
      if (statSync(abs).isFile()) mtimes.set(rel, statSync(abs).mtimeMs);
    }
    const markerMtime = statSync(join(dataDir, MARKER)).mtimeMs;

    const payload = payloadOf(await getTool(api, SEARCH).execute("i1", {}));
    expect(payload["status"]).toBe("ok");

    // Zero churn: every mtime identical, marker untouched, no backup dir.
    for (const [rel, was] of mtimes) {
      expect(statSync(join(shopperDir(), rel)).mtimeMs).toBe(was);
    }
    expect(statSync(join(dataDir, MARKER)).mtimeMs).toBe(markerMtime);
    expect(readStoreVersion(dataDir)).toBe(CURRENT_STORE_VERSION);
    expect(existsSync(join(dataDir, BACKUP_DIR))).toBe(false);
  });
});

// ===========================================================================
// AC8 — never fabricate identity: a fresh/empty store creates no shopper + invents
// no user_spec/name; it stamps the current version (or no-ops).
// ===========================================================================
describe("AC8 — a fresh/empty store is never conjured into a shopper", () => {
  it("no shopper/user_spec.md is created, no name is fabricated, and the marker is stamped to current", async () => {
    // A totally empty data dir — no shopper subtree at all (a clean install).
    expect(existsSync(shopperDir())).toBe(false);

    const payload = payloadOf(await getTool(api, SEARCH).execute("e1", {}));
    expect(payload["status"]).toBe("ok");

    // Migration heals; it never conjures — no shopper artefact was fabricated.
    expect(existsSync(join(shopperDir(), "user_spec.md"))).toBe(false);
    expect(readShopperIdentity().name).toBeUndefined();
    // But the version IS stamped so a fresh install is not re-probed every touch.
    expect(readStoreVersion(dataDir)).toBe(CURRENT_STORE_VERSION);
    // Nothing was migrated → no backup dir.
    expect(existsSync(join(dataDir, BACKUP_DIR))).toBe(false);
  });

  it("a store already in the new format (user_spec present, no profile.json) is NOT re-transformed — only stamped", async () => {
    // A 0.4.x store created before this framework: new-format, no marker, no profile.json.
    await getTool(api, MATERIALIZE).execute("e2", {
      name: "sil shopper",
      userSpec: "# person\n- NEW-FORMAT-TOKEN\n",
    });
    const userSpecBefore = readFileSync(join(shopperDir(), "user_spec.md"), "utf8");
    expect(existsSync(join(dataDir, MARKER))).toBe(false); // pre-framework: no marker yet

    await getTool(api, SEARCH).execute("e3", {});

    // detectApplicable is false (no profile.json) → record the version, touch nothing.
    expect(readStoreVersion(dataDir)).toBe(CURRENT_STORE_VERSION);
    expect(readFileSync(join(shopperDir(), "user_spec.md"), "utf8")).toBe(userSpecBefore);
    expect(existsSync(join(dataDir, BACKUP_DIR))).toBe(false);
  });
});
