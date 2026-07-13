/**
 * UNIT — the spec-driven-shopping-redesign Phase-1 tool surface, driven end-to-end
 * at the registered-tool boundary (tier: unit, mock api + temp $SIL_DATA_DIR, no
 * network, no host).
 *
 * Card: spec-driven-shopping-redesign — Phase 1 (store recast + tools + loop).
 * THESE ASSERTIONS ARE THE SPEC (RED-first). The store is recast to
 * frontmatter-as-truth with NO `profile.json` manifest; the artefact tree is
 * `domains/<slug>/{method.md, prds/<product>-<intent>.md, assets/}`; discovery is a
 * filesystem SCAN over frontmatter; writes are atomic + owner-only. The tool
 * surface is FIVE profile verbs:
 *
 *   - `sil_profile_materialize { name, userSpec }` — SETUP-ONLY: write `user_spec.md`
 *     (its FRONTMATTER carries the shopper `name`). It does NOT mint methods/PRDs and
 *     does NOT write a manifest.
 *   - `sil_learn { target, domain?, prd?, kind, … }` — the single target+change verb
 *     owning the whole method/PRD lifecycle: `create` mints a whole method/PRD;
 *     `append`/`amend`/`retract` refine in place; `attach-asset` persists image bytes.
 *     REPLACES the deleted `sil_remember` (delete, not alias).
 *   - `sil_profile_search { domain?, product?, intent?, query? }` — NEW: query artefact
 *     FRONTMATTER (coordinates only, no bodies) — the discovery / reuse-before-mint
 *     primitive that replaces the manifest's index role. Malformed frontmatter is
 *     SKIPPED + surfaced as `unreadable`, never half-read, never silently dropped.
 *   - `sil_profile_get { domainSlug, prd? }` — the RICH read: `domainSlug` → the method
 *     body, `+prd` → that PRD body. Missing → `not_found`.
 *   - `sil_profile_remove { domainSlug, prd? }` — `domainSlug` alone removes the whole
 *     domain subtree; `+prd` removes just that PRD file (method + siblings survive).
 *
 * The old `sil_remember`, the `profile.json` manifest, and the
 * domain_spec/intent_spec/playbook triple are DELETED, not migrated — asserted here
 * by their absence. No stubbed-tool assertions: the profile tools are LOCAL (no
 * bearer, no network), so nothing is mocked but the registration-capture api.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerProfileTools } from "../../tools/profile.js";
import {
  createMockPluginApi,
  getTool,
  registeredToolNames,
  type MockPluginAPI,
} from "../helpers/mock-plugin-api.js";

const MATERIALIZE = "sil_profile_materialize";
const LEARN = "sil_learn";
const SEARCH = "sil_profile_search";
const GET = "sil_profile_get";
const REMOVE = "sil_profile_remove";

let dataDir: string;
let priorSilDataDir: string | undefined;
let api: MockPluginAPI;

function payloadOf(result: { content: { text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`tool result has no text payload: ${String(text)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** The singleton shopper root under the temp data dir. The layout is pinned by the
 * design doc (frontmatter-as-truth), so computing these paths IS a spec assertion. */
function shopperDir(): string {
  return join(dataDir, "shopper");
}
function domainDir(slug: string): string {
  return join(shopperDir(), "domains", slug);
}
function modeBits(path: string): number {
  // eslint-disable-next-line no-bitwise
  return statSync(path).mode & 0o777;
}
/** Recursively list every path (relative to the shopper root). */
function walkShopper(): string[] {
  if (!existsSync(shopperDir())) return [];
  return readdirSync(shopperDir(), { recursive: true }) as string[];
}

const USER_SPEC = "# The person\n- Ships to Berlin.\n- HARD-NO: leather.";

/** Mint the shopper root (setup) then a `ski` method, so refine/read/remove tests
 * start from a populated store. Returns the method file path. */
async function seedSkiMethod(): Promise<string> {
  await getTool(api, MATERIALIZE).execute("m", { name: "sil shopper", userSpec: USER_SPEC });
  const p = payloadOf(
    await getTool(api, LEARN).execute("l", {
      target: "method",
      domain: "ski",
      kind: "create",
      name: "Ski",
      body: "# Buying guide — ski\n\n## Taste & stance\n- Prefer last-year models.\n",
    }),
  );
  expect(p["status"]).toBe("ok");
  return join(domainDir("ski"), "method.md");
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-sds-redesign-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
  api = createMockPluginApi();
  registerProfileTools(api);
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

/* ===========================================================================
 * MIRROR #5 — the profile group's EXACT set (5 verbs). Add-only; kept `.toEqual`
 * so a re-introduced sil_remember (or any extra tool) flips this RED.
 * ========================================================================= */
describe("the profile surface is EXACTLY five verbs — sil_remember is DELETED, sil_learn + sil_profile_search added", () => {
  it("registerProfileTools registers exactly { sil_learn, sil_profile_get, sil_profile_materialize, sil_profile_remove, sil_profile_search }", () => {
    expect([...registeredToolNames(api)].sort()).toEqual(
      [
        "sil_learn",
        "sil_profile_get",
        "sil_profile_materialize",
        "sil_profile_remove",
        "sil_profile_search",
      ].sort(),
    );
  });

  it("sil_remember is GONE (deleted, not aliased) — the group no longer registers it", () => {
    expect(registeredToolNames(api).has("sil_remember")).toBe(false);
    expect(() => getTool(api, "sil_remember")).toThrow();
  });
});

/* ===========================================================================
 * sil_profile_materialize — SETUP-ONLY. Writes user_spec.md (frontmatter name);
 * NO profile.json; NO domains mint.
 * ========================================================================= */
describe("sil_profile_materialize — setup-only, frontmatter-as-truth", () => {
  it("writes user_spec.md whose FRONTMATTER carries the shopper name + the userSpec body", async () => {
    const payload = payloadOf(
      await getTool(api, MATERIALIZE).execute("c1", { name: "sil shopper", userSpec: USER_SPEC }),
    );
    expect(payload["status"]).toBe("ok");
    const userSpecPath = join(shopperDir(), "user_spec.md");
    expect(existsSync(userSpecPath)).toBe(true);
    const raw = readFileSync(userSpecPath, "utf8");
    // Frontmatter-as-truth: the name lives in the file's OWN frontmatter, not a manifest.
    expect(raw.startsWith("---")).toBe(true);
    expect(raw).toMatch(/name:\s*sil shopper/);
    expect(raw).toContain("Ships to Berlin");
  });

  it("writes NO profile.json manifest anywhere under the shopper root (frontmatter is the source of truth)", async () => {
    await getTool(api, MATERIALIZE).execute("c2", { name: "sil shopper", userSpec: USER_SPEC });
    expect(walkShopper().some((p) => p.endsWith("profile.json"))).toBe(false);
  });

  it("is SETUP-ONLY — passing a legacy `domain` pack mints NO domain (that is sil_learn create)", async () => {
    await getTool(api, MATERIALIZE).execute("c3", {
      name: "sil shopper",
      userSpec: USER_SPEC,
      // A caller replaying the deleted domain-mint shape must NOT resurrect it here.
      domain: { slug: "ski", name: "Ski", domainSpec: "x", intentSpec: "y", playbook: "z" },
    });
    expect(existsSync(join(shopperDir(), "domains"))).toBe(false);
  });

  it("materializes with owner-only perms (dir 0700, user_spec.md 0600)", async () => {
    await getTool(api, MATERIALIZE).execute("c4", { name: "sil shopper", userSpec: USER_SPEC });
    expect(modeBits(shopperDir())).toBe(0o700);
    expect(modeBits(join(shopperDir(), "user_spec.md"))).toBe(0o600);
  });
});

/* ===========================================================================
 * sil_learn create — mint a whole method / PRD atomically. The file IS the
 * registration (no manifest).
 * ========================================================================= */
describe("sil_learn create — mints method + PRD into the frontmatter-as-truth tree", () => {
  it("create method writes domains/<slug>/method.md with typed frontmatter + body, atomic + owner-only", async () => {
    const methodPath = await seedSkiMethod();
    expect(existsSync(methodPath)).toBe(true);
    const raw = readFileSync(methodPath, "utf8");
    expect(raw.startsWith("---")).toBe(true);
    // Method frontmatter coordinates: { domain, name, updated_at }.
    expect(raw).toMatch(/domain:\s*ski/);
    expect(raw).toMatch(/name:\s*Ski/);
    expect(raw).toMatch(/updated_at:/);
    expect(raw).toContain("Buying guide — ski");
    // Owner-only, and the domain leaf dir is 0700.
    expect(modeBits(methodPath)).toBe(0o600);
    expect(modeBits(domainDir("ski"))).toBe(0o700);
  });

  it("create PRD writes domains/<slug>/prds/<product>-<intent>.md with the {key,product,intent,title,domain} coordinates", async () => {
    await getTool(api, MATERIALIZE).execute("p0", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("p1", {
      target: "method",
      domain: "ski",
      kind: "create",
      name: "Ski",
      body: "# guide",
    });
    const payload = payloadOf(
      await getTool(api, LEARN).execute("p2", {
        target: "prd",
        domain: "ski",
        prd: "gloves-slope",
        product: "gloves",
        intent: "slope",
        title: "Ski gloves for the slope",
        kind: "create",
        body: "## Requirements\n- waterproofing (hard)\n",
      }),
    );
    expect(payload["status"]).toBe("ok");
    const prdPath = join(domainDir("ski"), "prds", "gloves-slope.md");
    expect(existsSync(prdPath)).toBe(true);
    const raw = readFileSync(prdPath, "utf8");
    expect(raw.startsWith("---")).toBe(true);
    expect(raw).toMatch(/key:\s*gloves-slope/);
    expect(raw).toMatch(/product:\s*gloves/);
    expect(raw).toMatch(/intent:\s*slope/);
    expect(raw).toMatch(/domain:\s*ski/);
    expect(raw).toContain("waterproofing");
  });

  it("create is NOT valid for user_spec (that is materialize) → invalid_request", async () => {
    await getTool(api, MATERIALIZE).execute("u0", { name: "sil shopper", userSpec: USER_SPEC });
    const payload = payloadOf(
      await getTool(api, LEARN).execute("u1", {
        target: "user_spec",
        kind: "create",
        body: "whole new person",
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
  });

  it("rejects a traversal / reserved domain slug BEFORE any write (invalid_request, nothing minted)", async () => {
    await getTool(api, MATERIALIZE).execute("t0", { name: "sil shopper", userSpec: USER_SPEC });
    for (const slug of ["../escape", "main", "Has Space"]) {
      const payload = payloadOf(
        await getTool(api, LEARN).execute("t1", {
          target: "method",
          domain: slug,
          kind: "create",
          name: "x",
          body: "y",
        }),
      );
      expect(payload["status"]).toBe("invalid_request");
    }
    expect(existsSync(join(shopperDir(), "domains"))).toBe(false);
  });

  it("a method change bumps the file's own frontmatter (no manifest) — updated_at present, frontmatter intact after append", async () => {
    const methodPath = await seedSkiMethod();
    const before = readFileSync(methodPath, "utf8");
    expect(before).toMatch(/updated_at:/);
    await getTool(api, LEARN).execute("b1", {
      target: "method",
      domain: "ski",
      kind: "append",
      section: "Taste & stance",
      text: "Budget under 200.",
    });
    const after = readFileSync(methodPath, "utf8");
    expect(after.startsWith("---")).toBe(true);
    expect(after).toMatch(/updated_at:/);
    expect(after).toContain("Budget under 200.");
  });
});

/* ===========================================================================
 * sil_learn append / amend / retract — section-aware, single-match, fail-closed.
 * ========================================================================= */
describe("sil_learn append / amend / retract — refine in place, fail-closed", () => {
  it("append under a NAMED section adds a bullet; a missing section fails closed (invalid_request), never at EOF-by-accident", async () => {
    await seedSkiMethod();
    const ok = payloadOf(
      await getTool(api, LEARN).execute("a1", {
        target: "method",
        domain: "ski",
        kind: "append",
        section: "Taste & stance",
        text: "Shimano over SRAM.",
      }),
    );
    expect(ok["status"]).toBe("ok");
    expect(readFileSync(join(domainDir("ski"), "method.md"), "utf8")).toContain("Shimano over SRAM.");

    const bad = payloadOf(
      await getTool(api, LEARN).execute("a2", {
        target: "method",
        domain: "ski",
        kind: "append",
        section: "No Such Heading",
        text: "orphan",
      }),
    );
    expect(bad["status"]).toBe("invalid_request");
  });

  it("append/amend/retract require the target to already exist → not_found (never resurrects a seed-less doc)", async () => {
    await getTool(api, MATERIALIZE).execute("n0", { name: "sil shopper", userSpec: USER_SPEC });
    for (const kind of ["append", "amend", "retract"] as const) {
      const payload = payloadOf(
        await getTool(api, LEARN).execute("n1", {
          target: "method",
          domain: "never-minted",
          kind,
          text: "x",
          from: "x",
          to: "y",
        }),
      );
      expect(payload["status"]).toBe("not_found");
    }
  });

  it("amend replaces a single-occurrence match; an ambiguous (2+) match is invalid_request, not a silent multi-write", async () => {
    const methodPath = await seedSkiMethod();
    // Two identical bullets → an amend `from` that matches both must refuse.
    await getTool(api, LEARN).execute("am0", {
      target: "method", domain: "ski", kind: "append", section: "Taste & stance", text: "dup line",
    });
    await getTool(api, LEARN).execute("am1", {
      target: "method", domain: "ski", kind: "append", section: "Taste & stance", text: "dup line",
    });
    const ambiguous = payloadOf(
      await getTool(api, LEARN).execute("am2", {
        target: "method", domain: "ski", kind: "amend", from: "dup line", to: "changed",
      }),
    );
    expect(ambiguous["status"]).toBe("invalid_request");
    // The doc pins the ambiguous-match discriminant.
    expect(JSON.stringify(ambiguous)).toContain("ambiguous");

    // A unique match amends cleanly.
    const unique = payloadOf(
      await getTool(api, LEARN).execute("am3", {
        target: "method", domain: "ski", kind: "amend", from: "Prefer last-year models.", to: "Prefer current-year models.",
      }),
    );
    expect(unique["status"]).toBe("ok");
    const raw = readFileSync(methodPath, "utf8");
    expect(raw).toContain("Prefer current-year models.");
    expect(raw).not.toContain("Prefer last-year models.");
  });

  it("`hard` is valid only on append to user_spec / prd — rejected on a method target (category error)", async () => {
    await seedSkiMethod();
    const payload = payloadOf(
      await getTool(api, LEARN).execute("h1", {
        target: "method",
        domain: "ski",
        kind: "append",
        section: "Taste & stance",
        text: "never leather",
        hard: true,
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
  });

  it("`hard` append to user_spec writes the [hard] marker the reject-at-pick rule greps", async () => {
    await getTool(api, MATERIALIZE).execute("h2", { name: "sil shopper", userSpec: USER_SPEC });
    const payload = payloadOf(
      await getTool(api, LEARN).execute("h3", {
        target: "user_spec",
        kind: "append",
        text: "allergic to wool",
        hard: true,
      }),
    );
    expect(payload["status"]).toBe("ok");
    expect(readFileSync(join(shopperDir(), "user_spec.md"), "utf8")).toContain("[hard]");
  });
});

/* ===========================================================================
 * GAP 1 — `hard:true` is REJECTED loudly on EVERY non-append kind (create /
 * amend / retract / attach-asset), never silently dropped. One top-level guard
 * in `learnArtefact` (subsuming the deleted method-only `rejectHardMisuse`) fires
 * BEFORE the kind switch, so `hard` wins error-precedence over per-kind field
 * checks and a hard-constraint promotion is never a silent no-op.
 * ========================================================================= */
describe("sil_learn — hard:true is rejected on EVERY non-append kind (the silent drop is closed)", () => {
  // A 1x1 transparent PNG (for the attach-asset kind).
  const PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("amend + hard:true → invalid_request (field `hard`) and the PRD bullet stays SOFT — not a silent promotion", async () => {
    await getTool(api, MATERIALIZE).execute("g1m", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("g1a", {
      target: "method", domain: "ski", kind: "create", name: "Ski", body: "#g",
    });
    await getTool(api, LEARN).execute("g1b", {
      target: "prd", domain: "ski", prd: "gloves-slope", product: "gloves", intent: "slope", title: "G", kind: "create",
      body: "## Requirements\n- gore-tex preferred\n",
    });
    const payload = payloadOf(
      await getTool(api, LEARN).execute("g1c", {
        target: "prd", domain: "ski", prd: "gloves-slope", kind: "amend",
        from: "gore-tex preferred", to: "gore-tex required", hard: true,
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("hard");
    // Nothing written: the amend did NOT land and the soft pref was NOT promoted to hard.
    const raw = readFileSync(join(domainDir("ski"), "prds", "gloves-slope.md"), "utf8");
    expect(raw).toContain("gore-tex preferred");
    expect(raw).not.toContain("gore-tex required");
    expect(raw).not.toContain("[hard]");
  });

  it("create + hard:true → invalid_request (field `hard`) and NOTHING is minted", async () => {
    await getTool(api, MATERIALIZE).execute("g1d", { name: "sil shopper", userSpec: USER_SPEC });
    const payload = payloadOf(
      await getTool(api, LEARN).execute("g1e", {
        target: "method", domain: "ski", kind: "create", name: "Ski", body: "# guide", hard: true,
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("hard");
    expect(existsSync(join(domainDir("ski"), "method.md"))).toBe(false);
  });

  it("retract + hard:true → invalid_request (field `hard`) and the bullet is NOT removed", async () => {
    const methodPath = await seedSkiMethod();
    const payload = payloadOf(
      await getTool(api, LEARN).execute("g1f", {
        target: "method", domain: "ski", kind: "retract", from: "Prefer last-year models.", hard: true,
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("hard");
    expect(readFileSync(methodPath, "utf8")).toContain("Prefer last-year models.");
  });

  it("attach-asset + hard:true → invalid_request (field `hard`) BEFORE any bytes/link write (hard wins error-precedence)", async () => {
    await seedSkiMethod();
    const payload = payloadOf(
      await getTool(api, LEARN).execute("g1g", {
        target: "method", domain: "ski", kind: "attach-asset", bytes: PNG_B64, mime: "image/png", hard: true,
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("hard");
    expect(existsSync(join(domainDir("ski"), "assets"))).toBe(false);
    expect(readFileSync(join(domainDir("ski"), "method.md"), "utf8")).not.toContain("assets/");
  });

  it("append + hard:true is STILL honored on prd (the guard keys on kind+target, never over-narrow to user_spec only)", async () => {
    await getTool(api, MATERIALIZE).execute("g1h", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("g1i", {
      target: "method", domain: "ski", kind: "create", name: "Ski", body: "#g",
    });
    await getTool(api, LEARN).execute("g1j", {
      target: "prd", domain: "ski", prd: "gloves-slope", product: "gloves", intent: "slope", title: "G", kind: "create",
      body: "## Requirements\n- baseline\n",
    });
    const payload = payloadOf(
      await getTool(api, LEARN).execute("g1k", {
        target: "prd", domain: "ski", prd: "gloves-slope", kind: "append", text: "waterproof to IPX7", hard: true,
      }),
    );
    expect(payload["status"]).toBe("ok");
    expect(readFileSync(join(domainDir("ski"), "prds", "gloves-slope.md"), "utf8")).toContain("[hard]");
  });
});

/* ===========================================================================
 * sil_learn attach-asset — bytes in, path-reference out; per-domain only.
 * ========================================================================= */
describe("sil_learn attach-asset — persists image bytes into domains/<slug>/assets and links by path", () => {
  // A 1x1 transparent PNG.
  const PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("writes the bytes under assets/ (owner-only), returns assetPath, and links it from the method by RELATIVE path (never inline bytes)", async () => {
    await seedSkiMethod();
    const payload = payloadOf(
      await getTool(api, LEARN).execute("as1", {
        target: "method",
        domain: "ski",
        kind: "attach-asset",
        bytes: PNG_B64,
        mime: "image/png",
        caption: "boot last",
      }),
    );
    expect(payload["status"]).toBe("ok");
    const assetPath = payload["assetPath"];
    expect(typeof assetPath).toBe("string");

    const assetsDir = join(domainDir("ski"), "assets");
    expect(existsSync(assetsDir)).toBe(true);
    const files = readdirSync(assetsDir);
    expect(files.length).toBe(1);
    expect(modeBits(join(assetsDir, files[0]!))).toBe(0o600);

    // The method links the asset by a RELATIVE path, and never inlines the base64 bytes.
    const methodRaw = readFileSync(join(domainDir("ski"), "method.md"), "utf8");
    expect(methodRaw).toContain("assets/");
    expect(methodRaw).not.toContain(PNG_B64);
  });

  it("attach-asset to user_spec is rejected — assets are per-domain (invalid_request)", async () => {
    await getTool(api, MATERIALIZE).execute("as2", { name: "sil shopper", userSpec: USER_SPEC });
    const payload = payloadOf(
      await getTool(api, LEARN).execute("as3", {
        target: "user_spec",
        kind: "attach-asset",
        bytes: PNG_B64,
        mime: "image/png",
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
  });

  // GAP 4 — the markdown link append is idempotent: bytes dedup by content hash,
  // and re-attaching the SAME asset path to the SAME target never accretes a second
  // `![…](assets/…)` line. Idempotence keys on the asset PATH, not the caption.
  it("re-attaching the SAME bytes to the SAME target adds NO second link line (second call ok + same assetPath)", async () => {
    await seedSkiMethod();
    const first = payloadOf(
      await getTool(api, LEARN).execute("idem1", {
        target: "method", domain: "ski", kind: "attach-asset", bytes: PNG_B64, mime: "image/png", caption: "boot last",
      }),
    );
    expect(first["status"]).toBe("ok");
    const second = payloadOf(
      await getTool(api, LEARN).execute("idem2", {
        target: "method", domain: "ski", kind: "attach-asset", bytes: PNG_B64, mime: "image/png", caption: "boot last",
      }),
    );
    expect(second["status"]).toBe("ok");
    expect(second["assetPath"]).toBe(first["assetPath"]);

    const methodRaw = readFileSync(join(domainDir("ski"), "method.md"), "utf8");
    const linkCount = (methodRaw.match(/\]\(assets\//g) ?? []).length;
    expect(linkCount).toBe(1);
    // The bytes were content-hash dedup'd to a single asset file all along.
    expect(readdirSync(join(domainDir("ski"), "assets")).length).toBe(1);
  });

  it("re-attaching the same bytes with a DIFFERENT caption is still a body no-op — idempotence keys on the asset PATH, not the caption", async () => {
    await seedSkiMethod();
    await getTool(api, LEARN).execute("cap1", {
      target: "method", domain: "ski", kind: "attach-asset", bytes: PNG_B64, mime: "image/png", caption: "first caption alpha",
    });
    const second = payloadOf(
      await getTool(api, LEARN).execute("cap2", {
        target: "method", domain: "ski", kind: "attach-asset", bytes: PNG_B64, mime: "image/png", caption: "second caption bravo",
      }),
    );
    expect(second["status"]).toBe("ok");

    const methodRaw = readFileSync(join(domainDir("ski"), "method.md"), "utf8");
    const linkCount = (methodRaw.match(/\]\(assets\//g) ?? []).length;
    expect(linkCount).toBe(1);
    // The first link stays; the second caption is NOT accreted onto the body.
    expect(methodRaw).toContain("first caption alpha");
    expect(methodRaw).not.toContain("second caption bravo");
  });
});

/* ===========================================================================
 * sil_profile_search — frontmatter coordinates only (no bodies); malformed
 * frontmatter is skipped + surfaced as unreadable, never a silent drop.
 * ========================================================================= */
describe("sil_profile_search — the frontmatter-as-truth discovery primitive (coordinates, no bodies)", () => {
  it("an empty store is ok + empty-is-healthy (no domains, no prds) — never not_found", async () => {
    const payload = payloadOf(await getTool(api, SEARCH).execute("s0", {}));
    expect(payload["status"]).toBe("ok");
    expect(payload["domains"]).toEqual([]);
    expect(payload["prds"]).toEqual([]);
  });

  it("returns domain + PRD COORDINATES (no bodies) after a mint — the scan reads frontmatter, not documents", async () => {
    await getTool(api, MATERIALIZE).execute("s1", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("s2", {
      target: "method", domain: "ski", kind: "create", name: "Ski", body: "# guide (a BODY that must NOT leak)",
    });
    await getTool(api, LEARN).execute("s3", {
      target: "prd", domain: "ski", prd: "gloves-slope", product: "gloves", intent: "slope",
      title: "Ski gloves for the slope", kind: "create", body: "## Requirements (a BODY that must NOT leak)",
    });

    const payload = payloadOf(await getTool(api, SEARCH).execute("s4", {}));
    expect(payload["status"]).toBe("ok");
    const domains = payload["domains"] as Array<Record<string, unknown>>;
    expect(domains.map((d) => d["slug"])).toEqual(["ski"]);

    const prds = payload["prds"] as Array<Record<string, unknown>>;
    expect(prds).toHaveLength(1);
    const prd = prds[0]!;
    expect(prd["domain"]).toBe("ski");
    expect(prd["key"]).toBe("gloves-slope");
    expect(prd["product"]).toBe("gloves");
    expect(prd["intent"]).toBe("slope");
    expect(prd["title"]).toBe("Ski gloves for the slope");

    // LEAN: not a single artefact BODY leaks into the coordinates result.
    expect(JSON.stringify(payload)).not.toContain("must NOT leak");
  });

  it("filters by coordinate — a `product` filter returns only matching PRDs", async () => {
    await getTool(api, MATERIALIZE).execute("f0", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("f1", { target: "method", domain: "ski", kind: "create", name: "Ski", body: "#g" });
    await getTool(api, LEARN).execute("f2", {
      target: "prd", domain: "ski", prd: "gloves-slope", product: "gloves", intent: "slope", title: "G", kind: "create", body: "#r",
    });
    await getTool(api, LEARN).execute("f3", {
      target: "prd", domain: "ski", prd: "boots-general", product: "boots", intent: "general", title: "B", kind: "create", body: "#r",
    });
    const payload = payloadOf(await getTool(api, SEARCH).execute("f4", { product: "gloves" }));
    const prds = payload["prds"] as Array<Record<string, unknown>>;
    expect(prds.map((p) => p["key"])).toEqual(["gloves-slope"]);
  });

  it("a domain with MALFORMED method frontmatter is SKIPPED + surfaced as `unreadable` — never half-read, never a silent drop, siblings survive", async () => {
    await getTool(api, MATERIALIZE).execute("bad0", { name: "sil shopper", userSpec: USER_SPEC });
    // A healthy sibling.
    await getTool(api, LEARN).execute("bad1", { target: "method", domain: "ski", kind: "create", name: "Ski", body: "#g" });
    // A corrupt/hand-edited domain: a method.md with NO valid frontmatter fence.
    const brokenDir = domainDir("broken");
    mkdirSync(brokenDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(brokenDir, "method.md"), "no frontmatter here at all\njust prose\n", { mode: 0o600 });

    const payload = payloadOf(await getTool(api, SEARCH).execute("bad2", {}));
    expect(payload["status"]).toBe("ok");
    // The healthy sibling is still listed...
    const domains = payload["domains"] as Array<Record<string, unknown>>;
    expect(domains.map((d) => d["slug"])).toEqual(["ski"]);
    // ...the broken one is NOT silently dropped — it is surfaced with a cause.
    const unreadable = payload["unreadable"];
    expect(Array.isArray(unreadable)).toBe(true);
    expect((unreadable as unknown[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(unreadable)).toContain("broken");
  });
});

/* ===========================================================================
 * sil_profile_get — the RICH read (whole body); method vs PRD; fail-closed.
 * ========================================================================= */
describe("sil_profile_get — reads ONE full body (method or PRD)", () => {
  it("get(domainSlug) returns the METHOD body; get(domainSlug, prd) returns the PRD body", async () => {
    await getTool(api, MATERIALIZE).execute("g0", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("g1", {
      target: "method", domain: "ski", kind: "create", name: "Ski", body: "# METHOD BODY unique-token-77",
    });
    await getTool(api, LEARN).execute("g2", {
      target: "prd", domain: "ski", prd: "gloves-slope", product: "gloves", intent: "slope", title: "G", kind: "create",
      body: "## PRD BODY unique-token-88",
    });

    const method = payloadOf(await getTool(api, GET).execute("g3", { domainSlug: "ski" }));
    expect(method["status"]).toBe("ok");
    expect(JSON.stringify(method)).toContain("unique-token-77");

    const prd = payloadOf(await getTool(api, GET).execute("g4", { domainSlug: "ski", prd: "gloves-slope" }));
    expect(prd["status"]).toBe("ok");
    expect(JSON.stringify(prd)).toContain("unique-token-88");
  });

  it("a missing method / PRD → not_found", async () => {
    await getTool(api, MATERIALIZE).execute("g5", { name: "sil shopper", userSpec: USER_SPEC });
    expect(payloadOf(await getTool(api, GET).execute("g6", { domainSlug: "never" }))["status"]).toBe("not_found");
    await getTool(api, LEARN).execute("g7", { target: "method", domain: "ski", kind: "create", name: "Ski", body: "#g" });
    expect(
      payloadOf(await getTool(api, GET).execute("g8", { domainSlug: "ski", prd: "no-such-prd" }))["status"],
    ).toBe("not_found");
  });

  it("a traversal / reserved slug → invalid_request (guarded before any read)", async () => {
    await getTool(api, MATERIALIZE).execute("g9", { name: "sil shopper", userSpec: USER_SPEC });
    for (const slug of ["../escape", "main"]) {
      expect(payloadOf(await getTool(api, GET).execute("g10", { domainSlug: slug }))["status"]).toBe(
        "invalid_request",
      );
    }
  });

  // GAP 3 — the rich read distinguishes a PRESENT-but-corrupt artefact (`unreadable`,
  // fail-closed) from an ABSENT one (`not_found`), matching the scan paths. Conflating
  // them lets the agent re-mint over a recoverable body — silent data loss.
  it("a method.md present but with malformed/absent frontmatter → `unreadable` (NOT not_found) so the agent never re-mints over a recoverable artefact", async () => {
    await getTool(api, MATERIALIZE).execute("u0", { name: "sil shopper", userSpec: USER_SPEC });
    // A hand-corrupted domain: method.md exists but carries no valid frontmatter fence.
    const brokenDir = domainDir("broken");
    mkdirSync(brokenDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(brokenDir, "method.md"), "no frontmatter here at all\njust prose\n", { mode: 0o600 });

    const payload = payloadOf(await getTool(api, GET).execute("u1", { domainSlug: "broken" }));
    expect(payload["status"]).toBe("unreadable");
    expect(payload["status"]).not.toBe("not_found");
    // Fail-closed recovery that steers AWAY from re-mint (do not overwrite a corrupt-but-recoverable body).
    expect(payload["recovery"]).toBe("inspect_artefact");
    expect(String(payload["message"])).toMatch(/corrupt|overwrite|inspect|repair/i);
  });

  it("a malformed PRD → `unreadable`; a genuinely ABSENT method / PRD still → not_found", async () => {
    await getTool(api, MATERIALIZE).execute("u2", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("u3", { target: "method", domain: "ski", kind: "create", name: "Ski", body: "#g" });
    // A corrupt PRD leaf: present but unparseable.
    const prdsDir = join(domainDir("ski"), "prds");
    mkdirSync(prdsDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(prdsDir, "gloves-slope.md"), "not a frontmatter doc\n", { mode: 0o600 });

    expect(payloadOf(await getTool(api, GET).execute("u4", { domainSlug: "ski", prd: "gloves-slope" }))["status"]).toBe(
      "unreadable",
    );
    // Absence is distinct from corruption — a truly missing method/PRD is still not_found.
    expect(payloadOf(await getTool(api, GET).execute("u5", { domainSlug: "never-minted" }))["status"]).toBe("not_found");
    expect(payloadOf(await getTool(api, GET).execute("u6", { domainSlug: "ski", prd: "no-such-prd" }))["status"]).toBe(
      "not_found",
    );
  });
});

/* ===========================================================================
 * sil_profile_remove — domain subtree vs single PRD; fail-closed + escape guard.
 * ========================================================================= */
describe("sil_profile_remove — removes a whole domain, or just one PRD", () => {
  it("remove(domainSlug) deletes the whole domain subtree; remove(domainSlug, prd) deletes just that PRD (method + siblings survive)", async () => {
    await getTool(api, MATERIALIZE).execute("r0", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("r1", { target: "method", domain: "ski", kind: "create", name: "Ski", body: "#g" });
    await getTool(api, LEARN).execute("r2", {
      target: "prd", domain: "ski", prd: "gloves-slope", product: "gloves", intent: "slope", title: "G", kind: "create", body: "#r",
    });
    await getTool(api, LEARN).execute("r3", {
      target: "prd", domain: "ski", prd: "boots-general", product: "boots", intent: "general", title: "B", kind: "create", body: "#r",
    });

    // Remove just ONE PRD.
    const one = payloadOf(await getTool(api, REMOVE).execute("r4", { domainSlug: "ski", prd: "gloves-slope" }));
    expect(one["status"]).toBe("removed");
    expect(existsSync(join(domainDir("ski"), "prds", "gloves-slope.md"))).toBe(false);
    // The method and the sibling PRD survive.
    expect(existsSync(join(domainDir("ski"), "method.md"))).toBe(true);
    expect(existsSync(join(domainDir("ski"), "prds", "boots-general.md"))).toBe(true);

    // Remove the WHOLE domain.
    const whole = payloadOf(await getTool(api, REMOVE).execute("r5", { domainSlug: "ski" }));
    expect(whole["status"]).toBe("removed");
    expect(existsSync(domainDir("ski"))).toBe(false);
  });

  it("an unregistered domain / PRD → not_found (idempotent, safe to re-run)", async () => {
    await getTool(api, MATERIALIZE).execute("r6", { name: "sil shopper", userSpec: USER_SPEC });
    expect(payloadOf(await getTool(api, REMOVE).execute("r7", { domainSlug: "ghost" }))["status"]).toBe("not_found");
  });

  it("a traversal / reserved slug → invalid_request, deletes nothing", async () => {
    await seedSkiMethod();
    for (const slug of ["../..", "main"]) {
      expect(payloadOf(await getTool(api, REMOVE).execute("r8", { domainSlug: slug }))["status"]).toBe(
        "invalid_request",
      );
    }
    expect(existsSync(domainDir("ski"))).toBe(true);
  });
});

/* ===========================================================================
 * FRONTMATTER-AS-TRUTH — the whole flow leaves NO profile.json anywhere.
 * ========================================================================= */
describe("frontmatter-as-truth — no manifest ever appears across the whole lifecycle", () => {
  it("after create → learn → attach-asset → remove, not one profile.json exists under the shopper root", async () => {
    await seedSkiMethod();
    await getTool(api, LEARN).execute("z1", {
      target: "prd", domain: "ski", prd: "gloves-slope", product: "gloves", intent: "slope", title: "G", kind: "create", body: "#r",
    });
    await getTool(api, LEARN).execute("z2", {
      target: "method", domain: "ski", kind: "append", section: "Taste & stance", text: "note",
    });
    await getTool(api, REMOVE).execute("z3", { domainSlug: "ski", prd: "gloves-slope" });
    expect(walkShopper().some((p) => p.endsWith("profile.json"))).toBe(false);
  });
});
