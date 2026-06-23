/**
 * INTEGRATION — the refine loop's PERSIST + ROUND-TRIP composition over a real
 * temp $SIL_DATA_DIR (tier: integration — real filesystem artefact interaction,
 * no mock of the store, no network, no host).
 *
 * Card: refine-an-expert-from-observed-sessions-self-reinf (SC6). The architect's
 * verdict is that SC6 adds NO `src/` code — the refine loop COMPOSES the existing
 * `sil_profile_get` (load) + `sil_profile_materialize` (atomic in-place re-write)
 * store paths. So these tests do NOT test new code; they pin the EXISTING
 * profile-store paths the refine loop RELIES ON, in the specific composed shapes
 * the loop exercises that the create-time `profile-store.test.ts` does not cover:
 *
 *   (a) re-running materializeProfile over a PRE-EXISTING agents/<id>/ dir
 *       overwrites the artefact bodies IN PLACE (the refinement persists);
 *   (b) an injected write failure on a PRE-EXISTING dir leaves the PRIOR
 *       artefacts INTACT — the `dirPreexisted` guard (profile-store.ts:202-219)
 *       never tears down a dir it did not create, so a failed re-write never
 *       half-refines an expert;
 *   (c) materialize → re-materialize-with-an-updated-spec → readAgentProfile
 *       returns the UPDATED persona/playbook bodies — the load-then-refine-then-
 *       reload loop closes (the self-reinforcement round-trip).
 *
 * These are GREEN on arrival (green characterization of the foundation the loop
 * composes), NOT RED — they assert the store already does what SC6 needs. They
 * are deliberately NOT a duplicate of profile-store.test.ts: that file pins the
 * FRESH-dir create (write artefacts, validate-first, atomic-on-failure cleaning
 * up a dir IT created); this file pins the PRE-EXISTING-dir re-write semantics
 * (overwrite-in-place + prior-survives-on-failure + the read round-trip) — the
 * three behaviours the refine path is built on.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (the repo's standard knob),
 * mirroring profile-store.test.ts's beforeEach/afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
} from "../../lib/profile-store.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-refine-rewrite-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  // Restore perms so rmSync can clean a dir a failure-injection test chmod'd RO.
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    /* best-effort */
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/** The expert as first created (the working expert the refine loop sharpens). */
const CREATED = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  persona: "You are a road-cycling buyer. Prefer endurance geometry; flag anything over 8kg.",
  playbook: "Map budget to price_min/price_max. Rank by ride comfort, then weight.",
} as const;

/** The refined spec — the SAME agentId, UPDATED persona + playbook bodies (the
 * confirmed-subset-folded-into-the-full-spec the refine loop re-materializes). */
const REFINED = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  persona:
    "You are a road-cycling buyer. Prefer endurance geometry; flag anything over 8kg. "
    + "HARD-NO on carbon rim brakes (the user rejected every one).",
  playbook:
    "Map budget to price_min/price_max. Rank by ride comfort, then weight. "
    + "Down-weight anything the user called 'too racy'.",
} as const;

/** Every file under `dir`, recursively (relative paths) — to assert no `.tmp`
 * sibling survives a re-write, and that a failed re-write left only the priors. */
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

describe("refine persist — re-materialize over a PRE-EXISTING dir overwrites the bodies in place", () => {
  it("a second materialize with an updated spec overwrites persona.md + playbook.md (the refinement sticks)", () => {
    // Create the working expert, then refine it: re-run materialize with the
    // UPDATED spec for the SAME agentId. The artefact bodies must be overwritten
    // in place — the persisted files now hold the refined content, not the
    // original. This is the persist half of the refine loop.
    const first = materializeProfile({ ...CREATED });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // sanity: the original content is what landed.
    expect(readFileSync(first.personaPath, "utf8")).toBe(CREATED.persona);

    const dir = getAgentArtefactDir(CREATED.agentId);
    expect(existsSync(dir)).toBe(true); // the dir pre-exists the re-write

    const second = materializeProfile({ ...REFINED });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // The SAME files, now holding the REFINED bodies — overwritten in place.
    expect(second.dir).toBe(dir);
    expect(readFileSync(second.personaPath, "utf8")).toBe(REFINED.persona);
    expect(second.playbookPath).toBeDefined();
    expect(readFileSync(second.playbookPath!, "utf8")).toBe(REFINED.playbook);
    // The manifest is refreshed and still points at the same artefacts.
    const manifest = JSON.parse(
      readFileSync(join(dir, "profile.json"), "utf8"),
    ) as { agentId: string; name: string };
    expect(manifest.agentId).toBe(REFINED.agentId);
    // No `.tmp` sibling survives the atomic re-write (tmp → rename ran).
    expect(walkFiles(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("re-materialize does NOT create a sibling dir or leak outside agents/<agentId>/ (single-id scope)", () => {
    // The refine persist keys off the one validated agentId; a re-write must not
    // spawn a second agent dir. After create + refine, exactly ONE expert dir
    // exists under agents/.
    materializeProfile({ ...CREATED });
    materializeProfile({ ...REFINED });
    const agentsRoot = join(dataDir, "agents");
    const entries = readdirSync(agentsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(entries).toEqual([CREATED.agentId]);
  });
});

describe("refine persist — a write failure on a PRE-EXISTING dir leaves the PRIOR artefacts intact (dirPreexisted guard)", () => {
  // chmod 0500 cannot block writes for root — skip there rather than false-fail.
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;

  it.skipIf(asRoot)(
    "when the re-write fails (dir made read-only), the original artefacts survive — never a half-refined expert",
    () => {
      // Create the working expert with its ORIGINAL artefacts.
      const first = materializeProfile({ ...CREATED });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const dir = getAgentArtefactDir(CREATED.agentId);

      // Make the PRE-EXISTING dir read-only so the refine re-write's tmp-file
      // write fails EACCES. The `dirPreexisted` guard (profile-store.ts:202-219)
      // must NOT tear the dir down — it did not create it.
      chmodSync(dir, 0o500);

      const second = materializeProfile({ ...REFINED });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.kind).toBe("persistence_failed");

      // Restore perms to inspect + let afterEach clean up.
      chmodSync(dir, 0o700);

      // The PRIOR artefacts survive untouched — the original content, not the
      // refined content, and not a partial mix. This is the "a persist failure
      // leaves the prior expert intact, never half-refined" semantics SC6 needs.
      expect(existsSync(join(dir, "persona.md"))).toBe(true);
      expect(readFileSync(join(dir, "persona.md"), "utf8")).toBe(CREATED.persona);
      expect(readFileSync(join(dir, "playbook.md"), "utf8")).toBe(CREATED.playbook);
      expect(existsSync(join(dir, "profile.json"))).toBe(true);
      // No tmp leftover from the failed re-write.
      expect(walkFiles(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
    },
  );

  it("a re-write blocked at the manifest stage degrades to not_found on read — never serves a coherent HALF-refined expert (the store's per-file, NOT cross-file, atomicity)", () => {
    // ADVERSARIAL FINDING the developer must know: materializeProfile is per-FILE
    // atomic (tmp → rename, each file is all-or-nothing) but NOT transactional
    // ACROSS its three files. It writes persona.md → playbook.md → profile.json
    // in order (profile-store.ts:206-210). A failure at the MANIFEST stage —
    // AFTER persona+playbook have already been overwritten — does NOT roll the
    // bodies back. So the "a failed re-write leaves the PRIOR artefacts intact"
    // guarantee holds STRICTLY for a failure at the FIRST write (the read-only-dir
    // case above); a mid-sequence failure leaves the bodies updated but the
    // manifest stale/broken.
    //
    // What the store DOES still guarantee, and what protects the user, is two
    // things, both asserted here: (1) the `dirPreexisted` guard never tears the
    // expert dir down (the expert is not deleted), and (2) readAgentProfile
    // composes manifest + bodies and degrades to `not_found` when the manifest is
    // unreadable — so the loop NEVER serves a coherent-looking half-refined expert
    // off a broken manifest; the read fails closed and the skill lists the healthy
    // experts. THAT is the meaningful safety property at this seam.
    const first = materializeProfile({ ...CREATED });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const dir = getAgentArtefactDir(CREATED.agentId);

    // Occupy the manifest path with a directory — rename(tmp → profile.json) over
    // a directory target fails (EISDIR/ENOTEMPTY), failing the manifest write.
    const profilePath = join(dir, "profile.json");
    rmSync(profilePath, { force: true });
    mkdirSync(profilePath);
    writeFileSync(join(profilePath, "occupied"), "blocks the rename");

    const second = materializeProfile({ ...REFINED });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.kind).toBe("persistence_failed");

    // (1) The expert dir was NOT torn down (dirPreexisted guard) — the expert
    // still exists on disk; the failure did not destroy it.
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "persona.md"))).toBe(true);
    expect(statSync(profilePath).isDirectory()).toBe(true); // blocker untouched

    // (2) The read fails closed: with the manifest unreadable, readAgentProfile
    // returns not_found rather than serving an expert off a half-written state.
    // The loop never loads a coherent half-refined expert from a broken manifest.
    const read = readAgentProfile(CREATED.agentId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("not_found");
  });
});

describe("refine round-trip — materialize → re-materialize(updated) → readAgentProfile returns the UPDATED bodies", () => {
  it("a later read inside the refined expert loads the kept refinements (the self-reinforcement loop closes)", () => {
    // The full loop: create the expert, refine it (re-materialize the updated
    // spec), then LOAD it back via the same get path a later session uses. The
    // read must return the UPDATED persona/playbook — proving a later session
    // reflects the kept refinements, not the original spec.
    expect(materializeProfile({ ...CREATED }).ok).toBe(true);
    expect(materializeProfile({ ...REFINED }).ok).toBe(true);

    const read = readAgentProfile(CREATED.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.agentId).toBe(REFINED.agentId);
    expect(read.name).toBe(REFINED.name);
    // The kept refinements are what a later session loads — the UPDATED bodies.
    expect(read.persona).toBe(REFINED.persona);
    expect(read.playbook).toBe(REFINED.playbook);
    // And it is NOT the stale original (guards against a read that missed the
    // overwrite).
    expect(read.persona).not.toBe(CREATED.persona);
    expect(read.playbook).not.toBe(CREATED.playbook);
  });

  it("the read after refine carries the refreshed manifest fields (the load path sees the new spec)", () => {
    // The manifest is re-written on each materialize; the read composes manifest
    // + bodies. After refine, the read's createdAt is a parseable ISO timestamp
    // from the re-write and the profilePath still resolves under the one agent
    // dir — the loop loads a coherent, refreshed expert.
    materializeProfile({ ...CREATED });
    materializeProfile({ ...REFINED });

    const read = readAgentProfile(CREATED.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.profilePath).toBe(
      join(getAgentArtefactDir(CREATED.agentId), "profile.json"),
    );
    expect(Number.isNaN(Date.parse(read.createdAt))).toBe(false);
  });
});

// ===========================================================================
// SDS LAYERS — refine targets a user.md attribute or a domain.md dimension
//
// Card: spec-driven-shopping-sds-for-created-experts. SDS makes refine able to
// sharpen the NEW artefact layers too: a user.md standing attribute / hard
// constraint, or a domain.md decision-dimension. Each is re-materialized
// IN PLACE through the same `sil_profile_materialize` store path the refine loop
// already composes — so the same three properties the playbook/persona re-write
// proved must hold for the new files:
//   (a) re-materialize over a PRE-EXISTING dir overwrites domain.md / user.md
//       in place (the kept SDS refinement sticks);
//   (b) a failed re-write on a PRE-EXISTING dir leaves the PRIOR SDS artefacts
//       intact (never a half-refined user spec);
//   (c) updating ONE SDS layer leaves the OTHER (and persona/playbook) intact —
//       a user.md update is not a full-expert rewrite that drops domain.md.
//
// The intent spec is deliberately ABSENT here: it is ephemeral and never
// persisted, so it is never a refine target and never re-materialized.
// ===========================================================================

/** The SDS expert as first created — persona + playbook + the two new layers. */
const SDS_CREATED = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  persona: "You are a road-cycling buyer. Prefer endurance geometry.",
  playbook: "Map budget to price params. Rank by comfort, then weight.",
  domainSpec:
    "# Domain spec\nDimensions: fit (stack/reach), groupset tier, rim depth vs"
    + " crosswind, gearing range. Trade-offs noted.",
  userSpec:
    "# User spec\n## Soft preferences\n- Endurance geometry, ~€1500.\n"
    + "## Hard constraints (INVIOLABLE)\n- HARD-NO: rim brakes.",
} as const;

/** Same expert, the USER SPEC sharpened (a refine that targets a user.md hard
 * constraint) — domain.md/persona/playbook unchanged. */
const SDS_USER_REFINED = {
  ...SDS_CREATED,
  userSpec:
    "# User spec\n## Soft preferences\n- Endurance geometry, ~€1500.\n"
    + "## Hard constraints (INVIOLABLE)\n- HARD-NO: rim brakes.\n"
    + "- HARD-NO: anything over 9kg (the user said it three times).",
} as const;

describe("refine SDS layers — re-materialize a user.md attribute in place (the kept refinement sticks)", () => {
  it("a second materialize with an updated userSpec overwrites user.md in place; domain.md + persona survive", () => {
    const first = materializeProfile({ ...SDS_CREATED });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const dir = getAgentArtefactDir(SDS_CREATED.agentId);
    expect(readFileSync(join(dir, "user.md"), "utf8")).toBe(SDS_CREATED.userSpec);

    const second = materializeProfile({ ...SDS_USER_REFINED });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // user.md now holds the sharpened spec…
    expect(readFileSync(join(dir, "user.md"), "utf8")).toBe(SDS_USER_REFINED.userSpec);
    expect(readFileSync(join(dir, "user.md"), "utf8")).toContain("over 9kg");
    // …and the OTHER layers are untouched by a user-spec-only refine.
    expect(readFileSync(join(dir, "domain.md"), "utf8")).toBe(SDS_CREATED.domainSpec);
    expect(readFileSync(join(dir, "persona.md"), "utf8")).toBe(SDS_CREATED.persona);
    expect(readFileSync(join(dir, "playbook.md"), "utf8")).toBe(SDS_CREATED.playbook);
    // No tmp leftover from the atomic re-write.
    expect(walkFiles(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("the round-trip closes: read after a user.md refine returns the UPDATED user spec, not the stale one", () => {
    materializeProfile({ ...SDS_CREATED });
    materializeProfile({ ...SDS_USER_REFINED });
    const read = readAgentProfile(SDS_CREATED.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.userSpec).toBe(SDS_USER_REFINED.userSpec);
    expect(read.userSpec).not.toBe(SDS_CREATED.userSpec);
    // The domain spec is unchanged — a user-spec refine is not a domain rewrite.
    expect(read.domainSpec).toBe(SDS_CREATED.domainSpec);
  });
});

describe("refine SDS layers — a failed re-write leaves the PRIOR user.md/domain.md intact", () => {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;

  it.skipIf(asRoot)(
    "when the re-write fails (dir read-only), the original user.md + domain.md survive — never a half-refined SDS expert",
    () => {
      const first = materializeProfile({ ...SDS_CREATED });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const dir = getAgentArtefactDir(SDS_CREATED.agentId);

      // Block the re-write: make the PRE-EXISTING dir read-only so the tmp write
      // fails EACCES. The dirPreexisted guard must NOT tear the expert down.
      chmodSync(dir, 0o500);
      const second = materializeProfile({ ...SDS_USER_REFINED });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.kind).toBe("persistence_failed");
      chmodSync(dir, 0o700);

      // The PRIOR SDS artefacts survive untouched — the original bodies, not the
      // refined ones, and not a partial mix.
      expect(readFileSync(join(dir, "user.md"), "utf8")).toBe(SDS_CREATED.userSpec);
      expect(readFileSync(join(dir, "domain.md"), "utf8")).toBe(SDS_CREATED.domainSpec);
      expect(walkFiles(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
    },
  );
});
