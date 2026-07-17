/**
 * INTEGRATION — shipped-artifact shape: package.json + openclaw.plugin.json
 * (tier: integration — reads two real config files from disk and asserts
 * they hold the contract OpenClaw needs to load the plugin).
 *
 * Covers the card criterion: "when openclaw.plugin.json and package.json
 * are parsed, then the manifest has non-empty id/name/description/version,
 * a skills array, and a contracts.tools array, and package.json has
 * type:"module", main pointing at the built entry, and an openclaw compat
 * block declaring pluginApi and minGatewayVersion."
 *
 * Mirrors the load-bearing fields of the reference adapter's package.json
 * and openclaw.plugin.json (klodi), minus the klodi-specific publish
 * machinery (vendor block, NATS externalServices). We assert the shape
 * the host parses — not klodi's marketplace values.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   package.json: type "module", main "./dist/index.js" (the built
 *   entry), an `openclaw` block with extensions[] and a compat block
 *   carrying `pluginApi` + `minGatewayVersion`, and `skill` +
 *   `openclaw.plugin.json` listed in `files` so they ship.
 *   openclaw.plugin.json: non-empty id/name/description/version, skills
 *   array, contracts.tools array, one configSchema property.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, rel), "utf8")) as T;
}

function readText(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

interface PackageJson {
  type?: string;
  main?: string;
  files?: string[];
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  openclaw?: {
    extensions?: string[];
    compat?: { pluginApi?: string; minGatewayVersion?: string };
  };
}

interface Manifest {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  skills?: string[];
  activation?: { onCapabilities?: string[] };
  contracts?: { tools?: string[] };
  configSchema?: { type?: string; properties?: Record<string, unknown> };
  security?: { packagingNote?: string; filesystemScope?: string[] };
}

describe("package.json — OpenClaw ESM plugin shape", () => {
  const pkg = readJson<PackageJson>("package.json");

  it('is an ES module (type: "module")', () => {
    expect(pkg.type).toBe("module");
  });

  it("points `main` at the built entry under dist", () => {
    expect(typeof pkg.main).toBe("string");
    expect(pkg.main).toMatch(/dist\/index\.js$/);
  });

  it("declares an `openclaw` block whose extensions include the built entry", () => {
    expect(pkg.openclaw).toBeTypeOf("object");
    expect(Array.isArray(pkg.openclaw!.extensions)).toBe(true);
    expect(pkg.openclaw!.extensions!.some((e) => /dist\/index\.js$/.test(e))).toBe(
      true,
    );
  });

  it("declares a compat block with non-empty pluginApi and minGatewayVersion", () => {
    const compat = pkg.openclaw?.compat;
    expect(compat).toBeTypeOf("object");
    expect(typeof compat!.pluginApi).toBe("string");
    expect(compat!.pluginApi!.length).toBeGreaterThan(0);
    expect(typeof compat!.minGatewayVersion).toBe("string");
    expect(compat!.minGatewayVersion!.length).toBeGreaterThan(0);
  });

  it("ships the skill dir (under its sil-unique basename) and the manifest via `files`", () => {
    // If the skill dir or the manifest is missing from `files`, the packed
    // artifact won't carry the playbook/manifest and the host can't
    // discover the skill — the architect's skill-not-discoverable risk.
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain("sil-shopping");
    expect(pkg.files).not.toContain("skill");
    expect(pkg.files).toContain("openclaw.plugin.json");
  });

  it("declares build and test scripts", () => {
    expect(pkg.scripts).toBeTypeOf("object");
    expect(typeof pkg.scripts!["build"]).toBe("string");
    expect(typeof pkg.scripts!["test"]).toBe("string");
  });
});

describe("openclaw.plugin.json — manifest shape", () => {
  const manifest = readJson<Manifest>("openclaw.plugin.json");

  it("has a non-empty id, name, and description", () => {
    for (const field of ["id", "name", "description"] as const) {
      expect(typeof manifest[field]).toBe("string");
      expect((manifest[field] as string).length).toBeGreaterThan(0);
    }
  });

  it("has a non-empty version string", () => {
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version!.length).toBeGreaterThan(0);
  });

  it("declares a non-empty skills array pointing at ./sil-shopping (the sil-unique basename)", () => {
    expect(Array.isArray(manifest.skills)).toBe(true);
    expect(manifest.skills!.length).toBeGreaterThan(0);
    expect(manifest.skills).toContain("./sil-shopping");
    expect(manifest.skills).not.toContain("./skill");
  });

  it("declares a contracts.tools array", () => {
    expect(Array.isArray(manifest.contracts?.tools)).toBe(true);
    expect(manifest.contracts!.tools!.length).toBeGreaterThan(0);
  });

  it("declares a configSchema with at least one property", () => {
    // The skeleton's minimal config-override surface (sil_web_url).
    expect(manifest.configSchema).toBeTypeOf("object");
    expect(manifest.configSchema!.properties).toBeTypeOf("object");
    expect(
      Object.keys(manifest.configSchema!.properties ?? {}).length,
    ).toBeGreaterThan(0);
  });

  it("uses sil_* tool names (skeleton namespace, not klodi_*)", () => {
    // Guards against a copy-paste leak of klodi's marketplace names.
    for (const name of manifest.contracts!.tools!) {
      expect(name.startsWith("klodi_")).toBe(false);
    }
  });
});

describe("version parity — package.json ↔ openclaw.plugin.json", () => {
  // The plugin carries its version in TWO files: package.json#version — the
  // single source of truth that `pnpm version` bumps — and the manifest's
  // version. `scripts/sync-version.mjs` mirrors the former into the latter on
  // every bump (wired into the `version` lifecycle); this is the guard that
  // FAILS if a hand-edit ever lets the two drift apart.
  const pkg = readJson<{ version?: string }>("package.json");
  const manifest = readJson<Manifest>("openclaw.plugin.json");

  it("openclaw.plugin.json#version equals package.json#version", () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it("package.json#version is plain semver", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
  });
});

describe("skill basename is sil-unique — no stale `./skill` literal, ships under sil-shopping/ (AC3/AC4/AC8)", () => {
  const pkg = readJson<PackageJson>("package.json");
  const manifest = readJson<Manifest>("openclaw.plugin.json");

  it("package.json#files lists `sil-shopping` and NO `skill` entry (publish allowlist)", () => {
    expect(pkg.files).toContain("sil-shopping");
    expect(pkg.files).not.toContain("skill");
  });

  it("openclaw.plugin.json#skills points at `./sil-shopping` and NO `./skill`", () => {
    expect(manifest.skills).toContain("./sil-shopping");
    expect(manifest.skills).not.toContain("./skill");
  });

  it("the `sil-shopping/` directory + SKILL.md exist on disk, and the old `skill/` is GONE", () => {
    expect(existsSync(join(REPO_ROOT, "sil-shopping", "SKILL.md"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "skill"))).toBe(false);
  });

  it("the skill subtree (references + example) moved under sil-shopping/ intact", () => {
    // A representative-but-stable probe: the two most router-central references
    // (method_and_prds — the method/PRD store, agent_creation_engine — onboarding +
    // the creation engine) plus the example. Deliberately NOT the full reference set:
    // that set churns as the skill is reshaped, so pinning it would be brittle — this
    // guard proves the subtree shipped, not which exact files it holds today.
    const root = join(REPO_ROOT, "sil-shopping");
    expect(
      existsSync(join(root, "references", "method_and_prds.md")),
    ).toBe(true);
    expect(
      existsSync(join(root, "references", "agent_creation_engine.md")),
    ).toBe(true);
    expect(
      existsSync(
        join(root, "examples", "multi_domain_shopper_walkthrough.md"),
      ),
    ).toBe(true);
  });

  it("no stale `./skill` / top-level `skill` literal survives in the publish-path config (AC8 sweep)", () => {
    const fileEntries = pkg.files ?? [];
    const skillEntries = manifest.skills ?? [];
    const stale = [
      ...fileEntries.filter((e) => e === "skill" || e === "./skill"),
      ...skillEntries.filter((e) => e === "skill" || e === "./skill"),
    ];
    expect(stale).toEqual([]);
  });
});

describe("package.json#bin — the shipped operator bins (exact set, add-only)", () => {
  // Card: one-tap-shopper-create-via-a-single-wrapper-bin. The create-shopper bin
  // ships as a `package.json#bin` sibling of `sil-openclaw-allowlist` — NOT a plugin
  // tool (contracts.tools is unchanged; the six exact-tool-set/count mirrors are NOT
  // triggered). This guard is the EXACT-SET drift guard on the bin surface: it
  // set-equals the two operator bins, so a forgotten new bin OR a stray extra one
  // FAILS. It is add-only vs today's single-bin set — asserted with `toEqual`, never
  // loosened to a `toContain`/subset (which would silently stop catching drift).
  const pkg = readJson<PackageJson>("package.json");

  // The EXACT map the shipped package must declare. Add a bin ⇒ add it HERE too
  // (add-only); this is the contract, not a lower bound.
  const EXPECTED_BIN: Record<string, string> = {
    "sil-openclaw-allowlist": "./scripts/allowlist-openclaw.mjs",
    "sil-openclaw-create-shopper": "./scripts/create-shopper.mjs",
  };

  it("declares EXACTLY the two operator bins — never a subset, never a stray extra", () => {
    expect(pkg.bin).toEqual(EXPECTED_BIN);
  });

  it("every bin target is an existing scripts/*.mjs file on disk", () => {
    for (const target of Object.values(EXPECTED_BIN)) {
      expect(target).toMatch(/^\.\/scripts\/[a-z][a-z0-9-]*\.mjs$/);
      expect(existsSync(join(REPO_ROOT, target))).toBe(true);
    }
  });

  it("#files ships EXACTLY the two operator bins from scripts/, never the whole scripts/ dir (keeps maintainer-only tooling out of the tarball)", () => {
    // Shipping the coarse `scripts/` dir dragged maintainer-only tooling
    // (release.mjs, changelog.mjs, sync-version.mjs) onto every user's machine —
    // dead weight, extra attack surface, and the source of ClawHub's flagged
    // `dangerous_exec` in release.mjs. The tarball must carry ONLY the two runtime
    // bins. Derived from the bin map so the ship-list and the bin-list can't drift.
    const shipped = pkg.files ?? [];
    const runtimeEntries = Object.values(EXPECTED_BIN).map((t) => t.replace(/^\.\//, ""));
    for (const entry of runtimeEntries) expect(shipped).toContain(entry);
    // No coarse whole-dir entry, and no scripts/* leak beyond the two runtime bins.
    expect(shipped).not.toContain("scripts");
    expect(
      shipped.filter((f) => f.startsWith("scripts/") && !runtimeEntries.includes(f)),
    ).toEqual([]);
  });

  it("scripts/create-shopper.mjs is a node bin (starts with the `#!/usr/bin/env node` shebang, mirroring the sibling bin)", () => {
    const src = readText("scripts/create-shopper.mjs");
    expect(src.startsWith("#!/usr/bin/env node")).toBe(true);
  });
});
