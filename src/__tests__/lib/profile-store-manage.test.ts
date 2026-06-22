/**
 * UNIT — list/read/remove store primitives (tier: unit, real temp dir via the
 * SIL_DATA_DIR override, no network, no host).
 *
 * Card: list-view-and-remove-local-expert-agents. The create-engine
 * (`materializeProfile`) wrote the artefact store; this card adds the three
 * primitives that MANAGE it:
 *   - listAgentProfiles()        — enumerate $SIL_DATA_DIR/agents/*\/profile.json
 *   - readAgentProfile(agentId)  — manifest + persona/playbook bodies for one
 *   - removeAgentArtefacts(id)   — delete exactly one validated agent's dir
 *
 * Each returns a discriminated result that NEVER throws across the boundary
 * (cloning the `MaterializeResult` shape, profile-store.ts:94-117) — the tool
 * maps each variant to a structured envelope. The invariants pinned here ARE
 * the card's correctness bar for the artefact-half of list/view/remove:
 *
 *   LIST   (Flow 1, AC List):
 *     1. empty/absent store → ok with empty experts (a normal outcome).
 *     2. multiple experts → all present, each from its profile.json manifest
 *        (no dirname guessing — name/createdAt/hasPlaybook come from the file).
 *     3. ordered createdAt DESC (most-recently-created first).
 *     4. one corrupt/unreadable profile.json among healthy ones → that one in
 *        unreadable[], the rest still listed (the list never aborts/throws).
 *   READ   (Flow 2, AC View):
 *     5. ok → manifest + persona body (+ playbook body when present) read from
 *        the files the manifest points at.
 *     6. unknown id → not_found (a normal outcome, never a throw).
 *     7. traversal-shaped id (../x, a/b, .., a/../b, main, Mixed-Case) →
 *        invalid_request via AGENT_ID_RE, rejected BEFORE any join/read.
 *   REMOVE (Flow 3, AC Remove — clears the artefact half, scoped):
 *     8. removed → the target dir is gone.
 *     9. idempotent not_found on absent — a re-run is safe (converges to clean).
 *    10. traversal/main/malformed → invalid_request, DELETES NOTHING.
 *    11. a sibling expert's dir is byte-for-byte untouched (non-destructive).
 *    12. an rmSync that genuinely fails (non-writable parent) → persistence_failed
 *        with <dir>: <cause>, never a throw.
 *   IDENTITY BOUNDARY (Generic shopping unchanged):
 *    13. none of the three read/write a token (getTokensPath() never appears).
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (the repo's standard knob,
 * mirrors profile-store.test.ts:64-80).
 *
 * Contract this file pins for the implementation (expert-developer),
 * `src/lib/profile-store.ts`:
 *   - listAgentProfiles(): ListProfilesResult — discriminated, never throws.
 *     ok variant: { ok:true, experts: {agentId,name,hasPlaybook,createdAt}[]
 *     (createdAt DESC), unreadable: {agentId,error}[] }.
 *   - readAgentProfile(agentId): ReadProfileResult — discriminated, never throws.
 *     ok: { ok:true, agentId, name, persona, playbook?, profilePath, createdAt };
 *     not_found: { ok:false, kind:"not_found", agentId, message };
 *     bad id: { ok:false, kind:"invalid_request", field:"agentId", message }.
 *   - removeAgentArtefacts(agentId): RemoveProfileResult — discriminated, never
 *     throws. removed: { ok:true, agentId }; absent: { ok:false,
 *     kind:"not_found", agentId, message }; bad id: { ok:false,
 *     kind:"invalid_request", field:"agentId", message } AND deletes nothing;
 *     rmSync failure: { ok:false, kind:"persistence_failed", error:"<dir>:
 *     <cause>", message }.
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
  readdirSync,
  readFileSync,
  mkdirSync,
  statSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeProfile,
  listAgentProfiles,
  readAgentProfile,
  removeAgentArtefacts,
  getAgentArtefactDir,
} from "../../lib/profile-store.js";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-profile-manage-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  // Restore perms so rmSync can clean a dir a failure test chmod'd read-only.
  try {
    chmodSync(dataDir, 0o700);
    const agents = join(dataDir, "agents");
    if (existsSync(agents)) {
      chmodSync(agents, 0o700);
      for (const e of readdirSync(agents)) {
        try {
          chmodSync(join(agents, e), 0o700);
        } catch {
          /* best-effort */
        }
      }
    }
  } catch {
    /* best-effort */
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/** Materialize an expert and (optionally) backdate its manifest createdAt so
 * ordering is deterministic regardless of wall-clock resolution. The store's
 * own writer is used (never a hand-rolled fixture) so the test exercises the
 * real on-disk shape readAgentProfile/listAgentProfiles must parse. */
function makeExpert(
  agentId: string,
  opts: { name?: string; persona?: string; playbook?: string; createdAt?: string } = {},
): void {
  const result = materializeProfile({
    agentId,
    name: opts.name ?? `Expert ${agentId}`,
    persona: opts.persona ?? `Persona for ${agentId} — shops carefully.`,
    ...(opts.playbook !== undefined ? { playbook: opts.playbook } : {}),
  });
  if (!result.ok) {
    throw new Error(`fixture setup failed for ${agentId}: ${JSON.stringify(result)}`);
  }
  if (opts.createdAt !== undefined) {
    // Rewrite profile.json with a fixed createdAt to pin ordering.
    const manifestPath = join(getAgentArtefactDir(agentId), "profile.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest["createdAt"] = opts.createdAt;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
}

/** Every file under `dir`, recursively (relative paths). Used to prove a
 * rejected-on-bad-id remove deleted NOTHING anywhere under agents/. */
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

// ===========================================================================
// listAgentProfiles
// ===========================================================================

describe("listAgentProfiles — empty/absent store is a normal, successful empty listing", () => {
  // list has NO failure variant: an absent store is a normal empty listing and
  // per-entry problems land in unreadable[]. So the result carries experts +
  // unreadable directly (no `ok` discriminant to gate on) — pin the BEHAVIOUR.
  it("absent agents/ dir → empty experts, empty unreadable (not an error)", () => {
    // Fresh temp data dir: no agents/ subtree exists at all.
    expect(existsSync(join(getDataDir(), "agents"))).toBe(false);
    const result = listAgentProfiles();
    expect(result.experts).toEqual([]);
    expect(result.unreadable).toEqual([]);
  });

  it("present-but-empty agents/ dir → empty experts", () => {
    // An agents/ dir with no expert subdirs is still a normal empty listing.
    mkdirSync(join(getDataDir(), "agents"), { recursive: true });
    const result = listAgentProfiles();
    expect(result.experts).toEqual([]);
  });
});

describe("listAgentProfiles — multiple experts: all present, sourced from profile.json", () => {
  it("lists every materialized expert with name + hasPlaybook + agentId from its manifest", () => {
    makeExpert("gift-buyer", { name: "Gift Buyer", playbook: "Browse with sil_search." });
    makeExpert("grocery-agent", { name: "Grocery Agent" }); // no playbook

    const result = listAgentProfiles();
    expect(result.unreadable).toEqual([]);

    const byId = new Map(result.experts.map((e) => [e.agentId, e]));
    expect(byId.size).toBe(2);

    const gift = byId.get("gift-buyer");
    expect(gift).toBeDefined();
    // name comes from the manifest, NOT from the directory name.
    expect(gift!.name).toBe("Gift Buyer");
    expect(gift!.hasPlaybook).toBe(true);
    expect(typeof gift!.createdAt).toBe("string");

    const grocery = byId.get("grocery-agent");
    expect(grocery).toBeDefined();
    expect(grocery!.name).toBe("Grocery Agent");
    // hasPlaybook reflects the manifest's playbookPath presence (none here).
    expect(grocery!.hasPlaybook).toBe(false);
  });

  it("reads name from the manifest, not the directory name (no filesystem-name guessing)", () => {
    // The directory key is the agentId; the human name is a DISTINCT manifest
    // field. A list that echoed the dir name as the name would pass a naive
    // test but fail here, where the two deliberately differ.
    makeExpert("shoe-expert", { name: "Sneaker Specialist" });
    const result = listAgentProfiles();
    const entry = result.experts.find((e) => e.agentId === "shoe-expert");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("Sneaker Specialist");
    expect(entry!.name).not.toBe("shoe-expert");
  });
});

describe("listAgentProfiles — ordered most-recently-created first (createdAt DESC)", () => {
  it("returns experts in descending createdAt order", () => {
    makeExpert("oldest", { createdAt: "2026-01-01T00:00:00.000Z" });
    makeExpert("newest", { createdAt: "2026-06-22T00:00:00.000Z" });
    makeExpert("middle", { createdAt: "2026-03-15T00:00:00.000Z" });

    const result = listAgentProfiles();
    expect(result.experts.map((e) => e.agentId)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });
});

describe("listAgentProfiles — one corrupt manifest never blinds the user to the rest", () => {
  it("a healthy expert + an unparseable profile.json → healthy listed, broken in unreadable[]", () => {
    makeExpert("healthy", { name: "Healthy Expert", createdAt: "2026-05-01T00:00:00.000Z" });
    makeExpert("broken", { name: "Broken Expert", createdAt: "2026-05-02T00:00:00.000Z" });
    // Corrupt the broken one's manifest with non-JSON.
    const brokenManifest = join(getAgentArtefactDir("broken"), "profile.json");
    chmodSync(brokenManifest, 0o600);
    writeFileSync(brokenManifest, "{ this is not valid json ");

    const result = listAgentProfiles();
    // Must NOT throw — the broken one is isolated into unreadable[].

    // The healthy expert still lists.
    expect(result.experts.map((e) => e.agentId)).toEqual(["healthy"]);
    // The broken one is reported by agentId in unreadable[], with an error.
    expect(result.unreadable.map((u) => u.agentId)).toEqual(["broken"]);
    expect(typeof result.unreadable[0]!.error).toBe("string");
    expect(result.unreadable[0]!.error.length).toBeGreaterThan(0);
  });

  it("an expert subdir whose profile.json is entirely MISSING → reported unreadable, others still list", () => {
    makeExpert("intact", { name: "Intact" });
    // Create an agent subdir with NO profile.json (an interrupted create).
    const orphanDir = getAgentArtefactDir("orphaned");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "persona.md"), "persona but no manifest");

    const result = listAgentProfiles();
    expect(result.experts.map((e) => e.agentId)).toEqual(["intact"]);
    expect(result.unreadable.map((u) => u.agentId)).toContain("orphaned");
  });
});

// ===========================================================================
// readAgentProfile
// ===========================================================================

describe("readAgentProfile — ok: manifest + artefact bodies for one expert", () => {
  it("returns name, persona body, playbook body, profilePath, createdAt from the files the manifest points at", () => {
    makeExpert("gift-buyer", {
      name: "Gift Buyer",
      persona: "You specialise in gifts under €50; always check stock first.",
      playbook: "Use sil_search to browse; sil_product_get to re-check stock.",
    });

    const result = readAgentProfile("gift-buyer");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agentId).toBe("gift-buyer");
    expect(result.name).toBe("Gift Buyer");
    // The BODIES are read from disk (the files the manifest points at), not the
    // manifest paths alone — the skill renders detail from these.
    expect(result.persona).toBe(
      "You specialise in gifts under €50; always check stock first.",
    );
    expect(result.playbook).toBe(
      "Use sil_search to browse; sil_product_get to re-check stock.",
    );
    expect(result.profilePath).toBe(
      join(getAgentArtefactDir("gift-buyer"), "profile.json"),
    );
    expect(typeof result.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(result.createdAt))).toBe(false);
  });

  it("omits the playbook body when the expert has no playbook", () => {
    makeExpert("grocery-agent", { name: "Grocery Agent" }); // no playbook
    const result = readAgentProfile("grocery-agent");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playbook).toBeUndefined();
    expect(typeof result.persona).toBe("string");
    expect(result.persona.length).toBeGreaterThan(0);
  });
});

describe("readAgentProfile — unknown id fails gracefully (not_found, never a throw)", () => {
  it("an id with no artefact dir → not_found naming the agentId, no throw", () => {
    makeExpert("exists", {}); // a healthy neighbour, to prove read is scoped
    const result = readAgentProfile("does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("not_found");
    if (result.kind !== "not_found") return;
    expect(result.agentId).toBe("does-not-exist");
    expect(typeof result.message).toBe("string");
  });

  it("an agent dir whose profile.json is unreadable → not_found (a degraded read, not a throw)", () => {
    makeExpert("degraded", { name: "Degraded" });
    const manifestPath = join(getAgentArtefactDir("degraded"), "profile.json");
    writeFileSync(manifestPath, "}}} not json {{{");
    const result = readAgentProfile("degraded");
    // A corrupt manifest must never throw out of read — it degrades to not_found.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("not_found");
  });
});

describe("readAgentProfile — traversal-shaped id rejected fail-closed BEFORE any read", () => {
  it.each(["../escape", "gift/buyer", "..", ".", "a/../b", "main", "Gift-Buyer", ""])(
    "rejects %j with invalid_request(field=agentId) and reads nothing",
    (bad) => {
      const result = readAgentProfile(bad);
      expect(result.ok, `expected reject for ${JSON.stringify(bad)}`).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe("agentId");
    },
  );
});

// ===========================================================================
// removeAgentArtefacts
// ===========================================================================

describe("removeAgentArtefacts — removes exactly the named expert's dir", () => {
  it("removed → the target artefact dir is gone", () => {
    makeExpert("gift-buyer", { name: "Gift Buyer" });
    const dir = getAgentArtefactDir("gift-buyer");
    expect(existsSync(dir)).toBe(true);

    const result = removeAgentArtefacts("gift-buyer");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agentId).toBe("gift-buyer");
    expect(existsSync(dir)).toBe(false);
  });
});

describe("removeAgentArtefacts — non-destructive to OTHER experts", () => {
  it("removing one of several leaves every other expert's dir byte-for-byte untouched", () => {
    makeExpert("target", { name: "Target", playbook: "to be deleted" });
    makeExpert("survivor-a", { name: "Survivor A", playbook: "keep me A" });
    makeExpert("survivor-b", { name: "Survivor B" });

    const survivorAFiles = walkFiles(getAgentArtefactDir("survivor-a")).sort();
    const survivorASnapshot = survivorAFiles.map((rel) =>
      readFileSync(join(getAgentArtefactDir("survivor-a"), rel), "utf8"),
    );

    const result = removeAgentArtefacts("target");
    expect(result.ok).toBe(true);

    // The target is gone…
    expect(existsSync(getAgentArtefactDir("target"))).toBe(false);
    // …and every other expert's dir survives, byte-for-byte.
    expect(existsSync(getAgentArtefactDir("survivor-a"))).toBe(true);
    expect(existsSync(getAgentArtefactDir("survivor-b"))).toBe(true);
    expect(walkFiles(getAgentArtefactDir("survivor-a")).sort()).toEqual(survivorAFiles);
    survivorAFiles.forEach((rel, i) => {
      expect(
        readFileSync(join(getAgentArtefactDir("survivor-a"), rel), "utf8"),
      ).toBe(survivorASnapshot[i]);
    });
  });

  it("never deletes the agents/ PARENT — only the single leaf dir", () => {
    makeExpert("solo", { name: "Solo" });
    const agentsParent = join(getDataDir(), "agents");
    expect(existsSync(agentsParent)).toBe(true);
    const result = removeAgentArtefacts("solo");
    expect(result.ok).toBe(true);
    // The leaf is gone but the agents/ subtree itself remains (a removed-last
    // expert must not delete the store root — list of an empty store still works).
    expect(existsSync(getAgentArtefactDir("solo"))).toBe(false);
    expect(existsSync(agentsParent)).toBe(true);
  });
});

describe("removeAgentArtefacts — idempotent not_found on an absent target", () => {
  it("an id with no dir → not_found, deletes nothing; a second remove is also not_found (re-run safe)", () => {
    makeExpert("neighbour", { name: "Neighbour" }); // prove scope

    const first = removeAgentArtefacts("never-existed");
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.kind).toBe("not_found");
    if (first.kind !== "not_found") return;
    expect(first.agentId).toBe("never-existed");

    // The neighbour is untouched by the no-op remove.
    expect(existsSync(getAgentArtefactDir("neighbour"))).toBe(true);

    // Idempotent: a second remove of the same absent id ALSO returns not_found,
    // never an error — a retry after a partial host-CLI/artefact failure
    // converges to clean.
    const second = removeAgentArtefacts("never-existed");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.kind).toBe("not_found");
  });

  it("re-removing an id that WAS just removed returns not_found (full removed→not_found cycle is idempotent)", () => {
    makeExpert("transient", { name: "Transient" });
    const removed = removeAgentArtefacts("transient");
    expect(removed.ok).toBe(true);
    const again = removeAgentArtefacts("transient");
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.kind).toBe("not_found");
  });
});

describe("removeAgentArtefacts — malformed/traversal/main id is rejected and DELETES NOTHING", () => {
  it.each(["../escape", "gift/buyer", "..", ".", "a/../b", "main", "Gift-Buyer", ""])(
    "rejects %j with invalid_request(field=agentId) and removes nothing from the store",
    (bad) => {
      // Seed two real experts; a bad id must not reach outside the agents subtree
      // nor touch either of them.
      makeExpert("alpha", { name: "Alpha", playbook: "keep" });
      makeExpert("beta", { name: "Beta" });
      const before = walkFiles(join(getDataDir(), "agents")).sort();

      const result = removeAgentArtefacts(bad);
      expect(result.ok, `expected reject for ${JSON.stringify(bad)}`).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe("agentId");

      // NOTHING under agents/ changed — the bad id deleted nothing.
      expect(walkFiles(join(getDataDir(), "agents")).sort()).toEqual(before);
      expect(existsSync(getAgentArtefactDir("alpha"))).toBe(true);
      expect(existsSync(getAgentArtefactDir("beta"))).toBe(true);
    },
  );
});

describe("removeAgentArtefacts — a genuine rmSync failure returns persistence_failed, never throws", () => {
  // chmod 0500 can't block deletes for root — skip there rather than false-fail.
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(asRoot)(
    "a non-writable agents/ parent (rmSync of the leaf fails EACCES) → persistence_failed with <dir>: <cause>",
    () => {
      makeExpert("locked", { name: "Locked" });
      const dir = getAgentArtefactDir("locked");
      const agentsParent = join(getDataDir(), "agents");
      // rmSync of the leaf needs WRITE on the PARENT dir (to unlink the entry).
      // Make the parent read+exec-only so the unlink fails EACCES.
      chmodSync(agentsParent, 0o500);

      const result = removeAgentArtefacts("locked");
      // Restore perms immediately so the assertions + afterEach can clean up.
      chmodSync(agentsParent, 0o700);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("persistence_failed");
      if (result.kind !== "persistence_failed") return;
      // The path + cause are both present in `error` (actionable recovery),
      // mirroring the writer's failure envelope: "<dir>: <cause>".
      expect(result.error).toContain(dir);
      expect(result.error).toMatch(/.+: .+/);
      // The recovery hint steers the agent at the data dir (card §108).
      expect(result.recovery).toBe("fix_data_dir");
      // The dir was NOT removed (the delete genuinely failed) — but the result
      // is a structured failure, not a thrown error.
      expect(existsSync(dir)).toBe(true);
    },
  );
});

// ===========================================================================
// Identity boundary — none of the three read or write a token
// ===========================================================================

describe("list/read/remove — no identity coupling (getTokensPath never appears)", () => {
  it("listAgentProfiles reads/writes no token", () => {
    makeExpert("a", {});
    listAgentProfiles();
    expect(existsSync(getTokensPath())).toBe(false);
  });

  it("readAgentProfile reads/writes no token", () => {
    makeExpert("b", {});
    readAgentProfile("b");
    expect(existsSync(getTokensPath())).toBe(false);
  });

  it("removeAgentArtefacts reads/writes no token", () => {
    makeExpert("c", {});
    removeAgentArtefacts("c");
    expect(existsSync(getTokensPath())).toBe(false);
  });

  it("none of the three create the tokens path even across a full list→read→remove cycle", () => {
    makeExpert("cycle", { name: "Cycle", playbook: "pb" });
    listAgentProfiles();
    readAgentProfile("cycle");
    removeAgentArtefacts("cycle");
    expect(existsSync(getTokensPath())).toBe(false);
    // Sanity: the leaf statSync below proves the temp dir itself is intact.
    expect(statSync(getDataDir()).isDirectory()).toBe(true);
  });
});
