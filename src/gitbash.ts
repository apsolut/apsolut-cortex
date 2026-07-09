/**
 * Git Bash detection for Windows.
 *
 * Claude Code runs command-type hooks through Git Bash. Its default detection
 * resolves bash relative to git as `<gitroot>\usr\bin\bash.exe` — the REAL
 * bash binary. The stubs in `<gitroot>\bin\bash.exe` are ~47 KB wrapper
 * executables that merely re-exec `..\usr\bin\bash.exe`; on a partial / MinGit
 * install (usr\ tree stripped out) they exist but fail identically with
 * "Skipping command-line '...\usr\bin\bash.exe' (not found)". So `usr\bin\
 * bash.exe` is the single source of truth: if it's absent there is no usable
 * bash, and pointing `CLAUDE_CODE_GIT_BASH_PATH` at the `bin\` wrapper does
 * NOT help. The remedy is a full Git for Windows (or a real bash elsewhere).
 *
 * The hook that would report this can't itself launch, so detection lives in
 * the CLI (`init` prints it proactively, `doctor` on demand). The layout core
 * is a pure function so both git layouts can be unit-tested without a real
 * install; `doctor` additionally *runs* the resolved bash to catch broken
 * wrappers that a file-existence check would miss.
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { win32 as winPath } from "path";

export const FULL_GIT_URL = "https://git-scm.com/download/win";
export const FULL_GIT_WINGET = "winget install --id Git.Git -e --source winget";

export type GitBashDiagnosis =
  | { status: "not-windows" }
  | { status: "configured"; path: string }
  | { status: "configured-missing"; path: string }
  | { status: "ok"; path: string }
  | { status: "partial-git"; gitRoot: string }
  | { status: "no-git" };

export interface GitBashProbe {
  /** process.platform === "win32" */
  isWindows: boolean;
  /** CLAUDE_CODE_GIT_BASH_PATH from the process environment, if any. */
  envPath: string | undefined;
  /** CLAUDE_CODE_GIT_BASH_PATH from ~/.claude/settings.json `env`, if any. */
  settingsPath: string | undefined;
  /** Resolved Git for Windows install root, or undefined if git wasn't found. */
  gitRoot: string | undefined;
  /** File-existence probe (injected so tests can model either layout). */
  exists: (p: string) => boolean;
}

/** The real bash binary for a Git for Windows root (the only one that works). */
export function realBashPath(gitRoot: string): string {
  return winPath.join(gitRoot, "usr", "bin", "bash.exe");
}

/**
 * Pure diagnosis over file layout. No I/O beyond the injected `exists`. When a
 * `CLAUDE_CODE_GIT_BASH_PATH` override is set we only check that it exists here;
 * `doctor` runs it to confirm it actually launches.
 */
export function diagnoseGitBash(probe: GitBashProbe): GitBashDiagnosis {
  if (!probe.isWindows) return { status: "not-windows" };

  const configured = probe.envPath ?? probe.settingsPath;
  if (configured) {
    return probe.exists(configured)
      ? { status: "configured", path: configured }
      : { status: "configured-missing", path: configured };
  }

  if (!probe.gitRoot) return { status: "no-git" };

  // Only usr\bin\bash.exe is a real bash. bin\bash.exe is a wrapper to it and
  // is worthless when it's absent, so we never recommend the wrapper.
  return probe.exists(realBashPath(probe.gitRoot))
    ? { status: "ok", path: realBashPath(probe.gitRoot) }
    : { status: "partial-git", gitRoot: probe.gitRoot };
}

/**
 * Locate the Git for Windows install root by asking `where git` and walking up
 * out of the `cmd\` or `bin\` subdir that holds git.exe. Returns undefined if
 * git isn't on PATH or the lookup fails.
 */
export function findGitRoot(): string | undefined {
  try {
    const out = execFileSync("where", ["git"], { encoding: "utf-8" });
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (!first) return undefined;
    // e.g. C:\Program Files\Git\cmd\git.exe → C:\Program Files\Git
    return winPath.dirname(winPath.dirname(first));
  } catch {
    return undefined;
  }
}

/**
 * Actually launch a bash and confirm it runs. This is the reliable check: a
 * broken wrapper (partial Git) exists on disk but fails to exec, which a
 * file-existence probe can't tell apart from a working bash. Returns false on
 * any failure (missing, non-zero exit, wrapper error).
 */
export function bashRuns(bashPath: string): boolean {
  try {
    execFileSync(bashPath, ["-c", "exit 0"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Assemble a real probe from the current environment. `settingsEnvPath` is the
 * caller-read value of `env.CLAUDE_CODE_GIT_BASH_PATH` from settings.json.
 */
export function gatherGitBashProbe(settingsEnvPath?: string): GitBashProbe {
  const isWindows = process.platform === "win32";
  return {
    isWindows,
    envPath: process.env.CLAUDE_CODE_GIT_BASH_PATH,
    settingsPath: settingsEnvPath,
    gitRoot: isWindows ? findGitRoot() : undefined,
    exists: existsSync,
  };
}

/**
 * Render the instruct-only remedy for a diagnosis, or null when nothing is
 * wrong (or nothing can be said). Shared by `init` (printed proactively) and
 * `doctor`. `paint` optionally colorizes the leading marker.
 */
export function renderGitBashWarning(
  diag: GitBashDiagnosis,
  paint: (s: string) => string = (s) => s,
): string | null {
  const installFullGit = [
    "  Claude Code needs a working Git Bash to run hooks. Install the full",
    `  Git for Windows — ${FULL_GIT_URL}`,
    `  or:  ${FULL_GIT_WINGET}`,
    "  then fully quit and relaunch Claude Code. (If you already have a real",
    "  bash elsewhere, set CLAUDE_CODE_GIT_BASH_PATH to that bash.exe instead.)",
  ];

  switch (diag.status) {
    case "partial-git":
      return [
        paint("⚠ Windows: your Git install has no bash — hooks can't run."),
        `  ${realBashPath(diag.gitRoot)} is missing`,
        "  (a partial / MinGit install: the bin\\bash.exe stub is only a wrapper",
        "  to that missing binary, so pointing at it does not help).",
        ...installFullGit,
      ].join("\n");

    case "configured-missing":
      return [
        paint("⚠ Windows: CLAUDE_CODE_GIT_BASH_PATH points at a missing file."),
        `  ${diag.path}`,
        "  Claude Code can't launch hooks. Fix the path (or unset it) in your",
        "  environment or ~/.claude/settings.json, then relaunch Claude Code.",
      ].join("\n");

    default:
      // not-windows | configured | ok | no-git — nothing actionable to warn.
      // (`doctor` separately runs `configured`/`ok` to catch broken wrappers.)
      return null;
  }
}
