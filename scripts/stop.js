// src/hooks/stop.ts
import { readFileSync, existsSync as existsSync2 } from "fs";
import { join as join2 } from "path";

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
async function upsertSession(db, s) {
  const existing = await db.execute({
    sql: "SELECT id FROM sessions WHERE id = ?",
    args: [s.id]
  });
  if (existing.rows.length > 0) {
    const sets = [];
    const vals = [];
    if (s.ended_at !== undefined) {
      sets.push("ended_at = ?");
      vals.push(s.ended_at);
    }
    if (s.summary !== undefined) {
      sets.push("summary = ?");
      vals.push(s.summary);
    }
    if (s.memories_stored !== undefined) {
      sets.push("memories_stored = ?");
      vals.push(s.memories_stored);
    }
    if (s.tool_failures !== undefined) {
      sets.push("tool_failures = ?");
      vals.push(s.tool_failures);
    }
    if (sets.length) {
      vals.push(s.id);
      await db.execute({ sql: `UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`, args: vals });
    }
  } else {
    await db.execute({
      sql: "INSERT INTO sessions (id, project_id, started_at) VALUES (?, ?, ?)",
      args: [s.id, s.project_id, Date.now()]
    });
  }
}
async function insertObservation(db, obs) {
  await db.execute({
    sql: `INSERT INTO observations (id, session_id, project_id, tool_name, content, category, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      obs.session_id,
      obs.project_id,
      obs.tool_name ?? null,
      obs.content,
      obs.category ?? null,
      Date.now()
    ]
  });
}

// src/privacy.ts
function stripPrivate(text) {
  let result = text;
  let start;
  while ((start = result.toLowerCase().indexOf("<private>")) !== -1) {
    const end = result.toLowerCase().indexOf("</private>", start);
    if (end === -1)
      break;
    result = result.slice(0, start) + result.slice(end + "</private>".length);
  }
  const stripped = result.trim();
  return stripped.length > 0 ? stripped : null;
}

// src/hooks/stop.ts
var CORRECTION_PATTERNS = [
  /actually,?\s+(?:the|it'?s?|that'?s?)\s+(.{20,150})/gi,
  /(?:my mistake|i was wrong|incorrect)[^.]*[.!]\s*(.{20,150})/gi,
  /(?:wait|oops)[,.]?\s+(.{20,150})/gi,
  /(?:turns? out|it seems?)\s+(.{20,150})/gi,
  /(?:should(?:n'?t)? have|shouldn'?t).{0,30}[—–-]\s*(.{20,150})/gi,
  /(?:the correct|correct(?:ly)?)\s+(?:way|path|file|approach)\s+is\s+(.{20,150})/gi
];
function extractCorrections(transcript) {
  const found = [];
  for (const pattern of CORRECTION_PATTERNS) {
    let match;
    while ((match = pattern.exec(transcript)) !== null) {
      const text = match[1]?.trim();
      if (text && text.length > 20 && text.length < 200) {
        found.push(`Self-correction: ${text}`);
      }
    }
  }
  return [...new Set(found)].slice(0, 5);
}
async function main() {
  const raw = await new Promise((resolve) => {
    let d = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => d += c);
    process.stdin.on("end", () => resolve(d));
  });
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  if (!data.transcript)
    process.exit(0);
  const cleaned = stripPrivate(data.transcript);
  if (!cleaned)
    process.exit(0);
  data.transcript = cleaned;
  const cwd = data.cwd ?? process.cwd();
  const sessionId = data.session_id ?? "unknown";
  const projectFile = join2(cwd, ".apsolut", "project.json");
  if (!existsSync2(projectFile))
    process.exit(0);
  let project = null;
  try {
    project = JSON.parse(readFileSync(projectFile, "utf-8"));
  } catch {
    process.exit(0);
  }
  if (!project?.id)
    process.exit(0);
  try {
    const db = await getDb();
    await upsertSession(db, { id: sessionId, project_id: project.id });
    const corrections = extractCorrections(data.transcript);
    for (const correction of corrections) {
      await insertObservation(db, {
        session_id: sessionId,
        project_id: project.id,
        content: correction,
        category: "correction"
      });
    }
  } catch {
    process.exit(0);
  }
}
main();
