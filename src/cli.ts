#!/usr/bin/env node
/**
 * apsolut-cortex CLI
 *
 * Commands:
 *   init              — set up memory for this project
 *   status            — show memory stats
 *   uninstall         — remove hooks and MCP config
 *   hook:session-start
 *   hook:post-tool-use
 *   hook:stop
 *   hook:session-end
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath, pathToFileURL } from "url";
import { registerProject } from "./registry.js";
import { getDb } from "./db.js";
import { runMigrations } from "./migrations/runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// When installed via npm, __dirname is inside dist/
// When run locally with bun, __dirname is inside src/
const PACKAGE_ROOT = resolve(__dirname, "..");
const IS_DIST = __dirname.endsWith("dist") || __dirname.includes(`${process.sep}dist${process.sep}`);
const PKG_VERSION = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8")).version;

const PROJECT_ROOT = process.cwd();
const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");
const MCP_JSON = join(PROJECT_ROOT, ".mcp.json");
const PROJECT_APSOLUT = join(PROJECT_ROOT, ".apsolut-cortex");
const PROJECT_CONFIG = join(PROJECT_APSOLUT, "project.json");

const cmd = process.argv[2];

switch (cmd) {
  case "init":               await init(); break;
  case "status":             await status(); break;
  case "migrate":            await migrate(); break;
  case "eval":               await evalCmd(process.argv[3]); break;
  case "uninstall":          uninstall(); break;
  case "hook:session-start": await runHook("session-start"); break;
  case "hook:post-tool-use": await runHook("post-tool-use"); break;
  case "hook:stop":          await runHook("stop"); break;
  case "hook:session-end":   await runHook("session-end"); break;
  case "help": case "--help": case "-h":
  default:
    console.log(`
  ┌──────────────────────────────────────────────────┐
  │                                                  │
  │       c o r t e x  ·  v ${PKG_VERSION.padEnd(25)}│
  │                                                  │
  ├──────────────────────────────────────────────────┤
  │  Commands:                                       │
  │    init        Set up memory for a project       │
  │    status      Show memory stats                 │
  │    migrate     Apply pending schema migrations   │
  │    eval run    Run retrieval evals               │
  │    eval baseline   Snapshot current scores       │
  │    uninstall   Remove hooks & MCP config         │
  │    help        Show this help                    │
  ├──────────────────────────────────────────────────┤
  │  DB:     ~/.apsolut-cortex/memory.db             │
  │  Models: ~/.apsolut-cortex/models/               │
  └──────────────────────────────────────────────────┘
`);
}

// ── Hook dispatcher ───────────────────────────────────────────────────────────

async function runHook(name: string) {
  const hookPath = IS_DIST
    ? join(PACKAGE_ROOT, "scripts", `${name}.js`)
    : join(__dirname, "hooks", `${name}.ts`);

  if (!existsSync(hookPath)) {
    process.stderr.write(`[apsolut-cortex] hook not found: ${hookPath}\n`);
    process.exit(0);
  }

  // Dynamically import and run the hook (Windows requires file:// URLs for ESM)
  await import(pathToFileURL(hookPath).href);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  console.log("\n[apsolut-cortex] init\n");

  if (!existsSync(PROJECT_APSOLUT)) {
    mkdirSync(PROJECT_APSOLUT, { recursive: true });
  }

  let projectId: string;
  let projectName: string;

  if (existsSync(PROJECT_CONFIG)) {
    const existing = JSON.parse(readFileSync(PROJECT_CONFIG, "utf-8"));
    projectId = existing.id;
    projectName = existing.name;
    console.log(`[apsolut-cortex] ✓ Project already initialised: ${projectName}`);
  } else {
    projectId = crypto.randomUUID();
    projectName = PROJECT_ROOT.split(/[\\/]/).filter(Boolean).pop() ?? "project";
    writeFileSync(PROJECT_CONFIG, JSON.stringify({
      id: projectId,
      name: projectName,
      created_at: new Date().toISOString(),
    }, null, 2));
    console.log(`[apsolut-cortex] ✓ Created .apsolut-cortex/project.json`);
    console.log(`[apsolut-cortex]   ID:   ${projectId}`);
    console.log(`[apsolut-cortex]   Name: ${projectName}`);
  }

  registerProject(projectId, projectName, PROJECT_ROOT);
  console.log(`[apsolut-cortex] ✓ Registered in ~/.apsolut-cortex/registry.json`);

  // MCP server path — dist/ when published, src/ when local
  const mcpServerPath = IS_DIST
    ? join(__dirname, "mcp", "server.js")
    : join(__dirname, "mcp", "server.ts");

  const mcpCommand = IS_DIST ? "node" : "bun";
  const mcpArgs = [mcpServerPath];

  let mcp: Record<string, unknown> = {};
  if (existsSync(MCP_JSON)) {
    try { mcp = JSON.parse(readFileSync(MCP_JSON, "utf-8")); } catch {}
  }
  const servers = (mcp.mcpServers as Record<string, unknown>) ?? {};
  servers["apsolut-cortex"] = {
    command: mcpCommand,
    args: mcpArgs,
    env: { APSOLUT_PROJECT_PATH: PROJECT_ROOT },
  };
  mcp.mcpServers = servers;
  writeFileSync(MCP_JSON, JSON.stringify(mcp, null, 2));
  console.log(`[apsolut-cortex] ✓ Written .mcp.json`);

  // Hooks — use the binary name when installed via npm
  const hookCmd = IS_DIST
    ? "apsolut-cortex"
    : `bun run "${join(__dirname, "cli.ts").replace(/\\/g, "/")}"`;


  const hookEntries: Record<string, { matcher: string; hooks: { type: string; command: string }[] }[]> = {
    SessionStart: [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:session-start` }] }],
    PostToolUse:  [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:post-tool-use` }] }],
    Stop:         [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:stop` }] }],
    SessionEnd:   [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:session-end` }] }],
  };

  let settings: Record<string, unknown> = {};
  const settingsDir = dirname(CLAUDE_SETTINGS);
  if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });
  if (existsSync(CLAUDE_SETTINGS)) {
    try { settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf-8")); } catch {}
  }

  const existingHooks = (settings.hooks as Record<string, unknown[]>) ?? {};
  let added = 0;
  for (const [event, entries] of Object.entries(hookEntries)) {
    const current = (existingHooks[event] ?? []) as unknown[];
    const alreadyRegistered = current.some((e: any) => {
      if (typeof e !== "object") return false;
      // new format: { matcher, hooks: [{ command }] }
      if (Array.isArray(e.hooks)) {
        return e.hooks.some((h: any) => h.command?.includes("apsolut-cortex"));
      }
      // old format: { command }
      return e.command?.includes("apsolut-cortex");
    });
    if (!alreadyRegistered) {
      existingHooks[event] = [...current, ...entries];
      added++;
    }
  }
  settings.hooks = existingHooks;
  writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
  console.log(added > 0
    ? `[apsolut-cortex] ✓ Registered ${added} hooks in ~/.claude/settings.json`
    : `[apsolut-cortex] ✓ Hooks already registered`
  );

  // Skills — copy to ~/.claude/skills/ for standalone slash commands
  const SKILL_NAMES = ["apsolut-recall", "apsolut-store", "apsolut-status", "apsolut-forget"];
  const skillsSource = join(PACKAGE_ROOT, "skills");
  const skillsTarget = join(homedir(), ".claude", "skills");
  if (!existsSync(skillsTarget)) mkdirSync(skillsTarget, { recursive: true });

  // Clean up old generic skill names that collide with Claude builtins
  const OLD_SKILL_NAMES = ["remember", "store", "status", "forget"];
  for (const old of OLD_SKILL_NAMES) {
    const oldSkill = join(skillsTarget, old, "SKILL.md");
    if (existsSync(oldSkill)) {
      const content = readFileSync(oldSkill, "utf-8");
      if (content.includes("memory_")) {
        rmSync(join(skillsTarget, old), { recursive: true, force: true });
      }
    }
  }

  let skillsCopied = 0;
  for (const name of SKILL_NAMES) {
    const src = join(skillsSource, name, "SKILL.md");
    const destDir = join(skillsTarget, name);
    const dest = join(destDir, "SKILL.md");

    if (!existsSync(src)) continue;

    const srcContent = readFileSync(src, "utf-8");
    if (existsSync(dest) && readFileSync(dest, "utf-8") === srcContent) continue;

    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    writeFileSync(dest, srcContent);
    skillsCopied++;
  }
  console.log(skillsCopied > 0
    ? `[apsolut-cortex] ✓ Copied ${skillsCopied} skills to ~/.claude/skills/ (/${SKILL_NAMES.join(", /")})`
    : `[apsolut-cortex] ✓ Skills already installed`
  );

  // .gitignore
  const gitignore = join(PROJECT_ROOT, ".gitignore");
  if (existsSync(gitignore)) {
    const content = readFileSync(gitignore, "utf-8");
    if (!content.includes(".apsolut-cortex/")) {
      writeFileSync(gitignore, content + "\n# apsolut-cortex\n.apsolut-cortex/\n");
      console.log(`[apsolut-cortex] ✓ Added .apsolut-cortex/ to .gitignore`);
    }
  }

  // ANSI colors — fallback: if NO_COLOR or TERM=dumb, disable
  const useColor = !process.env.NO_COLOR && process.env.TERM !== "dumb";
  const v = (s: string) => useColor ? `\x1b[95m${s}\x1b[0m` : s;  // bright magenta
  const y = (s: string) => useColor ? `\x1b[33m${s}\x1b[0m` : s;  // yellow
  const d = (s: string) => useColor ? `\x1b[2m${s}\x1b[0m` : s;   // dim
  const g = (s: string) => useColor ? `\x1b[32m${s}\x1b[0m` : s;  // green (checkmarks)

  const BANNER = `
  ${d("┌─────────────────────────────────────────────────────────┐")}
  ${d("│")}                                                         ${d("│")}
  ${d("│")}   ${v("█████╗ ██████╗ ███████╗ ██████╗ ██╗     ██╗   ██╗████████╗")} ${d("│")}
  ${d("│")}  ${v("██╔══██╗██╔══██╗██╔════╝██╔═══██╗██║     ██║   ██║╚══██╔══╝")} ${d("│")}
  ${d("│")}  ${v("███████║██████╔╝███████╗██║   ██║██║     ██║   ██║   ██║")}    ${d("│")}
  ${d("│")}  ${v("██╔══██║██╔═══╝ ╚════██║██║   ██║██║     ██║   ██║   ██║")}    ${d("│")}
  ${d("│")}  ${v("██║  ██║██║     ███████║╚██████╔╝███████╗╚██████╔╝   ██║")}    ${d("│")}
  ${d("│")}  ${v("╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝ ╚══════╝ ╚═════╝    ╚═╝")}    ${d("│")}
  ${d("│")}                                                         ${d("│")}
  ${d("│")}            ${y("c o r t e x")}  ${d("·")}  ${y(`v ${PKG_VERSION}`)}                 ${d("│")}
  ${d("│")}                                                         ${d("│")}
  ${d("└─────────────────────────────────────────────────────────┘")}

  ${g("✓")}  project    ${projectName}
  ${g("✓")}  id         ${projectId.slice(0, 18)}...
  ${g("✓")}  memory     ~/.apsolut-cortex/memory.db
  ${g("✓")}  models     ~/.apsolut-cortex/models/

  ${d("──────────────────────────────────────────────────────────")}

  Restart Claude Code, then say ${y('"/apsolut-recall <topic>"')} to search.
  compression: ANTHROPIC_API_KEY → ollama fallback → loud error

`;
  console.log(BANNER);
}

// ── Status ────────────────────────────────────────────────────────────────────

async function status() {
  // getDb is statically imported at the top — bundled inline by Bun

  if (!existsSync(PROJECT_CONFIG)) {
    console.log("[apsolut-cortex] No project found. Run: apsolut-cortex init");
    process.exit(1);
  }

  const project = JSON.parse(readFileSync(PROJECT_CONFIG, "utf-8"));
  const db = await getDb();

  const totalResult = await db.execute({
    sql: "SELECT COUNT(*) as n FROM memories WHERE project_id = ?",
    args: [project.id],
  });
  const total = totalResult.rows[0]?.n as number ?? 0;

  const sessionsResult = await db.execute({
    sql: "SELECT COUNT(*) as n FROM sessions WHERE project_id = ?",
    args: [project.id],
  });
  const sessions = sessionsResult.rows[0]?.n as number ?? 0;

  const byTrustResult = await db.execute({
    sql: "SELECT trust, COUNT(*) as n FROM memories WHERE project_id = ? GROUP BY trust",
    args: [project.id],
  });
  const byTrust = byTrustResult.rows as Array<{ trust: string; n: number }>;

  const recentResult = await db.execute({
    sql: `SELECT summary, started_at FROM sessions
          WHERE project_id = ? AND summary IS NOT NULL
          ORDER BY started_at DESC LIMIT 3`,
    args: [project.id],
  });
  const recent = recentResult.rows as Array<{ summary: string; started_at: number }>;

  const W = 50;
  const hr = "─".repeat(W - 2);
  const bl = (t: string) => { const p = Math.max(0, W - 4 - t.length); return `│ ${t}${" ".repeat(p)} │`; };

  console.log(`\n  ┌${hr}┐`);
  console.log(`  ${bl(`[apsolut-cortex]  ${project.name}`)}`);
  console.log(`  ├${hr}┤`);
  console.log(`  ${bl(`Memories : ${total}`)}`);
  console.log(`  ${bl(`Sessions : ${sessions}`)}`);
  byTrust.forEach((r) => console.log(`  ${bl(`  ${r.trust}: ${r.n}`)}`));

  if (recent.length) {
    console.log(`  ├${hr}┤`);
    console.log(`  ${bl("Recent sessions:")}`);
    recent.forEach((r) => {
      const age = Math.round((Date.now() - r.started_at) / 86400000);
      const summary = r.summary.length > W - 14
        ? r.summary.slice(0, W - 17) + "..."
        : r.summary;
      console.log(`  ${bl(`  ${age}d ago: ${summary}`)}`);
    });
  }

  console.log(`  ├${hr}┤`);
  console.log(`  ${bl("DB: ~/.apsolut-cortex/memory.db")}`);
  console.log(`  └${hr}┘\n`);
}

// ── Migrate ───────────────────────────────────────────────────────────────────

async function migrate() {
  // getDb() runs migrations automatically as part of init. Calling it here is
  // enough; we then re-run runMigrations() explicitly so we can report which
  // ones actually ran vs were skipped.
  const db = await getDb();
  const result = await runMigrations(db);

  if (result.applied.length === 0) {
    console.log(`[apsolut-cortex] ✓ Schema up to date (${result.skipped.length} migrations on record)`);
  } else {
    console.log(`[apsolut-cortex] ✓ Applied ${result.applied.length} migration(s):`);
    for (const name of result.applied) console.log(`  + ${name}`);
    if (result.skipped.length > 0) {
      console.log(`[apsolut-cortex]   Skipped ${result.skipped.length} already-applied migration(s)`);
    }
  }
}

// ── Eval ──────────────────────────────────────────────────────────────────────

async function evalCmd(subcommand: string | undefined) {
  // Eval modules are loaded lazily so the CLI startup cost (importing the
  // embedding model, seed fixtures, etc.) is paid only when running evals.
  const evalsRoot = IS_DIST
    ? join(PACKAGE_ROOT, "evals")
    : join(PACKAGE_ROOT, "evals");
  const runnerModule = pathToFileURL(join(evalsRoot, "runner.ts")).href;
  const {
    runEvals,
    formatResult,
    saveBaseline,
    loadBaseline,
    formatComparison,
  } = await import(runnerModule);

  switch (subcommand) {
    case "run": {
      const result = await runEvals();
      console.log(formatResult(result));
      const baseline = loadBaseline();
      if (baseline) {
        console.log("");
        console.log(formatComparison(result, baseline));
      } else {
        console.log("");
        console.log("[apsolut-cortex] No baseline on file. Run `apsolut-cortex eval baseline` to snapshot the current scores.");
      }
      break;
    }
    case "baseline": {
      const result = await runEvals();
      saveBaseline(result);
      console.log(formatResult(result));
      console.log("");
      console.log("[apsolut-cortex] ✓ Baseline saved to evals/baseline.json");
      break;
    }
    default:
      console.log(`[apsolut-cortex] eval — subcommands:`);
      console.log(`  apsolut-cortex eval run        Run evals and print scores`);
      console.log(`  apsolut-cortex eval baseline   Snapshot current scores as baseline`);
      break;
  }
}

// ── Uninstall ─────────────────────────────────────────────────────────────────

function uninstall() {
  if (existsSync(MCP_JSON)) {
    try {
      const mcp = JSON.parse(readFileSync(MCP_JSON, "utf-8"));
      if ((mcp.mcpServers as Record<string, unknown>)?.["apsolut-cortex"]) {
        delete (mcp.mcpServers as Record<string, unknown>)["apsolut-cortex"];
        writeFileSync(MCP_JSON, JSON.stringify(mcp, null, 2));
        console.log("[apsolut-cortex] ✓ Removed from .mcp.json");
      }
    } catch {}
  }

  if (existsSync(CLAUDE_SETTINGS)) {
    try {
      const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf-8"));
      const hooks = settings.hooks as Record<string, unknown[]> | undefined;
      if (hooks) {
        for (const event of ["SessionStart", "PostToolUse", "Stop", "SessionEnd"]) {
          if (hooks[event]) {
            hooks[event] = hooks[event].filter(
              (e: any) => {
                if (typeof e !== "object") return true;
                // new format: { matcher, hooks: [{ command }] }
                if (Array.isArray(e.hooks)) {
                  return !e.hooks.some((h: any) => h.command?.includes("apsolut-cortex"));
                }
                // old format: { command }
                return !e.command?.includes("apsolut-cortex");
              }
            );
          }
        }
        writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
        console.log("[apsolut-cortex] ✓ Removed hooks from ~/.claude/settings.json");
      }
    } catch {}
  }

  // Remove standalone skills (both old and new names)
  const SKILL_NAMES = ["apsolut-recall", "apsolut-store", "apsolut-status", "apsolut-forget", "remember", "store", "status", "forget"];
  const skillsDir = join(homedir(), ".claude", "skills");
  let skillsRemoved = 0;
  for (const name of SKILL_NAMES) {
    const skillFile = join(skillsDir, name, "SKILL.md");
    if (existsSync(skillFile)) {
      const content = readFileSync(skillFile, "utf-8");
      if (content.includes("memory_")) {
        rmSync(join(skillsDir, name), { recursive: true, force: true });
        skillsRemoved++;
      }
    }
  }
  if (skillsRemoved > 0) {
    console.log(`[apsolut-cortex] ✓ Removed ${skillsRemoved} skills from ~/.claude/skills/`);
  }

  console.log("\n[apsolut-cortex] Uninstalled. DB at ~/.apsolut-cortex/memory.db kept.\n");
}
