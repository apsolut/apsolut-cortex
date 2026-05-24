#!/usr/bin/env node

// src/cli.ts
import {
  existsSync as existsSync5,
  mkdirSync as mkdirSync5,
  readFileSync as readFileSync3,
  rmSync,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join4, resolve, dirname as dirname3 } from "path";
import { homedir as homedir3 } from "os";
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
var CORTEX_DUPLICATE_THRESHOLD = envNum("APSOLUT_CORTEX_DUPLICATE_THRESHOLD", 0.92);
var CORTEX_DECAY_DAYS = envNum("APSOLUT_CORTEX_DECAY_DAYS", 7);
var CORTEX_DECAY_OBSERVED = envNum("APSOLUT_CORTEX_DECAY_OBSERVED", 0.95);
var CORTEX_DECAY_VALIDATED = envNum("APSOLUT_CORTEX_DECAY_VALIDATED", 0.98);
var CORTEX_PRUNE_WEIGHT = envNum("APSOLUT_CORTEX_PRUNE_WEIGHT", 0.1);
var CORTEX_RRF_K = envNum("APSOLUT_CORTEX_RRF_K", 60);
var CORTEX_MMR_LAMBDA = envNum("APSOLUT_CORTEX_MMR_LAMBDA", 0.7);
var CORTEX_SEARCH_LIMIT_MAX = envNum("APSOLUT_CORTEX_SEARCH_LIMIT_MAX", 10);
var CORTEX_SEARCH_MULTIPLIER = envNum("APSOLUT_CORTEX_SEARCH_MULTIPLIER", 2);
var CORTEX_WEIGHT_ALPHA = envNum("APSOLUT_CORTEX_WEIGHT_ALPHA", 0.3);
var CORTEX_PROMOTE_WEIGHT = envNum("APSOLUT_CORTEX_PROMOTE_WEIGHT", 1.4);
var CORTEX_PROMOTE_USES = envNum("APSOLUT_CORTEX_PROMOTE_USES", 3);
var CORTEX_BUMP_BOOST = envNum("APSOLUT_CORTEX_BUMP_BOOST", 0.1);
var CORTEX_WEIGHT_CAP = envNum("APSOLUT_CORTEX_WEIGHT_CAP", 3);
var CORTEX_CORRECTION_WEIGHT = envNum("APSOLUT_CORTEX_CORRECTION_WEIGHT", 1.5);
var CORTEX_MANUAL_WEIGHT = envNum("APSOLUT_CORTEX_MANUAL_WEIGHT", 1.2);

// src/migrations/001-initial-schema.ts
var migration = {
  name: "001-initial-schema",
  async up(client) {
    await client.executeMultiple(`
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
  }
};
var _001_initial_schema_default = migration;

// src/migrations/runner.ts
var MIGRATIONS = [
  _001_initial_schema_default
];
var LOCK_TIMEOUT_MS = 30000;
async function runMigrations(client, migrations = MIGRATIONS) {
  await ensureMigrationsTable(client);
  await acquireLock(client);
  try {
    const applied = await getAppliedNames(client);
    const result = { applied: [], skipped: [] };
    for (const m of migrations) {
      if (applied.has(m.name)) {
        result.skipped.push(m.name);
        continue;
      }
      try {
        await m.up(client);
        await client.execute({
          sql: "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
          args: [m.name, Date.now()]
        });
        result.applied.push(m.name);
      } catch (err) {
        throw new Error(`[apsolut-cortex] migration ${m.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return result;
  } finally {
    await releaseLock(client);
  }
}
async function ensureMigrationsTable(client) {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      applied_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS _migrations_lock (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      pid          INTEGER NOT NULL,
      acquired_at  INTEGER NOT NULL
    );
  `);
}
async function getAppliedNames(client) {
  const result = await client.execute("SELECT name FROM _migrations");
  return new Set(result.rows.map((r) => r.name));
}
async function acquireLock(client) {
  const now = Date.now();
  await client.execute({
    sql: "DELETE FROM _migrations_lock WHERE acquired_at < ?",
    args: [now - LOCK_TIMEOUT_MS]
  });
  try {
    await client.execute({
      sql: "INSERT INTO _migrations_lock (id, pid, acquired_at) VALUES (1, ?, ?)",
      args: [process.pid, now]
    });
  } catch {
    const held = await client.execute("SELECT pid, acquired_at FROM _migrations_lock WHERE id = 1");
    const row = held.rows[0];
    throw new Error(`[apsolut-cortex] migration lock held by pid ${row?.pid} since ${new Date(row?.acquired_at).toISOString()}. If this is stale, run: DELETE FROM _migrations_lock;`);
  }
}
async function releaseLock(client) {
  await client.execute("DELETE FROM _migrations_lock WHERE id = 1");
}

// src/keyring.ts
import { Entry } from "@napi-rs/keyring";
import { randomBytes } from "crypto";
var KEYRING_SERVICE = "apsolut-cortex";
var KEYRING_ACCOUNT_DB_KEY = "db-encryption-key";
function getDbKey(service = KEYRING_SERVICE, account = KEYRING_ACCOUNT_DB_KEY) {
  const entry = new Entry(service, account);
  try {
    return entry.getPassword();
  } catch (e) {
    const msg = e instanceof Error ? e.message.toLowerCase() : String(e);
    if (msg.includes("not found") || msg.includes("no matching") || msg.includes("does not exist") || msg.includes("the specified item could not be found")) {
      return null;
    }
    throw new Error(`[apsolut-cortex] keychain read failed (${service}/${account}): ${e}`);
  }
}
function setDbKey(key, service = KEYRING_SERVICE, account = KEYRING_ACCOUNT_DB_KEY) {
  const entry = new Entry(service, account);
  entry.setPassword(key);
}
function generateDbKey() {
  return randomBytes(32).toString("hex");
}

// src/db.ts
var CORTEX_DIR = join(homedir(), ".apsolut-cortex");
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
    let key = null;
    try {
      key = getDbKey();
    } catch (e) {
      process.stderr.write(`[apsolut-cortex] keychain unreachable; opening DB without encryption. (${e})
`);
    }
    _db = key ? createClient({ url: `file:${DB_PATH}`, encryptionKey: key }) : createClient({ url: `file:${DB_PATH}` });
  }
  if (!_initialized) {
    await runMigrations(_db);
    _initialized = true;
  }
  return _db;
}
function vecToSql(arr) {
  return JSON.stringify(Array.from(arr));
}
async function insertMemory(db, m) {
  const id = crypto.randomUUID();
  if (m.embedding) {
    await db.execute({
      sql: `INSERT INTO memories
              (id, project_id, tier, category, trust, content, context,
               source, embedding, weight, used_count, created_at, session_id)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, vector(?), ?, 0, ?, ?)`,
      args: [
        id,
        m.project_id,
        m.tier,
        m.category,
        m.trust,
        m.content,
        m.context ?? null,
        m.source,
        vecToSql(m.embedding),
        m.weight,
        Date.now(),
        m.session_id ?? null
      ]
    });
  } else {
    await db.execute({
      sql: `INSERT INTO memories
              (id, project_id, tier, category, trust, content, context,
               source, embedding, weight, used_count, created_at, session_id)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)`,
      args: [
        id,
        m.project_id,
        m.tier,
        m.category,
        m.trust,
        m.content,
        m.context ?? null,
        m.source,
        m.weight,
        Date.now(),
        m.session_id ?? null
      ]
    });
  }
  return id;
}
var GREP_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "do",
  "does",
  "for",
  "from",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "such",
  "that",
  "the",
  "this",
  "to",
  "use",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "you"
]);

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

// src/logs.ts
import { appendFileSync, existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { dirname as dirname2, join as join2 } from "path";
var LOGS_DIR = join2(homedir2(), ".apsolut-cortex", "logs");
var RETRIEVALS_PATH = join2(LOGS_DIR, "retrievals.jsonl");
var CORRECTIONS_PATH = join2(LOGS_DIR, "corrections.jsonl");
var SHADOW_PATH = join2(LOGS_DIR, "shadow.jsonl");
function appendJsonl(path, entry) {
  try {
    const dir = dirname2(path);
    if (!existsSync3(dir))
      mkdirSync3(dir, { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + `
`);
  } catch (e) {
    process.stderr.write(`[apsolut-cortex] log write failed (${path}): ${e}
`);
  }
}
function logCorrection(entry) {
  appendJsonl(CORRECTIONS_PATH, entry);
}
function getLastRetrieval() {
  if (!existsSync3(RETRIEVALS_PATH))
    return null;
  const text = readFileSync2(RETRIEVALS_PATH, "utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0)
    return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

// src/embed.ts
import { pipeline, env } from "@huggingface/transformers";
env.cacheDir = MODELS_DIR;
env.allowRemoteModels = true;
var _embedder = null;
async function getEmbedder() {
  if (_embedder)
    return _embedder;
  _embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  return _embedder;
}
async function embed(text) {
  const e = await getEmbedder();
  const out = await e(text, { pooling: "mean", normalize: true });
  return out.data;
}

// src/backup.ts
import {
  copyFileSync,
  existsSync as existsSync4,
  mkdirSync as mkdirSync4,
  readdirSync,
  renameSync as renameSync2,
  statSync,
  unlinkSync
} from "fs";
import { join as join3 } from "path";
import { createClient as createClient2 } from "@libsql/client";
async function unlinkRetry(path, attempts = 10) {
  for (let i = 0;i < attempts; i++) {
    try {
      unlinkSync(path);
      return;
    } catch (e) {
      const code = e.code;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOENT")
        throw e;
      if (code === "ENOENT")
        return;
      await new Promise((r) => setTimeout(r, 25 + i * 25));
    }
  }
  unlinkSync(path);
}
async function renameRetry(from, to, attempts = 10) {
  for (let i = 0;i < attempts; i++) {
    try {
      renameSync2(from, to);
      return;
    } catch (e) {
      const code = e.code;
      if (code !== "EBUSY" && code !== "EPERM")
        throw e;
      await new Promise((r) => setTimeout(r, 25 + i * 25));
    }
  }
  renameSync2(from, to);
}
var BACKUP_DIR = join3(CORTEX_DIR, "backup");
function timestamp() {
  const d = new Date;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function ensureBackupDir() {
  if (!existsSync4(BACKUP_DIR))
    mkdirSync4(BACKUP_DIR, { recursive: true });
}
function snapshot(label = "manual") {
  if (!existsSync4(DB_PATH)) {
    throw new Error(`[apsolut-cortex] no DB at ${DB_PATH} — nothing to back up`);
  }
  ensureBackupDir();
  const dest = join3(BACKUP_DIR, `${label}-${timestamp()}.db`);
  copyFileSync(DB_PATH, dest);
  return dest;
}
function listBackups() {
  if (!existsSync4(BACKUP_DIR))
    return [];
  return readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".db")).map((f) => {
    const path = join3(BACKUP_DIR, f);
    const s = statSync(path);
    return { path, bytes: s.size, mtime: s.mtime };
  }).sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
function restore(snapshotPath) {
  if (!existsSync4(snapshotPath)) {
    throw new Error(`[apsolut-cortex] snapshot not found: ${snapshotPath}`);
  }
  let safetyBackup = null;
  if (existsSync4(DB_PATH)) {
    safetyBackup = snapshot("pre-restore");
  }
  const tmp = `${DB_PATH}.restoring`;
  copyFileSync(snapshotPath, tmp);
  for (const ext of ["-wal", "-shm"]) {
    const sidecar = `${DB_PATH}${ext}`;
    if (existsSync4(sidecar)) {
      try {
        unlinkSync(sidecar);
      } catch {}
    }
  }
  if (existsSync4(DB_PATH)) {
    let attempts = 0;
    while (existsSync4(DB_PATH) && attempts < 10) {
      try {
        unlinkSync(DB_PATH);
        break;
      } catch {
        attempts++;
      }
      const deadline = Date.now() + 25 + attempts * 25;
      while (Date.now() < deadline) {}
    }
  }
  renameSync2(tmp, DB_PATH);
  return { restored: snapshotPath, safetyBackup };
}
var COPY_TABLES = [
  "projects",
  "sessions",
  "observations",
  "memories",
  "file_hashes"
];
async function copyTable(src, dst, table) {
  const rows = await src.execute(`SELECT * FROM ${table}`);
  if (rows.rows.length === 0)
    return 0;
  const columns = rows.columns;
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
  await dst.batch(rows.rows.map((r) => ({
    sql,
    args: columns.map((c) => r[c])
  })), "write");
  return rows.rows.length;
}
async function reencryptPathToKey(sourcePath, encryptionKey) {
  if (!existsSync4(sourcePath)) {
    throw new Error(`[apsolut-cortex] no DB at ${sourcePath} — cannot re-encrypt`);
  }
  const newPath = `${sourcePath}.new`;
  if (existsSync4(newPath))
    unlinkSync(newPath);
  const src = createClient2({ url: `file:${sourcePath}` });
  let dst = null;
  const rowsCopied = {};
  try {
    dst = createClient2({ url: `file:${newPath}`, encryptionKey });
    await runMigrations(dst);
    for (const table of COPY_TABLES) {
      rowsCopied[table] = await copyTable(src, dst, table);
    }
  } catch (err) {
    if (dst) {
      try {
        dst.close();
      } catch {}
    }
    try {
      src.close();
    } catch {}
    if (existsSync4(newPath)) {
      try {
        unlinkSync(newPath);
      } catch {}
    }
    throw new Error(`[apsolut-cortex] re-encryption failed before swap; original untouched. Cause: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    dst.close();
  } catch {}
  try {
    src.close();
  } catch {}
  for (const ext of ["-wal", "-shm"]) {
    const sidecar = `${sourcePath}${ext}`;
    if (existsSync4(sidecar)) {
      try {
        await unlinkRetry(sidecar);
      } catch {}
    }
  }
  await unlinkRetry(sourcePath);
  await renameRetry(newPath, sourcePath);
  return { rows_copied: rowsCopied, new_path: sourcePath };
}
async function reencryptToKey(encryptionKey) {
  const sourceBackup = snapshot("pre-encrypt");
  const { rows_copied } = await reencryptPathToKey(DB_PATH, encryptionKey);
  return { source_backup: sourceBackup, rows_copied, new_db_path: DB_PATH };
}

// src/cli.ts
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = dirname3(__filename2);
var PACKAGE_ROOT = resolve(__dirname2, "..");
var IS_DIST = __dirname2.endsWith("dist") || __dirname2.includes(`${process.sep}dist${process.sep}`);
var PKG_VERSION = JSON.parse(readFileSync3(join4(PACKAGE_ROOT, "package.json"), "utf-8")).version;
var PROJECT_ROOT = process.cwd();
var CLAUDE_SETTINGS = join4(homedir3(), ".claude", "settings.json");
var MCP_JSON = join4(PROJECT_ROOT, ".mcp.json");
var PROJECT_APSOLUT = join4(PROJECT_ROOT, ".apsolut-cortex");
var PROJECT_CONFIG = join4(PROJECT_APSOLUT, "project.json");
var cmd = process.argv[2];
switch (cmd) {
  case "init":
    await init();
    break;
  case "status":
    await status();
    break;
  case "migrate":
    await migrate();
    break;
  case "correct":
    await correctCmd(process.argv.slice(3));
    break;
  case "backup":
    await backupCmd();
    break;
  case "restore":
    await restoreCmd(process.argv[3], process.argv.slice(4));
    break;
  case "db":
    await dbCmd(process.argv[3], process.argv.slice(4));
    break;
  case "eval":
    await evalCmd(process.argv[3]);
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
  │    migrate     Apply pending schema migrations   │
  │    correct     Flag last retrieval as a miss     │
  │    backup      Snapshot the DB                   │
  │    restore     Restore a snapshot                │
  │    db re-encrypt  Migrate DB to encrypted        │
  │    uninstall   Remove hooks & MCP config         │
  │    help        Show this help                    │
  ├──────────────────────────────────────────────────┤
  │  DB:     ~/.apsolut-cortex/memory.db             │
  │  Models: ~/.apsolut-cortex/models/               │
  └──────────────────────────────────────────────────┘
`);
}
async function runHook(name) {
  const hookPath = IS_DIST ? join4(PACKAGE_ROOT, "scripts", `${name}.js`) : join4(__dirname2, "hooks", `${name}.ts`);
  if (!existsSync5(hookPath)) {
    process.stderr.write(`[apsolut-cortex] hook not found: ${hookPath}
`);
    process.exit(0);
  }
  await import(pathToFileURL(hookPath).href);
}
async function init() {
  console.log(`
[apsolut-cortex] init
`);
  if (!existsSync5(PROJECT_APSOLUT)) {
    mkdirSync5(PROJECT_APSOLUT, { recursive: true });
  }
  let projectId;
  let projectName;
  if (existsSync5(PROJECT_CONFIG)) {
    const existing = JSON.parse(readFileSync3(PROJECT_CONFIG, "utf-8"));
    projectId = existing.id;
    projectName = existing.name;
    console.log(`[apsolut-cortex] ✓ Project already initialised: ${projectName}`);
  } else {
    projectId = crypto.randomUUID();
    projectName = PROJECT_ROOT.split(/[\\/]/).filter(Boolean).pop() ?? "project";
    writeFileSync2(PROJECT_CONFIG, JSON.stringify({
      id: projectId,
      name: projectName,
      created_at: new Date().toISOString()
    }, null, 2));
    console.log(`[apsolut-cortex] ✓ Created .apsolut-cortex/project.json`);
    console.log(`[apsolut-cortex]   ID:   ${projectId}`);
    console.log(`[apsolut-cortex]   Name: ${projectName}`);
  }
  registerProject(projectId, projectName, PROJECT_ROOT);
  console.log(`[apsolut-cortex] ✓ Registered in ~/.apsolut-cortex/registry.json`);
  const mcpServerPath = IS_DIST ? join4(__dirname2, "mcp", "server.js") : join4(__dirname2, "mcp", "server.ts");
  const mcpCommand = IS_DIST ? "node" : "bun";
  const mcpArgs = [mcpServerPath];
  let mcp = {};
  if (existsSync5(MCP_JSON)) {
    try {
      mcp = JSON.parse(readFileSync3(MCP_JSON, "utf-8"));
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
  console.log(`[apsolut-cortex] ✓ Written .mcp.json`);
  const hookCmd = IS_DIST ? "apsolut-cortex" : `bun run "${join4(__dirname2, "cli.ts").replace(/\\/g, "/")}"`;
  const hookEntries = {
    SessionStart: [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:session-start` }] }],
    PostToolUse: [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:post-tool-use` }] }],
    Stop: [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:stop` }] }],
    SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:session-end` }] }]
  };
  let settings = {};
  const settingsDir = dirname3(CLAUDE_SETTINGS);
  if (!existsSync5(settingsDir))
    mkdirSync5(settingsDir, { recursive: true });
  if (existsSync5(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(readFileSync3(CLAUDE_SETTINGS, "utf-8"));
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
  console.log(added > 0 ? `[apsolut-cortex] ✓ Registered ${added} hooks in ~/.claude/settings.json` : `[apsolut-cortex] ✓ Hooks already registered`);
  const SKILL_NAMES = ["apsolut-recall", "apsolut-store", "apsolut-status", "apsolut-forget"];
  const skillsSource = join4(PACKAGE_ROOT, "skills");
  const skillsTarget = join4(homedir3(), ".claude", "skills");
  if (!existsSync5(skillsTarget))
    mkdirSync5(skillsTarget, { recursive: true });
  const OLD_SKILL_NAMES = ["remember", "store", "status", "forget"];
  for (const old of OLD_SKILL_NAMES) {
    const oldSkill = join4(skillsTarget, old, "SKILL.md");
    if (existsSync5(oldSkill)) {
      const content = readFileSync3(oldSkill, "utf-8");
      if (content.includes("memory_")) {
        rmSync(join4(skillsTarget, old), { recursive: true, force: true });
      }
    }
  }
  let skillsCopied = 0;
  for (const name of SKILL_NAMES) {
    const src = join4(skillsSource, name, "SKILL.md");
    const destDir = join4(skillsTarget, name);
    const dest = join4(destDir, "SKILL.md");
    if (!existsSync5(src))
      continue;
    const srcContent = readFileSync3(src, "utf-8");
    if (existsSync5(dest) && readFileSync3(dest, "utf-8") === srcContent)
      continue;
    if (!existsSync5(destDir))
      mkdirSync5(destDir, { recursive: true });
    writeFileSync2(dest, srcContent);
    skillsCopied++;
  }
  console.log(skillsCopied > 0 ? `[apsolut-cortex] ✓ Copied ${skillsCopied} skills to ~/.claude/skills/ (/${SKILL_NAMES.join(", /")})` : `[apsolut-cortex] ✓ Skills already installed`);
  const gitignore = join4(PROJECT_ROOT, ".gitignore");
  if (existsSync5(gitignore)) {
    const content = readFileSync3(gitignore, "utf-8");
    if (!content.includes(".apsolut-cortex/")) {
      writeFileSync2(gitignore, content + `
# apsolut-cortex
.apsolut-cortex/
`);
      console.log(`[apsolut-cortex] ✓ Added .apsolut-cortex/ to .gitignore`);
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
  ${g("✓")}  memory     ~/.apsolut-cortex/memory.db
  ${g("✓")}  models     ~/.apsolut-cortex/models/

  ${d("──────────────────────────────────────────────────────────")}

  Restart Claude Code, then say ${y('"/apsolut-recall <topic>"')} to search.
  compression: ANTHROPIC_API_KEY → ollama fallback → loud error

`;
  console.log(BANNER);
}
async function status() {
  if (!existsSync5(PROJECT_CONFIG)) {
    console.log("[apsolut-cortex] No project found. Run: apsolut-cortex init");
    process.exit(1);
  }
  const project = JSON.parse(readFileSync3(PROJECT_CONFIG, "utf-8"));
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
      const summary = r.summary.length > W - 14 ? r.summary.slice(0, W - 17) + "..." : r.summary;
      console.log(`  ${bl(`  ${age}d ago: ${summary}`)}`);
    });
  }
  console.log(`  ├${hr}┤`);
  console.log(`  ${bl("DB: ~/.apsolut-cortex/memory.db")}`);
  console.log(`  └${hr}┘
`);
}
async function migrate() {
  const db = await getDb();
  const result = await runMigrations(db);
  if (result.applied.length === 0) {
    console.log(`[apsolut-cortex] ✓ Schema up to date (${result.skipped.length} migrations on record)`);
  } else {
    console.log(`[apsolut-cortex] ✓ Applied ${result.applied.length} migration(s):`);
    for (const name of result.applied)
      console.log(`  + ${name}`);
    if (result.skipped.length > 0) {
      console.log(`[apsolut-cortex]   Skipped ${result.skipped.length} already-applied migration(s)`);
    }
  }
}
async function correctCmd(args) {
  const withIdx = args.findIndex((a) => a === "--with");
  const correctionText = withIdx >= 0 && args[withIdx + 1] ? args.slice(withIdx + 1).join(" ") : null;
  const last = getLastRetrieval();
  if (!last) {
    console.log("[apsolut-cortex] No retrievals on record yet — nothing to correct.");
    console.log("[apsolut-cortex] (Retrievals are logged to ~/.apsolut-cortex/logs/retrievals.jsonl when Claude calls memory_search.)");
    return;
  }
  console.log(`[apsolut-cortex] Last retrieval:`);
  console.log(`  query:   ${last.query}`);
  console.log(`  project: ${last.project_name}`);
  console.log(`  matches: ${last.candidates.length} (${last.injected_ids.length} injected)`);
  let correctionMemoryId = null;
  if (correctionText) {
    const db = await getDb();
    let embedding = null;
    try {
      embedding = await embed(correctionText);
    } catch (e) {
      console.error(`[apsolut-cortex] embedding failed for correction: ${e}`);
    }
    correctionMemoryId = await insertMemory(db, {
      project_id: last.project_id,
      tier: "episodic",
      category: "correction",
      trust: "observed",
      content: correctionText,
      context: `Correction for query: "${last.query}"`,
      source: "correction-cli",
      embedding,
      weight: CORTEX_CORRECTION_WEIGHT,
      session_id: null
    });
    console.log(`[apsolut-cortex] ✓ Stored correction memory ${correctionMemoryId}`);
  }
  logCorrection({
    ts: Date.now(),
    retrieval_ts: last.ts,
    retrieval_query: last.query,
    is_miss: true,
    correction_memory_id: correctionMemoryId,
    correction_text: correctionText
  });
  console.log(`[apsolut-cortex] ✓ Flagged retrieval as a miss in ~/.apsolut-cortex/logs/corrections.jsonl`);
  if (!correctionText) {
    console.log(`[apsolut-cortex]   (pass --with "<correct answer>" to also store the fix as a new memory)`);
  }
}
async function backupCmd() {
  const dest = snapshot("manual");
  console.log(`[apsolut-cortex] ✓ Snapshot written to ${dest}`);
  console.log(`[apsolut-cortex]   (encrypted at rest if key is set in the OS keychain)`);
  const all = listBackups();
  if (all.length > 1) {
    console.log(`[apsolut-cortex]   ${all.length} total snapshots under ${BACKUP_DIR}`);
  }
}
async function restoreCmd(target, args) {
  if (!target) {
    const all = listBackups();
    if (all.length === 0) {
      console.log(`[apsolut-cortex] No snapshots in ${BACKUP_DIR}`);
      return;
    }
    console.log(`[apsolut-cortex] Available snapshots (newest first):`);
    for (const b of all.slice(0, 20)) {
      const kb = Math.round(b.bytes / 1024);
      console.log(`  ${b.mtime.toISOString()}  ${kb.toString().padStart(6)}KB  ${b.path}`);
    }
    console.log(`
[apsolut-cortex] Restore one with: apsolut-cortex restore <path> --yes`);
    return;
  }
  if (!args.includes("--yes")) {
    console.log(`[apsolut-cortex] Refusing to overwrite ${DB_PATH} without --yes.`);
    console.log(`[apsolut-cortex] A safety snapshot will be taken first if you confirm:`);
    console.log(`    apsolut-cortex restore ${target} --yes`);
    return;
  }
  const result = restore(target);
  console.log(`[apsolut-cortex] ✓ Restored ${result.restored} → ${DB_PATH}`);
  if (result.safetyBackup) {
    console.log(`[apsolut-cortex]   Pre-restore safety snapshot at ${result.safetyBackup}`);
  }
}
async function dbCmd(sub, args) {
  switch (sub) {
    case "re-encrypt": {
      const existing = getDbKey();
      if (existing) {
        console.log(`[apsolut-cortex] An encryption key is already set in the OS keychain.`);
        console.log(`[apsolut-cortex] If the DB is already encrypted, nothing to do.`);
        console.log(`[apsolut-cortex] If you need to rotate the key, that flow is not implemented yet — back up and ask.`);
        return;
      }
      if (!args.includes("--yes")) {
        console.log(`[apsolut-cortex] db re-encrypt`);
        console.log(`  - generates a new 256-bit key, stores it in the OS keychain`);
        console.log(`  - snapshots the current DB to ~/.apsolut-cortex/backup/pre-encrypt-<ts>.db`);
        console.log(`  - copies every row into a fresh encrypted DB`);
        console.log(`  - atomically replaces the live DB`);
        console.log(`
  The pre-encrypt backup is never deleted. If anything goes wrong`);
        console.log(`  you can copy it back over memory.db to recover.`);
        console.log(`
  Run again with --yes to proceed:`);
        console.log(`    apsolut-cortex db re-encrypt --yes`);
        return;
      }
      console.log(`[apsolut-cortex] Generating key and re-encrypting DB...`);
      const key = generateDbKey();
      setDbKey(key);
      try {
        const result = await reencryptToKey(key);
        console.log(`[apsolut-cortex] ✓ Re-encryption complete.`);
        console.log(`  pre-encrypt backup: ${result.source_backup}`);
        for (const [tbl, n] of Object.entries(result.rows_copied)) {
          console.log(`  ${tbl.padEnd(15)} ${n.toString().padStart(6)} rows copied`);
        }
        console.log(`
  Encryption key is in the OS keychain (service "apsolut-cortex",`);
        console.log(`  account "db-encryption-key"). The DB is unreadable without it.`);
      } catch (e) {
        console.log(`[apsolut-cortex] ✗ Re-encryption failed: ${e instanceof Error ? e.message : e}`);
        console.log(`[apsolut-cortex] The original DB is untouched. The key was already saved`);
        console.log(`[apsolut-cortex] to the keychain — delete it manually if you don't intend to`);
        console.log(`[apsolut-cortex] retry, or the next startup will fail on the unencrypted DB.`);
        process.exitCode = 1;
      }
      break;
    }
    default:
      console.log(`[apsolut-cortex] db — subcommands:`);
      console.log(`  apsolut-cortex db re-encrypt   Migrate the DB to encrypted at rest`);
      break;
  }
}
async function evalCmd(subcommand) {
  if (IS_DIST) {
    console.log("[apsolut-cortex] `eval` is a maintainer-only command.");
    console.log("[apsolut-cortex] Run it from a cloned repo:");
    console.log("    git clone https://github.com/apsolut/apsolut-cortex.git");
    console.log("    cd apsolut-cortex && bun install");
    console.log("    bun run src/cli.ts eval run");
    return;
  }
  const evalsRoot = join4(PACKAGE_ROOT, "evals");
  const runnerModule = pathToFileURL(join4(evalsRoot, "runner.ts")).href;
  const {
    runEvals,
    formatResult,
    saveBaseline,
    loadBaseline,
    formatComparison
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
function uninstall() {
  if (existsSync5(MCP_JSON)) {
    try {
      const mcp = JSON.parse(readFileSync3(MCP_JSON, "utf-8"));
      if (mcp.mcpServers?.["apsolut-cortex"]) {
        delete mcp.mcpServers["apsolut-cortex"];
        writeFileSync2(MCP_JSON, JSON.stringify(mcp, null, 2));
        console.log("[apsolut-cortex] ✓ Removed from .mcp.json");
      }
    } catch {}
  }
  if (existsSync5(CLAUDE_SETTINGS)) {
    try {
      const settings = JSON.parse(readFileSync3(CLAUDE_SETTINGS, "utf-8"));
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
        console.log("[apsolut-cortex] ✓ Removed hooks from ~/.claude/settings.json");
      }
    } catch {}
  }
  const SKILL_NAMES = ["apsolut-recall", "apsolut-store", "apsolut-status", "apsolut-forget", "remember", "store", "status", "forget"];
  const skillsDir = join4(homedir3(), ".claude", "skills");
  let skillsRemoved = 0;
  for (const name of SKILL_NAMES) {
    const skillFile = join4(skillsDir, name, "SKILL.md");
    if (existsSync5(skillFile)) {
      const content = readFileSync3(skillFile, "utf-8");
      if (content.includes("memory_")) {
        rmSync(join4(skillsDir, name), { recursive: true, force: true });
        skillsRemoved++;
      }
    }
  }
  if (skillsRemoved > 0) {
    console.log(`[apsolut-cortex] ✓ Removed ${skillsRemoved} skills from ~/.claude/skills/`);
  }
  console.log(`
[apsolut-cortex] Uninstalled. DB at ~/.apsolut-cortex/memory.db kept.
`);
}
