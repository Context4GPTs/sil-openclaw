/**
 * INTEGRATION — the refine + lazy-capture loop's PERSIST + ROUND-TRIP composition
 * over a real temp $SIL_DATA_DIR (tier: integration — real filesystem artefact
 * interaction, no mock of the store, no network, no host).
 *
 * Card: spec-driven-shopping-sds-for-created-experts — Founder review round 2
 * (PR #33 bounced a SECOND time). The refine loop AND the per-query augment path
 * both COMPOSE the existing `sil_profile_get` (load) + `sil_profile_materialize`
 * (atomic in-place re-write) store paths — no new code. These tests pin the
 * EXISTING profile-store re-write semantics the loop relies on, in the SDS
 * five-artefact shape:
 *
 *   (a) re-running materializeProfile over a PRE-EXISTING agents/<id>/ dir
 *       overwrites the artefact bodies IN PLACE (the refinement / per-query
 *       augmentation persists);
 *   (b) an injected write failure on a PRE-EXISTING dir leaves the PRIOR
 *       artefacts INTACT — the `dirPreexisted` guard never tears down a dir it
 *       did not create, so a failed re-write never half-refines an expert;
 *   (c) materialize → re-materialize-with-an-updated-spec → readAgentProfile
 *       returns the UPDATED bodies — the load-then-refine-then-reload loop closes.
 *
 * After the SDS reframe: NO persona in the store (it is the host SOUL.md). Round-2
 * correction: ALL FOUR sil specs (domain_spec / intent_spec / user_spec /
 * playbook) are REQUIRED and PRESENT from creation (seeded partial), then lazily
 * AUGMENTED in place per-query — never "added from absent". Refine can target any
 * of the four. The per-query INTENT (filled dimensions) is never persisted — only
 * the intent_spec.md SCHEMA is — so it is never a refine target and never
 * re-materialized.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (the repo's standard knob).
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

/** The SDS expert as first created — ALL FOUR REQUIRED specs (round-2: every sil
 * doc is present non-blank from creation, seeded partial). */
const CREATED = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  domainSpec:
    "# Domain spec (deep)\nFit mechanics (stack/reach, saddle setback, crank"
    + " length), gearing theory, frame geometry. Trade-offs noted.",
  intentSpec:
    "# Intent spec — dimensions\nuse-case, terrain, budget, timeline, compatibility,"
    + " performance priorities, aesthetics.",
  userSpec:
    "# User spec (seeded partial)\nFacts: endurance geometry, inseam 81cm.\n"
    + "HARD-NO: rim brakes.",
  playbook: "# Buying taste (seeded partial)\nBudget ~€1500; brand-agnostic.",
} as const;

/** The refined spec — SAME agentId, the domain spec ENHANCED (a per-query web
 * refresh persisted in place). The intent spec is unchanged. */
const REFINED = {
  ...CREATED,
  domainSpec:
    "# Domain spec (deep)\nFit mechanics (stack/reach, saddle setback, crank"
    + " length), gearing theory, frame geometry. Trade-offs noted.\n"
    + "## 2026 update (web refresh)\nSRAM Red AXS 2x13 now shipping; UDH/T-Type"
    + " compatibility matters for new frames.",
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
  it("a second materialize with an updated domain spec overwrites domain_spec.md (the web-refresh sticks)", () => {
    // Create the expert, then web-refresh its domain spec: re-run materialize with
    // the ENHANCED domainSpec for the SAME agentId. domain_spec.md is overwritten
    // in place — the persisted file now holds the refreshed content (Correction 5:
    // the domain spec is web-refreshed per-query and persisted via re-materialize).
    const first = materializeProfile({ ...CREATED });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(readFileSync(first.domainSpecPath, "utf8")).toBe(CREATED.domainSpec);

    const dir = getAgentArtefactDir(CREATED.agentId);
    expect(existsSync(dir)).toBe(true); // the dir pre-exists the re-write

    const second = materializeProfile({ ...REFINED });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.dir).toBe(dir);
    expect(readFileSync(second.domainSpecPath, "utf8")).toBe(REFINED.domainSpec);
    // The intent spec is unchanged by a domain-only refresh.
    expect(readFileSync(second.intentSpecPath, "utf8")).toBe(CREATED.intentSpec);
    const manifest = JSON.parse(
      readFileSync(join(dir, "profile.json"), "utf8"),
    ) as { agentId: string; name: string };
    expect(manifest.agentId).toBe(REFINED.agentId);
    // No `.tmp` sibling survives the atomic re-write (tmp → rename ran).
    expect(walkFiles(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("re-materialize does NOT create a sibling dir or leak outside agents/<agentId>/ (single-id scope)", () => {
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
      const first = materializeProfile({ ...CREATED });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const dir = getAgentArtefactDir(CREATED.agentId);

      // Make the PRE-EXISTING dir read-only so the refine re-write's tmp-file
      // write fails EACCES. The `dirPreexisted` guard must NOT tear the dir down —
      // it did not create it.
      chmodSync(dir, 0o500);

      const second = materializeProfile({ ...REFINED });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.kind).toBe("persistence_failed");

      // Restore perms to inspect + let afterEach clean up.
      chmodSync(dir, 0o700);

      // The PRIOR artefacts survive untouched — the original content, not the
      // refined content, and not a partial mix.
      expect(existsSync(join(dir, "domain_spec.md"))).toBe(true);
      expect(readFileSync(join(dir, "domain_spec.md"), "utf8")).toBe(CREATED.domainSpec);
      expect(readFileSync(join(dir, "intent_spec.md"), "utf8")).toBe(CREATED.intentSpec);
      expect(existsSync(join(dir, "profile.json"))).toBe(true);
      expect(walkFiles(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
    },
  );

  it("a re-write blocked at the manifest stage degrades to not_found on read — never serves a coherent HALF-refined expert (the store's per-file, NOT cross-file, atomicity)", () => {
    // ADVERSARIAL FINDING the developer must know: materializeProfile is per-FILE
    // atomic (tmp → rename, each file is all-or-nothing) but NOT transactional
    // ACROSS its files. A failure at the MANIFEST stage — AFTER the bodies have
    // already been overwritten — does NOT roll the bodies back. So the "a failed
    // re-write leaves the PRIOR artefacts intact" guarantee holds STRICTLY for a
    // failure at the FIRST write; a mid-sequence failure leaves the bodies updated
    // but the manifest stale/broken.
    //
    // What the store DOES still guarantee, and what protects the user, is two
    // things, both asserted here: (1) the `dirPreexisted` guard never tears the
    // expert dir down (the expert is not deleted), and (2) readAgentProfile
    // composes manifest + bodies and degrades to `not_found` when the manifest is
    // unreadable — so the loop NEVER serves a coherent-looking half-refined expert
    // off a broken manifest; the read fails closed.
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

    // (1) The expert dir was NOT torn down (dirPreexisted guard).
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "domain_spec.md"))).toBe(true);
    expect(statSync(profilePath).isDirectory()).toBe(true); // blocker untouched

    // (2) The read fails closed: with the manifest unreadable, readAgentProfile
    // returns not_found rather than serving an expert off a half-written state.
    const read = readAgentProfile(CREATED.agentId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("not_found");
  });
});

describe("refine round-trip — materialize → re-materialize(updated) → readAgentProfile returns the UPDATED bodies", () => {
  it("a later read inside the refined expert loads the kept domain refresh (the loop closes)", () => {
    expect(materializeProfile({ ...CREATED }).ok).toBe(true);
    expect(materializeProfile({ ...REFINED }).ok).toBe(true);

    const read = readAgentProfile(CREATED.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.agentId).toBe(REFINED.agentId);
    expect(read.name).toBe(REFINED.name);
    // The kept refresh is what a later session loads — the UPDATED domain spec.
    expect(read.domainSpec).toBe(REFINED.domainSpec);
    expect(read.domainSpec).not.toBe(CREATED.domainSpec);
    // The intent spec is unchanged.
    expect(read.intentSpec).toBe(CREATED.intentSpec);
  });

  it("the read after refine carries the refreshed manifest fields (the load path sees the new spec)", () => {
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
// PER-QUERY AUGMENT + REFINE OF THE SDS LAYERS — domain_spec / intent_spec /
// user_spec / playbook re-materialize in place
//
// Card: spec-driven-shopping-sds-for-created-experts (Founder review round 2).
// All four sil docs are PRESENT from creation (seeded partial); the per-query
// augment path and the refine path both re-materialize a layer IN PLACE through
// the same `sil_profile_materialize` store path — augmenting an already-present
// doc, never adding one from absent. The three properties the domain re-write
// proved above must hold for each layer:
//   (a) re-materialize over a PRE-EXISTING dir overwrites the layer in place (the
//       kept augmentation/refinement sticks);
//   (b) a failed re-write on a PRE-EXISTING dir leaves the PRIOR SDS artefacts
//       intact (never a half-augmented user spec);
//   (c) augmenting ONE layer leaves the OTHERS intact — a user_spec augment is not
//       a full-expert rewrite that drops domain_spec/intent_spec.
//
// The per-query INTENT (filled dimensions) is deliberately ABSENT here: it is
// ephemeral and never persisted, so it is never a refine target and never
// re-materialized. Only the intent_spec.md SCHEMA is persisted.
// ===========================================================================

/** The SDS expert as first created — ALL FOUR REQUIRED specs present (seeded
 * partial; round-2). */
const SDS_CREATED = {
  agentId: "road-cycling-buyer",
  name: "Road Cycling Buyer",
  domainSpec: "# Domain spec\nFit mechanics, gearing theory, frame geometry.",
  intentSpec: "# Intent spec — dimensions\nuse-case, terrain, budget, compatibility.",
  userSpec:
    "# User spec (seeded partial)\n## Domain-relevant facts (soft)\n- Endurance geometry.\n"
    + "## Hard constraints (INVIOLABLE)\n- HARD-NO: rim brakes.",
  playbook: "# Buying taste (seeded partial)\nBrand-agnostic.",
} as const;

/** Same expert, the already-present user_spec AUGMENTED in place (a fact the user
 * surfaced mid-query) — domain/intent unchanged. */
const SDS_USER_AUGMENTED = {
  ...SDS_CREATED,
  userSpec:
    "# User spec\n## Domain-relevant facts (soft)\n- Endurance geometry, inseam 81cm.\n"
    + "## Hard constraints (INVIOLABLE)\n- HARD-NO: rim brakes.",
} as const;

/** Same expert, the user_spec then SHARPENED again (a refine targeting a user_spec
 * hard constraint) PLUS the playbook taste augmented in place. */
const SDS_USER_REFINED = {
  ...SDS_USER_AUGMENTED,
  userSpec:
    "# User spec\n## Domain-relevant facts (soft)\n- Endurance geometry, inseam 81cm.\n"
    + "## Hard constraints (INVIOLABLE)\n- HARD-NO: rim brakes.\n"
    + "- HARD-NO: anything over 9kg (the user said it three times).",
  playbook: "# Buying taste\nBudget ~€1500; brand-agnostic.",
} as const;

describe("per-query augment — re-materialize AUGMENTS an already-present user_spec/playbook in place", () => {
  it("a second materialize with an augmented userSpec overwrites user_spec.md in place; domain/intent survive untouched", () => {
    const first = materializeProfile({ ...SDS_CREATED });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const dir = getAgentArtefactDir(SDS_CREATED.agentId);
    // The user_spec is PRESENT from creation (round-2) — augmentation overwrites it.
    expect(readFileSync(join(dir, "user_spec.md"), "utf8")).toBe(SDS_CREATED.userSpec);

    const second = materializeProfile({ ...SDS_USER_AUGMENTED });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // user_spec.md now holds the augmented fact + hard constraint…
    expect(readFileSync(join(dir, "user_spec.md"), "utf8")).toBe(SDS_USER_AUGMENTED.userSpec);
    expect(readFileSync(join(dir, "user_spec.md"), "utf8")).toContain("inseam 81cm");
    // …and the other specs are untouched by a user-side augmentation.
    expect(readFileSync(join(dir, "domain_spec.md"), "utf8")).toBe(SDS_CREATED.domainSpec);
    expect(readFileSync(join(dir, "intent_spec.md"), "utf8")).toBe(SDS_CREATED.intentSpec);
    expect(readFileSync(join(dir, "playbook.md"), "utf8")).toBe(SDS_CREATED.playbook);
    expect(walkFiles(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("a later refine sharpens user_spec AND augments the playbook taste; domain/intent still survive", () => {
    materializeProfile({ ...SDS_CREATED });
    materializeProfile({ ...SDS_USER_AUGMENTED });
    const dir = getAgentArtefactDir(SDS_CREATED.agentId);

    const third = materializeProfile({ ...SDS_USER_REFINED });
    expect(third.ok).toBe(true);
    if (!third.ok) return;

    expect(readFileSync(join(dir, "user_spec.md"), "utf8")).toBe(SDS_USER_REFINED.userSpec);
    expect(readFileSync(join(dir, "user_spec.md"), "utf8")).toContain("over 9kg");
    // The buying taste (playbook) is augmented in place…
    expect(readFileSync(join(dir, "playbook.md"), "utf8")).toBe(SDS_USER_REFINED.playbook);
    // …and the required specs survive.
    expect(readFileSync(join(dir, "domain_spec.md"), "utf8")).toBe(SDS_CREATED.domainSpec);
    expect(readFileSync(join(dir, "intent_spec.md"), "utf8")).toBe(SDS_CREATED.intentSpec);
  });

  it("the round-trip closes: read after a user_spec refine returns the UPDATED user spec, not the stale one", () => {
    materializeProfile({ ...SDS_CREATED });
    materializeProfile({ ...SDS_USER_AUGMENTED });
    materializeProfile({ ...SDS_USER_REFINED });
    const read = readAgentProfile(SDS_CREATED.agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.userSpec).toBe(SDS_USER_REFINED.userSpec);
    expect(read.userSpec).not.toBe(SDS_USER_AUGMENTED.userSpec);
    // The intent spec (the persisted dimension schema) is unchanged — a user-spec
    // refine is not an intent-spec rewrite.
    expect(read.intentSpec).toBe(SDS_CREATED.intentSpec);
  });

  it("refine can target the intent_spec.md SCHEMA in place (re-derived dimensions persist; the per-query intent is never persisted)", () => {
    // Correction 4: intent_spec.md is refine-mutable (the persisted dimension
    // schema). A re-materialize with an updated intentSpec overwrites the schema in
    // place — but NO intent.md of filled per-query values is ever written.
    materializeProfile({ ...SDS_CREATED });
    const dir = getAgentArtefactDir(SDS_CREATED.agentId);
    const newIntentSchema =
      "# Intent spec — dimensions (v2)\nuse-case, terrain, budget, timeline,"
      + " compatibility, performance priorities, aesthetics, weight-weenie-ness.";
    const refined = materializeProfile({ ...SDS_CREATED, intentSpec: newIntentSchema });
    expect(refined.ok).toBe(true);
    if (!refined.ok) return;
    expect(readFileSync(join(dir, "intent_spec.md"), "utf8")).toBe(newIntentSchema);
    // The schema overwrote in place; no intent.md instance file appears.
    expect(existsSync(join(dir, "intent.md"))).toBe(false);
  });
});

describe("refine SDS layers — a failed re-write leaves the PRIOR layers intact", () => {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;

  it.skipIf(asRoot)(
    "when the re-write fails (dir read-only), the original user_spec + domain_spec survive — never a half-refined SDS expert",
    () => {
      materializeProfile({ ...SDS_CREATED });
      materializeProfile({ ...SDS_USER_AUGMENTED });
      const dir = getAgentArtefactDir(SDS_CREATED.agentId);

      // Block the re-write: make the PRE-EXISTING dir read-only so the tmp write
      // fails EACCES. The dirPreexisted guard must NOT tear the expert down.
      chmodSync(dir, 0o500);
      const refined = materializeProfile({ ...SDS_USER_REFINED });
      expect(refined.ok).toBe(false);
      if (refined.ok) return;
      expect(refined.kind).toBe("persistence_failed");
      chmodSync(dir, 0o700);

      // The PRIOR SDS artefacts survive untouched — the augmented bodies, not the
      // refined ones, and not a partial mix.
      expect(readFileSync(join(dir, "user_spec.md"), "utf8")).toBe(SDS_USER_AUGMENTED.userSpec);
      expect(readFileSync(join(dir, "domain_spec.md"), "utf8")).toBe(SDS_CREATED.domainSpec);
      expect(readFileSync(join(dir, "intent_spec.md"), "utf8")).toBe(SDS_CREATED.intentSpec);
      expect(walkFiles(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
    },
  );
});
