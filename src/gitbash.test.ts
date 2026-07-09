/**
 * Tests for the Windows Git Bash diagnosis. The real failure (a partial /
 * MinGit install where usr\bin\bash.exe is absent) can't be reproduced on a
 * machine with full Git, so `diagnoseGitBash` is a pure function over an
 * injectable file-existence probe — both layouts are modelled with mocked
 * paths. `bin\bash.exe` is a wrapper to usr\bin\bash.exe and is never
 * recommended, since it fails identically when the real binary is missing.
 */

import { describe, test, expect } from "bun:test";
import { win32 as winPath } from "path";
import {
  diagnoseGitBash,
  renderGitBashWarning,
  realBashPath,
  bashRuns,
  FULL_GIT_URL,
  type GitBashProbe,
} from "./gitbash.js";

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

  test("partial/MinGit with only the bin\\bash.exe wrapper is partial-git, NOT ok", () => {
    // The wrapper exists but forwards to the missing usr\bin\bash.exe — useless.
    const d = diagnoseGitBash(probe({ present: [BIN] }));
    expect(d).toEqual({ status: "partial-git", gitRoot: GIT_ROOT });
  });

  test("no bash at all is also partial-git", () => {
    const d = diagnoseGitBash(probe({ present: [] }));
    expect(d).toEqual({ status: "partial-git", gitRoot: GIT_ROOT });
  });

  test("git not found reports no-git", () => {
    const d = diagnoseGitBash(probe({ gitRoot: undefined, present: [] }));
    expect(d).toEqual({ status: "no-git" });
  });

  test("explicit env override that exists → configured (verified by running in doctor)", () => {
    const custom = "D:\\tools\\bash.exe";
    const d = diagnoseGitBash(probe({ envPath: custom, present: [BIN, custom] }));
    expect(d).toEqual({ status: "configured", path: custom });
  });

  test("settings-file override is honoured when env is unset", () => {
    const custom = "D:\\tools\\bash.exe";
    const d = diagnoseGitBash(probe({ settingsPath: custom, present: [custom] }));
    expect(d).toEqual({ status: "configured", path: custom });
  });

  test("override pointing at a missing file is flagged", () => {
    const custom = "D:\\gone\\bash.exe";
    const d = diagnoseGitBash(probe({ envPath: custom, present: [BIN] }));
    expect(d).toEqual({ status: "configured-missing", path: custom });
  });

  test("env override takes precedence over settings override", () => {
    const fromEnv = "D:\\env\\bash.exe";
    const fromSettings = "D:\\settings\\bash.exe";
    const d = diagnoseGitBash(
      probe({ envPath: fromEnv, settingsPath: fromSettings, present: [fromEnv, fromSettings] }),
    );
    expect(d).toEqual({ status: "configured", path: fromEnv });
  });
});

describe("realBashPath", () => {
  test("points at usr\\bin\\bash.exe, the only real binary", () => {
    expect(realBashPath(GIT_ROOT)).toBe(USR_BIN);
  });
});

describe("renderGitBashWarning", () => {
  test("partial-git tells you to install full Git and does NOT recommend bin\\bash.exe", () => {
    const msg = renderGitBashWarning({ status: "partial-git", gitRoot: GIT_ROOT })!;
    expect(msg).toContain(FULL_GIT_URL);
    expect(msg).toContain(USR_BIN); // names the missing real binary
    // Must not tell the user to point CLAUDE_CODE_GIT_BASH_PATH at the wrapper.
    expect(msg).not.toContain(`"${BIN}"`);
  });

  test("healthy / non-actionable statuses produce no warning", () => {
    expect(renderGitBashWarning({ status: "ok", path: USR_BIN })).toBeNull();
    expect(renderGitBashWarning({ status: "not-windows" })).toBeNull();
    expect(renderGitBashWarning({ status: "configured", path: USR_BIN })).toBeNull();
    expect(renderGitBashWarning({ status: "no-git" })).toBeNull();
  });

  test("configured-missing warns about the missing file", () => {
    expect(renderGitBashWarning({ status: "configured-missing", path: BIN })).toContain("missing");
  });

  test("paint callback colorizes the marker", () => {
    const msg = renderGitBashWarning({ status: "partial-git", gitRoot: GIT_ROOT }, (s) => `<${s}>`);
    expect(msg!.startsWith("<⚠")).toBe(true);
  });
});

describe("bashRuns", () => {
  test("returns false for a path that isn't an executable bash", () => {
    // A nonexistent path can't run — must degrade to false, never throw.
    expect(bashRuns("C:\\definitely\\not\\here\\bash.exe")).toBe(false);
  });
});
