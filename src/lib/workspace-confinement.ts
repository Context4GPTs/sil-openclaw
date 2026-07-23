/**
 * `workspace` is UNTRUSTED INPUT.
 *
 * The creation spec is model-authored prose — the creation reference templates
 * `~/.openclaw/workspace-<id>`, and `~` is never expanded anywhere in this stack
 * — so the string that lands here has been through a language model, not a file
 * picker. Creation both CREATES that directory and, on a failure, REMOVES what
 * it created there. A path that can be influenced is therefore a path that can
 * be deleted, which is exactly what ClawHub E9 flagged.
 *
 * This module decides; it never acts. It opens nothing, creates nothing, and
 * never throws — a malformed input is a verdict, because a thrown exception
 * inside a tool is an outcome the taxonomy cannot name.
 *
 * Every rejection carries the RULE it broke, not just the field. A user who
 * genuinely wanted an external drive has to be able to tell "sil won't let me
 * put it there" from "sil is broken", and only the rule text says which.
 */

import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

import { getDataDir } from "./credentials.js";

export interface WorkspaceRejection {
  field: "workspace";
  /** The constraint broken, in one sentence. Constant text — never interpolated,
   * so relaying a rejection onward cannot disclose a path the caller never saw. */
  rule: string;
  /** What was wrong with THIS input. May name the caller's own path. */
  cause: string;
}

export type WorkspaceVerdict =
  | { ok: true; path: string }
  | { ok: false; rejection: WorkspaceRejection };

const RULES = {
  blank: "The workspace must be a non-empty string naming a directory.",
  tilde:
    "The workspace must not contain \"~\". A tilde is expanded by your shell, not"
    + " by sil, so it would be taken literally and create a directory named \"~\".",
  absolute:
    "The workspace must be an absolute path. A relative path would resolve"
    + " against whatever directory the gateway happens to be running in.",
  normalised:
    "The workspace must already be normalised — no \".\" or \"..\" segments, so the"
    + " directory sil creates is plainly the one you asked for.",
  dataDir:
    "The workspace must sit outside sil's own data directory, which holds your"
    + " credentials and everything the shopper has learned.",
  isHome:
    "The workspace must be a directory of its own, not your home directory"
    + " itself.",
  outsideHome:
    "The workspace must sit inside your home directory, because a failed"
    + " creation removes what it made and sil will only ever do that under home.",
  symlink:
    "No part of the workspace path may be a symbolic link, which could point the"
    + " directory sil creates and later removes at another tree entirely.",
} as const;

function reject(rule: string, cause: string): WorkspaceVerdict {
  return { ok: false, rejection: { field: "workspace", rule, cause } };
}

/** True when `child` is strictly below `parent` (never equal to it). */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Walk `home → workspace` one component at a time, looking for a link hop.
 *
 * Only the segments BELOW home are walked: home's own ancestors are the
 * operator's business (on many systems `/tmp` or `/home` is itself a link), and
 * the containment sil promises starts at home. The walk stops at the first
 * component that does not exist — nothing can exist below it.
 */
function hasSymlinkComponent(homeDir: string, path: string): boolean {
  let current = homeDir;
  for (const segment of relative(homeDir, path).split(sep)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function confineWorkspace(
  raw: unknown,
  opts?: { homeDir?: string; dataDir?: string },
): WorkspaceVerdict {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return reject(RULES.blank, `the workspace given was ${JSON.stringify(raw)}.`);
  }
  if (raw.includes("~")) {
    return reject(RULES.tilde, `the workspace ${JSON.stringify(raw)} contains "~".`);
  }
  // One trailing separator is a typing habit, not a different directory.
  const path = raw.length > 1 ? raw.replace(/[\\/]+$/, "") : raw;
  if (!isAbsolute(path)) {
    return reject(RULES.absolute, `the workspace ${JSON.stringify(raw)} is relative.`);
  }
  if (normalize(path) !== path) {
    return reject(
      RULES.normalised,
      `the workspace ${JSON.stringify(raw)} normalises to ${JSON.stringify(normalize(path))}.`,
    );
  }

  const homeDir = opts?.homeDir ?? homedir();
  const dataDir = opts?.dataDir ?? getDataDir();

  if (path === dataDir || isInside(dataDir, path)) {
    return reject(RULES.dataDir, "the workspace is inside sil's own data directory.");
  }
  if (path === homeDir) {
    return reject(RULES.isHome, "the workspace is the home directory itself.");
  }
  if (!isInside(homeDir, path)) {
    return reject(RULES.outsideHome, "the workspace is outside the home directory.");
  }
  if (hasSymlinkComponent(homeDir, path)) {
    return reject(RULES.symlink, "part of the workspace path is a symbolic link.");
  }

  return { ok: true, path };
}
