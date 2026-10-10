/**
 * INTEGRATION — what must hold of the sil-shopping skill bundle whatever it says:
 * discoverable, correctly named, naming exactly the registered tools, and short.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { registerIdentityTools } from "../tools/identity.js";
import { registerCatalogTools } from "../tools/catalog.js";
import { registerDoctorTools } from "../tools/doctor.js";
import { createMockPluginApi, registeredToolNames } from "./helpers/mock-plugin-api.js";
import {
  BUNDLE,
  REPO_ROOT,
  bundleCorpus,
  bundleEntries,
  frontmatter,
  skillSrc,
} from "./helpers/skill-bundle.js";

const MAX_CHARS = 9_000;
const MAX_LINES = 240;

const manifest = (): { skills?: unknown } =>
  JSON.parse(readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"));

// Every register group: a group left out silently narrows the guards below.
function registeredTools(): string[] {
  const api = createMockPluginApi();
  registerIdentityTools(api);
  registerCatalogTools(api);
  registerDoctorTools(api);
  return [...registeredToolNames(api)];
}

describe("sil-shopping skill bundle", () => {
  it("SKILL.md exists with parseable frontmatter and a non-empty body", () => {
    expect(existsSync(join(BUNDLE, "SKILL.md"))).toBe(true);
    expect(skillSrc().startsWith("---")).toBe(true);
    expect(frontmatter().body.trim().length).toBeGreaterThan(0);
  });

  it("frontmatter name is 'sil-shopping' (distinct from plugin id 'sil') with a description, and the manifest agrees", () => {
    const fm = frontmatter();
    expect(fm.name).toBe("sil-shopping");
    expect(fm.description.length).toBeGreaterThan(0);
    expect(basename((manifest().skills as string[])[0])).toBe(fm.name);
  });

  it("every registered tool is named in the bundle, and it names no tool that is not registered", () => {
    const registered = new Set(registeredTools());
    const corpus = bundleCorpus();
    expect([...registered].filter((n) => !corpus.includes(n))).toEqual([]);
    const named = new Set([...corpus.matchAll(/\b(?:sil|shopping)_[a-z_]+\b/g)].map((m) => m[0]));
    expect([...named].filter((n) => !registered.has(n)).sort()).toEqual([]);
  });

  it("the bundle is SKILL.md alone, every file markdown", () => {
    expect(bundleEntries()).toEqual(["SKILL.md"]);
  });

  it(`SKILL.md stays within ${MAX_CHARS} characters and ${MAX_LINES} lines`, () => {
    expect(skillSrc().length).toBeLessThanOrEqual(MAX_CHARS);
    expect(skillSrc().split("\n").length).toBeLessThanOrEqual(MAX_LINES);
  });
});
