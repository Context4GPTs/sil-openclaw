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
 *     both sides equals { sil_learn, sil_product_get, sil_profile_get,
 *     sil_profile_materialize, sil_profile_remove, sil_profile_search,
 *     sil_register, sil_search, sil_specs, sil_whoami } (the 10-tool floor
 *     after the sds-specs-client-tool card ADDED the sil_specs catalog tool —
 *     the coin/dedupe/register canonicalization primitive — to the 9-tool set
 *     the spec-driven-shopping-redesign card left behind).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIdentityTools } from "../tools/identity.js";
import { registerCatalogTools } from "../tools/catalog.js";
import { registerProfileTools } from "../tools/profile.js";
import { registerDoctorTools } from "../tools/doctor.js";
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
  registerDoctorTools(api);
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
    // AND the code both name exactly the real tools. Pinned by literal
    // so a re-introduced sil_ping/sil_echo (on either side) flips this RED,
    // not just the symmetric drift check above. Now 11 tools — the
    // sil-doctor-tool-data-store-identity-health card ADDS sil_doctor (the
    // report-first data-store/identity/version health tool) in a NEW group
    // (registerDoctorTools, wired above): 10 → 11, add-only.
    const expected = [
      "sil_doctor",
      "sil_learn",
      "sil_product_get",
      "sil_profile_get",
      "sil_profile_materialize",
      "sil_profile_remove",
      "sil_profile_search",
      "sil_register",
      "sil_search",
      "sil_specs",
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

  it("sil_doctor is BOTH registered by register() and declared in contracts.tools", () => {
    // The doctor's self-enforcing-registration criterion, pinned by name. Unlike
    // sil_specs (which joined the existing catalog group), sil_doctor arrives in
    // a NEW group — so it reaches this guard only once registerDoctorTools is
    // wired into register() in src/index.ts AND into codeRegisteredNames above.
    // Both sides must name it: registered by registerDoctorTools AND listed in
    // openclaw.plugin.json#contracts.tools.
    expect(codeRegisteredNames().has("sil_doctor")).toBe(true);
    expect(manifestToolNames().has("sil_doctor")).toBe(true);
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

  it("sil_profile_list is NOT registered and NOT declared (folded into sil_profile_get)", () => {
    // The consolidate-profile-tools-to-the-singleton-surface card DELETES
    // sil_profile_list, folding its read into sil_profile_get's no-args zoom. It
    // must be absent on BOTH sides of the equal set — a re-introduction (in code or
    // manifest) flips the set-equality RED, just as an addition would.
    expect(codeRegisteredNames().has("sil_profile_list")).toBe(false);
    expect(manifestToolNames().has("sil_profile_list")).toBe(false);
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

  it("sil_remember is NOT registered and NOT declared (DELETED, renamed to sil_learn — not aliased)", () => {
    // The spec-driven-shopping-redesign card DELETES sil_remember and replaces it
    // with the target+change feedback verb sil_learn. No backwards compat, no
    // alias: sil_remember must be absent on BOTH sides of the equal set. A
    // re-introduction (in code or manifest) — including a compat alias kept alive
    // beside sil_learn — flips the set-equality RED, exactly as the sil_profile_list
    // removal is guarded above.
    expect(codeRegisteredNames().has("sil_remember")).toBe(false);
    expect(manifestToolNames().has("sil_remember")).toBe(false);
  });

  it("sil_learn is BOTH registered by register() and declared in contracts.tools", () => {
    // The spec-driven-shopping-redesign card's target+change feedback verb — the
    // single write tool for the whole method/PRD lifecycle (create + write +
    // attach-asset), replacing sil_remember. Added to the existing
    // registerProfileTools group (no new group, no src/index.ts change), so it is
    // auto-picked-up by codeRegisteredNames. The load-bearing 3rd "add a tool"
    // step: it MUST also be listed in openclaw.plugin.json#contracts.tools — a
    // forgotten manifest entry flips the set-equality RED here, before merge.
    expect(codeRegisteredNames().has("sil_learn")).toBe(true);
    expect(manifestToolNames().has("sil_learn")).toBe(true);
  });

  it("sil_profile_search is BOTH registered by register() and declared in contracts.tools", () => {
    // The spec-driven-shopping-redesign card's NEW frontmatter-as-truth query tool
    // — the local discovery / reuse-before-mint primitive that returns artefact
    // coordinates (no bodies) and replaces the deleted profile.json manifest's
    // index role. Added to registerProfileTools; it must appear on BOTH sides of
    // the equal set: registered by the group AND listed in contracts.tools.
    expect(codeRegisteredNames().has("sil_profile_search")).toBe(true);
    expect(manifestToolNames().has("sil_profile_search")).toBe(true);
  });

  it("sil_specs is BOTH registered by register() and declared in contracts.tools", () => {
    // The sds-specs-client-tool card's NEW catalog tool — the coin/dedupe/register
    // canonicalization primitive (Beat-2 born-canonical-before-persist). Added to the
    // existing registerCatalogTools group beside sil_search / sil_product_get (no new
    // group, no src/index.ts change), so it is auto-picked-up by codeRegisteredNames.
    // The load-bearing 3rd "add a tool" step: it MUST also be listed in
    // openclaw.plugin.json#contracts.tools — a forgotten manifest entry flips the
    // set-equality RED here, before merge.
    expect(codeRegisteredNames().has("sil_specs")).toBe(true);
    expect(manifestToolNames().has("sil_specs")).toBe(true);
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
