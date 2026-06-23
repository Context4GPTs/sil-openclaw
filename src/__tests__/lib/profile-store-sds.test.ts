/**
 * UNIT — the SDS artefact store after the five-artefact reframe (tier: unit,
 * real temp dir via the SIL_DATA_DIR override, no network, no host).
 *
 * Card: spec-driven-shopping-sds-for-created-experts — Founder review round 1
 * (PR #33 bounced). SDS is the operating model for EVERY created expert, not an
 * additive optional layer. The sil store now holds FOUR behaviour artefacts (the
 * persona left the store — it is the host SOUL.md, written by the engine via the
 * host CLI, never a sil-side file):
 *
 *   domain_spec.md  — REQUIRED. The deep, researched niche expertise (how to buy
 *                     well, the full mechanics) — web-refreshed every query.
 *   intent_spec.md  — REQUIRED. The agent-specific decomposition DIMENSIONS
 *                     (PRD-style) a good query must resolve, derived from the
 *                     domain at creation.
 *   user_spec.md    — LAZY (optional). The user's domain-relevant facts + hard
 *                     constraints, captured incrementally per-query.
 *   playbook.md     — LAZY (optional). The user's buying TASTE (price sensitivity,
 *                     brand, preferences) — captured incrementally per-query.
 *
 * The store-layer contract this file pins for the implementation
 * (`src/lib/profile-store.ts`):
 *   1. NO PERSONA in the store. `ProfileSpec` has no `persona`; `materializeProfile`
 *      writes no persona.md; `ProfileManifest` has no personaPath;
 *      `readManifestFile`'s required gate is agentId/name/createdAt/domainSpecPath/
 *      intentSpecPath (NOT personaPath); `readAgentProfile` returns no persona.
 *   2. `domainSpec` + `intentSpec` are REQUIRED on materialize. A present-but-blank
 *      OR omitted domainSpec/intentSpec → invalid_request naming the field, and
 *      WRITES NOTHING (whole-spec validate-first — not even the other good files).
 *   3. `userSpec` + `playbook` are OPTIONAL (lazy): omitted is a valid create;
 *      present-but-blank is rejected (a blank spec is not a spec).
 *   4. Manifest gains domainSpecPath + intentSpecPath (required), keeps
 *      userSpecPath + playbookPath (optional). A manifest missing user/playbook
 *      keys is valid; one missing domain/intent keys is corrupt (not_found).
 *   5. The store NOW carries `intentSpec` (the persisted decomposition-dimension
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

/** A complete create: the two REQUIRED specs + the two LAZY ones. */
const GOOD = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  domainSpec: DOMAIN_SPEC,
  intentSpec: INTENT_SPEC,
  userSpec: USER_SPEC,
  playbook: PLAYBOOK,
} as const;

/** The minimum valid create: ONLY the two required specs (the lazy slots fill
 * later, per-query). This is what creation actually produces. */
const MIN_CREATE = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  domainSpec: DOMAIN_SPEC,
  intentSpec: INTENT_SPEC,
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

describe("materializeProfile — domain_spec.md + intent_spec.md are REQUIRED and land with the lazy slots", () => {
  it("writes domain_spec.md, intent_spec.md, user_spec.md, playbook.md under agents/<id>/ for a full create", () => {
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

  it("the minimum create is the two required specs alone — the lazy slots are simply absent", () => {
    // Cross-cutting rule A: domain_spec + intent_spec are substantive at creation;
    // user_spec + playbook start (near-)empty and fill lazily per-query. A create
    // with ONLY the two required specs is the normal creation output.
    const result = materializeProfile({ ...MIN_CREATE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(existsSync(join(result.dir, "domain_spec.md"))).toBe(true);
    expect(existsSync(join(result.dir, "intent_spec.md"))).toBe(true);
    expect(existsSync(join(result.dir, "user_spec.md"))).toBe(false);
    expect(existsSync(join(result.dir, "playbook.md"))).toBe(false);

    expect(result.userSpecPath).toBeUndefined();
    expect(result.playbookPath).toBeUndefined();
    const manifest = readManifest(GOOD.agentId);
    expect(manifest.userSpecPath).toBeUndefined();
    expect(manifest.playbookPath).toBeUndefined();
    // Only the two required artefacts + manifest.
    expect(walkFiles(result.dir).sort()).toEqual(
      ["domain_spec.md", "intent_spec.md", "profile.json"].sort(),
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

describe("materializeProfile — the LAZY slots are optional; present-but-blank is still rejected", () => {
  it("creates with only the two required specs — user_spec/playbook fill lazily later", () => {
    const result = materializeProfile({ ...MIN_CREATE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userSpecPath).toBeUndefined();
    expect(result.playbookPath).toBeUndefined();
  });

  it("present-but-blank userSpec → invalid_request(field=userSpec), nothing written", () => {
    const result = materializeProfile({ ...MIN_CREATE, userSpec: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("userSpec");
    expect(existsSync(getAgentArtefactDir(GOOD.agentId))).toBe(false);
  });

  it("present-but-blank playbook → invalid_request(field=playbook), nothing written", () => {
    const result = materializeProfile({ ...MIN_CREATE, playbook: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("playbook");
    expect(existsSync(getAgentArtefactDir(GOOD.agentId))).toBe(false);
  });

  it("a later re-materialize ADDS a lazily-captured user_spec without disturbing domain/intent", () => {
    // Lazy capture (Correction 5): the user side fills incrementally per-query via
    // re-materialize. After a min create, a second materialize adds user_spec.md.
    const first = materializeProfile({ ...MIN_CREATE });
    expect(first.ok).toBe(true);
    const second = materializeProfile({ ...MIN_CREATE, userSpec: USER_SPEC });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(readFileSync(second.userSpecPath!, "utf8")).toBe(USER_SPEC);
    // Domain + intent untouched by a user-side lazy capture.
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

  it("a min-create expert reads back OK — required specs present, lazy slots absent", () => {
    materializeProfile({ ...MIN_CREATE });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.domainSpec).toBe(DOMAIN_SPEC);
    expect(read.intentSpec).toBe(INTENT_SPEC);
    expect(read.userSpec).toBeUndefined();
    expect(read.playbook).toBeUndefined();
  });

  it("a manifest missing user/playbook keys is VALID; the required gate is agentId/name/createdAt/domainSpecPath/intentSpecPath", () => {
    // A min-create manifest carries no user/playbook path keys at all — and still
    // reads. readManifestFile must keep userSpecPath/playbookPath OPTIONAL.
    const result = materializeProfile({ ...MIN_CREATE });
    expect(result.ok).toBe(true);
    const manifest = readManifest(GOOD.agentId);
    expect("userSpecPath" in manifest).toBe(false);
    expect("playbookPath" in manifest).toBe(false);
    // But it carries the two REQUIRED path keys.
    expect(typeof manifest.domainSpecPath).toBe("string");
    expect(typeof manifest.intentSpecPath).toBe("string");
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

  it("a manifest pointing at a user_spec.md whose body is GONE degrades gracefully (lazy slot is optional detail)", () => {
    // Per-file atomic, not transactional: a manifest can point at a user_spec.md
    // that was hand-deleted. The user spec is OPTIONAL/lazy detail — its absent
    // body must NOT brick the read. The expert stays viewable; userSpec is just
    // undefined. (The REQUIRED specs are present, so the gate still passes.)
    materializeProfile({ ...GOOD });
    rmSync(join(getAgentArtefactDir(GOOD.agentId), "user_spec.md"), { force: true });
    const read = readAgentProfile(GOOD.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.userSpec).toBeUndefined();
    // The healthy parts still load.
    expect(read.domainSpec).toBe(DOMAIN_SPEC);
    expect(read.intentSpec).toBe(INTENT_SPEC);
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
