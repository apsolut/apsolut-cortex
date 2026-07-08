/**
 * Tests for the Windows Git Bash diagnosis. The real failure (slim/MinGit
 * layout where usr\bin\bash.exe is absent) can't be reproduced on a machine
 * with full Git, so `diagnoseGitBash` is a pure function over an injectable
 * file-existence probe — both layouts are modelled with mocked paths.
 */

import { describe, test, expect } from "bun:test";
import { win32 as winPath } from "path";
import { diagnoseGitBash, renderGitBashWarning, type GitBashProbe } from "./gitbash.js";

const GIT_ROOT = "C:\\Program Files\\Git";
const USR_BIN = winPath.join(GIT_ROOT, "usr", "bin", "bash.exe");
const BIN = winPath.join(GIT_ROOT, "bin", "bash.exe");

/** Build a probe whose `exists` returns true only for the listed paths. */
function probe(overrides: Partial<GitBashProbe> & { present?: string[] }): GitBashProbe {
  const present = new Set(overrides.present ?? []);
  return {
    isWindows: true,
    envPath: undefined,
    settingsPath: undefined,
    gitRoot: GIT_ROOT,
    exists: (p) => present.has(p),
    ...overrides,
  };
}

describe("diagnoseGitBash", () => {
  test("non-Windows short-circuits", () => {
    expect(diagnoseGitBash(probe({ isWindows: false }))).toEqual({ status: "not-windows" });
  });

  test("full install (usr\\bin\\bash.exe present) is ok", () => {
    const d = diagnoseGitBash(probe({ present: [USR_BIN, BIN] }));
    expect(d).toEqual({ status: "ok", path: USR_BIN });
  });

  test("slim layout (only bin\\bash.exe) recommends bin\\bash.exe", () => {
    const d = diagnoseGitBash(probe({ present: [BIN] }));
    expect(d).toEqual({ status: "slim", recommended: BIN });
  });

  test("no bash at all reports no-bash with the git root", () => {
    const d = diagnoseGitBash(probe({ present: [] }));
    expect(d).toEqual({ status: "no-bash", gitRoot: GIT_ROOT });
  });

  test("git not found reports no-git", () => {
    const d = diagnoseGitBash(probe({ gitRoot: undefined, present: [] }));
    expect(d).toEqual({ status: "no-git" });
  });

  test("explicit env override that exists wins over layout", () => {
    const custom = "D:\\tools\\bash.exe";
    // Slim layout on disk, but the override exists → already-set, no nag.
    const d = diagnoseGitBash(probe({ envPath: custom, present: [BIN, custom] }));
    expect(d).toEqual({ status: "already-set", path: custom });
  });

  test("settings-file override is honoured when env is unset", () => {
    const custom = "D:\\tools\\bash.exe";
    const d = diagnoseGitBash(probe({ settingsPath: custom, present: [custom] }));
    expect(d).toEqual({ status: "already-set", path: custom });
  });

  test("override pointing at a missing file is flagged", () => {
    const custom = "D:\\gone\\bash.exe";
    const d = diagnoseGitBash(probe({ envPath: custom, present: [BIN] }));
    expect(d).toEqual({ status: "already-set-missing", path: custom });
  });

  test("env override takes precedence over settings override", () => {
    const fromEnv = "D:\\env\\bash.exe";
    const fromSettings = "D:\\settings\\bash.exe";
    const d = diagnoseGitBash(
      probe({ envPath: fromEnv, settingsPath: fromSettings, present: [fromEnv, fromSettings] }),
    );
    expect(d).toEqual({ status: "already-set", path: fromEnv });
  });
});

describe("renderGitBashWarning", () => {
  test("slim warning includes a JSON-escaped, pasteable settings line", () => {
    const msg = renderGitBashWarning({ status: "slim", recommended: BIN });
    expect(msg).toContain("CLAUDE_CODE_GIT_BASH_PATH");
    // The path must be JSON-escaped (doubled backslashes) so it can be pasted.
    expect(msg).toContain(JSON.stringify(BIN));
    expect(msg).toContain("C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe");
  });

  test("healthy statuses produce no warning", () => {
    expect(renderGitBashWarning({ status: "ok", path: USR_BIN })).toBeNull();
    expect(renderGitBashWarning({ status: "not-windows" })).toBeNull();
    expect(renderGitBashWarning({ status: "already-set", path: BIN })).toBeNull();
    expect(renderGitBashWarning({ status: "no-git" })).toBeNull();
  });

  test("missing-override and no-bash statuses do warn", () => {
    expect(renderGitBashWarning({ status: "already-set-missing", path: BIN })).toContain("missing");
    const noBash = renderGitBashWarning({ status: "no-bash", gitRoot: GIT_ROOT })!;
    expect(noBash).toContain(GIT_ROOT);
    // The placeholder path must be JSON-escaped exactly once (two backslashes),
    // not double-escaped into four.
    expect(noBash).toContain("C:\\\\path\\\\to\\\\bash.exe");
    expect(noBash).not.toContain("C:\\\\\\\\path");
  });

  test("paint callback colorizes the marker", () => {
    const msg = renderGitBashWarning({ status: "slim", recommended: BIN }, (s) => `<${s}>`);
    expect(msg!.startsWith("<⚠")).toBe(true);
  });
});
