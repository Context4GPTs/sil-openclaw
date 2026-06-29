/**
 * UNIT — the lightweight append-memory store primitive `appendProfileEntry`
 * (tier: unit, real temp dir via the SIL_DATA_DIR override, no network, no host).
 *
 * Card: sil-remember-append-memory-tool, updated for
 * consolidate-profile-tools-to-the-singleton-surface. `appendProfileEntry({ kind,
 * text, domain?, hard? })` is the cheap per-query persistence spine — it owns ALL
 * validation, active-domain resolution, the fail-closed existence gate, and the
 * O_APPEND write. The caller-supplied `agentId` is DROPPED (the store re-scopes to
 * the singleton); the taste `domain` slug guard SURVIVES (the slug is still
 * caller-supplied). The tool (profile-remember.test.ts) is a thin wrapper over it.
 *
 * Pinned here against the singleton layout (the SHARED user_spec.md + per-domain
 * playbook.md):
 *
 *   1. ROUTING — `kind:"fact"` → the agent-level `user_spec.md` ONLY; `kind:"taste"`
 *      → the ACTIVE domain's `playbook.md` ONLY. A `hard:true` fact is marked.
 *   2. O_APPEND — the prior body is preserved BYTE-FOR-BYTE; two appends BOTH land.
 *   3. VALIDATE-FIRST / WRITE-NOTHING — a blank text, a fact carrying a `domain`, a
 *      taste carrying `hard:true`, or a traversal/"main" taste `domain` slug → each
 *      `invalid_request` naming the field, writing NOTHING.
 *   4. FAIL-CLOSED `not_found` — append NEVER creates a file: NO shopper, a missing
 *      `user_spec` body, an unregistered domain, or a registered domain whose
 *      `playbook.md` body is gone → `not_found`.
 *   5. DOMAIN RESOLUTION — taste with `domain` omitted resolves the single
 *      registered domain; omitted + zero → `not_found`; omitted + 2+ →
 *      `invalid_request`.
 *   6. PERSISTENCE — a genuine fs failure → `persistence_failed`; the target file
 *      mode stays `0600` after a successful append.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  statSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendProfileEntry,
  materializeProfile,
  readAgentProfile,
  getShopperArtefactDir,
  getDomainArtefactDir,
  type ProfileSpec,
} from "../../lib/profile-store.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-remember-store-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    /* best-effort */
  }
  rmSync(dataDir, { recursive: true, force: true });
});

// NOTE the pre-existing "Hard constraints" header + "HARD-NO" line: the hard-fact
// marker assertions check the APPENDED DELTA, never the whole file, so this seed
// text can never false-green a /hard/ check.
const USER_SPEC_V1 =
  "# User spec (shared)\n## Standing facts\n- Ships to Berlin 10115.\n"
  + "## Hard constraints\n- HARD-NO: leather (ethics).";

const CYCLING = {
  slug: "road-cycling",
  name: "Road cycling",
  domainSpec: "# Road-cycling domain spec\nFit, gearing, geometry.",
  intentSpec: "# Intent spec — cycling\nuse-case, terrain, budget, timeline.",
  playbook: "# Taste — cycling\n~€1500; Shimano over SRAM.",
} as const;

const RUNNING = {
  slug: "running-shoes",
  name: "Running shoes",
  domainSpec: "# Running-shoe domain spec\nLast shape, stack, drop, foam.",
  intentSpec: "# Intent spec — running\nsurface, distance, gait, budget.",
  playbook: "# Taste — running\nUnder €160; neutral foam; no carbon plate.",
} as const;

function createShopper(userSpec = USER_SPEC_V1): void {
  const r = materializeProfile({ name: "sil shopper", userSpec });
  if (!r.ok) throw new Error(`createShopper failed: ${JSON.stringify(r)}`);
}

function mint(domain: ProfileSpec["domain"], userSpec = USER_SPEC_V1): void {
  const r = materializeProfile({ name: "sil shopper", userSpec, domain });
  if (!r.ok) throw new Error(`mint failed: ${JSON.stringify(r)}`);
}

function userSpecFile(): string {
  return join(getShopperArtefactDir(), "user_spec.md");
}
function playbookFile(slug: string): string {
  return join(getDomainArtefactDir(slug), "playbook.md");
}

// ===========================================================================
// 1 — routing: fact → agent-level user_spec only; taste → active playbook only
// ===========================================================================

describe("appendProfileEntry — kind:fact routes to the agent-level user_spec ONLY", () => {
  it("appends exactly ONE entry to user_spec.md, touches no playbook, and is visible from any domain read", () => {
    createShopper();
    mint(CYCLING);
    const before = readFileSync(userSpecFile(), "utf8");
    const cyclingPlaybookBefore = readFileSync(playbookFile(CYCLING.slug), "utf8");

    const text = "Waist measures 34 inches (stated while shopping).";
    const r = appendProfileEntry({ kind: "fact", text });
    expect(r.ok).toBe(true);

    const after = readFileSync(userSpecFile(), "utf8");
    const delta = after.slice(before.length);
    expect(after.startsWith(before)).toBe(true);
    expect(delta).toContain(text);
    expect(delta.split(text).length - 1).toBe(1);
    expect(/\[hard\]/i.test(delta)).toBe(false);

    // No playbook was touched.
    expect(readFileSync(playbookFile(CYCLING.slug), "utf8")).toBe(cyclingPlaybookBefore);

    // Visible from the overview AND from a domain read (carries across niches).
    const overview = readAgentProfile();
    expect(overview.ok && overview.userSpec.includes(text)).toBe(true);
    const cyclingRead = readAgentProfile(CYCLING.slug);
    expect(cyclingRead.ok && cyclingRead.userSpec.includes(text)).toBe(true);
  });

  it("a hard:true fact is marked UNAMBIGUOUSLY as a hard constraint (greppable by the reject-at-pick rule)", () => {
    createShopper();
    const before = readFileSync(userSpecFile(), "utf8");

    const text = "Severe tree-nut allergy — never anything processed with nuts.";
    const r = appendProfileEntry({ kind: "fact", text, hard: true });
    expect(r.ok).toBe(true);

    const delta = readFileSync(userSpecFile(), "utf8").slice(before.length);
    expect(delta).toContain(text);
    expect(/\[hard\]/i.test(delta)).toBe(true);
  });
});

describe("appendProfileEntry — kind:taste routes to the ACTIVE domain's playbook ONLY", () => {
  it("appends to that domain's playbook.md and to NEITHER a sibling playbook NOR user_spec", () => {
    createShopper();
    mint(CYCLING);
    mint(RUNNING);
    const cyclingBefore = readFileSync(playbookFile(CYCLING.slug), "utf8");
    const runningBefore = readFileSync(playbookFile(RUNNING.slug), "utf8");
    const userSpecBefore = readFileSync(userSpecFile(), "utf8");

    const text = "Leans Castelli over Rapha for bibs.";
    const r = appendProfileEntry({ kind: "taste", text, domain: CYCLING.slug });
    expect(r.ok).toBe(true);

    const cyclingAfter = readFileSync(playbookFile(CYCLING.slug), "utf8");
    expect(cyclingAfter.startsWith(cyclingBefore)).toBe(true);
    expect(cyclingAfter.slice(cyclingBefore.length)).toContain(text);
    expect(readFileSync(playbookFile(RUNNING.slug), "utf8")).toBe(runningBefore);
    expect(readFileSync(userSpecFile(), "utf8")).toBe(userSpecBefore);
  });
});

// ===========================================================================
// 2 — O_APPEND: prior body preserved byte-for-byte; two appends both land
// ===========================================================================

describe("appendProfileEntry — O_APPEND preserves the prior body and never loses an entry", () => {
  it("two sequential remembers both land at EOF, in order, with the prior bytes intact", () => {
    createShopper();
    const before = readFileSync(userSpecFile(), "utf8");

    const t1 = "Shoe size EU 43.";
    const t2 = "Allergic to wool.";
    expect(appendProfileEntry({ kind: "fact", text: t1 }).ok).toBe(true);
    expect(appendProfileEntry({ kind: "fact", text: t2 }).ok).toBe(true);

    const after = readFileSync(userSpecFile(), "utf8");
    expect(after.slice(0, before.length)).toBe(before);
    expect(after).toContain(t1);
    expect(after).toContain(t2);
    expect(after.indexOf(t1)).toBeLessThan(after.indexOf(t2));
    expect(after.indexOf(t1)).toBeGreaterThanOrEqual(before.length);
  });
});

// ===========================================================================
// 3 — validate-first / writes-nothing
// ===========================================================================

describe("appendProfileEntry — validate-first: a bad request writes NOTHING", () => {
  it.each(["", "   ", "\t\n"])(
    "rejects blank text %j → invalid_request(field=text), no write",
    (badText) => {
      createShopper();
      const before = readFileSync(userSpecFile(), "utf8");
      const r = appendProfileEntry({ kind: "fact", text: badText });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.kind).toBe("invalid_request");
      if (r.kind !== "invalid_request") return;
      expect(r.field).toBe("text");
      expect(readFileSync(userSpecFile(), "utf8")).toBe(before);
    },
  );

  it("a fact carrying a `domain` is a category error → invalid_request(field=domain), no write", () => {
    createShopper();
    mint(CYCLING);
    const userSpecBefore = readFileSync(userSpecFile(), "utf8");
    const playbookBefore = readFileSync(playbookFile(CYCLING.slug), "utf8");

    const r = appendProfileEntry({ kind: "fact", text: "a fact", domain: CYCLING.slug });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("invalid_request");
    if (r.kind !== "invalid_request") return;
    expect(r.field).toBe("domain");
    expect(readFileSync(userSpecFile(), "utf8")).toBe(userSpecBefore);
    expect(readFileSync(playbookFile(CYCLING.slug), "utf8")).toBe(playbookBefore);
  });

  it("a taste carrying `hard:true` is a contradiction → invalid_request(field=hard), no write", () => {
    createShopper();
    mint(CYCLING);
    const playbookBefore = readFileSync(playbookFile(CYCLING.slug), "utf8");

    const r = appendProfileEntry({
      kind: "taste",
      text: "always buys premium",
      domain: CYCLING.slug,
      hard: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("invalid_request");
    if (r.kind !== "invalid_request") return;
    expect(r.field).toBe("hard");
    expect(readFileSync(playbookFile(CYCLING.slug), "utf8")).toBe(playbookBefore);
  });

  it.each(["../escape", "a/../b", "road/cycling", "..", "main", "Road-Cycling"])(
    "a traversal/main taste `domain` slug %j → invalid_request(field=domain), no write (the slug guard survives the agentId drop)",
    (badSlug) => {
      createShopper();
      mint(CYCLING);
      const before = readFileSync(playbookFile(CYCLING.slug), "utf8");
      const r = appendProfileEntry({ kind: "taste", text: "a taste", domain: badSlug });
      expect(r.ok, `expected reject for ${JSON.stringify(badSlug)}`).toBe(false);
      if (r.ok) return;
      expect(r.kind).toBe("invalid_request");
      if (r.kind !== "invalid_request") return;
      expect(r.field).toBe("domain");
      expect(readFileSync(playbookFile(CYCLING.slug), "utf8")).toBe(before);
    },
  );
});

// ===========================================================================
// 4 — fail-closed not_found: append NEVER creates a file
// ===========================================================================

describe("appendProfileEntry — fail-closed: append never resurrects a seed-less doc", () => {
  it("a fact when NO shopper exists (no manifest) → not_found, no shopper dir / user_spec born", () => {
    const r = appendProfileEntry({ kind: "fact", text: "a fact" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not_found");
    expect(existsSync(getShopperArtefactDir())).toBe(false);
    expect(existsSync(userSpecFile())).toBe(false);
  });

  it("a fact when the shopper's user_spec BODY is gone → not_found (never re-created)", () => {
    createShopper();
    rmSync(userSpecFile(), { force: true });
    const r = appendProfileEntry({ kind: "fact", text: "a fact" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not_found");
    expect(existsSync(userSpecFile())).toBe(false);
  });

  it("a taste for an UNREGISTERED domain → not_found, no playbook born", () => {
    createShopper();
    mint(CYCLING);
    const r = appendProfileEntry({ kind: "taste", text: "a taste", domain: "never-minted" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not_found");
    expect(existsSync(playbookFile("never-minted"))).toBe(false);
  });

  it("a taste for a registered domain whose playbook BODY is gone → not_found (existence gate)", () => {
    createShopper();
    mint(CYCLING);
    rmSync(playbookFile(CYCLING.slug), { force: true });
    const r = appendProfileEntry({ kind: "taste", text: "a taste", domain: CYCLING.slug });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not_found");
    expect(existsSync(playbookFile(CYCLING.slug))).toBe(false);
  });
});

// ===========================================================================
// 5 — active-domain resolution (the `domain?` selector)
// ===========================================================================

describe("appendProfileEntry — active-domain resolution for a taste", () => {
  it("domain OMITTED + exactly one registered domain → resolves to it", () => {
    createShopper();
    mint(CYCLING); // the only domain
    const before = readFileSync(playbookFile(CYCLING.slug), "utf8");

    const text = "Prefers tubeless.";
    const r = appendProfileEntry({ kind: "taste", text });
    expect(r.ok).toBe(true);
    expect(readFileSync(playbookFile(CYCLING.slug), "utf8").slice(before.length)).toContain(text);
  });

  it("domain OMITTED + ZERO registered domains → not_found (mint the niche first)", () => {
    createShopper(); // no domains at all
    const r = appendProfileEntry({ kind: "taste", text: "a taste" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("not_found");
  });

  it("domain OMITTED + 2+ registered domains → invalid_request (ambiguous), no write to either", () => {
    createShopper();
    mint(CYCLING);
    mint(RUNNING);
    const cyclingBefore = readFileSync(playbookFile(CYCLING.slug), "utf8");
    const runningBefore = readFileSync(playbookFile(RUNNING.slug), "utf8");

    const r = appendProfileEntry({ kind: "taste", text: "a taste" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("invalid_request");
    if (r.kind !== "invalid_request") return;
    expect(r.field).toBe("domain");
    expect(readFileSync(playbookFile(CYCLING.slug), "utf8")).toBe(cyclingBefore);
    expect(readFileSync(playbookFile(RUNNING.slug), "utf8")).toBe(runningBefore);
  });
});

// ===========================================================================
// 6 — persistence_failed + the 0600 file mode survives an append
// ===========================================================================

describe("appendProfileEntry — persistence + file mode", () => {
  it("a genuine fs failure (the target is a directory → EISDIR) → persistence_failed", () => {
    createShopper();
    rmSync(userSpecFile(), { force: true });
    mkdirSync(userSpecFile());

    const r = appendProfileEntry({ kind: "fact", text: "a fact" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("persistence_failed");
    if (r.kind !== "persistence_failed") return;
    expect(typeof r.error).toBe("string");
    expect(r.error.length).toBeGreaterThan(0);
  });

  it("the target file mode stays 0600 after a successful fact append", () => {
    createShopper();
    expect(appendProfileEntry({ kind: "fact", text: "size 43" }).ok).toBe(true);
    expect(statSync(userSpecFile()).mode & 0o777).toBe(0o600);
  });

  it("the target file mode stays 0600 after a successful taste append", () => {
    createShopper();
    mint(CYCLING);
    expect(
      appendProfileEntry({ kind: "taste", text: "tubeless", domain: CYCLING.slug }).ok,
    ).toBe(true);
    expect(statSync(playbookFile(CYCLING.slug)).mode & 0o777).toBe(0o600);
  });
});
