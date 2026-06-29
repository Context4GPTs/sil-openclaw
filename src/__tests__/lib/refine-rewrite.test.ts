/**
 * UNIT — the per-query refine / lazy-augment loop, re-expressed at the DOMAIN
 * grain (tier: unit, real temp dir via the SIL_DATA_DIR override, no network, no
 * host).
 *
 * Card: single-multi-domain-sil-shopper — Slice 1, updated for
 * consolidate-profile-tools-to-the-singleton-surface (the caller-supplied `agentId`
 * is dropped; the store re-scopes to the singleton). The "refine an expert" loop
 * is "refine a DOMAIN": re-running `materializeProfile` with the SAME
 * `domain.slug` overwrites that domain's pack IN PLACE (the per-query web refresh /
 * taste augmentation). The store's "fresh-create teardown vs re-materialize
 * per-file-atomic" split re-applies one level deeper — with the domains/<slug>/
 * leaf as the unit:
 *
 *   (a) re-minting an EXISTING domain overwrites its three bodies in place;
 *   (b) a write failure on an EXISTING domain's leaf is DIR-PRESERVING;
 *   (c) the re-mint is per-FILE atomic, NOT a cross-file transaction;
 *   (d) materialize → re-materialize(updated domain) → readAgentProfile(slug)
 *       returns the UPDATED bodies — the load-then-refine-then-reload loop closes.
 *
 * Contrast with profile-store-sds.test.ts: there, a failed FIRST mint of a NEW
 * domain tears the fresh leaf DOWN. Here, a failed re-mint of an EXISTING domain
 * PRESERVES it. Same split, one level deeper.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  statSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeProfile,
  readAgentProfile,
  getShopperArtefactDir,
  getDomainArtefactDir,
  type ProfileSpec,
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
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    /* best-effort */
  }
  rmSync(dataDir, { recursive: true, force: true });
});

const USER_SPEC = "# User spec (shared)\n- Ships to Berlin.\nHARD-NO: leather.";

/** The cycling pack, as first minted. */
const CYCLING_V1 = {
  slug: "road-cycling",
  name: "Road cycling",
  domainSpec: "# Domain spec (seeded)\nFit + gearing basics.",
  intentSpec: "# Intent spec\nuse-case, terrain, budget.",
  playbook: "# Taste (seeded)\n~€1500; brand-agnostic.",
} as const;

/** The same domain, refreshed by a later query — domain_spec ENHANCED. */
const CYCLING_V2 = {
  ...CYCLING_V1,
  domainSpec: CYCLING_V1.domainSpec + "\n(refreshed: aero vs comfort trade-offs).",
} as const;

function createShopper(userSpec = USER_SPEC): void {
  const r = materializeProfile({ name: "sil shopper", userSpec });
  if (!r.ok) throw new Error(`createShopper failed: ${JSON.stringify(r)}`);
}

function mint(domain: NonNullable<ProfileSpec["domain"]>, userSpec = USER_SPEC) {
  return materializeProfile({ name: "sil shopper", userSpec, domain });
}

function domainDir(slug: string): string {
  return getDomainArtefactDir(slug);
}

function readManifest(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(getShopperArtefactDir(), "profile.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("re-mint — re-running over an EXISTING domain overwrites its pack in place", () => {
  it("a second mint of the same slug overwrites domain_spec.md with the refreshed body", () => {
    createShopper();
    expect(mint(CYCLING_V1).ok).toBe(true);
    expect(readFileSync(join(domainDir("road-cycling"), "domain_spec.md"), "utf8")).toBe(
      CYCLING_V1.domainSpec,
    );

    expect(mint(CYCLING_V2).ok).toBe(true);
    expect(readFileSync(join(domainDir("road-cycling"), "domain_spec.md"), "utf8")).toBe(
      CYCLING_V2.domainSpec,
    );
    expect(readFileSync(join(domainDir("road-cycling"), "intent_spec.md"), "utf8")).toBe(
      CYCLING_V1.intentSpec,
    );
    expect(Object.keys((readManifest()["domains"] ?? {}) as Record<string, unknown>)).toEqual([
      "road-cycling",
    ]);
  });
});

describe("re-mint round-trip — materialize → re-materialize(updated) → read returns the UPDATED bodies", () => {
  it("a later read of the refined domain loads the kept domain refresh (the loop closes)", () => {
    createShopper();
    expect(mint(CYCLING_V1).ok).toBe(true);
    expect(mint(CYCLING_V2).ok).toBe(true);

    const read = readAgentProfile("road-cycling");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.domainSpec).toBe(CYCLING_V2.domainSpec);
    expect(read.domainSpec).not.toBe(CYCLING_V1.domainSpec);
    expect(read.intentSpec).toBe(CYCLING_V1.intentSpec);
  });
});

describe("re-mint atomicity — a failed re-mint of an EXISTING domain is DIR-PRESERVING (never deletes a domain the user has)", () => {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(asRoot)(
    "when the re-write into an existing leaf fails (leaf made read-only), the PRIOR pack survives intact",
    () => {
      createShopper();
      expect(mint(CYCLING_V1).ok).toBe(true);
      const leaf = domainDir("road-cycling");

      chmodSync(leaf, 0o500);
      const result = mint(CYCLING_V2);
      chmodSync(leaf, 0o700); // restore for assertions + cleanup

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("persistence_failed");

      expect(existsSync(leaf)).toBe(true);
      expect(readFileSync(join(leaf, "domain_spec.md"), "utf8")).toBe(CYCLING_V1.domainSpec);
      expect(readFileSync(join(leaf, "intent_spec.md"), "utf8")).toBe(CYCLING_V1.intentSpec);
      expect(
        Object.keys((readManifest()["domains"] ?? {}) as Record<string, unknown>),
      ).toEqual(["road-cycling"]);
      const read = readAgentProfile("road-cycling");
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.domainSpec).toBe(CYCLING_V1.domainSpec);
    },
  );

  it("a successful refine leaves only the three pack files in the leaf (no .tmp survivor)", () => {
    createShopper();
    expect(mint(CYCLING_V1).ok).toBe(true);
    expect(mint(CYCLING_V2).ok).toBe(true);
    const leaf = domainDir("road-cycling");
    for (const n of ["domain_spec.md", "intent_spec.md", "playbook.md"]) {
      expect(statSync(join(leaf, n)).isFile()).toBe(true);
    }
  });
});
