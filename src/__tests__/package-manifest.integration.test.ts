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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, rel), "utf8")) as T;
}

interface PackageJson {
  type?: string;
  main?: string;
  files?: string[];
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

  it("ships the skill dir and the manifest via `files`", () => {
    // If `skill` or the manifest is missing from `files`, the packed
    // artifact won't carry the playbook/manifest and the host can't
    // discover the skill — the architect's skill-not-discoverable risk.
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain("skill");
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

  it("declares a non-empty skills array pointing at ./skill", () => {
    expect(Array.isArray(manifest.skills)).toBe(true);
    expect(manifest.skills!.length).toBeGreaterThan(0);
    expect(manifest.skills).toContain("./skill");
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
