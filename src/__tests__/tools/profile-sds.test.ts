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
 *     `write` replaces an EXISTING doc's whole body (reconciled, never stacked);
 *     `attach-asset` persists image bytes. REPLACES the deleted `sil_remember`.
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

/** A sentinel `updated_at`/`created_at` older than any real `new Date()` — so a
 * subsequent `write`'s timestamp bump (and `created_at` preservation) is
 * DETERMINISTIC, never a wall-clock race between two sub-millisecond tool calls. */
const OLD_TS = "2000-01-01T00:00:00.000Z";

/** Backdate an on-disk artefact's timestamps to `OLD_TS` so a following `write` can
 * prove it moved `updated_at` forward (and left `created_at` frozen). */
function backdate(path: string): void {
  const patched = readFileSync(path, "utf8")
    .replace(/updated_at:.*/g, "updated_at: " + OLD_TS)
    .replace(/created_at:.*/g, "created_at: " + OLD_TS);
  writeFileSync(path, patched, { mode: 0o600 });
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

  it("create REFUSES to clobber an existing method (create only mints) → invalid_request (field kind), on-disk body unchanged", async () => {
    const methodPath = await seedSkiMethod();
    const before = readFileSync(methodPath, "utf8");
    const payload = payloadOf(
      await getTool(api, LEARN).execute("ce1", {
        target: "method",
        domain: "ski",
        kind: "create",
        name: "Ski",
        body: "# a WHOLLY different guide that must NOT land\n",
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
    // The error points the model at kind:write (the only path that overwrites).
    expect(payload["field"]).toBe("kind");
    // Nothing was clobbered — the seeded method is byte-for-byte intact.
    expect(readFileSync(methodPath, "utf8")).toBe(before);
  });

  it("create REFUSES to clobber an existing PRD → invalid_request (field kind), on-disk body unchanged", async () => {
    await getTool(api, MATERIALIZE).execute("cp0", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("cp1", {
      target: "method",
      domain: "ski",
      kind: "create",
      name: "Ski",
      body: "#g",
    });
    const prdCoords = {
      target: "prd" as const,
      domain: "ski",
      prd: "gloves-slope",
      product: "gloves",
      intent: "slope",
      title: "G",
      kind: "create" as const,
    };
    const first = payloadOf(
      await getTool(api, LEARN).execute("cp2", { ...prdCoords, body: "## Requirements\n- original\n" }),
    );
    expect(first["status"]).toBe("ok");
    const prdPath = join(domainDir("ski"), "prds", "gloves-slope.md");
    const before = readFileSync(prdPath, "utf8");
    const second = payloadOf(
      await getTool(api, LEARN).execute("cp3", { ...prdCoords, body: "## Requirements\n- DIFFERENT\n" }),
    );
    expect(second["status"]).toBe("invalid_request");
    expect(second["field"]).toBe("kind");
    expect(readFileSync(prdPath, "utf8")).toBe(before);
  });

  it("strips a model-authored leading frontmatter block from a create body — never stacks two blocks", async () => {
    // A model sometimes prepends its OWN `--- … ---` to the body. The store owns
    // frontmatter (frontmatter-as-truth), so serialization must strip it and emit
    // exactly one block (the store's coordinates), never two stacked.
    await getTool(api, MATERIALIZE).execute("fm0", { name: "sil shopper", userSpec: USER_SPEC });
    const bodyWithFm =
      "---\nnote: MODEL-AUTHORED-FRONTMATTER\ntitle: not the real title\n---\n" +
      "# Buying guide\n\nStability first, then sound.\n";
    const payload = payloadOf(
      await getTool(api, LEARN).execute("fm1", {
        target: "method",
        domain: "running",
        name: "running shoes",
        kind: "create",
        body: bodyWithFm,
      }),
    );
    expect(payload["status"]).toBe("ok"); // create succeeded
    const raw = readFileSync(join(domainDir("running"), "method.md"), "utf8");
    // Exactly one frontmatter block: the file opens with the store's fence, and after its
    // close fence the body begins with the real content — NOT a second `---` fence.
    expect(raw.startsWith("---")).toBe(true);
    const afterOpen = raw.slice(3);
    const close = afterOpen.match(/\n---[ \t]*\r?\n/)!;
    const body = afterOpen.slice(close.index! + close[0].length);
    expect(body.startsWith("# Buying guide")).toBe(true);
    // The model's stray frontmatter content is gone entirely (stripped, not embedded).
    expect(raw).not.toContain("MODEL-AUTHORED-FRONTMATTER");
    // The store's own coordinates ARE present in the single frontmatter block.
    expect(raw).toContain("domain: running");
    expect(raw).toContain("name: running shoes");
  });
});

/* ===========================================================================
 * sil_learn write — replace an EXISTING doc's WHOLE body with a reconciled version
 * (the model reads current, reconciles in context, writes the whole doc back). No
 * append/amend/retract: a correction can never stack a contradicting line. Coordinates
 * + created_at are preserved and updated_at bumps (user_spec carries no timestamp).
 * Fail-closed: not_found on an absent target (write never mints), unreadable on a
 * present-but-corrupt one (never clobbers a recoverable artefact).
 * ========================================================================= */
describe("sil_learn write — reconcile an existing doc's whole body, no stacking", () => {
  it("write method REPLACES the whole body (old content GONE — reconciled, not stacked); domain/name preserved; updated_at bumped", async () => {
    const methodPath = await seedSkiMethod();
    // Backdate so the bump is provable against a fixed sentinel (no wall-clock race).
    backdate(methodPath);
    const newBody = "# Buying guide — ski (rebuilt)\n\n## Fresh stance\n- Only current-year models.\n";
    const payload = payloadOf(
      await getTool(api, LEARN).execute("w1", {
        target: "method",
        domain: "ski",
        kind: "write",
        body: newBody,
      }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["kind"]).toBe("write");
    const raw = readFileSync(methodPath, "utf8");
    // Reconciliation, not accretion: the seeded line is GONE, the new body is in.
    expect(raw).not.toContain("Prefer last-year models.");
    expect(raw).toContain("Only current-year models.");
    // Coordinates survive the whole-body rewrite.
    expect(raw).toMatch(/domain:\s*ski/);
    expect(raw).toMatch(/name:\s*Ski/);
    // updated_at moved OFF the backdated sentinel to a real, strictly-newer stamp.
    expect(raw).not.toContain(OLD_TS);
    const updatedAt = raw.match(/updated_at:\s*(\S+)/)![1]!;
    expect(updatedAt > OLD_TS).toBe(true);
  });

  it("write prd replaces the body; {key,product,intent,title,domain,created_at} preserved; updated_at bumped", async () => {
    await getTool(api, MATERIALIZE).execute("wp0", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("wp1", {
      target: "method", domain: "ski", kind: "create", name: "Ski", body: "#g",
    });
    await getTool(api, LEARN).execute("wp2", {
      target: "prd", domain: "ski", prd: "gloves-slope", product: "gloves", intent: "slope",
      title: "Ski gloves for the slope", kind: "create", body: "## Requirements\n- original waterproofing\n",
    });
    const prdPath = join(domainDir("ski"), "prds", "gloves-slope.md");
    backdate(prdPath);
    const payload = payloadOf(
      await getTool(api, LEARN).execute("wp3", {
        target: "prd", domain: "ski", prd: "gloves-slope", kind: "write",
        body: "## Requirements\n- rebuilt: insulation over waterproofing\n",
      }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["kind"]).toBe("write");
    const raw = readFileSync(prdPath, "utf8");
    expect(raw).not.toContain("original waterproofing");
    expect(raw).toContain("rebuilt: insulation over waterproofing");
    // Every PRD coordinate survives.
    expect(raw).toMatch(/key:\s*gloves-slope/);
    expect(raw).toMatch(/product:\s*gloves/);
    expect(raw).toMatch(/intent:\s*slope/);
    expect(raw).toMatch(/title:\s*Ski gloves for the slope/);
    expect(raw).toMatch(/domain:\s*ski/);
    // created_at is FROZEN at the seed; only updated_at moves forward.
    expect(raw).toContain("created_at: " + OLD_TS);
    const updatedAt = raw.match(/updated_at:\s*(\S+)/)![1]!;
    expect(updatedAt > OLD_TS).toBe(true);
  });

  it("write user_spec replaces the body (old GONE, new in); the shopper `name` frontmatter is preserved; no updated_at is added", async () => {
    await getTool(api, MATERIALIZE).execute("wu0", { name: "sil shopper", userSpec: USER_SPEC });
    const userSpecPath = join(shopperDir(), "user_spec.md");
    const payload = payloadOf(
      await getTool(api, LEARN).execute("wu1", {
        target: "user_spec",
        kind: "write",
        body: "# The person (rebuilt)\n- Ships to Munich now.\n",
      }),
    );
    expect(payload["status"]).toBe("ok");
    expect(payload["kind"]).toBe("write");
    const raw = readFileSync(userSpecPath, "utf8");
    expect(raw).not.toContain("Ships to Berlin");
    expect(raw).toContain("Ships to Munich now.");
    // The name in frontmatter is carried across the rewrite.
    expect(raw).toMatch(/name:\s*sil shopper/);
    // user_spec carries no timestamp — only method/prd do.
    expect(raw).not.toContain("updated_at");
  });

  it("write on an ABSENT method / PRD → not_found (write never mints — that is create); nothing is written as a side effect", async () => {
    await getTool(api, MATERIALIZE).execute("wn0", { name: "sil shopper", userSpec: USER_SPEC });
    const method = payloadOf(
      await getTool(api, LEARN).execute("wn1", {
        target: "method", domain: "never-minted", kind: "write", body: "# nope\n",
      }),
    );
    expect(method["status"]).toBe("not_found");
    expect(existsSync(join(domainDir("never-minted"), "method.md"))).toBe(false);

    await getTool(api, LEARN).execute("wn2", { target: "method", domain: "ski", kind: "create", name: "Ski", body: "#g" });
    const prd = payloadOf(
      await getTool(api, LEARN).execute("wn3", {
        target: "prd", domain: "ski", prd: "no-such-prd", kind: "write", body: "## nope\n",
      }),
    );
    expect(prd["status"]).toBe("not_found");
    expect(existsSync(join(domainDir("ski"), "prds", "no-such-prd.md"))).toBe(false);
  });

  it("write on a PRESENT-but-corrupt method → unreadable (never clobbers a recoverable artefact); the original bytes are untouched", async () => {
    await getTool(api, MATERIALIZE).execute("wc0", { name: "sil shopper", userSpec: USER_SPEC });
    // A hand-corrupted domain: method.md present but with NO valid frontmatter fence.
    const brokenDir = domainDir("broken");
    mkdirSync(brokenDir, { recursive: true, mode: 0o700 });
    const garbage = "no frontmatter here at all\njust prose\n";
    const methodPath = join(brokenDir, "method.md");
    writeFileSync(methodPath, garbage, { mode: 0o600 });

    const payload = payloadOf(
      await getTool(api, LEARN).execute("wc1", {
        target: "method", domain: "broken", kind: "write", body: "# a replacement that must NOT land\n",
      }),
    );
    expect(payload["status"]).toBe("unreadable");
    // Fail-closed: the corrupt-but-recoverable bytes are exactly as they were.
    expect(readFileSync(methodPath, "utf8")).toBe(garbage);
  });

  it("write with NO body → invalid_request (field body) — write requires the reconciled whole body, and writes nothing", async () => {
    const methodPath = await seedSkiMethod();
    const before = readFileSync(methodPath, "utf8");
    const payload = payloadOf(
      await getTool(api, LEARN).execute("wb1", {
        target: "method", domain: "ski", kind: "write",
      }),
    );
    expect(payload["status"]).toBe("invalid_request");
    expect(payload["field"]).toBe("body");
    expect(readFileSync(methodPath, "utf8")).toBe(before);
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

  // ---------------------------------------------------------------------------
  // The MINT TRIGGER — an empty `domains` result (an empty store OR a filtered
  // miss on a populated one) IS the reuse-before-mint MISS, the exact point a
  // first shop silently stalls onto the open web. The MISS must carry
  // `next_step: mint_domain` + a `guidance` cue so the model mints before it
  // shops. A MATCH carries NEITHER field. These pin that forcing function.
  // ---------------------------------------------------------------------------
  it("an EMPTY store → the mint trigger: next_step === mint_domain + a non-empty guidance string (a first shop never silently stalls)", async () => {
    const payload = payloadOf(await getTool(api, SEARCH).execute("mt0", {}));
    expect(payload["status"]).toBe("ok");
    expect(payload["domains"]).toEqual([]);
    expect(payload["next_step"]).toBe("mint_domain");
    expect(typeof payload["guidance"]).toBe("string");
    expect((payload["guidance"] as string).length).toBeGreaterThan(0);
  });

  it("a FILTERED miss on a POPULATED store → the mint trigger fires per-REQUEST, not only on an empty store", async () => {
    await seedSkiMethod();
    // `espresso` is a niche that was never learned — a per-request miss on a store
    // that DOES hold `ski`. The trigger must key on the filtered result, not the store.
    const payload = payloadOf(await getTool(api, SEARCH).execute("mt1", { domain: "espresso" }));
    expect(payload["status"]).toBe("ok");
    expect(payload["domains"]).toEqual([]);
    expect(payload["next_step"]).toBe("mint_domain");
  });

  it("a MATCH carries NO mint trigger — neither next_step nor guidance is present when a domain came back", async () => {
    await seedSkiMethod();
    // Both the unfiltered overview and an explicit `ski` filter MATCH → no cue.
    const cases: Array<Record<string, unknown>> = [{}, { domain: "ski" }];
    for (const params of cases) {
      const payload = payloadOf(await getTool(api, SEARCH).execute("mt2", params));
      const domains = payload["domains"] as Array<Record<string, unknown>>;
      expect(domains.map((d) => d["slug"])).toEqual(["ski"]);
      // Absence is the spec — assert the KEYS are gone, not merely falsy.
      expect(payload).not.toHaveProperty("next_step");
      expect(payload).not.toHaveProperty("guidance");
    }
  });

  it("the mint-trigger guidance names the mint verb (sil_learn) + steers to the sil catalog over the open web, and leaks NO artefact body", async () => {
    // Mint a method whose body carries a unique token, then MISS on another niche:
    // the guidance is a static cue, so not one byte of the minted body may appear.
    const BODY_TOKEN = "unique-body-token-must-NOT-leak-mint-42";
    await getTool(api, MATERIALIZE).execute("mt3", { name: "sil shopper", userSpec: USER_SPEC });
    await getTool(api, LEARN).execute("mt4", {
      target: "method",
      domain: "ski",
      kind: "create",
      name: "Ski",
      body: `# Buying guide\n${BODY_TOKEN}\n`,
    });
    const payload = payloadOf(await getTool(api, SEARCH).execute("mt5", { domain: "espresso" }));
    expect(payload["next_step"]).toBe("mint_domain");
    const guidance = payload["guidance"] as string;
    // Names the mint path…
    expect(guidance).toContain("sil_learn");
    // …and steers a buy-intent to the sil catalog over the open web.
    expect(guidance).toMatch(/catalog/i);
    expect(guidance).toMatch(/open web/i);
    // No artefact body text leaks — not into the guidance, not anywhere in the payload.
    expect(guidance).not.toContain(BODY_TOKEN);
    expect(JSON.stringify(payload)).not.toContain(BODY_TOKEN);
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
  it("after create → write → remove, not one profile.json exists under the shopper root", async () => {
    await seedSkiMethod();
    await getTool(api, LEARN).execute("z1", {
      target: "prd", domain: "ski", prd: "gloves-slope", product: "gloves", intent: "slope", title: "G", kind: "create", body: "#r",
    });
    await getTool(api, LEARN).execute("z2", {
      target: "method", domain: "ski", kind: "write",
      body: "# Buying guide — ski\n\n## Taste & stance\n- Prefer last-year models.\n- note\n",
    });
    await getTool(api, REMOVE).execute("z3", { domainSlug: "ski", prd: "gloves-slope" });
    expect(walkShopper().some((p) => p.endsWith("profile.json"))).toBe(false);
  });
});
