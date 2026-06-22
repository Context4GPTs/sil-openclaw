/**
 * INTEGRATION — manifest ↔ code drift guard (tier: integration).
 *
 * THE load-bearing test. Architect Risk #3 marks it mandatory, not
 * optional: it is the guardrail that makes the 3-step "add a tool"
 * pattern self-enforcing. It crosses two artifacts — the real
 * `openclaw.plugin.json` file on disk and the TS registration code —
 * which is why it sits at the integration tier, not unit.
 *
 * Covers the card's criteria:
 *   - api.registerTool is called once for every name in
 *     `openclaw.plugin.json#contracts.tools`, and the set of registered
 *     names EQUALS the set of manifest names (no drift in EITHER
 *     direction);
 *   - the failure direction: if a dev registers a tool but omits the
 *     manifest entry (or declares a manifest entry with no registration),
 *     the set-equality assertion FAILS — demonstrated here against
 *     deliberately-perturbed sets so the guardrail's bite is itself
 *     tested, not just asserted.
 *
 * No mocks of the registration code — the real tool groups
 * (`registerIdentityTools`, `registerCatalogTools`) run for real against
 * the mock api. Only the host/network is absent (the mock api is a pure
 * in-memory capture), which is exactly the integration contract: real
 * components, real file, no live host.
 *
 * Contract this file pins for the implementation (expert-developer):
 *   - openclaw.plugin.json exists at the repo root with a
 *     `contracts.tools` string array;
 *   - the real tool groups register exactly the tools named there (and
 *     the manifest names exactly the tools they register) — the set on
 *     both sides equals { sil_product_get, sil_profile_get,
 *     sil_profile_list, sil_profile_materialize, sil_profile_remove,
 *     sil_register, sil_search, sil_whoami }.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIdentityTools } from "../tools/identity.js";
import { registerCatalogTools } from "../tools/catalog.js";
import { registerProfileTools } from "../tools/profile.js";
import {
  createMockPluginApi,
  registeredToolNames,
} from "./helpers/mock-plugin-api.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// src/__tests__ → repo root is two levels up.
const REPO_ROOT = join(HERE, "..", "..");
const MANIFEST_PATH = join(REPO_ROOT, "openclaw.plugin.json");

interface Manifest {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  version?: unknown;
  skills?: unknown;
  contracts?: { tools?: unknown };
  configSchema?: unknown;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

/** The set of tool names declared in openclaw.plugin.json#contracts.tools. */
function manifestToolNames(): Set<string> {
  const tools = readManifest().contracts?.tools;
  if (!Array.isArray(tools)) {
    throw new Error("openclaw.plugin.json#contracts.tools is not an array");
  }
  return new Set(tools as string[]);
}

/** The set of names the real register code emits against a mock api. Must call
 * EVERY tool group that src/index.ts#register() wires, or the drift guard goes
 * stale (a real tool would be registered + manifest-declared yet read as
 * "missing from code" here). Mirror register() exactly. */
function codeRegisteredNames(): Set<string> {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerProfileTools(api);
  return registeredToolNames(api);
}

function sorted(set: Set<string>): string[] {
  return [...set].sort();
}

describe("openclaw.plugin.json — manifest shape", () => {
  it("declares a non-empty contracts.tools array", () => {
    const names = manifestToolNames();
    expect(names.size).toBeGreaterThan(0);
  });

  it("has no duplicate tool names", () => {
    const raw = readManifest().contracts?.tools as string[];
    expect(raw.length).toBe(new Set(raw).size);
  });
});

describe("manifest ↔ code drift guard (set-equality, BOTH directions)", () => {
  it("registers a tool for every name in contracts.tools (manifest ⊆ code)", () => {
    const manifest = manifestToolNames();
    const code = codeRegisteredNames();
    const missingFromCode = [...manifest].filter((n) => !code.has(n));
    expect(missingFromCode).toEqual([]);
  });

  it("declares in the manifest every tool the code registers (code ⊆ manifest)", () => {
    const manifest = manifestToolNames();
    const code = codeRegisteredNames();
    const missingFromManifest = [...code].filter((n) => !manifest.has(n));
    expect(missingFromManifest).toEqual([]);
  });

  it("the two sets are exactly equal (no drift in either direction)", () => {
    expect(sorted(codeRegisteredNames())).toEqual(sorted(manifestToolNames()));
  });

  it("both sides equal exactly the real tool set — no example tool survives", () => {
    // The card's spine: after removing the skeleton examples, the manifest
    // AND the code both name exactly the four real tools. Pinned by literal
    // so a re-introduced sil_ping/sil_echo (on either side) flips this RED,
    // not just the symmetric drift check above.
    const expected = [
      "sil_product_get",
      "sil_profile_get",
      "sil_profile_list",
      "sil_profile_materialize",
      "sil_profile_remove",
      "sil_register",
      "sil_search",
      "sil_whoami",
    ];
    expect(sorted(codeRegisteredNames())).toEqual(expected);
    expect(sorted(manifestToolNames())).toEqual(expected);
  });

  it("neither side names a removed example tool (sil_ping / sil_echo)", () => {
    const code = codeRegisteredNames();
    const manifest = manifestToolNames();
    for (const removed of ["sil_ping", "sil_echo"]) {
      expect(code.has(removed)).toBe(false);
      expect(manifest.has(removed)).toBe(false);
    }
  });

  it("sil_search is BOTH registered by register() and declared in contracts.tools", () => {
    // The card's self-enforcing-registration criterion, pinned by name: the new
    // catalog tool must appear on BOTH sides of the equal set — registered by
    // registerCatalogTools (now wired into codeRegisteredNames) AND listed in
    // openclaw.plugin.json#contracts.tools.
    expect(codeRegisteredNames().has("sil_search")).toBe(true);
    expect(manifestToolNames().has("sil_search")).toBe(true);
  });

  it("sil_product_get is BOTH registered by register() and declared in contracts.tools", () => {
    // The sibling lookup tool's self-enforcing-registration criterion, pinned by
    // name. registerCatalogTools is ALREADY wired into codeRegisteredNames (search
    // added the call), so adding sil_product_get as a second tool in that group is
    // picked up automatically — it must appear on BOTH sides of the equal set:
    // registered by registerCatalogTools AND listed in
    // openclaw.plugin.json#contracts.tools.
    expect(codeRegisteredNames().has("sil_product_get")).toBe(true);
    expect(manifestToolNames().has("sil_product_get")).toBe(true);
  });

  it("sil_profile_materialize is BOTH registered by register() and declared in contracts.tools", () => {
    // The agent-creation engine's behaviour-artefact tool (card:
    // create-a-valid-sil-wired-openclaw-agent-profile). registerProfileTools is
    // wired into codeRegisteredNames (and into src/index.ts#register()), so the
    // new tool must appear on BOTH sides of the equal set: registered by
    // registerProfileTools AND listed in openclaw.plugin.json#contracts.tools.
    expect(codeRegisteredNames().has("sil_profile_materialize")).toBe(true);
    expect(manifestToolNames().has("sil_profile_materialize")).toBe(true);
  });

  it("sil_profile_list is BOTH registered by register() and declared in contracts.tools", () => {
    // The list-view-and-remove card's enumerate tool. Added to the existing
    // registerProfileTools group (already wired into register() + here), so it
    // must appear on BOTH sides of the equal set — registered AND declared.
    expect(codeRegisteredNames().has("sil_profile_list")).toBe(true);
    expect(manifestToolNames().has("sil_profile_list")).toBe(true);
  });

  it("sil_profile_get is BOTH registered by register() and declared in contracts.tools", () => {
    // The list-view-and-remove card's view tool. Same group, same self-enforcing
    // bar: a missing manifest entry (or a stale one) flips the set-equality RED.
    expect(codeRegisteredNames().has("sil_profile_get")).toBe(true);
    expect(manifestToolNames().has("sil_profile_get")).toBe(true);
  });

  it("sil_profile_remove is BOTH registered by register() and declared in contracts.tools", () => {
    // The list-view-and-remove card's destructive remove tool (artefact half).
    // Must appear on BOTH sides — registered by registerProfileTools AND listed
    // in openclaw.plugin.json#contracts.tools.
    expect(codeRegisteredNames().has("sil_profile_remove")).toBe(true);
    expect(manifestToolNames().has("sil_profile_remove")).toBe(true);
  });
});

describe("the drift guard actually bites (failure-direction proof)", () => {
  // The card's criterion: "Given a developer adds a registerTool but
  // omits the contracts.tools entry (or vice-versa), when the
  // set-equality test runs, then it FAILS." We prove the guardrail has
  // teeth by perturbing each side and asserting the equality check
  // would reject it. If these ever pass with equal sets, the guard is
  // toothless and the whole self-enforcing claim is hollow.

  it("FAILS when code registers a tool the manifest omits", () => {
    const manifest = manifestToolNames();
    const codePlusExtra = new Set(codeRegisteredNames());
    codePlusExtra.add("sil_tool_a_dev_forgot_to_declare");
    // Set-equality must reject the extra registered name.
    expect(sorted(codePlusExtra)).not.toEqual(sorted(manifest));
  });

  it("FAILS when the manifest declares a tool the code never registers", () => {
    const code = codeRegisteredNames();
    const manifestPlusGhost = new Set(manifestToolNames());
    manifestPlusGhost.add("sil_tool_declared_but_unwired");
    expect(sorted(manifestPlusGhost)).not.toEqual(sorted(code));
  });
});
