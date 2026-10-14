/**
 * The CLI must actually dispatch.
 *
 * 0.14.0 shipped a cli.ts whose top-level `switch (process.argv[2])` had been
 * deleted. Everything still compiled, every unit test still passed, and the
 * binary exited 0 for every input while doing nothing — including the
 * `hook:*` entry points that the registered hooks invoke. The failure was
 * invisible precisely because silence is also what a well-behaved hook looks
 * like.
 *
 * Two layers here: the dispatcher responds when executed, and it covers every
 * hook that exists on disk (so adding a hook file without wiring it fails).
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const CLI_PATH = join(import.meta.dir, "cli.ts");
const HOOKS_DIR = join(import.meta.dir, "hooks");
const source = readFileSync(CLI_PATH, "utf-8");

describe("cli dispatch", () => {
  test("reads a command off argv", () => {
    expect(source).toContain("process.argv[2]");
  });

  test("every hook file has a hook: case routing to it", () => {
    const hookNames = readdirSync(HOOKS_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => f.replace(/\.ts$/, ""));

    expect(hookNames.length).toBeGreaterThan(0);
    for (const name of hookNames) {
      expect(source).toContain(`case "hook:${name}":`);
      expect(source).toContain(`runHook("${name}")`);
    }
  });

  test("no declared function is orphaned", () => {
    // Deleting the dispatcher leaves every command handler declared and
    // referenced by nothing — which is exactly how 0.14.0 shipped. Helpers
    // called from other functions are fine; what must never happen is a
    // function with no caller anywhere in the file.
    const declared = [...source.matchAll(/^(?:async )?function (\w+)\(/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(10);

    const orphaned = declared.filter((name) => {
      const declaration = new RegExp(`^(?:async )?function ${name}\\(`, "m");
      const references = source
        .split("\n")
        .filter((line) => !declaration.test(line))
        .join("\n");
      return !references.includes(`${name}(`);
    });
    expect(orphaned).toEqual([]);
  });

  test("the switch dispatches the documented commands", () => {
    const switchBlock = source.slice(
      source.indexOf("switch (cmd)"),
      source.indexOf("// ── Hook dispatcher")
    );
    expect(switchBlock.length).toBeGreaterThan(0);

    for (const cmd of [
      "init", "status", "doctor", "uninstall", "migrate", "export",
      "backup", "restore", "db", "reembed", "install-hooks",
    ]) {
      expect(switchBlock).toContain(`case "${cmd}":`);
    }
  });

  test("responds to `help` with the banner instead of exiting silently", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    expect(code).toBe(0);
    expect(out).toContain("c o r t e x");
    expect(out).toContain("Commands:");
    expect(out.trim().length).toBeGreaterThan(100);
  });

  test("an unknown command also produces output, never silence", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "not-a-real-command"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    expect(code).toBe(0);
    expect(out).toContain("Commands:");
  });
});
