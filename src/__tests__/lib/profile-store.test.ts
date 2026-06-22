/**
 * UNIT — materializeProfile() behaviour-artefact writer (tier: unit, real temp
 * dir via the SIL_DATA_DIR override, no network, no host).
 *
 * Card: create-a-valid-sil-wired-openclaw-agent-profile (founder steer:
 * behaviour artefacts in the sil data directory). This is the plugin's half of
 * the agent-creation engine — the host-config wiring is host-CLI-driven; the
 * BEHAVIOUR artefacts (persona.md, optional playbook.md, profile.json) are the
 * sil-owned write into $SIL_DATA_DIR/agents/<agentId>/.
 *
 * The invariants pinned here ARE the card's correctness bar for the artefact
 * layer:
 *   1. A valid spec materializes persona.md + profile.json (and playbook.md when
 *      supplied) under $SIL_DATA_DIR/agents/<agentId>/, owner-only (0600), in a
 *      0700 dir, with a typed manifest pointing at the artefacts.
 *   2. Validate-FIRST: every invalid field returns `invalid_request` naming the
 *      field and writes NOTHING — no agent directory appears (Product
 *      invariant 7, atomic outcome).
 *   3. Atomic on failure: a mid-write failure leaves NOTHING partial behind
 *      (persistence_failed with <dir>: <cause>).
 *   4. Identity boundary: materializing reads/writes no token (no coupling).
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (the repo's standard knob).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/profile-store.ts`:
 *   - getAgentArtefactDir(agentId): $SIL_DATA_DIR/agents/<agentId> (never hardcoded)
 *   - materializeProfile(spec): MaterializeResult — discriminated, never throws;
 *     validate-first (invalid_request, write nothing); atomic (persistence_failed,
 *     nothing partial); ok writes persona.md + profile.json + optional playbook.md.
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
  getAgentArtefactDir,
  type ProfileManifest,
} from "../../lib/profile-store.js";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-profile-store-"));
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

const GOOD = {
  agentId: "gift-buyer",
  name: "Gift Buyer",
  persona: "You specialise in gifts under €50; always check stock before recommending.",
  playbook: "Use sil_search for browsing; sil_product_get to re-check stock before buying.",
} as const;

function readManifest(agentId: string): ProfileManifest {
  const path = join(getAgentArtefactDir(agentId), "profile.json");
  return JSON.parse(readFileSync(path, "utf8")) as ProfileManifest;
}

/** Every file under `dir`, recursively (relative paths). Used to prove no
 * `.tmp` sibling survives a write and no artefact survives a failed write. */
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

describe("materializeProfile — valid spec writes the behaviour artefacts", () => {
  it("writes persona.md, playbook.md, and profile.json under $SIL_DATA_DIR/agents/<agentId>/", () => {
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow

    const expectedDir = join(getDataDir(), "agents", GOOD.agentId);
    expect(result.dir).toBe(expectedDir);
    expect(existsSync(join(expectedDir, "persona.md"))).toBe(true);
    expect(existsSync(join(expectedDir, "playbook.md"))).toBe(true);
    expect(existsSync(join(expectedDir, "profile.json"))).toBe(true);

    expect(readFileSync(result.personaPath, "utf8")).toBe(GOOD.persona);
    expect(result.playbookPath).toBeDefined();
    expect(readFileSync(result.playbookPath!, "utf8")).toBe(GOOD.playbook);
  });

  it("resolves the artefact dir from getDataDir() — honours $SIL_DATA_DIR (never hardcoded)", () => {
    // getAgentArtefactDir must sit under the overridden data dir, proving it
    // reads the accessor and is not a baked-in ~/.local/share path.
    expect(getAgentArtefactDir("x")).toBe(join(dataDir, "agents", "x"));
  });

  it("the manifest is typed and points at the materialized artefacts", () => {
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);

    const manifest = readManifest(GOOD.agentId);
    expect(manifest.agentId).toBe(GOOD.agentId);
    expect(manifest.name).toBe(GOOD.name);
    expect(manifest.personaPath).toBe(
      join(getAgentArtefactDir(GOOD.agentId), "persona.md"),
    );
    expect(manifest.playbookPath).toBe(
      join(getAgentArtefactDir(GOOD.agentId), "playbook.md"),
    );
    expect(typeof manifest.createdAt).toBe("string");
    // ISO 8601 — parseable to a real date.
    expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false);
  });

  it("omits playbook.md AND the manifest playbookPath when no playbook is supplied", () => {
    const { playbook: _omit, ...noPlaybook } = GOOD;
    const result = materializeProfile({ ...noPlaybook });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(existsSync(join(result.dir, "persona.md"))).toBe(true);
    expect(existsSync(join(result.dir, "playbook.md"))).toBe(false);
    expect(result.playbookPath).toBeUndefined();

    const manifest = readManifest(GOOD.agentId);
    expect(manifest.playbookPath).toBeUndefined();
  });

  it("writes artefacts owner-only (0600) inside a 0700 dir", () => {
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // mask to the permission bits.
    expect(statSync(result.dir).mode & 0o777).toBe(0o700);
    expect(statSync(result.personaPath).mode & 0o777).toBe(0o600);
    expect(statSync(result.profilePath).mode & 0o777).toBe(0o600);
  });

  it("does NOT read or write any token (no identity coupling)", () => {
    // The tokens path must not appear as a side effect of materializing.
    materializeProfile({ ...GOOD });
    expect(existsSync(getTokensPath())).toBe(false);
  });

  it("leaves NO .tmp sibling behind after the atomic write (tmp → rename → chmod)", () => {
    // The store writes via a tmp sibling then renames over the target. A
    // surviving `.tmp` means the rename never ran — the atomic-write contract
    // broken (a reader could observe a half-written artefact).
    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const leftovers = walkFiles(result.dir).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });
});

describe("materializeProfile — validate-first: a bad spec writes NOTHING (invalid_request)", () => {
  const dirExists = () => existsSync(getAgentArtefactDir(GOOD.agentId));

  it("missing agentId → invalid_request(field=agentId), nothing written", () => {
    const result = materializeProfile({ ...GOOD, agentId: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("agentId");
    expect(dirExists()).toBe(false);
  });

  it('reserved "main" agentId → invalid_request(field=agentId), nothing written', () => {
    const result = materializeProfile({ ...GOOD, agentId: "main" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("agentId");
    expect(existsSync(join(getDataDir(), "agents", "main"))).toBe(false);
  });

  it("non-kebab agentId → invalid_request(field=agentId), nothing written", () => {
    const result = materializeProfile({ ...GOOD, agentId: "Gift Buyer!" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("agentId");
  });

  it("rejects a path-traversing / separator-bearing agentId (it is a dir-path segment)", () => {
    // Security-relevant: agentId becomes a directory path segment under
    // $SIL_DATA_DIR/agents/. A `..` or `/` would let an artefact escape the
    // sandbox. The lower-kebab gate must reject every such shape — and write
    // nothing for any of them.
    for (const bad of ["../escape", "gift/buyer", "..", ".", "a/../b", "Gift-Buyer"]) {
      const result = materializeProfile({ ...GOOD, agentId: bad });
      expect(result.ok, `expected reject for ${JSON.stringify(bad)}`).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe("agentId");
    }
    // Nothing escaped the agents subtree (no stray file anywhere under it).
    expect(walkFiles(join(getDataDir(), "agents"))).toEqual([]);
  });

  it("blank name → invalid_request(field=name), nothing written", () => {
    const result = materializeProfile({ ...GOOD, name: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("name");
    expect(dirExists()).toBe(false);
  });

  it("blank persona → invalid_request(field=persona), nothing written", () => {
    const result = materializeProfile({ ...GOOD, persona: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("persona");
    expect(dirExists()).toBe(false);
  });

  it("present-but-blank playbook → invalid_request(field=playbook), nothing written", () => {
    const result = materializeProfile({ ...GOOD, playbook: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("playbook");
    expect(dirExists()).toBe(false);
  });
});

describe("materializeProfile — atomic on write failure (persistence_failed, nothing partial)", () => {
  it("when the artefact path is blocked by a file, returns persistence_failed with <dir>: <cause> and leaves nothing partial", () => {
    // Force a write failure: pre-create `agents/<id>` as a FILE, so mkdir of the
    // dir (recursive over an existing non-dir leaf) throws ENOTDIR/EEXIST.
    const agentsDir = join(getDataDir(), "agents");
    mkdirSync(agentsDir, { recursive: true });
    // Place a regular file exactly where the agent DIR must go.
    writeFileSync(join(agentsDir, GOOD.agentId), "i am a file, not a dir");

    const result = materializeProfile({ ...GOOD });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("persistence_failed");
    if (result.kind !== "persistence_failed") return;
    // The path + cause are both present (actionable recovery).
    expect(result.error).toContain(getAgentArtefactDir(GOOD.agentId));
    // The blocking file is untouched; no partial artefacts were written under it.
    expect(statSync(join(agentsDir, GOOD.agentId)).isFile()).toBe(true);
  });

  // chmod 0500 can't block writes for root — skip there rather than false-fail.
  // The file-blocks-path case above covers the failure envelope for ALL uids;
  // this one additionally drives the catch-block rmSync CLEANUP (a dir that was
  // created, then a write into it failed) so no half-populated dir survives.
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(asRoot)(
    "CLEANS UP a partially-created artefact dir when a mid-write fails (no half-set survives)",
    () => {
      // Pre-create the agent dir READ-ONLY (0500): mkdir(recursive) is a no-op,
      // then the tmp-file write inside it fails EACCES, driving the cleanup.
      const agentDir = getAgentArtefactDir(GOOD.agentId);
      mkdirSync(agentDir, { recursive: true });
      chmodSync(agentDir, 0o500);

      const result = materializeProfile({ ...GOOD });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("persistence_failed");

      // No artefact file may survive a failed write. Restore perms first so we
      // can inspect + afterEach can clean up.
      if (existsSync(agentDir)) {
        chmodSync(agentDir, 0o700);
        expect(walkFiles(agentDir)).toEqual([]);
      }
    },
  );
});
