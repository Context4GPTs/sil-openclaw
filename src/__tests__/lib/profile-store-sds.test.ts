/**
 * UNIT — the SDS artefact store after the five-artefact reframe (tier: unit,
 * real temp dir via the SIL_DATA_DIR override, no network, no host).
 *
 * Card: spec-driven-shopping-sds-for-created-experts — Founder review round 2
 * (PR #33 bounced a SECOND time). SDS is the operating model for EVERY created
 * expert. The sil store holds FOUR behaviour artefacts (the persona left the
 * store — it is the host SOUL.md, written by the engine via the host CLI, never a
 * sil-side file). The ROUND-2 correction: all four sil docs are PRESENT, non-blank,
 * from creation — seeded *partial* (the ≤10-question setup + a quick initial
 * research pass), then lazily AUGMENTED/reinforced on every query. None is
 * "absent-is-fine"; none "starts empty". All four are REQUIRED:
 *
 *   domain_spec.md  — REQUIRED. The deep, researched niche expertise (how to buy
 *                     well, the full mechanics) — web-refreshed every query.
 *   intent_spec.md  — REQUIRED. The agent-specific decomposition DIMENSIONS
 *                     (PRD-style) a good query must resolve, derived from the
 *                     domain at creation.
 *   user_spec.md    — REQUIRED. The user's domain-relevant facts + hard
 *                     constraints, seeded partial at creation, AUGMENTED per-query.
 *   playbook.md     — REQUIRED. The user's buying TASTE (price sensitivity, brand,
 *                     preferences) — seeded partial at creation, AUGMENTED per-query.
 *
 * The store-layer contract this file pins for the implementation
 * (`src/lib/profile-store.ts`):
 *   1. NO PERSONA in the store. `ProfileSpec` has no `persona`; `materializeProfile`
 *      writes no persona.md; `ProfileManifest` has no personaPath;
 *      `readManifestFile`'s required gate is agentId/name/createdAt + ALL FOUR spec
 *      paths (NOT personaPath); `readAgentProfile` returns no persona.
 *   2. ALL FOUR specs are REQUIRED on materialize (Founder review round 2). A
 *      present-but-blank OR omitted domainSpec / intentSpec / userSpec / playbook →
 *      invalid_request naming the field, and WRITES NOTHING (whole-spec
 *      validate-first — not even the other good files). A min create IS a full
 *      create: there is no two-spec-only valid create any more.
 *   3. The manifest carries ALL FOUR path keys (domainSpecPath + intentSpecPath +
 *      userSpecPath + playbookPath), all REQUIRED in `readManifestFile`'s gate. A
 *      manifest missing ANY of the four path keys is corrupt (not_found).
 *   4. `readAgentProfile` is fail-closed on ANY of the four bodies missing — a
 *      referenced-but-missing domain/intent/user/playbook body → not_found (all
 *      four always exist; there is no degrade-to-undefined path any more).
 *   5. The store carries `intentSpec` (the persisted decomposition-dimension
 *      SCHEMA). The prior @ts-expect-error that blocked an intent store field is
 *      REVERSED — intentSpec is a real, required field. The per-query intent (the
 *      filled dimensions) is STILL never persisted: no intent.md of filled values
 *      is ever written; only the intent_spec.md schema is.
 *   6. Bodies round-trip VERBATIM (so hard-constraint vs soft-preference in the
 *      user spec stays distinguishable); 0600 files in a 0700 dir; no .tmp survivor.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (mirrors profile-store.test.ts).
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
  chmodSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeProfile,
  readAgentProfile,
  getAgentArtefactDir,
  type ProfileManifest,
  type ProfileSpec,
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

/** A deep, research-grade domain spec — niche-concrete mechanics a layperson
 * couldn't enumerate (the store never validates THIS; it preserves the body). */
const DOMAIN_SPEC =
  "# Road-cycling domain spec (deep)\n"
  + "Fit mechanics: stack/reach drive torso angle; saddle setback from KOPS;"
  + " crank length scales with inseam; bar reach + drop set hand position.\n"
  + "Gearing theory: gear-inches = chainring/cog × wheel diameter; compact vs"
  + " mid-compact vs 1x trade range for steps. Frame geometry: head-tube angle +"
  + " trail govern handling; chainstay length governs stiffness vs comfort.\n"
  + "Trade-offs: deeper rims buy aero but cost crosswind handling; a stiffer frame"
  + " buys power transfer but costs all-day comfort.";

/** The persisted decomposition-DIMENSION schema (PRD-style) — the dimensions a
 * good query must resolve, derived from the domain. NOT a filled-in instance. */
const INTENT_SPEC =
  "# Intent spec — decomposition dimensions (schema, not a fill)\n"
  + "A road-cycling purchase query must resolve: use-case (commute/race/endurance),"
  + " terrain, budget band, timeline, compatibility-with-existing-setup,"
  + " performance priorities, aesthetics. Each is a dimension the per-query intent"
  + " fills in — the fill is ephemeral, this schema is persisted.";

/** A user spec carrying a SOFT preference AND a HARD constraint — the two must
 * round-trip distinguishably so downstream reasoning treats them differently. */
const USER_SPEC =
  "# User spec — road-cycling buyer\n"
  + "## Domain-relevant facts (soft preferences)\n"
  + "- Prefers endurance geometry over race geometry.\n"
  + "- Inseam 81cm, height 178cm.\n"
  + "## Hard constraints (INVIOLABLE — never recommend a violating item)\n"
  + "- HARD-NO: rim brakes (disc only).\n"
  + "- HARD-NO: anything over 9 kg.";

/** The user's buying TASTE (the new playbook meaning) — price sensitivity /
 * brand / preference, NOT a seller's method. */
const PLAYBOOK =
  "# Buying taste\nBudget comfort zone around €1500; will stretch 10% for the"
  + " right frame. Brand-agnostic but distrusts house-brand groupsets.";

/** A complete create: ALL FOUR REQUIRED specs (Founder review round 2 — none is
 * lazy/optional; all four are present non-blank from creation). */
const GOOD = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  domainSpec: DOMAIN_SPEC,
  intentSpec: INTENT_SPEC,
  userSpec: USER_SPEC,
  playbook: PLAYBOOK,
} as const;

/** The minimum valid create. After Founder review round 2, ALL FOUR sil docs are
 * REQUIRED and present (seeded partial at creation), so the minimum create IS the
 * full four-spec create — there is no two-spec-only valid create any more. Kept as
 * a named alias so the intent ("the smallest thing that creates an expert") stays
 * legible at each call site. */
const MIN_CREATE = GOOD;

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

describe("materializeProfile — persona is GONE from the store (it is the host SOUL.md)", () => {
  it("writes NO persona.md and records NO personaPath — persona left the sil store entirely", () => {
    // Correction 1: the persona is the agent's soul/system framing — the host's
    // SOUL.md, written by the engine via the host CLI, never a sil-side file. The
    // store holds only behaviour artefacts (domain/intent/user/playbook).
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(existsSync(join(result.dir, "persona.md"))).toBe(false);
    const manifest = readManifest(GOOD.agentId);
    expect("personaPath" in manifest).toBe(false);
    // Only the four behaviour artefacts + manifest exist — never persona.md.
    const files = walkFiles(result.dir).sort();
    expect(files).toEqual(
      ["domain_spec.md", "intent_spec.md", "playbook.md", "profile.json", "user_spec.md"].sort(),
    );
  });

  it("a ProfileSpec carrying a `persona` field is a type error (the store has no persona slot)", () => {
    const result = materializeProfile({
      ...MIN_CREATE,
      // @ts-expect-error — `persona` is NOT a ProfileSpec field after the reframe;
      // the persona lives only in the host SOUL.md. The compile error IS part of
      // the assertion: the store must NOT carry a persona slot.
      persona: "You are a road-cycling buyer.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Even if a caller smuggles it, no persona.md is written.
    expect(existsSync(join(result.dir, "persona.md"))).toBe(false);
  });
});

describe("materializeProfile — all four SDS specs are REQUIRED and land at creation (round-2: none lazy)", () => {
  it("writes domain_spec.md, intent_spec.md, user_spec.md, playbook.md under agents/<id>/ for a create", () => {
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dir = join(getDataDir(), "agents", GOOD.agentId);
    expect(existsSync(join(dir, "domain_spec.md"))).toBe(true);
    expect(existsSync(join(dir, "intent_spec.md"))).toBe(true);
    expect(existsSync(join(dir, "user_spec.md"))).toBe(true);
    expect(existsSync(join(dir, "playbook.md"))).toBe(true);

    // The ok variant surfaces the two required paths…
    expect(result.domainSpecPath).toBe(join(dir, "domain_spec.md"));
    expect(result.intentSpecPath).toBe(join(dir, "intent_spec.md"));
    // …and the two optional ones when supplied.
    expect(result.userSpecPath).toBe(join(dir, "user_spec.md"));
    expect(result.playbookPath).toBe(join(dir, "playbook.md"));

    expect(readFileSync(result.domainSpecPath, "utf8")).toBe(DOMAIN_SPEC);
    expect(readFileSync(result.intentSpecPath, "utf8")).toBe(INTENT_SPEC);
    expect(readFileSync(result.userSpecPath!, "utf8")).toBe(USER_SPEC);
    expect(readFileSync(result.playbookPath!, "utf8")).toBe(PLAYBOOK);
  });

  it("a creation produces ALL FOUR spec files + their manifest paths — none is lazily absent (round-2)", () => {
    // Founder review round 2: all four sil docs are PRESENT, non-blank, from
    // creation (seeded partial by the ≤10-question setup + the agent's initial
    // research). There is no two-spec-only create — the minimum create IS the full
    // four-spec create.
    const result = materializeProfile({ ...MIN_CREATE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(existsSync(join(result.dir, "domain_spec.md"))).toBe(true);
    expect(existsSync(join(result.dir, "intent_spec.md"))).toBe(true);
    expect(existsSync(join(result.dir, "user_spec.md"))).toBe(true);
    expect(existsSync(join(result.dir, "playbook.md"))).toBe(true);

    expect(result.userSpecPath).toBeDefined();
    expect(result.playbookPath).toBeDefined();
    const manifest = readManifest(GOOD.agentId);
    expect(typeof manifest.userSpecPath).toBe("string");
    expect(typeof manifest.playbookPath).toBe("string");
    // All four required artefacts + manifest.
    expect(walkFiles(result.dir).sort()).toEqual(
      ["domain_spec.md", "intent_spec.md", "user_spec.md", "playbook.md", "profile.json"].sort(),
    );
  });

  it("records domainSpecPath + intentSpecPath in the typed manifest, pointing at the artefacts", () => {
    materializeProfile({ ...GOOD });
    const manifest = readManifest(GOOD.agentId);
    const dir = getAgentArtefactDir(GOOD.agentId);
    expect(manifest.domainSpecPath).toBe(join(dir, "domain_spec.md"));
    expect(manifest.intentSpecPath).toBe(join(dir, "intent_spec.md"));
    expect(manifest.userSpecPath).toBe(join(dir, "user_spec.md"));
    expect(manifest.playbookPath).toBe(join(dir, "playbook.md"));
  });

  it("writes every artefact owner-only (0600) inside the 0700 dir", () => {
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(statSync(result.dir).mode & 0o777).toBe(0o700);
    expect(statSync(result.domainSpecPath).mode & 0o777).toBe(0o600);
    expect(statSync(result.intentSpecPath).mode & 0o777).toBe(0o600);
    expect(statSync(result.userSpecPath!).mode & 0o777).toBe(0o600);
    expect(statSync(result.playbookPath!).mode & 0o777).toBe(0o600);
  });

  it("leaves NO .tmp sibling behind after the atomic write", () => {
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(walkFiles(result.dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });
});

describe("materializeProfile — validate-first: a missing/blank REQUIRED spec writes NOTHING", () => {
  const dirExists = () => existsSync(getAgentArtefactDir(GOOD.agentId));

  it("OMITTED domainSpec → invalid_request(field=domainSpec), nothing written", () => {
    // SDS is the operating model — domain_spec is required, not absent-is-fine.
    // Cast: omitting a required field is a type error, but the RUNTIME contract is
    // exactly that the store rejects it fail-closed (validate-first).
    const { domainSpec: _d, ...noDomain } = GOOD;
    const result = materializeProfile(noDomain as unknown as ProfileSpec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("domainSpec");
    expect(dirExists()).toBe(false);
  });

  it("OMITTED intentSpec → invalid_request(field=intentSpec), nothing written", () => {
    const { intentSpec: _i, ...noIntent } = GOOD;
    const result = materializeProfile(noIntent as unknown as ProfileSpec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("intentSpec");
    expect(dirExists()).toBe(false);
  });

  it("OMITTED userSpec → invalid_request(field=userSpec), nothing written (round-2: user_spec is REQUIRED)", () => {
    // Founder review round 2: user_spec is no longer lazy/optional — it is present
    // (seeded partial) from creation. Omitting it is a defect the store rejects
    // fail-closed, exactly like a missing domain/intent spec.
    const { userSpec: _u, ...noUser } = GOOD;
    const result = materializeProfile(noUser as unknown as ProfileSpec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("userSpec");
    expect(dirExists()).toBe(false);
  });

  it("OMITTED playbook → invalid_request(field=playbook), nothing written (round-2: playbook is REQUIRED)", () => {
    // Founder review round 2: playbook (buying taste) is no longer lazy/optional —
    // it is present (seeded partial) from creation. Omitting it is rejected.
    const { playbook: _p, ...noPlaybook } = GOOD;
    const result = materializeProfile(noPlaybook as unknown as ProfileSpec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("playbook");
    expect(dirExists()).toBe(false);
  });

  it("present-but-blank domainSpec → invalid_request(field=domainSpec), nothing written", () => {
    const result = materializeProfile({ ...GOOD, domainSpec: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("domainSpec");
    expect(dirExists()).toBe(false);
  });

  it("present-but-blank intentSpec → invalid_request(field=intentSpec), nothing written", () => {
    const result = materializeProfile({ ...GOOD, intentSpec: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("intentSpec");
    expect(dirExists()).toBe(false);
  });

  it("a blank REQUIRED spec does NOT partially write the OTHER good artefacts (whole-spec validate-first)", () => {
    // The architect's partial-write-brick risk: a blank intentSpec must reject
    // BEFORE any file is written — domain_spec.md must NOT appear just because it
    // was the first good field. Validate-first is whole-spec.
    const result = materializeProfile({ ...GOOD, intentSpec: "\t\n " });
    expect(result.ok).toBe(false);
    expect(existsSync(join(getAgentArtefactDir(GOOD.agentId), "domain_spec.md"))).toBe(false);
    expect(walkFiles(join(getDataDir(), "agents"))).toEqual([]);
  });
});

describe("materializeProfile — every spec is required + non-blank; a later query AUGMENTS one in place", () => {
  it("present-but-blank userSpec → invalid_request(field=userSpec), nothing written", () => {
    const result = materializeProfile({ ...GOOD, userSpec: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("userSpec");
    expect(existsSync(getAgentArtefactDir(GOOD.agentId))).toBe(false);
  });

  it("present-but-blank playbook → invalid_request(field=playbook), nothing written", () => {
    const result = materializeProfile({ ...GOOD, playbook: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("playbook");
    expect(existsSync(getAgentArtefactDir(GOOD.agentId))).toBe(false);
  });

  it("a later re-materialize AUGMENTS the already-present user_spec in place, without disturbing domain/intent", () => {
    // Round-2 model: user_spec is PRESENT (seeded partial) from creation, then
    // lazily AUGMENTED per-query — not "added from absent". After a create, a
    // second materialize overwrites user_spec.md with the augmented body.
    const first = materializeProfile({ ...GOOD });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(readFileSync(first.userSpecPath!, "utf8")).toBe(USER_SPEC);

    const augmented = USER_SPEC + "\n- HARD-NO: anything over 9 kg (reinforced this query).";
    const second = materializeProfile({ ...GOOD, userSpec: augmented });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(readFileSync(second.userSpecPath!, "utf8")).toBe(augmented);
    // Domain + intent untouched by a user-side augmentation.
    expect(readFileSync(second.domainSpecPath, "utf8")).toBe(DOMAIN_SPEC);
    expect(readFileSync(second.intentSpecPath, "utf8")).toBe(INTENT_SPEC);
  });
});

describe("readAgentProfile — round-trips the four bodies; no persona; required specs always present", () => {
  it("returns domainSpec + intentSpec + userSpec + playbook VERBATIM, and NO persona", () => {
    materializeProfile({ ...GOOD });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // The store preserves the bodies byte-for-byte — it does NOT parse them.
    expect(read.domainSpec).toBe(DOMAIN_SPEC);
    expect(read.intentSpec).toBe(INTENT_SPEC);
    expect(read.userSpec).toBe(USER_SPEC);
    expect(read.playbook).toBe(PLAYBOOK);
    // Persona left the store — the read result carries no persona field.
    expect("persona" in read).toBe(false);
  });

  it("HARD-constraint vs SOFT-preference survive distinguishably in the round-tripped user spec", () => {
    // The store keeps the user_spec.md body intact, so the markers that separate a
    // bendable soft preference from an inviolable hard constraint survive the
    // write→read cycle — THIS is what lets downstream reasoning treat a hard
    // constraint as inviolable (the distinction is in the persisted body, not lost
    // to a lossy parse).
    materializeProfile({ ...GOOD });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const spec = read.userSpec!;
    expect(spec).toContain("soft preferences");
    expect(spec).toContain("HARD-NO: rim brakes");
    expect(spec).toContain("INVIOLABLE");
    expect(spec).toBe(USER_SPEC);
  });

  it("a created expert reads back ALL FOUR specs — none is absent at creation (round-2)", () => {
    materializeProfile({ ...MIN_CREATE });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.domainSpec).toBe(DOMAIN_SPEC);
    expect(read.intentSpec).toBe(INTENT_SPEC);
    // All four are present from creation — the user side is no longer absent.
    expect(read.userSpec).toBe(USER_SPEC);
    expect(read.playbook).toBe(PLAYBOOK);
  });

  it("a created manifest carries ALL FOUR path keys; the required gate is agentId/name/createdAt + all four spec paths", () => {
    // Round-2: the manifest's required gate includes userSpecPath + playbookPath.
    // A created expert's manifest carries all four spec path keys.
    const result = materializeProfile({ ...MIN_CREATE });
    expect(result.ok).toBe(true);
    const manifest = readManifest(GOOD.agentId);
    expect(typeof manifest.domainSpecPath).toBe("string");
    expect(typeof manifest.intentSpecPath).toBe("string");
    expect(typeof manifest.userSpecPath).toBe("string");
    expect(typeof manifest.playbookPath).toBe("string");
    expect(readAgentProfile(GOOD.agentId).ok).toBe(true);
  });
});

describe("readAgentProfile — a manifest missing a REQUIRED spec key is corrupt (fails closed)", () => {
  it("a profile.json with NO domainSpecPath → not_found (domain_spec is a required-gate field)", () => {
    // SDS reframe: domain_spec/intent_spec are required, so their manifest path
    // keys are part of readManifestFile's required gate. A manifest missing one is
    // an interrupted/hand-edited write → the expert reads back not_found, never as
    // a coherent-but-incomplete expert.
    materializeProfile({ ...GOOD });
    const manifestPath = join(getAgentArtefactDir(GOOD.agentId), "profile.json");
    const manifest = readManifest(GOOD.agentId) as unknown as Record<string, unknown>;
    delete manifest["domainSpecPath"];
    // Re-write the manifest without the required key, preserving the file's perms.
    chmodSync(manifestPath, 0o600);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("not_found");
  });

  it("a profile.json with NO intentSpecPath → not_found (intent_spec is a required-gate field)", () => {
    materializeProfile({ ...GOOD });
    const manifestPath = join(getAgentArtefactDir(GOOD.agentId), "profile.json");
    const manifest = readManifest(GOOD.agentId) as unknown as Record<string, unknown>;
    delete manifest["intentSpecPath"];
    chmodSync(manifestPath, 0o600);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("not_found");
  });

  it("a profile.json with NO userSpecPath → not_found (round-2: user_spec is a required-gate field)", () => {
    // Founder review round 2: userSpecPath joins the required gate. A manifest
    // missing it is an interrupted/hand-edited write → not_found, never a
    // coherent-but-incomplete expert.
    materializeProfile({ ...GOOD });
    const manifestPath = join(getAgentArtefactDir(GOOD.agentId), "profile.json");
    const manifest = readManifest(GOOD.agentId) as unknown as Record<string, unknown>;
    delete manifest["userSpecPath"];
    chmodSync(manifestPath, 0o600);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("not_found");
  });

  it("a profile.json with NO playbookPath → not_found (round-2: playbook is a required-gate field)", () => {
    materializeProfile({ ...GOOD });
    const manifestPath = join(getAgentArtefactDir(GOOD.agentId), "profile.json");
    const manifest = readManifest(GOOD.agentId) as unknown as Record<string, unknown>;
    delete manifest["playbookPath"];
    chmodSync(manifestPath, 0o600);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("not_found");
  });

  it("a manifest pointing at a user_spec.md whose body is GONE fails closed → not_found (round-2: all four are required)", () => {
    // Per-file atomic, not transactional: a manifest can point at a user_spec.md
    // that was hand-deleted. After round-2 the user spec is REQUIRED — a
    // referenced-but-missing body of ANY of the four is fail-closed, exactly the
    // role persona played pre-SDS. The read must NOT serve a coherent-but-partial
    // expert off a missing required body.
    materializeProfile({ ...GOOD });
    rmSync(join(getAgentArtefactDir(GOOD.agentId), "user_spec.md"), { force: true });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("not_found");
  });

  it("a manifest pointing at a playbook.md whose body is GONE fails closed → not_found (round-2: all four are required)", () => {
    materializeProfile({ ...GOOD });
    rmSync(join(getAgentArtefactDir(GOOD.agentId), "playbook.md"), { force: true });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("not_found");
  });
});

describe("materializeProfile — intentSpec is the PERSISTED schema; the per-query intent is NEVER persisted", () => {
  it("persists intent_spec.md (the decomposition-dimension schema) — the store now carries intentSpec", () => {
    // Correction 4: the prior @ts-expect-error blocking an intent store field is
    // REVERSED. intentSpec is a real, REQUIRED ProfileSpec field — the persisted
    // dimension schema/template. (No @ts-expect-error here: it must compile.)
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(join(result.dir, "intent_spec.md"))).toBe(true);
    expect(readFileSync(result.intentSpecPath, "utf8")).toBe(INTENT_SPEC);
  });

  it("NEVER writes an intent.md of filled per-query values — only the intent_spec.md schema", () => {
    // The per-query intent (the dimensions filled in for one request) is ephemeral,
    // conversation-only. The store persists the SCHEMA (intent_spec.md), never the
    // INSTANCE. No intent.md is ever written.
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(join(result.dir, "intent.md"))).toBe(false);
    // Exactly the four behaviour artefacts + manifest — and intent_spec.md, never
    // a bare intent.md.
    const files = walkFiles(result.dir).sort();
    expect(files).toEqual(
      ["domain_spec.md", "intent_spec.md", "playbook.md", "profile.json", "user_spec.md"].sort(),
    );
  });
});
