/**
 * UNIT — read / remove store primitives after the
 * consolidate-profile-tools-to-the-singleton-surface fold (tier: unit, real temp
 * dir via the SIL_DATA_DIR override, no network, no host).
 *
 * `listAgentProfiles` is DELETED (its read folds into the no-args `readAgentProfile()`
 * Zoom A) and the caller-supplied `agentId` is dropped from every primitive. The
 * primitives now manage the ONE singleton shopper's domain packs:
 *
 *   readAgentProfile(slug?)        — no slug ⇒ the shopper top-level (Zoom A,
 *                                    absorbs the old list): the shared user_spec +
 *                                    the domain index + `unreadable[]`. An EMPTY
 *                                    store is `ok` empty-is-healthy — NEVER
 *                                    not_found. slug ⇒ that domain's 3 bodies + the
 *                                    SHARED user_spec.
 *   removeAgentArtefacts(slug)     — remove exactly ONE domain leaf + de-register
 *                                    domains[slug]; the shopper and shared user_spec
 *                                    survive. `slug` is REQUIRED (no
 *                                    omit-deletes-everything).
 *
 * The invariants pinned here:
 *   READ   1. no-args on an EMPTY store → ok empty-is-healthy + unreadable: []
 *             (NEVER not_found — the create-collision + "no shopper yet" flows
 *             depend on it).
 *          2. no-args with a shopper → the shared user_spec + the domain index +
 *             unreadable: [].
 *          3. a corrupt manifest → ok (degraded), surfaced in unreadable[], never
 *             aborts/throws.
 *          4. per-domain (slug) → the 3 domain bodies + the shared user_spec.
 *          5. unknown slug → not_found; traversal/main slug → invalid_request.
 *   REMOVE 6. removes exactly one leaf + de-registers it; sibling + shared
 *             user_spec + shopper survive.
 *          7. removing the LAST domain leaves a healthy `domains: {}` shopper.
 *          8. absent slug → not_found (idempotent); missing/blank slug →
 *             invalid_request(field=domainSlug), deletes nothing.
 *          9. traversal/main slug → invalid_request(field=domainSlug), deletes
 *             nothing.
 *         10. a genuine rmSync failure → persistence_failed with <dir>: <cause>.
 *   UPSERT 11. re-materializing the singleton overwrites in place (sequential ops —
 *             the recast of the retired two-agentId isolation fixtures).
 *   IDENTITY 12. none of these read/write a token.
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
  readdirSync,
  readFileSync,
  statSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeProfile,
  readAgentProfile,
  removeAgentArtefacts,
  getShopperArtefactDir,
  getDomainArtefactDir,
  type ProfileSpec,
} from "../../lib/profile-store.js";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-shopper-manage-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  try {
    chmodSync(dataDir, 0o700);
    const shopper = getShopperArtefactDir();
    if (existsSync(shopper)) {
      chmodSync(shopper, 0o700);
      const dom = join(shopper, "domains");
      if (existsSync(dom)) {
        chmodSync(dom, 0o700);
        for (const d of readdirSync(dom)) {
          try {
            chmodSync(join(dom, d), 0o700);
          } catch {
            /* best-effort */
          }
        }
      }
    }
  } catch {
    /* best-effort */
  }
  rmSync(dataDir, { recursive: true, force: true });
});

const USER_SPEC =
  "# User spec (shared)\n- Ships to Berlin 10115.\nHARD-NO: leather (ethics).";

function pack(slug: string, name: string): NonNullable<ProfileSpec["domain"]> {
  return {
    slug,
    name,
    domainSpec: `# Domain spec — ${name}\nResearched mechanics.`,
    intentSpec: `# Intent spec — ${name}\nDecomposition dimensions.`,
    playbook: `# Taste — ${name}\nSeeded preferences.`,
  };
}

/** Create the singleton shopper, then mint each (slug → name) domain (no agentId). */
function makeShopper(
  domains: ReadonlyArray<readonly [string, string]> = [],
  userSpec = USER_SPEC,
): void {
  const created = materializeProfile({ name: "sil shopper", userSpec });
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
  for (const [slug, name] of domains) {
    const r = materializeProfile({ name: "sil shopper", userSpec, domain: pack(slug, name) });
    if (!r.ok) throw new Error(`mint ${slug} failed: ${JSON.stringify(r)}`);
  }
}

function readManifest(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(getShopperArtefactDir(), "profile.json"), "utf8"),
  ) as Record<string, unknown>;
}

function walkFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

// ===========================================================================
// readAgentProfile() — Zoom A (no args): the folded listing + empty-is-healthy
// ===========================================================================

describe("readAgentProfile() — Zoom A (no args) is the folded listing; empty store is `ok` empty-is-healthy", () => {
  it("an EMPTY store → ok with `unreadable: []` and NO shopper content — NEVER not_found", () => {
    expect(existsSync(getShopperArtefactDir())).toBe(false);
    const result = readAgentProfile();
    // The load-bearing semantic of the fold: empty-is-healthy `ok`, never not_found.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unreadable).toEqual([]);
    expect((result.domains ?? []).length).toBe(0);
    // No shopper materialized → no shared user spec body.
    expect(result.userSpec == null || result.userSpec === "").toBe(true);
  });

  it("a shopper present → ok with the shared user_spec, the domain index, and unreadable: []", () => {
    makeShopper([["road-cycling", "Road cycling"]], USER_SPEC);
    const result = readAgentProfile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userSpec).toBe(USER_SPEC);
    expect(result.domains.map((d) => d.slug)).toEqual(["road-cycling"]);
    expect(result.unreadable).toEqual([]);
    expect(result.profilePath).toBe(join(getShopperArtefactDir(), "profile.json"));
  });

  it("a corrupt shopper manifest → ok (degraded), reported in unreadable[], never aborts/throws", () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    // Corrupt the singleton's manifest — the no-args read must still return `ok`
    // (empty-is-healthy / degraded), surface the breakage in unreadable[], and never
    // throw nor downgrade to not_found.
    writeFileSync(join(getShopperArtefactDir(), "profile.json"), "not json {{{", { mode: 0o600 });
    const result = readAgentProfile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unreadable.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// readAgentProfile(slug) — per-domain
// ===========================================================================

describe("readAgentProfile(slug) — the 3 domain bodies + the shared user_spec", () => {
  it("returns domainSpec + intentSpec + playbook (the pack) AND the shared user_spec", () => {
    makeShopper([["road-cycling", "Road cycling"]], USER_SPEC);
    const read = readAgentProfile("road-cycling");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.slug).toBe("road-cycling");
    expect(read.domainSpec).toBe("# Domain spec — Road cycling\nResearched mechanics.");
    expect(read.intentSpec).toBe("# Intent spec — Road cycling\nDecomposition dimensions.");
    expect(read.playbook).toBe("# Taste — Road cycling\nSeeded preferences.");
    expect(read.userSpec).toBe(USER_SPEC);
  });
});

describe("readAgentProfile(slug) — graceful failures", () => {
  it("an unknown slug → not_found (manifest-gated), no throw", () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    const result = readAgentProfile("never-minted");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("not_found");
  });

  it.each(["../escape", "shop/per", "..", ".", "main", "Road-Cycling"])(
    "a traversal/main/malformed slug %j → invalid_request(field=domainSlug), reads nothing",
    (bad) => {
      makeShopper([["road-cycling", "Road cycling"]]);
      const result = readAgentProfile(bad);
      expect(result.ok, `expected reject for ${JSON.stringify(bad)}`).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe("domainSlug");
    },
  );
});

// ===========================================================================
// removeAgentArtefacts(slug) — one domain leaf, de-registered, scoped
// ===========================================================================

describe("removeAgentArtefacts(slug) — removes exactly ONE domain leaf + de-registers it", () => {
  it("the target leaf is gone + de-registered; the sibling domain + shared user_spec + shopper survive", () => {
    makeShopper([
      ["road-cycling", "Road cycling"],
      ["running-shoes", "Running shoes"],
    ]);
    expect(existsSync(getDomainArtefactDir("road-cycling"))).toBe(true);

    const result = removeAgentArtefacts("road-cycling");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domainSlug).toBe("road-cycling");

    // The leaf is gone…
    expect(existsSync(getDomainArtefactDir("road-cycling"))).toBe(false);
    // …and de-registered from the manifest, while the sibling stays.
    const domains = (readManifest()["domains"] ?? {}) as Record<string, unknown>;
    expect(Object.keys(domains)).toEqual(["running-shoes"]);
    expect(existsSync(getDomainArtefactDir("running-shoes"))).toBe(true);
    // The shopper + the SHARED user_spec are untouched (artefact-only, scoped).
    expect(existsSync(join(getShopperArtefactDir(), "user_spec.md"))).toBe(true);
    expect(readFileSync(join(getShopperArtefactDir(), "user_spec.md"), "utf8")).toBe(USER_SPEC);
  });

  it("removing the LAST domain leaves a healthy `domains: {}` shopper (never deletes the shopper)", () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    const result = removeAgentArtefacts("road-cycling");
    expect(result.ok).toBe(true);

    // The shopper dir + shared user_spec + manifest survive; the domains map is now {}.
    expect(existsSync(getShopperArtefactDir())).toBe(true);
    expect(existsSync(join(getShopperArtefactDir(), "user_spec.md"))).toBe(true);
    expect(readManifest()["domains"]).toEqual({});
    // The shopper still reads back healthy (empty domain index, not not_found).
    const overview = readAgentProfile();
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.domains).toEqual([]);
  });
});

describe("removeAgentArtefacts(slug) — required slug, idempotent, fail-closed on a bad slug", () => {
  it("absent slug → not_found (idempotent: a re-run is also not_found), deletes nothing", () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    const first = removeAgentArtefacts("never-minted");
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.kind).toBe("not_found");
    expect(existsSync(getDomainArtefactDir("road-cycling"))).toBe(true);
    const second = removeAgentArtefacts("never-minted");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.kind).toBe("not_found");
  });

  it("a MISSING/blank domainSlug → invalid_request(field=domainSlug), deletes nothing (no omit-deletes-everything)", () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    for (const missing of ["", undefined as unknown as string]) {
      const result = removeAgentArtefacts(missing);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe("domainSlug");
      // The whole shopper + its domain are untouched — an absent slug deletes NOTHING.
      expect(existsSync(getDomainArtefactDir("road-cycling"))).toBe(true);
      expect(existsSync(getShopperArtefactDir())).toBe(true);
    }
  });

  it.each(["../escape", "road/cycling", "..", ".", "a/../b", "main", "Road-Cycling"])(
    "a traversal/main slug %j → invalid_request(field=domainSlug), deletes nothing",
    (bad) => {
      makeShopper([["road-cycling", "Road cycling"]]);
      const before = walkFiles(getShopperArtefactDir()).sort();
      const result = removeAgentArtefacts(bad);
      expect(result.ok, `expected reject for ${JSON.stringify(bad)}`).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe("domainSlug");
      expect(walkFiles(getShopperArtefactDir()).sort()).toEqual(before);
    },
  );
});

describe("removeAgentArtefacts — a genuine rmSync failure returns persistence_failed, never throws", () => {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(asRoot)(
    "a non-writable domains/ parent (rmSync of the leaf fails EACCES) → persistence_failed with <dir>: <cause>",
    () => {
      makeShopper([["road-cycling", "Road cycling"]]);
      const leaf = getDomainArtefactDir("road-cycling");
      const domainsParent = join(getShopperArtefactDir(), "domains");
      // Unlinking the leaf needs WRITE on its PARENT (domains/). Make it read+exec.
      chmodSync(domainsParent, 0o500);

      const result = removeAgentArtefacts("road-cycling");
      chmodSync(domainsParent, 0o700); // restore immediately for assertions + cleanup

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("persistence_failed");
      if (result.kind !== "persistence_failed") return;
      expect(result.error).toContain(leaf);
      expect(result.error).toMatch(/.+: .+/);
      expect(result.recovery).toBe("fix_data_dir");
      expect(existsSync(leaf)).toBe(true);
    },
  );
});

// ===========================================================================
// Single-shopper sequential ops — the recast of the retired two-agentId isolation
// ===========================================================================

describe("single-shopper sequential ops — re-materializing overwrites in place (one store, upsert)", () => {
  it("re-creating the shopper with a NEW userSpec overwrites the shared spec; still exactly ONE shopper", () => {
    const v1 = "# User spec v1\n- ships to Berlin.";
    const v2 = "# User spec v2\n- ships to Munich now.";
    materializeProfile({ name: "sil shopper", userSpec: v1 });
    materializeProfile({ name: "sil shopper", userSpec: v2 });

    // The shared user_spec reflects the LATEST write — a re-create is an overwrite,
    // not a second store (there is no second agentId to isolate).
    const overview = readAgentProfile();
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.userSpec).toBe(v2);
    // One singleton dir; the manifest createdAt is preserved across the overwrite.
    expect(existsSync(getShopperArtefactDir())).toBe(true);
    expect(typeof readManifest()["createdAt"]).toBe("string");
  });

  it("re-minting an existing domain upserts (no second pack); a NEW slug adds a sibling", () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    // Re-mint the SAME slug → upsert in place (still one domain).
    const reMint = materializeProfile({
      name: "sil shopper",
      userSpec: USER_SPEC,
      domain: pack("road-cycling", "Road cycling (refined)"),
    });
    expect(reMint.ok).toBe(true);
    expect(Object.keys((readManifest()["domains"] ?? {}) as Record<string, unknown>)).toEqual([
      "road-cycling",
    ]);
    // A NEW slug adds a sibling — the store accretes domains on the one shopper.
    const second = materializeProfile({
      name: "sil shopper",
      userSpec: USER_SPEC,
      domain: pack("running-shoes", "Running shoes"),
    });
    expect(second.ok).toBe(true);
    expect(
      Object.keys((readManifest()["domains"] ?? {}) as Record<string, unknown>).sort(),
    ).toEqual(["road-cycling", "running-shoes"]);
  });
});

// ===========================================================================
// Identity boundary — none of the primitives read or write a token
// ===========================================================================

describe("read/remove — no identity coupling (getTokensPath never appears)", () => {
  it("neither read nor remove creates the tokens path across a full read→remove cycle", () => {
    makeShopper([["road-cycling", "Road cycling"]]);
    readAgentProfile();
    readAgentProfile("road-cycling");
    removeAgentArtefacts("road-cycling");
    expect(existsSync(getTokensPath())).toBe(false);
    expect(statSync(getDataDir()).isDirectory()).toBe(true);
  });
});
