/**
 * Hook registration edits a file the user owns and other tools share. The
 * contract: our entries are replaced, nobody else's are touched, and a strip
 * leaves the file valid.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildHookEntries, writeHooks, stripHooks, isCortexEntry, findRegisteredHooks,
  ALL_HOOK_EVENTS,
} from "./hook-settings.js";

let dir: string;
let settings: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-hooks-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  settings = join(dir, ".claude", "settings.local.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function read(): any {
  return JSON.parse(readFileSync(settings, "utf-8"));
}

describe("buildHookEntries", () => {
  test("covers every event and marks capture hooks async", () => {
    const entries = buildHookEntries("apsolut-cortex");
    expect(Object.keys(entries).sort()).toEqual([...ALL_HOOK_EVENTS].sort());
    expect(entries.PostToolUse[0].hooks[0].async).toBe(true);
    expect(entries.Stop[0].hooks[0].async).toBe(true);
    // SessionStart and UserPromptSubmit return context; they must stay sync.
    expect(entries.SessionStart[0].hooks[0].async).toBeUndefined();
    expect(entries.UserPromptSubmit[0].hooks[0].async).toBeUndefined();
    expect(entries.PreCompact[0].hooks[0].asyncRewake).toBe(true);
  });

  test("PostToolUseFailure reuses the post-tool-use hook", () => {
    const entries = buildHookEntries("apsolut-cortex");
    expect(entries.PostToolUseFailure[0].hooks[0].command).toBe("apsolut-cortex hook:post-tool-use");
  });
});

describe("writeHooks", () => {
  test("creates the settings file and any missing directory", () => {
    const nested = join(dir, "fresh-project", ".claude", "settings.local.json");
    expect(writeHooks(nested, buildHookEntries("apsolut-cortex"))).toBe(ALL_HOOK_EVENTS.length);
    expect(existsSync(nested)).toBe(true);
    expect(JSON.parse(readFileSync(nested, "utf-8")).hooks.SessionStart[0].hooks[0].command)
      .toContain("apsolut-cortex");
  });

  test("is idempotent — re-running does not accumulate entries", () => {
    writeHooks(settings, buildHookEntries("apsolut-cortex"));
    writeHooks(settings, buildHookEntries("apsolut-cortex"));
    writeHooks(settings, buildHookEntries("apsolut-cortex"));
    expect(read().hooks.PostToolUse.length).toBe(1);
  });

  test("replaces an outdated cortex command instead of duplicating it", () => {
    writeHooks(settings, { Stop: [{ matcher: "", hooks: [{ type: "command", command: "apsolut-cortex hook:old-name" }] }] });
    writeHooks(settings, buildHookEntries("apsolut-cortex"));
    const stop = read().hooks.Stop;
    expect(stop.length).toBe(1);
    expect(stop[0].hooks[0].command).toBe("apsolut-cortex hook:stop");
  });

  test("leaves other tools' hooks alone", () => {
    writeFileSync(settings, JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: "", hooks: [{ type: "command", command: "some-other-tool audit" }] }],
      },
      permissions: { allow: ["Bash(ls)"] },
    }));
    writeHooks(settings, buildHookEntries("apsolut-cortex"));

    const after = read();
    const commands = after.hooks.PostToolUse.map((e: any) => e.hooks[0].command);
    expect(commands).toContain("some-other-tool audit");
    expect(commands).toContain("apsolut-cortex hook:post-tool-use");
    expect(after.permissions.allow).toEqual(["Bash(ls)"]);
  });

  test("survives a corrupt settings file rather than throwing", () => {
    writeHooks(settings, buildHookEntries("apsolut-cortex"));
    writeFileSync(settings, "{ not json");
    expect(writeHooks(settings, buildHookEntries("apsolut-cortex"))).toBe(ALL_HOOK_EVENTS.length);
    expect(read().hooks.SessionEnd.length).toBe(1);
  });
});

describe("stripHooks", () => {
  test("removes only cortex entries and keeps the rest", () => {
    writeHooks(settings, buildHookEntries("apsolut-cortex"));
    const current = read();
    current.hooks.PostToolUse.unshift({ matcher: "", hooks: [{ type: "command", command: "some-other-tool audit" }] });
    writeFileSync(settings, JSON.stringify(current));

    const removed = stripHooks(settings);
    expect(removed).toBe(ALL_HOOK_EVENTS.length);
    const after = read();
    expect(after.hooks.PostToolUse.length).toBe(1);
    expect(after.hooks.PostToolUse[0].hooks[0].command).toBe("some-other-tool audit");
    // Events that held nothing but cortex are dropped entirely.
    expect(after.hooks.SessionStart).toBeUndefined();
  });

  test("recognizes the legacy flat entry format", () => {
    writeFileSync(settings, JSON.stringify({
      hooks: { Stop: [{ command: "apsolut-cortex hook:stop" }] },
    }));
    expect(stripHooks(settings)).toBe(1);
  });

  test("returns 0 for a missing file or a file with no hooks", () => {
    expect(stripHooks(join(dir, "nope.json"))).toBe(0);
    const empty = join(dir, ".claude", "empty.json");
    writeFileSync(empty, "{}");
    expect(stripHooks(empty)).toBe(0);
  });
});

describe("isCortexEntry", () => {
  test("matches both formats and nothing else", () => {
    expect(isCortexEntry({ hooks: [{ command: "apsolut-cortex hook:stop" }] })).toBe(true);
    expect(isCortexEntry({ command: "apsolut-cortex hook:stop" })).toBe(true);
    expect(isCortexEntry({ hooks: [{ command: "other-tool" }] })).toBe(false);
    expect(isCortexEntry("string")).toBe(false);
    expect(isCortexEntry(null)).toBe(false);
  });
});

describe("findRegisteredHooks", () => {
  test("reports which scope holds which events", () => {
    writeHooks(settings, buildHookEntries("apsolut-cortex"));
    const found = findRegisteredHooks([
      { label: "project", path: settings },
      { label: "global", path: join(dir, "missing.json") },
    ]);
    expect(found.length).toBe(1);
    expect(found[0].label).toBe("project");
    expect(found[0].events.sort()).toEqual([...ALL_HOOK_EVENTS].sort());
  });
});
