/**
 * Git Bash detection for Windows.
 *
 * Claude Code runs command-type hooks through Git Bash. Its default detection
 * resolves bash relative to git as `<gitroot>\usr\bin\bash.exe`. On a slim /
 * MinGit-style install only `<gitroot>\bin\bash.exe` exists, so CC can't launch
 * bash and every hook silently no-ops with a non-blocking error. The remedy is
 * to point `CLAUDE_CODE_GIT_BASH_PATH` at a bash.exe that actually exists.
 *
 * The hook that would report this can't itself launch, so detection lives here
 * in the CLI (`init` prints it proactively, `doctor` on demand). The core is a
 * pure function so both git layouts can be unit-tested without a real install.
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { win32 as winPath } from "path";

export type GitBashDiagnosis =
  | { status: "not-windows" }
  | { status: "already-set"; path: string }
  | { status: "already-set-missing"; path: string }
  | { status: "ok"; path: string }
  | { status: "slim"; recommended: string }
  | { status: "no-bash"; gitRoot: string }
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

/**
 * Pure diagnosis. Given a fully-resolved probe, decide what (if anything) is
 * wrong with Git Bash resolution. No I/O beyond the injected `exists`.
 */
export function diagnoseGitBash(probe: GitBashProbe): GitBashDiagnosis {
  if (!probe.isWindows) return { status: "not-windows" };

  // An explicit override wins — but only if it actually points at a real file.
  const configured = probe.envPath ?? probe.settingsPath;
  if (configured) {
    return probe.exists(configured)
      ? { status: "already-set", path: configured }
      : { status: "already-set-missing", path: configured };
  }

  if (!probe.gitRoot) return { status: "no-git" };

  const usrBin = winPath.join(probe.gitRoot, "usr", "bin", "bash.exe");
  const bin = winPath.join(probe.gitRoot, "bin", "bash.exe");

  // usr\bin\bash.exe is what CC's default resolution expects — if it's there,
  // hooks launch fine.
  if (probe.exists(usrBin)) return { status: "ok", path: usrBin };
  // Slim layout: only bin\bash.exe exists. It works on full installs too, so
  // it's a safe universal recommendation.
  if (probe.exists(bin)) return { status: "slim", recommended: bin };
  return { status: "no-bash", gitRoot: probe.gitRoot };
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
  const line = (env: string) =>
    `    "env": { "CLAUDE_CODE_GIT_BASH_PATH": ${JSON.stringify(env)} }`;

  switch (diag.status) {
    case "slim":
      return [
        paint("⚠ Windows: Claude Code can't launch your hooks."),
        "  Your Git install lacks usr\\bin\\bash.exe (slim/MinGit layout),",
        "  so hooks silently never run. Add this to ~/.claude/settings.json:",
        "",
        line(diag.recommended),
        "",
        "  Then restart Claude Code.",
      ].join("\n");

    case "no-bash":
      return [
        paint("⚠ Windows: no bash.exe found under your Git install."),
        `  Looked under ${diag.gitRoot} but found neither usr\\bin\\bash.exe`,
        "  nor bin\\bash.exe. Claude Code can't launch hooks without Git Bash.",
        "  Install full Git for Windows, or point at a bash.exe you have:",
        "",
        line("C:\\path\\to\\bash.exe"),
        "",
        "  Then restart Claude Code.",
      ].join("\n");

    case "already-set-missing":
      return [
        paint("⚠ Windows: CLAUDE_CODE_GIT_BASH_PATH points at a missing file."),
        `  ${diag.path}`,
        "  Claude Code can't launch hooks. Fix the path in your environment or",
        "  ~/.claude/settings.json, then restart Claude Code.",
      ].join("\n");

    default:
      // not-windows | already-set | ok | no-git — nothing actionable to warn.
      return null;
  }
}
