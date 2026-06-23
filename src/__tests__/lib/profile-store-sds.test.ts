/**
 * UNIT — the two NEW SDS artefact slots (domain.md + user.md) in the
 * behaviour-artefact store (tier: unit, real temp dir via the SIL_DATA_DIR
 * override, no network, no host).
 *
 * Card: spec-driven-shopping-sds-for-created-experts. SDS adds two new
 * FIRST-CLASS, OPTIONAL artefact slots alongside persona.md (required) +
 * playbook.md (optional):
 *   - domain.md — the niche's researched decision-dimensions (the domain spec);
 *   - user.md   — the user's standing niche attributes + HARD CONSTRAINTS
 *                 (the user spec).
 * Both are materialized through the SAME `sil_profile_materialize` store path
 * (no new tool — the 8-tool manifest is frozen), keyed off the same manifest,
 * mirroring `playbook`'s optionality EXACTLY: validate-first non-blank-if-present,
 * atomic per-file, 0600 inside a 0700 dir, absent-is-fine on read.
 *
 * The pure store-layer invariants pinned here ARE the card's correctness bar for
 * the persisted-spec plumbing (the architect's slice-1, the only real code):
 *
 *   1. A spec carrying domainSpec/userSpec materializes domain.md / user.md
 *      under $SIL_DATA_DIR/agents/<id>/, owner-only (0600), in a 0700 dir, with
 *      the manifest gaining domainSpecPath / userSpecPath.
 *   2. Validate-FIRST: a present-but-BLANK domainSpec or userSpec returns
 *      `invalid_request` NAMING the field and writes NOTHING — exactly the
 *      `playbook` discipline (profile-store.ts:180-182). An OMITTED slot is
 *      accepted as "no spec" — absent-is-fine, NOT an error.
 *   3. Absent-is-fine on READ: a pre-SDS expert (no domain.md/user.md) reads
 *      back successfully — the two new bodies degrade like `playbook`, NEVER
 *      required for a successful read (Architect Risk: a partial write must not
 *      brick the expert; the manifest's two new paths stay OPTIONAL, out of
 *      readManifestFile's required-field gate).
 *   4. Hard-constraint vs soft-preference round-trips DISTINGUISHABLY through
 *      the user spec — the user.md body that goes in is the body that comes back
 *      verbatim, so downstream reasoning can treat a hard constraint as
 *      inviolable and a soft preference as bendable (the store does not parse the
 *      body; it preserves it byte-for-byte, which is what makes the distinction
 *      survive).
 *   5. INTENT-SPEC PERSISTENCE CREEP is impossible at the store: there is no
 *      intentSpec param and no intent.md is ever written. The intent spec is
 *      ephemeral (conversation-only) — the store has no slot for it.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (mirrors profile-store.test.ts).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/profile-store.ts`:
 *   - ProfileSpec gains `domainSpec?: string` + `userSpec?: string`;
 *   - ProfileManifest gains `domainSpecPath?` + `userSpecPath?` (OPTIONAL — out
 *     of readManifestFile's required-field gate);
 *   - materializeProfile writes domain.md / user.md in the SAME atomic,
 *     validate-first, all-or-nothing-per-file sequence as playbook;
 *   - the MaterializeResult ok variant surfaces `domainSpecPath?` / `userSpecPath?`;
 *   - readAgentProfile returns `domainSpec?` / `userSpec?` bodies (absent-is-fine).
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
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeProfile,
  readAgentProfile,
  getAgentArtefactDir,
  type ProfileManifest,
} from "../../lib/profile-store.js";
import { getDataDir } from "../../lib/credentials.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-profile-sds-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  // Restore perms so rmSync can clean a dir a cleanup test chmod'd read-only.
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    /* best-effort */
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/** A research-grade domain spec — niche-concrete decision-dimensions a layperson
 * couldn't enumerate (the store never validates THIS; it preserves the body). */
const DOMAIN_SPEC =
  "# Road-cycling domain spec\n"
  + "Decision-dimensions: frame stack/reach (fit), groupset tier (105/Ultegra/Dura-Ace),"
  + " wheel rim depth vs. crosswind stability, tyre clearance, gearing range for the"
  + " rider's terrain. Trade-offs: deeper rims buy aero but cost crosswind handling;"
  + " a stiffer frame buys power transfer but costs all-day comfort.";

/** A user spec carrying a SOFT preference AND a HARD constraint — the two must
 * round-trip distinguishably so downstream reasoning treats them differently. */
const USER_SPEC =
  "# User spec — road-cycling buyer\n"
  + "## Standing attributes (soft preferences)\n"
  + "- Prefers endurance geometry over race geometry.\n"
  + "- Budget comfort zone around €1500.\n"
  + "## Hard constraints (INVIOLABLE — never recommend a violating item)\n"
  + "- HARD-NO: rim brakes (disc only).\n"
  + "- HARD-NO: anything over 9 kg.";

const GOOD = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  persona: "You are a road-cycling buyer. Prefer endurance geometry; flag anything over 9kg.",
  playbook: "Map budget to price_min/price_max. Rank by ride comfort, then weight.",
  domainSpec: DOMAIN_SPEC,
  userSpec: USER_SPEC,
} as const;

function readManifest(agentId: string): ProfileManifest {
  const path = join(getAgentArtefactDir(agentId), "profile.json");
  return JSON.parse(readFileSync(path, "utf8")) as ProfileManifest;
}

/** Every file under `dir`, recursively (relative paths). */
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

describe("materializeProfile — domain.md + user.md materialize alongside persona/playbook", () => {
  it("writes domain.md and user.md under $SIL_DATA_DIR/agents/<id>/ when the spec carries them", () => {
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dir = join(getDataDir(), "agents", GOOD.agentId);
    expect(existsSync(join(dir, "domain.md"))).toBe(true);
    expect(existsSync(join(dir, "user.md"))).toBe(true);

    // The ok variant surfaces the two new paths, and they point at the bodies.
    expect(result.domainSpecPath).toBe(join(dir, "domain.md"));
    expect(result.userSpecPath).toBe(join(dir, "user.md"));
    expect(readFileSync(result.domainSpecPath!, "utf8")).toBe(DOMAIN_SPEC);
    expect(readFileSync(result.userSpecPath!, "utf8")).toBe(USER_SPEC);
  });

  it("records domainSpecPath + userSpecPath in the typed manifest, pointing at the artefacts", () => {
    materializeProfile({ ...GOOD });
    const manifest = readManifest(GOOD.agentId);
    const dir = getAgentArtefactDir(GOOD.agentId);
    expect(manifest.domainSpecPath).toBe(join(dir, "domain.md"));
    expect(manifest.userSpecPath).toBe(join(dir, "user.md"));
  });

  it("writes domain.md + user.md owner-only (0600) inside the 0700 dir", () => {
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(statSync(result.dir).mode & 0o777).toBe(0o700);
    expect(statSync(result.domainSpecPath!).mode & 0o777).toBe(0o600);
    expect(statSync(result.userSpecPath!).mode & 0o777).toBe(0o600);
  });

  it("leaves NO .tmp sibling behind after the atomic write of the two new files", () => {
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(walkFiles(result.dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });
});

describe("materializeProfile — the two new slots are OPTIONAL (absent-is-fine, like playbook)", () => {
  it("omits domain.md / user.md AND the manifest paths when neither is supplied (a pre-SDS expert)", () => {
    const { domainSpec: _d, userSpec: _u, ...noSds } = GOOD;
    const result = materializeProfile({ ...noSds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No new files written.
    expect(existsSync(join(result.dir, "domain.md"))).toBe(false);
    expect(existsSync(join(result.dir, "user.md"))).toBe(false);
    // No path on the ok variant.
    expect(result.domainSpecPath).toBeUndefined();
    expect(result.userSpecPath).toBeUndefined();
    // No path in the manifest (mirrors playbookPath when absent).
    const manifest = readManifest(GOOD.agentId);
    expect(manifest.domainSpecPath).toBeUndefined();
    expect(manifest.userSpecPath).toBeUndefined();
    // The expert is otherwise complete — persona + profile still landed.
    expect(existsSync(join(result.dir, "persona.md"))).toBe(true);
  });

  it("materializes domain.md alone (domainSpec without userSpec) — the two slots are independent", () => {
    const { userSpec: _u, ...domainOnly } = GOOD;
    const result = materializeProfile({ ...domainOnly });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(join(result.dir, "domain.md"))).toBe(true);
    expect(existsSync(join(result.dir, "user.md"))).toBe(false);
    expect(result.domainSpecPath).toBeDefined();
    expect(result.userSpecPath).toBeUndefined();
  });

  it("materializes user.md alone (userSpec without domainSpec) — first-shop capture before a domain spec exists is not blocked", () => {
    const { domainSpec: _d, ...userOnly } = GOOD;
    const result = materializeProfile({ ...userOnly });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(join(result.dir, "user.md"))).toBe(true);
    expect(existsSync(join(result.dir, "domain.md"))).toBe(false);
    expect(result.userSpecPath).toBeDefined();
    expect(result.domainSpecPath).toBeUndefined();
  });
});

describe("materializeProfile — validate-first: a present-but-BLANK new slot writes NOTHING", () => {
  const dirExists = () => existsSync(getAgentArtefactDir(GOOD.agentId));

  it("present-but-blank domainSpec → invalid_request(field=domainSpec), nothing written", () => {
    const result = materializeProfile({ ...GOOD, domainSpec: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("domainSpec");
    // Validate-first: a bad field writes the WHOLE thing nowhere (no dir at all).
    expect(dirExists()).toBe(false);
  });

  it("present-but-blank userSpec → invalid_request(field=userSpec), nothing written", () => {
    const result = materializeProfile({ ...GOOD, userSpec: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("userSpec");
    expect(dirExists()).toBe(false);
  });

  it("a blank new slot does not partially write the OTHER good artefacts (whole-spec validate-first)", () => {
    // Adversarial: the architect's "partial-write brick" risk. A blank userSpec
    // must reject BEFORE any file is written — persona.md must NOT appear just
    // because it was the first good field. Validate-first is whole-spec.
    const result = materializeProfile({ ...GOOD, userSpec: "\t\n " });
    expect(result.ok).toBe(false);
    expect(existsSync(join(getAgentArtefactDir(GOOD.agentId), "persona.md"))).toBe(false);
    expect(walkFiles(join(getDataDir(), "agents"))).toEqual([]);
  });
});

describe("readAgentProfile — the two new bodies round-trip; absent-is-fine; never required for a read", () => {
  it("returns the domainSpec + userSpec bodies VERBATIM when present (round-trip intact)", () => {
    materializeProfile({ ...GOOD });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // The store preserves the bodies byte-for-byte — it does NOT parse them.
    expect(read.domainSpec).toBe(DOMAIN_SPEC);
    expect(read.userSpec).toBe(USER_SPEC);
  });

  it("HARD-constraint vs SOFT-preference survive distinguishably in the round-tripped user spec", () => {
    // The store keeps the user.md body intact, so the markers that separate a
    // bendable soft preference from an inviolable hard constraint survive the
    // write→read cycle. THIS is what lets downstream reasoning treat a hard
    // constraint as inviolable: the distinction is in the persisted body, not
    // lost to a lossy parse. (The store's job is fidelity; the reasoning is e2e.)
    materializeProfile({ ...GOOD });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const spec = read.userSpec!;
    // The soft-preference section and the hard-constraint section both survive,
    // and they are distinguishable (the hard markers are present and intact).
    expect(spec).toContain("soft preferences");
    expect(spec).toContain("HARD-NO: rim brakes");
    expect(spec).toContain("INVIOLABLE");
    // And the body is identical to what went in — no normalization dropped the
    // markers that carry the distinction.
    expect(spec).toBe(USER_SPEC);
  });

  it("a pre-SDS expert (no domain.md/user.md) reads back OK — the two new bodies are simply absent", () => {
    // The back-compat trap (Architect Risk): an expert with no SDS slots reads
    // back successfully. The two new bodies degrade like playbook — ABSENT, never
    // required. A missing domain.md/user.md must NOT make the read not_found.
    const { domainSpec: _d, userSpec: _u, ...noSds } = GOOD;
    materializeProfile({ ...noSds });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.domainSpec).toBeUndefined();
    expect(read.userSpec).toBeUndefined();
    // The rest of the expert is fully readable.
    expect(read.persona).toBe(GOOD.persona);
  });

  it("a manifest with NO domainSpecPath/userSpecPath is valid (the paths are OUT of the required-field gate)", () => {
    // Directly exercises the manifest back-compat trap: an old profile.json with
    // none of the new path fields must still parse + read. readManifestFile must
    // keep domainSpecPath/userSpecPath OPTIONAL — never add them to its
    // required-field gate, or every pre-SDS expert reads back not_found.
    const { domainSpec: _d, userSpec: _u, ...noSds } = GOOD;
    const result = materializeProfile({ ...noSds });
    expect(result.ok).toBe(true);
    const manifest = readManifest(GOOD.agentId);
    // The persisted manifest carries no SDS path keys at all (not even null).
    expect("domainSpecPath" in manifest).toBe(false);
    expect("userSpecPath" in manifest).toBe(false);
    // And it still reads.
    expect(readAgentProfile(GOOD.agentId).ok).toBe(true);
  });

  it("a manifest pointing at a domain.md whose body is GONE degrades gracefully (domain spec is optional detail, like playbook)", () => {
    // Per-file atomic, not transactional: a manifest can point at a domain.md
    // that was hand-deleted. The domain spec is OPTIONAL detail — its absent body
    // must NOT brick the read (it degrades like a missing playbook body, not like
    // a missing persona). The expert stays viewable; domainSpec is just undefined.
    materializeProfile({ ...GOOD });
    rmSync(join(getAgentArtefactDir(GOOD.agentId), "domain.md"), { force: true });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.domainSpec).toBeUndefined();
    // The healthy parts still load.
    expect(read.persona).toBe(GOOD.persona);
    expect(read.userSpec).toBe(USER_SPEC);
  });
});

describe("materializeProfile — no intent-spec slot exists (ephemeral, never persisted)", () => {
  it("an intentSpec-shaped param is ignored: no intent.md is ever written", () => {
    // Architect Risk: intent-spec persistence creep. The intent spec is
    // ephemeral, conversation-only — the store has NO slot for it. Even if a
    // caller smuggles an `intentSpec` field, the store writes no intent.md.
    const result = materializeProfile({
      ...GOOD,
      // @ts-expect-error — intentSpec is NOT a ProfileSpec field; the store must
      // not grow a slot for it. The compile error IS part of the assertion.
      intentSpec: "what this one request demands",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(join(result.dir, "intent.md"))).toBe(false);
    // Only the four legitimate artefacts (persona/playbook/domain/user) + manifest.
    const files = walkFiles(result.dir).sort();
    expect(files).toEqual(
      ["domain.md", "persona.md", "playbook.md", "profile.json", "user.md"].sort(),
    );
  });
});
