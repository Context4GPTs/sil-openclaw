/**
 * INTEGRATION — slice P: the plugin describes itself HONESTLY.
 *
 * ClawHub's skillspector sub-scan returned CRITICAL / DO_NOT_INSTALL on 0.4.5
 * with 12 issues, NONE of them the exec. Those issues are places where a shipped
 * surface contradicts itself or the code: a tool description that says "never
 * updates anything itself" while the tool chmods, a README that promises
 * "offline" for a flow that calls sil-api with a stored token, a shopping skill
 * that tells the agent to widen its own trust, reference frontmatter that
 * presents a progressive-disclosure page as independently activatable, and a
 * 987-word `packagingNote` no installer can read.
 *
 * These are not scanner noise. An agent picks a tool by its description; a user
 * authorizes by the README. A description that contradicts the tool mis-routes;
 * a trust claim that contradicts the rest of the document mis-sells.
 *
 * VACUITY DISCIPLINE (`[[vacuity-proof-silence-and-name-assertions]]`): every
 * retraction below is paired with a positive pin, because a guard that only
 * greps for a REMOVED string passes on an empty file. Every file this reads is
 * first asserted to exist, parse, and be non-trivially long.
 *
 * Card: clear-the-clawhub-suspicious-flag-review-findings (slice P — B1, B2,
 * B4/C5, D6, D7, D8, F10, and the stale README found during discovery).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const BUNDLE = join(REPO_ROOT, "sil-shopping");

const README = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
const MANIFEST = JSON.parse(
  readFileSync(join(REPO_ROOT, "openclaw.plugin.json"), "utf8"),
) as {
  contracts: { tools: string[] };
  security: Record<string, unknown>;
};

/** Every markdown file in the shipped bundle, relative to sil-shopping/. */
function bundleFiles(dir = BUNDLE): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...bundleFiles(abs));
    else if (entry.endsWith(".md")) out.push(relative(BUNDLE, abs).split(sep).join("/"));
  }
  return out.sort();
}

function read(rel: string): string {
  return readFileSync(join(BUNDLE, rel), "utf8");
}

interface Frontmatter {
  name: string;
  description: string;
  body: string;
}

function frontmatter(rel: string): Frontmatter {
  const raw = read(rel);
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${rel}: no parseable --- frontmatter block`);
  const block = m[1]!;
  const name = /^name:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? "";
  // description may be plain, single-quoted, or double-quoted, and may wrap.
  const descRaw = /^description:\s*([\s\S]*?)(?=\n[a-zA-Z_]+:|\s*$)/m.exec(block)?.[1] ?? "";
  const description = descRaw
    .trim()
    .replace(/^'([\s\S]*)'$/, "$1")
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return { name, description, body: m[2]! };
}

/** Sentences of a document, split on terminal punctuation. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Blank-line-delimited paragraphs. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const SKILL = "SKILL.md";
const REFERENCES = () => bundleFiles().filter((f) => f !== SKILL);

// ---------------------------------------------------------------------------
// Guard-of-the-guards: everything below reads real, non-trivial files.
// ---------------------------------------------------------------------------

describe("corpus sanity — no assertion below can pass on an empty file", () => {
  it("the bundle holds SKILL.md plus reference/example pages, all non-trivial", () => {
    const files = bundleFiles();
    expect(files).toContain(SKILL);
    expect(files.length).toBeGreaterThan(4);
    for (const f of files) {
      expect(read(f).length, `${f} is suspiciously short`).toBeGreaterThan(400);
    }
  });

  it("every bundle page has parseable frontmatter with a non-empty description", () => {
    for (const f of bundleFiles()) {
      const fm = frontmatter(f);
      expect(fm.name, `${f}: empty frontmatter name`).not.toBe("");
      expect(fm.description.length, `${f}: empty frontmatter description`).toBeGreaterThan(40);
    }
  });

  it("README and manifest are real", () => {
    expect(README.length).toBeGreaterThan(4000);
    expect(MANIFEST.contracts.tools.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// B2 + discovery finding — the README's trust claim and its stale tool table
// ---------------------------------------------------------------------------

describe("B2 — README: 'offline' is scoped to creation and local storage", () => {
  it("no sentence claims that RUNNING or SHOPPING with the shopper is offline", () => {
    const offending = sentences(README)
      .filter((s) => /\boffline\b/i.test(s))
      .filter((s) => /\brunning\b|\bshopping\b|\bshops?\b/i.test(s));
    expect(
      offending,
      "an 'offline' claim still attaches to running/shopping the shopper",
    ).toEqual([]);
  });

  it("the retracted 'creating and running … is local and offline' claim is gone", () => {
    expect(README).not.toMatch(/creating and running[^.]*offline/i);
  });

  it("'offline' / 'no sign-in' is stated of shopper CREATION, positively", () => {
    // Positive half: the differentiator is scoped, not retracted.
    const offlineSentences = sentences(README).filter((s) => /\boffline\b/i.test(s));
    expect(offlineSentences.length, "'offline' vanished from the README entirely").toBeGreaterThan(
      0,
    );
    expect(
      offlineSentences.some((s) => /creat|set(ting)? up|setup/i.test(s)),
      "no 'offline' sentence scopes the claim to creating/setting up the shopper",
    ).toBe(true);
  });

  it("the same passage says shopping uses the registered sil identity over the network", () => {
    const offlinePara = paragraphs(README).filter((p) => /\boffline\b/i.test(p));
    expect(offlinePara.length).toBeGreaterThan(0);
    expect(
      offlinePara.some(
        (p) =>
          /sil identity|sil account|registered|session token|sil-api/i.test(p) &&
          /network|online|server|internet|sil-api/i.test(p),
      ),
      "no 'offline' paragraph states that shopping goes over the network with the sil identity",
    ).toBe(true);
  });

  it("the same passage says niche research reads the public web", () => {
    const offlinePara = paragraphs(README).filter((p) => /\boffline\b/i.test(p));
    expect(
      offlinePara.some((p) => /public (web|sources|internet)|the open web/i.test(p)),
      "no 'offline' paragraph states that niche research reads the public web",
    ).toBe(true);
  });
});

describe("README tool table — documents the tools that actually ship", () => {
  /** Tool names named in a markdown table row (`| \`sil_x\` | … |`). */
  function tableTools(): string[] {
    const names = new Set<string>();
    for (const line of README.split("\n")) {
      if (!/^\s*\|\s*`sil_[a-z_]+`/.test(line)) continue;
      const m = /`(sil_[a-z_]+)`/.exec(line);
      if (m) names.add(m[1]!);
    }
    return [...names].sort();
  }

  it("documents exactly the manifest's contracts.tools set — no more, no fewer", () => {
    expect(tableTools()).toEqual([...MANIFEST.contracts.tools].sort());
  });

  it("names no deleted artefact", () => {
    const dead = ["profile.json", "domain_spec.md", "intent_spec.md", "playbook.md"];
    const found = dead.filter((d) => README.includes(d));
    expect(found, "README still documents artefacts the store no longer writes").toEqual([]);
  });

  it("still describes the frontmatter-as-truth artefacts that DO ship (positive half)", () => {
    expect(README).toMatch(/user_spec\.md/);
    expect(README).toMatch(/\$SIL_DATA_DIR/);
  });
});

// ---------------------------------------------------------------------------
// D6 — the sil-shopping activation boundary (both halves, roster gone)
// ---------------------------------------------------------------------------

describe("D6 — sil-shopping description states BOTH halves of the activation boundary", () => {
  const desc = () => frontmatter(SKILL).description;

  it("fires on an actionable purchase request — with no mention of sil required", () => {
    const d = desc();
    // The README's first-run promise is "find me a mechanical keyboard under
    // $100" with no mention of sil (README "First run"). The description must
    // not gate activation on naming sil.
    expect(d, "activation is still gated on explicitly asking for sil").not.toMatch(
      /explicitly asks? to shop with sil/i,
    );
    expect(
      /no mention of sil|without mentioning sil|even (when|if) sil is(n't| not) mentioned|whether or not sil is mentioned|never has to (name|mention) sil|sil need not be (named|mentioned)/i.test(
        d,
      ),
      "the description does not state that sil need not be mentioned",
    ).toBe(true);
    // The actionable verbs the boundary is drawn on.
    for (const verb of [/\bfind\b/i, /\bcompar/i, /\bbuy\b/i]) {
      expect(verb.test(d), `activation verb missing from the description: ${verb}`).toBe(true);
    }
  });

  it("states the negative half — talk about a product with no buying intent does not fire it", () => {
    const d = desc();
    expect(
      /\b(not|never|no)\b[^.]*\b(fire|load|activate|trigger|engage)/i.test(d) ||
        /does not (fire|load|activate|trigger)/i.test(d),
      "the description never says what does NOT activate it",
    ).toBe(true);
    expect(
      /no (buying|purchase|buy) intent|not (buying|shopping)|without buying intent|idle (talk|chat)|talk(ing)? about/i.test(
        d,
      ),
      "the description does not name the no-buying-intent case it declines",
    ).toBe(true);
  });

  it("the tool roster is gone — the description is a boundary, not a manifest restatement", () => {
    const d = desc();
    const named = MANIFEST.contracts.tools.filter((t) => d.includes(t));
    expect(named, `the description still lists a tool roster: ${named.join(", ")}`).toHaveLength(0);
    expect(d).not.toMatch(/\bDrives sil_/);
  });

  it("README's 'loads on first commerce intent' promise is reconciled, not contradicted", () => {
    expect(README).toMatch(/first commerce intent|first .{0,20}shopping intent/i);
  });
});

// ---------------------------------------------------------------------------
// B4 + C5 — the skill never instructs the AGENT to widen its own trust
// ---------------------------------------------------------------------------

/** The trust surfaces a shopping skill must never act on. */
const TRUST_SURFACES = /plugins\.allow|tools\.alsoAllow/;
/** The admission helper, by every name it goes by. */
const ADMISSION_HELPER = /allowlist-openclaw|sil-openclaw-allowlist|openclaw:allowlist/;

describe("B4/C5 — admission is an operator act; the skill reports, it does not mutate", () => {
  it("the bundle names the admission helper as a runnable command NOWHERE", () => {
    // C5 (0.96, privilege escalation) + B4: a shopping skill that hands the
    // agent a command widening `plugins.allow` / `tools.alsoAllow` turns a
    // low-risk commerce workflow into an escalation path. The skill's job ends
    // at REPORTING. This also removes SKILL.md:43's relative `node scripts/…`
    // hop, which cannot resolve from a published skill symlink anyway
    // (`[[plugin-skill-prose-cannot-reach-its-own-tree]]`).
    const offenders: string[] = [];
    for (const f of bundleFiles()) {
      read(f)
        .split("\n")
        .forEach((line, i) => {
          if (ADMISSION_HELPER.test(line)) offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 140)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("no paragraph pairs a trust surface with an imperative the AGENT would follow", () => {
    // A trust surface may be DESCRIBED (why tools are missing). It may not be
    // acted on. The one escape is an instruction explicitly addressed to the
    // user — "tell the user to run …" — which is exactly the ruling.
    const offenders: string[] = [];
    for (const f of bundleFiles()) {
      for (const para of paragraphs(read(f))) {
        if (!TRUST_SURFACES.test(para)) continue;
        if (!/\b(run|execute|invoke)\b/i.test(para)) continue;
        if (/\bthe user\b/i.test(para)) continue;
        offenders.push(`${f}: ${para.replace(/\s+/g, " ").slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      "a trust-surface paragraph still carries an imperative with the agent as its subject",
    ).toEqual([]);
  });

  it("SKILL.md instructs the agent to REPORT and relay sil_doctor's suggestion TO THE USER", () => {
    // Positive half — without it, deleting the whole session-start section
    // would satisfy every negative above.
    const skill = read(SKILL);
    expect(skill, "the sil_doctor wiring finding is no longer referenced").toMatch(
      /tools_not_admitted|suggestedAction/,
    );
    expect(
      /(tell|ask|relay|report|hand|surface|give|pass)[^.\n]{0,140}\bthe user\b/i.test(skill),
      "SKILL.md never routes the fix to the user",
    ).toBe(true);
  });

  it("SKILL.md still names sil_doctor as the diagnosis — reporting is not silence", () => {
    expect(read(SKILL)).toMatch(/sil_doctor/);
  });
});

// ---------------------------------------------------------------------------
// D7 + D8 — reference frontmatter is a load hint, not an activation advert
// ---------------------------------------------------------------------------

describe("D7/D8 — reference + example descriptions read as progressive disclosure", () => {
  it("every non-SKILL page opens 'Loaded by the sil-shopping skill …'", () => {
    for (const f of REFERENCES()) {
      const d = frontmatter(f).description;
      expect(d, `${f}: description does not open with the load hint`).toMatch(
        /^Loaded by the sil-shopping skill\b/i,
      );
    }
  });

  it("no page presents itself as independently activatable ('Use when …')", () => {
    for (const f of REFERENCES()) {
      const d = frontmatter(f).description;
      expect(d, `${f}: still advertises its own activation`).not.toMatch(/\buse when\b/i);
      expect(d, `${f}: still advertises its own activation`).not.toMatch(
        /^\s*(load|activate) (when|if)\b/i,
      );
    }
  });

  it("agent_creation_engine.md names the endorsement gate", () => {
    const d = frontmatter("references/agent_creation_engine.md").description;
    expect(d, "the creation reference never states the endorsement gate").toMatch(/endors/i);
    expect(
      /nothing is (created|written|configured|persisted)|creates? nothing|until (the user|you) (explicitly )?endorse/i.test(
        d,
      ),
      "the endorsement gate is named but not stated as a precondition",
    ).toBe(true);
  });

  it("method_and_prds.md scopes its verbs to the shopper's own artefacts", () => {
    const d = frontmatter("references/method_and_prds.md").description;
    expect(d, "the store scope is not named").toMatch(/\$SIL_DATA_DIR\/shopper\//);
    expect(d, "the no-network fact is not stated").toMatch(/no network|never .{0,20}network|offline/i);
    expect(d, "the confirm-before-remove fact is not stated").toMatch(/confirm/i);
  });
});

// ---------------------------------------------------------------------------
// F10 — the manifest's security disclosure is readable by a human
// ---------------------------------------------------------------------------

describe("F10 — security.packagingNote is a bounded, person-readable disclosure", () => {
  const note = () => MANIFEST.security["packagingNote"] as string;

  it("fits a bounded budget a prospective installer will actually read", () => {
    // 0.4.5 shipped 6330 chars / 987 words — a disclosure surface no human reads,
    // and the length itself is what drew skillspector's three session-persistence
    // quotes. The four questions below fit comfortably inside this budget.
    expect(note().length, "packagingNote is still too long to be read").toBeLessThanOrEqual(1500);
  });

  it("is not merely emptied — it still answers the four questions", () => {
    const n = note();
    expect(n.length, "packagingNote was gutted rather than rewritten").toBeGreaterThan(300);
    // 1. what leaves the machine, and to whom
    expect(n, "does not say what leaves the machine / to whom").toMatch(
      /sil-api|sil\.4gpts|clawhub|network|sends?|calls?/i,
    );
    // 2. what is stored on disk, and where
    expect(n, "does not say what is stored on disk and where").toMatch(/\$SIL_DATA_DIR/);
    expect(n, "does not name the credentials on disk").toMatch(/token/i);
    // 3. what code executes
    expect(n, "does not say what code executes").toMatch(/dist|register\(\)|execute\(\)|tool/i);
    // 4. what the plugin never does
    expect(n, "does not state what the plugin never does").toMatch(/\bnever\b|\bno\b/i);
  });

  it("every fact dropped from the long note is still carried by a machine-readable field", () => {
    const s = MANIFEST.security;
    expect(Array.isArray(s["networkEndpoints"]) && (s["networkEndpoints"] as string[]).length).
      toBeTruthy();
    expect(
      Array.isArray(s["filesystemScope"]) && (s["filesystemScope"] as string[]).length,
    ).toBeTruthy();
    expect(
      Array.isArray(s["credentialsOnDisk"]) && (s["credentialsOnDisk"] as string[]).length,
    ).toBeTruthy();
    for (const key of ["noNativeModules", "noChildProcess", "noInstallScripts"]) {
      expect(typeof s[key], `security.${key} must stay a declared boolean`).toBe("boolean");
    }
    // The endpoints the note used to enumerate in prose are still declared.
    const endpoints = (s["networkEndpoints"] as string[]).join(" ");
    for (const host of ["clawhub.ai", "sil-api.4gpts.com", "sil.4gpts.com"]) {
      expect(endpoints, `networkEndpoints dropped ${host}`).toContain(host);
    }
  });

  it("filesystemScope still names the store root it scopes", () => {
    const scope = (MANIFEST.security["filesystemScope"] as string[]).join(" ");
    expect(scope).toMatch(/\$SIL_DATA_DIR/);
    expect(scope).toMatch(/shopper/);
  });
});
