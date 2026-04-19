#!/usr/bin/env node

// src/cli.ts
import {
  existsSync as existsSync3,
  mkdirSync as mkdirSync3,
  readFileSync as readFileSync2,
  rmSync,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join2, resolve, dirname as dirname2 } from "path";
import { homedir as homedir2 } from "os";
import { fileURLToPath, pathToFileURL } from "url";

// src/registry.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync, writeFileSync, renameSync } from "fs";
import { dirname } from "path";

// src/db.ts
import { createClient } from "@libsql/client";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// src/config.ts
function envNum(key, fallback) {
  const val = process.env[key];
  if (val === undefined)
    return fallback;
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
var CORTEX_DUPLICATE_THRESHOLD = envNum("CORTEX_DUPLICATE_THRESHOLD", 0.92);
var CORTEX_DECAY_DAYS = envNum("CORTEX_DECAY_DAYS", 7);
var CORTEX_DECAY_OBSERVED = envNum("CORTEX_DECAY_OBSERVED", 0.95);
var CORTEX_DECAY_VALIDATED = envNum("CORTEX_DECAY_VALIDATED", 0.98);
var CORTEX_PRUNE_WEIGHT = envNum("CORTEX_PRUNE_WEIGHT", 0.1);
var CORTEX_RRF_K = envNum("CORTEX_RRF_K", 60);
var CORTEX_MMR_LAMBDA = envNum("CORTEX_MMR_LAMBDA", 0.7);
var CORTEX_SEARCH_LIMIT_MAX = envNum("CORTEX_SEARCH_LIMIT_MAX", 10);
var CORTEX_SEARCH_MULTIPLIER = envNum("CORTEX_SEARCH_MULTIPLIER", 2);
var CORTEX_WEIGHT_ALPHA = envNum("CORTEX_WEIGHT_ALPHA", 0.3);
var CORTEX_PROMOTE_WEIGHT = envNum("CORTEX_PROMOTE_WEIGHT", 1.4);
var CORTEX_PROMOTE_USES = envNum("CORTEX_PROMOTE_USES", 3);
var CORTEX_BUMP_BOOST = envNum("CORTEX_BUMP_BOOST", 0.1);
var CORTEX_WEIGHT_CAP = envNum("CORTEX_WEIGHT_CAP", 3);
var CORTEX_CORRECTION_WEIGHT = envNum("CORTEX_CORRECTION_WEIGHT", 1.5);
var CORTEX_MANUAL_WEIGHT = envNum("CORTEX_MANUAL_WEIGHT", 1.2);

// src/db.ts
var CORTEX_DIR = join(homedir(), ".apsolut");
var DB_PATH = join(CORTEX_DIR, "memory.db");
var REGISTRY_PATH = join(CORTEX_DIR, "registry.json");
var MODELS_DIR = join(CORTEX_DIR, "models");
var _db = null;
var _initialized = false;
async function getDb() {
  if (_db && _initialized)
    return _db;
  if (!existsSync(CORTEX_DIR))
    mkdirSync(CORTEX_DIR, { recursive: true });
  if (!existsSync(MODELS_DIR))
    mkdirSync(MODELS_DIR, { recursive: true });
  if (!_db) {
    _db = createClient({ url: `file:${DB_PATH}` });
  }
  if (!_initialized) {
    await _db.executeMultiple(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA cache_size = -32000;

      CREATE TABLE IF NOT EXISTS projects (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        path         TEXT,
        created_at   INTEGER NOT NULL,
        last_session INTEGER
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id                 TEXT PRIMARY KEY,
        project_id         TEXT NOT NULL REFERENCES projects(id),
        started_at         INTEGER NOT NULL,
        ended_at           INTEGER,
        summary            TEXT,
        memories_injected  INTEGER NOT NULL DEFAULT 0,
        memories_stored    INTEGER NOT NULL DEFAULT 0,
        tool_failures      INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project
        ON sessions(project_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS observations (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES sessions(id),
        project_id  TEXT NOT NULL,
        tool_name   TEXT,
        content     TEXT NOT NULL,
        category    TEXT,
        created_at  INTEGER NOT NULL,
        promoted    INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_obs_project ON observations(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS memories (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL,
        tier         TEXT NOT NULL DEFAULT 'semantic',
        category     TEXT NOT NULL DEFAULT 'insight',
        trust        TEXT NOT NULL DEFAULT 'observed',
        content      TEXT NOT NULL,
        context      TEXT,
        source       TEXT NOT NULL DEFAULT 'manual',
        embedding    F32_BLOB(384),
        weight       REAL NOT NULL DEFAULT 1.0,
        used_count   INTEGER NOT NULL DEFAULT 0,
        last_used    INTEGER,
        created_at   INTEGER NOT NULL,
        session_id   TEXT REFERENCES sessions(id),
        flagged      INTEGER NOT NULL DEFAULT 0,
        flag_reason  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_mem_project ON memories(project_id);
      CREATE INDEX IF NOT EXISTS idx_mem_weight  ON memories(project_id, weight DESC);
      CREATE INDEX IF NOT EXISTS idx_mem_tier    ON memories(project_id, tier);
      CREATE INDEX IF NOT EXISTS idx_mem_trust   ON memories(project_id, trust);
      CREATE INDEX IF NOT EXISTS idx_mem_flagged ON memories(project_id, flagged)
        WHERE flagged = 1;

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, context,
        content='memories',
        content_rowid='rowid',
        tokenize='porter ascii'
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, context)
        VALUES (new.rowid, new.content, COALESCE(new.context, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, context)
        VALUES ('delete', old.rowid, old.content, COALESCE(old.context, ''));
        INSERT INTO memories_fts(rowid, content, context)
        VALUES (new.rowid, new.content, COALESCE(new.context, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, context)
        VALUES ('delete', old.rowid, old.content, COALESCE(old.context, ''));
      END;

      CREATE TABLE IF NOT EXISTS file_hashes (
        project_id TEXT NOT NULL,
        path       TEXT NOT NULL,
        hash       TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, path)
      );
    `);
    _initialized = true;
  }
  return _db;
}

// src/registry.ts
function readRegistry() {
  if (!existsSync2(REGISTRY_PATH))
    return { projects: {} };
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  } catch {
    return { projects: {} };
  }
}
function writeRegistry(reg) {
  const dir = dirname(REGISTRY_PATH);
  if (!existsSync2(dir))
    mkdirSync2(dir, { recursive: true });
  const tmp = REGISTRY_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(reg, null, 2));
  renameSync(tmp, REGISTRY_PATH);
}
function registerProject(id, name, path) {
  const reg = readRegistry();
  reg.projects[id] = { name, path, registered_at: Date.now() };
  writeRegistry(reg);
}

// src/cli.ts
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = dirname2(__filename2);
var PACKAGE_ROOT = resolve(__dirname2, "..");
var IS_DIST = __dirname2.endsWith("dist") || __dirname2.includes(`${process.sep}dist${process.sep}`);
var PKG_VERSION = JSON.parse(readFileSync2(join2(PACKAGE_ROOT, "package.json"), "utf-8")).version;
var PROJECT_ROOT = process.cwd();
var CLAUDE_SETTINGS = join2(homedir2(), ".claude", "settings.json");
var MCP_JSON = join2(PROJECT_ROOT, ".mcp.json");
var PROJECT_APSOLUT = join2(PROJECT_ROOT, ".apsolut");
var PROJECT_CONFIG = join2(PROJECT_APSOLUT, "project.json");
var cmd = process.argv[2];
switch (cmd) {
  case "init":
    await init();
    break;
  case "status":
    await status();
    break;
  case "uninstall":
    uninstall();
    break;
  case "hook:session-start":
    await runHook("session-start");
    break;
  case "hook:post-tool-use":
    await runHook("post-tool-use");
    break;
  case "hook:stop":
    await runHook("stop");
    break;
  case "hook:session-end":
    await runHook("session-end");
    break;
  case "help":
  case "--help":
  case "-h":
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
  │    uninstall   Remove hooks & MCP config         │
  │    help        Show this help                    │
  ├──────────────────────────────────────────────────┤
  │  DB:     ~/.apsolut/memory.db                    │
  │  Models: ~/.apsolut/models/                      │
  └──────────────────────────────────────────────────┘
`);
}
async function runHook(name) {
  const hookPath = IS_DIST ? join2(PACKAGE_ROOT, "scripts", `${name}.js`) : join2(__dirname2, "hooks", `${name}.ts`);
  if (!existsSync3(hookPath)) {
    process.stderr.write(`[apsolut-cortex] hook not found: ${hookPath}
`);
    process.exit(0);
  }
  await import(pathToFileURL(hookPath).href);
}
async function init() {
  console.log(`
apsolut-cortex init
`);
  if (!existsSync3(PROJECT_APSOLUT)) {
    mkdirSync3(PROJECT_APSOLUT, { recursive: true });
  }
  let projectId;
  let projectName;
  if (existsSync3(PROJECT_CONFIG)) {
    const existing = JSON.parse(readFileSync2(PROJECT_CONFIG, "utf-8"));
    projectId = existing.id;
    projectName = existing.name;
    console.log(`✓ Project already initialised: ${projectName}`);
  } else {
    projectId = crypto.randomUUID();
    projectName = PROJECT_ROOT.split(/[\\/]/).filter(Boolean).pop() ?? "project";
    writeFileSync2(PROJECT_CONFIG, JSON.stringify({
      id: projectId,
      name: projectName,
      created_at: new Date().toISOString()
    }, null, 2));
    console.log(`✓ Created .apsolut/project.json`);
    console.log(`  ID:   ${projectId}`);
    console.log(`  Name: ${projectName}`);
  }
  registerProject(projectId, projectName, PROJECT_ROOT);
  console.log(`✓ Registered in ~/.apsolut/registry.json`);
  const mcpServerPath = IS_DIST ? join2(__dirname2, "mcp", "server.js") : join2(__dirname2, "mcp", "server.ts");
  const mcpCommand = IS_DIST ? "node" : "bun";
  const mcpArgs = [mcpServerPath];
  let mcp = {};
  if (existsSync3(MCP_JSON)) {
    try {
      mcp = JSON.parse(readFileSync2(MCP_JSON, "utf-8"));
    } catch {}
  }
  const servers = mcp.mcpServers ?? {};
  servers["apsolut-cortex"] = {
    command: mcpCommand,
    args: mcpArgs,
    env: { APSOLUT_PROJECT_PATH: PROJECT_ROOT }
  };
  mcp.mcpServers = servers;
  writeFileSync2(MCP_JSON, JSON.stringify(mcp, null, 2));
  console.log(`✓ Written .mcp.json`);
  const hookCmd = IS_DIST ? "apsolut-cortex" : `bun run "${join2(__dirname2, "cli.ts").replace(/\\/g, "/")}"`;
  const hookEntries = {
    SessionStart: [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:session-start` }] }],
    PostToolUse: [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:post-tool-use` }] }],
    Stop: [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:stop` }] }],
    SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:session-end` }] }]
  };
  let settings = {};
  const settingsDir = dirname2(CLAUDE_SETTINGS);
  if (!existsSync3(settingsDir))
    mkdirSync3(settingsDir, { recursive: true });
  if (existsSync3(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(readFileSync2(CLAUDE_SETTINGS, "utf-8"));
    } catch {}
  }
  const existingHooks = settings.hooks ?? {};
  let added = 0;
  for (const [event, entries] of Object.entries(hookEntries)) {
    const current = existingHooks[event] ?? [];
    const alreadyRegistered = current.some((e) => {
      if (typeof e !== "object")
        return false;
      if (Array.isArray(e.hooks)) {
        return e.hooks.some((h) => h.command?.includes("apsolut-cortex"));
      }
      return e.command?.includes("apsolut-cortex");
    });
    if (!alreadyRegistered) {
      existingHooks[event] = [...current, ...entries];
      added++;
    }
  }
  settings.hooks = existingHooks;
  writeFileSync2(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
  console.log(added > 0 ? `✓ Registered ${added} hooks in ~/.claude/settings.json` : `✓ Hooks already registered`);
  const SKILL_NAMES = ["remember", "store", "status", "forget"];
  const skillsSource = join2(PACKAGE_ROOT, "skills");
  const skillsTarget = join2(homedir2(), ".claude", "skills");
  if (!existsSync3(skillsTarget))
    mkdirSync3(skillsTarget, { recursive: true });
  let skillsCopied = 0;
  for (const name of SKILL_NAMES) {
    const src = join2(skillsSource, name, "SKILL.md");
    const destDir = join2(skillsTarget, name);
    const dest = join2(destDir, "SKILL.md");
    if (!existsSync3(src))
      continue;
    const srcContent = readFileSync2(src, "utf-8");
    if (existsSync3(dest) && readFileSync2(dest, "utf-8") === srcContent)
      continue;
    if (!existsSync3(destDir))
      mkdirSync3(destDir, { recursive: true });
    writeFileSync2(dest, srcContent);
    skillsCopied++;
  }
  console.log(skillsCopied > 0 ? `✓ Copied ${skillsCopied} skills to ~/.claude/skills/ (/${SKILL_NAMES.join(", /")})` : `✓ Skills already installed`);
  const gitignore = join2(PROJECT_ROOT, ".gitignore");
  if (existsSync3(gitignore)) {
    const content = readFileSync2(gitignore, "utf-8");
    if (!content.includes(".apsolut/")) {
      writeFileSync2(gitignore, content + `
# apsolut-cortex
.apsolut/
`);
      console.log(`✓ Added .apsolut/ to .gitignore`);
    }
  }
  const useColor = !process.env.NO_COLOR && process.env.TERM !== "dumb";
  const v = (s) => useColor ? `\x1B[95m${s}\x1B[0m` : s;
  const y = (s) => useColor ? `\x1B[33m${s}\x1B[0m` : s;
  const d = (s) => useColor ? `\x1B[2m${s}\x1B[0m` : s;
  const g = (s) => useColor ? `\x1B[32m${s}\x1B[0m` : s;
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
  ${g("✓")}  memory     ~/.apsolut/memory.db
  ${g("✓")}  models     ~/.apsolut/models/

  ${d("──────────────────────────────────────────────────────────")}

  Restart Claude Code, then say ${y('"remember <topic>"')} to search.
  compression: ANTHROPIC_API_KEY → ollama fallback → loud error

`;
  console.log(BANNER);
}
async function status() {
  if (!existsSync3(PROJECT_CONFIG)) {
    console.log("No project found. Run: apsolut-cortex init");
    process.exit(1);
  }
  const project = JSON.parse(readFileSync2(PROJECT_CONFIG, "utf-8"));
  const db = await getDb();
  const totalResult = await db.execute({
    sql: "SELECT COUNT(*) as n FROM memories WHERE project_id = ?",
    args: [project.id]
  });
  const total = totalResult.rows[0]?.n ?? 0;
  const sessionsResult = await db.execute({
    sql: "SELECT COUNT(*) as n FROM sessions WHERE project_id = ?",
    args: [project.id]
  });
  const sessions = sessionsResult.rows[0]?.n ?? 0;
  const byTrustResult = await db.execute({
    sql: "SELECT trust, COUNT(*) as n FROM memories WHERE project_id = ? GROUP BY trust",
    args: [project.id]
  });
  const byTrust = byTrustResult.rows;
  const recentResult = await db.execute({
    sql: `SELECT summary, started_at FROM sessions
          WHERE project_id = ? AND summary IS NOT NULL
          ORDER BY started_at DESC LIMIT 3`,
    args: [project.id]
  });
  const recent = recentResult.rows;
  const W = 50;
  const hr = "─".repeat(W - 2);
  const bl = (t) => {
    const p = Math.max(0, W - 4 - t.length);
    return `│ ${t}${" ".repeat(p)} │`;
  };
  console.log(`
  ┌${hr}┐`);
  console.log(`  ${bl(`c o r t e x  ·  ${project.name}`)}`);
  console.log(`  ├${hr}┤`);
  console.log(`  ${bl(`Memories : ${total}`)}`);
  console.log(`  ${bl(`Sessions : ${sessions}`)}`);
  byTrust.forEach((r) => console.log(`  ${bl(`  ${r.trust}: ${r.n}`)}`));
  if (recent.length) {
    console.log(`  ├${hr}┤`);
    console.log(`  ${bl("Recent sessions:")}`);
    recent.forEach((r) => {
      const age = Math.round((Date.now() - r.started_at) / 86400000);
      const summary = r.summary.length > W - 14 ? r.summary.slice(0, W - 17) + "..." : r.summary;
      console.log(`  ${bl(`  ${age}d ago: ${summary}`)}`);
    });
  }
  console.log(`  ├${hr}┤`);
  console.log(`  ${bl("DB: ~/.apsolut/memory.db")}`);
  console.log(`  └${hr}┘
`);
}
function uninstall() {
  if (existsSync3(MCP_JSON)) {
    try {
      const mcp = JSON.parse(readFileSync2(MCP_JSON, "utf-8"));
      if (mcp.mcpServers?.["apsolut-cortex"]) {
        delete mcp.mcpServers["apsolut-cortex"];
        writeFileSync2(MCP_JSON, JSON.stringify(mcp, null, 2));
        console.log("✓ Removed from .mcp.json");
      }
    } catch {}
  }
  if (existsSync3(CLAUDE_SETTINGS)) {
    try {
      const settings = JSON.parse(readFileSync2(CLAUDE_SETTINGS, "utf-8"));
      const hooks = settings.hooks;
      if (hooks) {
        for (const event of ["SessionStart", "PostToolUse", "Stop", "SessionEnd"]) {
          if (hooks[event]) {
            hooks[event] = hooks[event].filter((e) => {
              if (typeof e !== "object")
                return true;
              if (Array.isArray(e.hooks)) {
                return !e.hooks.some((h) => h.command?.includes("apsolut-cortex"));
              }
              return !e.command?.includes("apsolut-cortex");
            });
          }
        }
        writeFileSync2(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
        console.log("✓ Removed hooks from ~/.claude/settings.json");
      }
    } catch {}
  }
  const SKILL_NAMES = ["remember", "store", "status", "forget"];
  const skillsDir = join2(homedir2(), ".claude", "skills");
  let skillsRemoved = 0;
  for (const name of SKILL_NAMES) {
    const skillFile = join2(skillsDir, name, "SKILL.md");
    if (existsSync3(skillFile)) {
      const content = readFileSync2(skillFile, "utf-8");
      if (content.includes("memory_")) {
        rmSync(join2(skillsDir, name), { recursive: true, force: true });
        skillsRemoved++;
      }
    }
  }
  if (skillsRemoved > 0) {
    console.log(`✓ Removed ${skillsRemoved} skills from ~/.claude/skills/`);
  }
  console.log(`
Uninstalled. DB at ~/.apsolut/memory.db kept.
`);
}
