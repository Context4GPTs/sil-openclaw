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
 *     both sides equals the TWELVE v0 tools (AC G1): the five catalog tools
 *     1:1 with the sil-services catalog routes, the four `sil_doc_*` document
 *     tools, the two identity tools and the doctor. 13 → 12: the eight-beat
 *     card REPLACES `registerProfileTools`' five verbs with
 *     `registerDocTools`' four, which is a GROUP SWAP — CLAUDE.md step 4 —
 *     so `codeRegisteredNames()` below had to be rewired or it would have
 *     silently narrowed instead of going red.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIdentityTools } from "../tools/identity.js";
import { registerCatalogTools } from "../tools/catalog.js";
import { registerDocTools } from "../tools/doc.js";
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
  registerDocTools(api);
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

  it("AC G1 — both sides equal exactly the TWELVE v0 tools, and the four sil_doc_* are among them", () => {
    // The card's spine, pinned by literal so a re-introduction on EITHER side flips
    // RED rather than merely staying symmetric. 13 → 12: the eight-beat card swaps
    // `registerProfileTools`' five verbs for `registerDocTools`' four. A GROUP swap,
    // so the code side is NOT picked up for free — `codeRegisteredNames()` had to be
    // rewired, and had it not been, this guard would have silently narrowed.
    const expected = [
      "sil_doc_find",
      "sil_doc_read",
      "sil_doc_remove",
      "sil_doc_write",
      "sil_doctor",
      "sil_domain_create",
      "sil_domain_find",
      "sil_product_get",
      "sil_register",
      "sil_search",
      "sil_stores",
      "sil_whoami",
    ];
    expect(sorted(codeRegisteredNames())).toEqual(expected);
    expect(sorted(manifestToolNames())).toEqual(expected);
  });

  it("AC G1 — no RETIRED tool name is registered or declared, on either side", () => {
    // ONE table replacing four near-identical per-name bars (sil_ping/sil_echo,
    // sil_profile_list, sil_remember, sil_specs): the failure mode is the same for
    // every entry — a compat alias, a deprecation stub, or a "tool that explains it
    // is gone" — and a table is where the next retirement lands with no new test.
    //
    // The exact-set bar above ALREADY catches every one of these. This is the bar
    // that says WHY they are absent, so a future reader does not "restore" one.
    const RETIRED = [
      "sil_ping",
      "sil_echo", // the skeleton examples
      "sil_profile_list", // folded into sil_profile_get, which is itself now gone
      "sil_remember", // renamed to sil_learn, which is itself now gone
      "sil_specs", // POST /catalog/specs was deleted server-side
      "sil_learn", // ↓ the five verbs this card retires: no shim, no side-by-side
      "sil_profile_materialize",
      "sil_profile_search",
      "sil_profile_get",
      "sil_profile_remove",
    ];
    const code = codeRegisteredNames();
    const manifest = manifestToolNames();
    expect(RETIRED.filter((n) => code.has(n))).toEqual([]);
    expect(RETIRED.filter((n) => manifest.has(n))).toEqual([]);
  });

  it("sil_doctor is BOTH registered by register() and declared in contracts.tools", () => {
    // The doctor's self-enforcing-registration criterion, pinned by name. Unlike
    // a tool joining an existing group, sil_doctor arrives in a NEW group — so it
    // reaches this guard only once registerDoctorTools is wired into register()
    // in src/index.ts AND into codeRegisteredNames above.
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

  it("sil_domain_find is BOTH registered by register() and declared in contracts.tools", () => {
    // The read-before-mint card's fifth catalog tool — `GET /catalog/domains`,
    // the verb twin of the mint's POST. It joins the EXISTING
    // `registerCatalogTools` group, which `codeRegisteredNames()` already calls,
    // so the code side is picked up dynamically; step 3 (the manifest entry) is
    // the half that is not, and forgetting it flips the set-equality RED here
    // before merge. That asymmetry is the whole point of this guard.
    expect(codeRegisteredNames().has("sil_domain_find")).toBe(true);
    expect(manifestToolNames().has("sil_domain_find")).toBe(true);
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

  // The same proof aimed at THE tool this card adds, in both directions. These
  // are non-vacuous by construction: if `sil_domain_find` were missing from both
  // sides, each `delete` would be a no-op, the two sets would still be equal, and
  // the `not.toEqual` below would FAIL. So they cannot pass by the tool's absence.
  it("FAILS if `sil_domain_find` is dropped from the manifest side", () => {
    const manifestMinus = new Set(manifestToolNames());
    manifestMinus.delete("sil_domain_find");
    expect(sorted(manifestMinus)).not.toEqual(sorted(codeRegisteredNames()));
  });

  it("FAILS if `sil_domain_find` is dropped from the code side", () => {
    const codeMinus = new Set(codeRegisteredNames());
    codeMinus.delete("sil_domain_find");
    expect(sorted(codeMinus)).not.toEqual(sorted(manifestToolNames()));
  });
});
