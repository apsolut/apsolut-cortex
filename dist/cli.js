#!/usr/bin/env node
import { createRequire } from "node:module";
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/config.ts
function envNum(key, fallback) {
  const val = process.env[key];
  if (val === undefined)
    return fallback;
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function envStr(key, fallback) {
  const val = process.env[key]?.trim();
  return val ? val : fallback;
}
var CORTEX_ANTHROPIC_MODEL, CORTEX_OLLAMA_MODEL, CORTEX_DUPLICATE_THRESHOLD, CORTEX_DECAY_DAYS, CORTEX_DECAY_OBSERVED, CORTEX_DECAY_VALIDATED, CORTEX_PRUNE_WEIGHT, CORTEX_RRF_K, CORTEX_MMR_LAMBDA, CORTEX_SEARCH_LIMIT_MAX, CORTEX_SEARCH_MULTIPLIER, CORTEX_WEIGHT_ALPHA, CORTEX_PROMOTE_WEIGHT, CORTEX_PROMOTE_USES, CORTEX_BUMP_BOOST, CORTEX_WEIGHT_CAP, CORTEX_CORRECTION_WEIGHT, CORTEX_MANUAL_WEIGHT, CORTEX_RAW_RETENTION_DAYS, CORTEX_UNPROCESSED_BATCH, CORTEX_RECALL_TOKEN_BUDGET, CORTEX_OBSERVE_THRESHOLD, CORTEX_OBSERVE_BLOCK_MULT, CORTEX_REFLECT_THRESHOLD;
var init_config = __esm(() => {
  CORTEX_ANTHROPIC_MODEL = envStr("APSOLUT_CORTEX_ANTHROPIC_MODEL", "claude-haiku-4-5-20251001");
  CORTEX_OLLAMA_MODEL = envStr("APSOLUT_CORTEX_OLLAMA_MODEL", "qwen2.5-coder:7b");
  CORTEX_DUPLICATE_THRESHOLD = envNum("APSOLUT_CORTEX_DUPLICATE_THRESHOLD", 0.92);
  CORTEX_DECAY_DAYS = envNum("APSOLUT_CORTEX_DECAY_DAYS", 7);
  CORTEX_DECAY_OBSERVED = envNum("APSOLUT_CORTEX_DECAY_OBSERVED", 0.95);
  CORTEX_DECAY_VALIDATED = envNum("APSOLUT_CORTEX_DECAY_VALIDATED", 0.98);
  CORTEX_PRUNE_WEIGHT = envNum("APSOLUT_CORTEX_PRUNE_WEIGHT", 0.1);
  CORTEX_RRF_K = envNum("APSOLUT_CORTEX_RRF_K", 60);
  CORTEX_MMR_LAMBDA = envNum("APSOLUT_CORTEX_MMR_LAMBDA", 0.7);
  CORTEX_SEARCH_LIMIT_MAX = envNum("APSOLUT_CORTEX_SEARCH_LIMIT_MAX", 10);
  CORTEX_SEARCH_MULTIPLIER = envNum("APSOLUT_CORTEX_SEARCH_MULTIPLIER", 2);
  CORTEX_WEIGHT_ALPHA = envNum("APSOLUT_CORTEX_WEIGHT_ALPHA", 0.3);
  CORTEX_PROMOTE_WEIGHT = envNum("APSOLUT_CORTEX_PROMOTE_WEIGHT", 1.4);
  CORTEX_PROMOTE_USES = envNum("APSOLUT_CORTEX_PROMOTE_USES", 3);
  CORTEX_BUMP_BOOST = envNum("APSOLUT_CORTEX_BUMP_BOOST", 0.1);
  CORTEX_WEIGHT_CAP = envNum("APSOLUT_CORTEX_WEIGHT_CAP", 3);
  CORTEX_CORRECTION_WEIGHT = envNum("APSOLUT_CORTEX_CORRECTION_WEIGHT", 1.5);
  CORTEX_MANUAL_WEIGHT = envNum("APSOLUT_CORTEX_MANUAL_WEIGHT", 1.2);
  CORTEX_RAW_RETENTION_DAYS = envNum("APSOLUT_CORTEX_RAW_RETENTION_DAYS", 90);
  CORTEX_UNPROCESSED_BATCH = envNum("APSOLUT_CORTEX_UNPROCESSED_BATCH", 50);
  CORTEX_RECALL_TOKEN_BUDGET = envNum("APSOLUT_CORTEX_RECALL_TOKEN_BUDGET", 4000);
  CORTEX_OBSERVE_THRESHOLD = envNum("APSOLUT_CORTEX_OBSERVE_THRESHOLD", 30000);
  CORTEX_OBSERVE_BLOCK_MULT = envNum("APSOLUT_CORTEX_OBSERVE_BLOCK_MULT", 1.2);
  CORTEX_REFLECT_THRESHOLD = envNum("APSOLUT_CORTEX_REFLECT_THRESHOLD", 40000);
});

// src/migrations/001-initial-schema.ts
var migration, _001_initial_schema_default;
var init_001_initial_schema = __esm(() => {
  migration = {
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
  _001_initial_schema_default = migration;
});

// src/migrations/002-range-linked-memories.ts
var migration2, _002_range_linked_memories_default;
var init_002_range_linked_memories = __esm(() => {
  migration2 = {
    name: "002-range-linked-memories",
    async up(client) {
      const cols = await client.execute("PRAGMA table_info(memories)");
      const have = new Set(cols.rows.map((r) => r.name));
      if (!have.has("source_session_id")) {
        await client.execute("ALTER TABLE memories ADD COLUMN source_session_id TEXT");
      }
      if (!have.has("source_start_msg_idx")) {
        await client.execute("ALTER TABLE memories ADD COLUMN source_start_msg_idx INTEGER");
      }
      if (!have.has("source_end_msg_idx")) {
        await client.execute("ALTER TABLE memories ADD COLUMN source_end_msg_idx INTEGER");
      }
      await client.execute(`CREATE INDEX IF NOT EXISTS idx_mem_source_session
       ON memories(source_session_id, source_start_msg_idx)`);
    }
  };
  _002_range_linked_memories_default = migration2;
});

// src/migrations/003-raw-messages.ts
var migration3, _003_raw_messages_default;
var init_003_raw_messages = __esm(() => {
  migration3 = {
    name: "003-raw-messages",
    async up(client) {
      await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS raw_messages (
        session_id  TEXT NOT NULL,
        msg_idx     INTEGER NOT NULL,
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (session_id, msg_idx)
      );

      CREATE INDEX IF NOT EXISTS idx_raw_session_time
        ON raw_messages(session_id, created_at);
    `);
    }
  };
  _003_raw_messages_default = migration3;
});

// src/migrations/004-memory-tags.ts
var migration4, _004_memory_tags_default;
var init_004_memory_tags = __esm(() => {
  migration4 = {
    name: "004-memory-tags",
    async up(client) {
      await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS memory_tags (
        memory_id   TEXT NOT NULL,
        tag         TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (memory_id, tag)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_tags_tag
        ON memory_tags(tag, memory_id);
    `);
    }
  };
  _004_memory_tags_default = migration4;
});

// src/migrations/005-observation-prompt-id.ts
var migration5, _005_observation_prompt_id_default;
var init_005_observation_prompt_id = __esm(() => {
  migration5 = {
    name: "005-observation-prompt-id",
    async up(client) {
      const cols = await client.execute("PRAGMA table_info(observations)");
      const have = new Set(cols.rows.map((r) => r.name));
      if (!have.has("prompt_id")) {
        await client.execute("ALTER TABLE observations ADD COLUMN prompt_id TEXT");
      }
      await client.execute("CREATE INDEX IF NOT EXISTS idx_obs_prompt ON observations(prompt_id)");
    }
  };
  _005_observation_prompt_id_default = migration5;
});

// src/migrations/006-decay-clock.ts
var migration6, _006_decay_clock_default;
var init_006_decay_clock = __esm(() => {
  migration6 = {
    name: "006-decay-clock",
    async up(client) {
      const cols = await client.execute("PRAGMA table_info(memories)");
      const hasColumn = cols.rows.some((r) => r.name === "last_decay_at");
      if (!hasColumn) {
        await client.execute("ALTER TABLE memories ADD COLUMN last_decay_at INTEGER");
      }
      await client.executeMultiple(`
      CREATE INDEX IF NOT EXISTS idx_mem_decay
        ON memories(project_id, last_decay_at);

      CREATE INDEX IF NOT EXISTS idx_raw_created
        ON raw_messages(created_at);
    `);
    }
  };
  _006_decay_clock_default = migration6;
});

// src/migrations/runner.ts
async function runMigrations(client, migrations = MIGRATIONS) {
  await ensureMigrationsTable(client);
  const preApplied = await getAppliedNames(client);
  if (migrations.every((m) => preApplied.has(m.name))) {
    return { applied: [], skipped: migrations.map((m) => m.name) };
  }
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
  const deadline = Date.now() + LOCK_WAIT_MS;
  let holder = null;
  for (;; ) {
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
      return;
    } catch {
      const held = await client.execute("SELECT pid, acquired_at FROM _migrations_lock WHERE id = 1");
      const row = held.rows[0];
      if (row) {
        holder = `pid ${row.pid} since ${new Date(Number(row.acquired_at)).toISOString()}`;
      }
      if (Date.now() >= deadline)
        break;
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  throw new Error(`[apsolut-cortex] migration lock still held after ${LOCK_WAIT_MS}ms` + `${holder ? ` (${holder})` : ""}. If this is stale, run: DELETE FROM _migrations_lock;`);
}
async function releaseLock(client) {
  await client.execute("DELETE FROM _migrations_lock WHERE id = 1");
}
var MIGRATIONS, LOCK_TIMEOUT_MS = 30000, LOCK_WAIT_MS = 5000, LOCK_RETRY_MS = 50;
var init_runner = __esm(() => {
  init_001_initial_schema();
  init_002_range_linked_memories();
  init_003_raw_messages();
  init_004_memory_tags();
  init_005_observation_prompt_id();
  init_006_decay_clock();
  MIGRATIONS = [
    _001_initial_schema_default,
    _002_range_linked_memories_default,
    _003_raw_messages_default,
    _004_memory_tags_default,
    _005_observation_prompt_id_default,
    _006_decay_clock_default
  ];
});

// src/keyring.ts
import { createRequire as createRequire2 } from "module";
import { randomBytes } from "crypto";
function getDbKey(service = KEYRING_SERVICE, account = KEYRING_ACCOUNT_DB_KEY) {
  if (!_EntryCtor)
    return null;
  const entry = new _EntryCtor(service, account);
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
  if (!_EntryCtor) {
    throw new Error(`[apsolut-cortex] OS keychain backend is unavailable on this platform/install, ` + `so encryption can't be enabled. (${_loadError ?? "no backend loaded"})`);
  }
  const entry = new _EntryCtor(service, account);
  entry.setPassword(key);
}
function generateDbKey() {
  return randomBytes(32).toString("hex");
}
var KEYRING_SERVICE = "apsolut-cortex", KEYRING_ACCOUNT_DB_KEY = "db-encryption-key", _EntryCtor = null, _loadError = null;
var init_keyring = __esm(() => {
  try {
    const require2 = createRequire2(import.meta.url);
    _EntryCtor = require2("@napi-rs/keyring").Entry;
  } catch (e) {
    _loadError = e;
  }
});

// src/validate.ts
function isTier(v) {
  return typeof v === "string" && MEMORY_TIERS.includes(v);
}
function isCategory(v) {
  return typeof v === "string" && MEMORY_CATEGORIES.includes(v);
}
function isTrust(v) {
  return typeof v === "string" && TRUST_LEVELS.includes(v);
}
function coerceTier(v, fallback = "semantic") {
  return isTier(v) ? v : fallback;
}
function coerceCategory(v, fallback = "insight") {
  return isCategory(v) ? v : fallback;
}
function clampText(text, max) {
  const trimmed = text.trim();
  if (trimmed.length === 0)
    return null;
  if (trimmed.length <= max)
    return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut;
  return `${body} […truncated]`;
}
var MEMORY_TIERS, MEMORY_CATEGORIES, TRUST_LEVELS, CONTENT_MAX = 4000, CONTEXT_MAX = 2000;
var init_validate = __esm(() => {
  MEMORY_TIERS = [
    "episodic",
    "semantic",
    "procedural",
    "strategic",
    "meta"
  ];
  MEMORY_CATEGORIES = [
    "correction",
    "insight",
    "decision",
    "discovery",
    "fact",
    "pattern"
  ];
  TRUST_LEVELS = [
    "observed",
    "validated",
    "proven",
    "canonical"
  ];
});

// src/paths.ts
import { homedir } from "os";
import { join } from "path";
var CORTEX_DIR, DB_PATH, REGISTRY_PATH, MODELS_DIR;
var init_paths = __esm(() => {
  CORTEX_DIR = join(homedir(), ".apsolut-cortex");
  DB_PATH = join(CORTEX_DIR, "memory.db");
  REGISTRY_PATH = join(CORTEX_DIR, "registry.json");
  MODELS_DIR = join(CORTEX_DIR, "models");
});

// src/db.ts
var exports_db = {};
__export(exports_db, {
  upsertSession: () => upsertSession,
  upsertProject: () => upsertProject,
  updateWeight: () => updateWeight,
  snapshotFileHashes: () => snapshotFileHashes,
  setMemoryEmbedding: () => setMemoryEmbedding,
  searchVector: () => searchVector,
  searchGrep: () => searchGrep,
  searchBM25: () => searchBM25,
  purgeRawMessages: () => purgeRawMessages,
  mergeRRF: () => mergeRRF,
  markObservationsPromotedByIds: () => markObservationsPromotedByIds,
  markObservationsPromoted: () => markObservationsPromoted,
  listMemoriesMissingEmbedding: () => listMemoriesMissingEmbedding,
  insertRawMessage: () => insertRawMessage,
  insertObservation: () => insertObservation,
  insertMemory: () => insertMemory,
  getUnprocessedObservations: () => getUnprocessedObservations,
  getSessionObservations: () => getSessionObservations,
  getRecentSummaries: () => getRecentSummaries,
  getRawRange: () => getRawRange,
  getMemoryWithRange: () => getMemoryWithRange,
  getDb: () => getDb,
  findDuplicate: () => findDuplicate,
  diffFileHashes: () => diffFileHashes,
  deleteMemory: () => deleteMemory,
  decayAndPrune: () => decayAndPrune,
  countUnprocessedObservations: () => countUnprocessedObservations,
  countMemoriesMissingEmbedding: () => countMemoriesMissingEmbedding,
  cosineSimilarity: () => cosineSimilarity,
  bumpWeight: () => bumpWeight,
  applyMMR: () => applyMMR,
  REGISTRY_PATH: () => REGISTRY_PATH,
  MODELS_DIR: () => MODELS_DIR,
  DB_PATH: () => DB_PATH,
  CORTEX_DIR: () => CORTEX_DIR
});
import { existsSync as existsSync2, mkdirSync as mkdirSync2 } from "fs";
async function getDb() {
  if (_db && _initialized)
    return _db;
  if (!existsSync2(CORTEX_DIR))
    mkdirSync2(CORTEX_DIR, { recursive: true });
  if (!existsSync2(MODELS_DIR))
    mkdirSync2(MODELS_DIR, { recursive: true });
  if (!_db) {
    const { createClient } = await import("@libsql/client");
    let key = null;
    try {
      key = getDbKey();
    } catch (e) {
      process.stderr.write(`[apsolut-cortex] keychain unreachable; opening DB without encryption. (${e})
`);
    }
    _db = key ? createClient({ url: `file:${DB_PATH}`, encryptionKey: key }) : createClient({ url: `file:${DB_PATH}` });
    try {
      await _db.execute("PRAGMA busy_timeout = 5000");
      await _db.execute("PRAGMA synchronous = NORMAL");
    } catch {}
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
function rowToMemory(r) {
  return {
    id: r.id,
    project_id: r.project_id,
    tier: r.tier,
    category: r.category,
    trust: r.trust,
    content: r.content,
    context: r.context,
    source: r.source,
    embedding: r.embedding,
    weight: r.weight,
    used_count: r.used_count,
    last_used: r.last_used,
    created_at: r.created_at,
    session_id: r.session_id,
    flagged: r.flagged,
    flag_reason: r.flag_reason,
    source_session_id: r.source_session_id ?? null,
    source_start_msg_idx: r.source_start_msg_idx ?? null,
    source_end_msg_idx: r.source_end_msg_idx ?? null
  };
}
async function upsertProject(db, project) {
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO projects (id, name, path, created_at, last_session)
          VALUES (?1, ?2, ?3, ?4, ?4)
          ON CONFLICT(id) DO UPDATE SET
            last_session = ?4,
            name         = ?2,
            path         = COALESCE(?3, projects.path)`,
    args: [project.id, project.name, project.path ?? null, now]
  });
}
async function upsertSession(db, s) {
  await db.execute({
    sql: `INSERT INTO sessions
            (id, project_id, started_at, ended_at, summary, memories_stored, tool_failures)
          VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, 0), COALESCE(?7, 0))
          ON CONFLICT(id) DO UPDATE SET
            ended_at        = COALESCE(?4, sessions.ended_at),
            summary         = COALESCE(?5, sessions.summary),
            memories_stored = COALESCE(?6, sessions.memories_stored),
            tool_failures   = COALESCE(?7, sessions.tool_failures)`,
    args: [
      s.id,
      s.project_id,
      Date.now(),
      s.ended_at ?? null,
      s.summary ?? null,
      s.memories_stored ?? null,
      s.tool_failures ?? null
    ]
  });
}
async function getRecentSummaries(db, projectId, limit = 3) {
  const result = await db.execute({
    sql: `SELECT summary FROM sessions
          WHERE project_id = ? AND summary IS NOT NULL AND summary != ''
          ORDER BY started_at DESC LIMIT ?`,
    args: [projectId, limit]
  });
  return result.rows.map((r) => r.summary);
}
async function insertObservation(db, obs) {
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO observations (id, session_id, project_id, tool_name, content, category, created_at, prompt_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      obs.session_id,
      obs.project_id,
      obs.tool_name ?? null,
      obs.content,
      obs.category ?? null,
      Date.now(),
      obs.prompt_id ?? null
    ]
  });
  return id;
}
async function getSessionObservations(db, sessionId) {
  const result = await db.execute({
    sql: "SELECT id, tool_name, content, category FROM observations WHERE session_id = ? AND promoted = 0 ORDER BY created_at ASC",
    args: [sessionId]
  });
  return result.rows.map((r) => ({
    id: r.id,
    tool_name: r.tool_name,
    content: r.content,
    category: r.category
  }));
}
async function getUnprocessedObservations(db, projectId, excludeSessionId, limit = CORTEX_UNPROCESSED_BATCH) {
  const result = await db.execute({
    sql: "SELECT id, tool_name, content, category, session_id FROM observations WHERE project_id = ? AND session_id != ? AND promoted = 0 ORDER BY created_at ASC LIMIT ?",
    args: [projectId, excludeSessionId, limit]
  });
  return result.rows.map((r) => ({
    id: r.id,
    tool_name: r.tool_name,
    content: r.content,
    category: r.category,
    session_id: r.session_id
  }));
}
async function countUnprocessedObservations(db, projectId) {
  const result = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM observations WHERE project_id = ? AND promoted = 0",
    args: [projectId]
  });
  return Number(result.rows[0]?.n ?? 0);
}
async function markObservationsPromoted(db, sessionId) {
  await db.execute({
    sql: "UPDATE observations SET promoted = 1 WHERE session_id = ?",
    args: [sessionId]
  });
}
async function markObservationsPromotedByIds(db, ids) {
  if (ids.length === 0)
    return 0;
  const CHUNK = 500;
  let affected = 0;
  for (let i = 0;i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const result = await db.execute({
      sql: `UPDATE observations SET promoted = 1 WHERE id IN (${chunk.map(() => "?").join(",")})`,
      args: chunk
    });
    affected += result.rowsAffected;
  }
  return affected;
}
async function findDuplicate(db, projectId, embedding, threshold = CORTEX_DUPLICATE_THRESHOLD) {
  const maxDistance = 1 - threshold;
  const result = await db.execute({
    sql: `SELECT id, weight, vector_distance_cos(embedding, vector(?)) as distance
          FROM memories
          WHERE project_id = ? AND embedding IS NOT NULL
          ORDER BY distance LIMIT 1`,
    args: [vecToSql(embedding), projectId]
  });
  if (result.rows.length === 0)
    return null;
  const row = result.rows[0];
  const distance = row.distance;
  if (distance <= maxDistance) {
    return { id: row.id, weight: row.weight };
  }
  return null;
}
async function bumpWeight(db, id, boost = CORTEX_BUMP_BOOST) {
  await db.execute({
    sql: `UPDATE memories SET weight = MIN(weight + ?, ${CORTEX_WEIGHT_CAP}), last_used = ? WHERE id = ?`,
    args: [boost, Date.now(), id]
  });
}
async function insertMemory(db, m) {
  const id = crypto.randomUUID();
  const srcSession = m.source_session_id ?? null;
  const srcStart = m.source_start_msg_idx ?? null;
  const srcEnd = m.source_end_msg_idx ?? null;
  const tier = coerceTier(m.tier);
  const category = coerceCategory(m.category);
  const trust = isTrust(m.trust) ? m.trust : "observed";
  const content = clampText(m.content, CONTENT_MAX);
  if (!content)
    throw new Error("insertMemory: content is empty");
  const context = m.context ? clampText(m.context, CONTEXT_MAX) : null;
  if (m.embedding) {
    await db.execute({
      sql: `INSERT INTO memories
              (id, project_id, tier, category, trust, content, context,
               source, embedding, weight, used_count, created_at, session_id,
               source_session_id, source_start_msg_idx, source_end_msg_idx)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, vector(?), ?, 0, ?, ?, ?, ?, ?)`,
      args: [
        id,
        m.project_id,
        tier,
        category,
        trust,
        content,
        context,
        m.source,
        vecToSql(m.embedding),
        m.weight,
        Date.now(),
        m.session_id ?? null,
        srcSession,
        srcStart,
        srcEnd
      ]
    });
  } else {
    await db.execute({
      sql: `INSERT INTO memories
              (id, project_id, tier, category, trust, content, context,
               source, embedding, weight, used_count, created_at, session_id,
               source_session_id, source_start_msg_idx, source_end_msg_idx)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, ?)`,
      args: [
        id,
        m.project_id,
        tier,
        category,
        trust,
        content,
        context,
        m.source,
        m.weight,
        Date.now(),
        m.session_id ?? null,
        srcSession,
        srcStart,
        srcEnd
      ]
    });
  }
  return id;
}
async function insertRawMessage(db, m) {
  await db.execute({
    sql: `INSERT OR IGNORE INTO raw_messages
            (session_id, msg_idx, role, content, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [m.session_id, m.msg_idx, m.role, m.content, m.created_at]
  });
}
async function getRawRange(db, sessionId, startIdx, endIdx) {
  const result = await db.execute({
    sql: `SELECT session_id, msg_idx, role, content, created_at
          FROM raw_messages
          WHERE session_id = ? AND msg_idx >= ? AND msg_idx < ?
          ORDER BY msg_idx`,
    args: [sessionId, startIdx, endIdx]
  });
  return result.rows.map((r) => ({
    session_id: r.session_id,
    msg_idx: r.msg_idx,
    role: r.role,
    content: r.content,
    created_at: r.created_at
  }));
}
async function getMemoryWithRange(db, memoryId, projectId) {
  const result = await db.execute(projectId ? {
    sql: "SELECT * FROM memories WHERE id = ? AND project_id = ?",
    args: [memoryId, projectId]
  } : { sql: "SELECT * FROM memories WHERE id = ?", args: [memoryId] });
  if (result.rows.length === 0)
    return null;
  const memory = rowToMemory(result.rows[0]);
  if (memory.source_session_id === null || memory.source_start_msg_idx === null || memory.source_end_msg_idx === null) {
    return { memory, rawMessages: [] };
  }
  const rawMessages = await getRawRange(db, memory.source_session_id, memory.source_start_msg_idx, memory.source_end_msg_idx);
  return { memory, rawMessages };
}
async function searchBM25(db, projectId, query, limit) {
  const tokens = query.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0)
    return [];
  const escaped = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
  const result = await db.execute({
    sql: `SELECT m.* FROM memories_fts
          JOIN memories m ON m.rowid = memories_fts.rowid
          WHERE memories_fts MATCH ? AND m.project_id = ?
          ORDER BY bm25(memories_fts) LIMIT ?`,
    args: [escaped, projectId, limit]
  });
  return result.rows.map(rowToMemory);
}
async function searchGrep(db, projectId, query, limit) {
  const tokens = query.toLowerCase().split(/[^a-z0-9_-]+/).filter((t) => t.length >= 3 && !GREP_STOP_WORDS.has(t));
  if (tokens.length === 0)
    return [];
  const orClauses = tokens.map(() => "(LOWER(content) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(context, '')) LIKE ? ESCAPE '\\')").join(" OR ");
  const args = [projectId];
  for (const t of tokens) {
    const pattern = `%${t.replace(/[%_]/g, "\\$&")}%`;
    args.push(pattern, pattern);
  }
  const result = await db.execute({
    sql: `SELECT * FROM memories
          WHERE project_id = ? AND (${orClauses})
          ORDER BY created_at DESC`,
    args
  });
  const scored = result.rows.map((r) => {
    const m = rowToMemory(r);
    const hay = `${m.content} ${m.context ?? ""}`.toLowerCase();
    const score = tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
    return { memory: m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.memory);
}
async function searchVector(db, projectId, queryEmb, limit) {
  const result = await db.execute({
    sql: `SELECT *, vector_distance_cos(embedding, vector(?)) as distance
          FROM memories
          WHERE project_id = ? AND embedding IS NOT NULL
          ORDER BY distance LIMIT ?`,
    args: [vecToSql(queryEmb), projectId, limit]
  });
  return result.rows.map((r) => ({
    ...rowToMemory(r),
    similarity: 1 - r.distance
  }));
}
function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0;i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
function mergeRRF(list1, list2, limit, allItems) {
  const k = CORTEX_RRF_K;
  const scores = new Map;
  list1.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (i + k)));
  list2.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (i + k)));
  const ordered = [...scores.entries()].sort(([, a], [, b]) => b - a);
  const best = ordered[0]?.[1] ?? 0;
  const out = [];
  for (const [id, score] of ordered.slice(0, limit)) {
    const item = allItems.get(id);
    if (!item)
      continue;
    out.push({ ...item, rrf: best > 0 ? score / best : 0 });
  }
  return out;
}
function applyMMR(candidates, queryEmb, limit, lambda = CORTEX_MMR_LAMBDA) {
  if (candidates.length <= limit)
    return candidates.slice(0, limit);
  const selected = [];
  const remaining = [...candidates];
  const embOf = (m) => m.embedding ? new Float32Array(m.embedding) : null;
  const relevanceOf = (cand) => {
    if (typeof cand.rrf === "number")
      return cand.rrf;
    if (typeof cand.similarity === "number")
      return cand.similarity;
    const e = embOf(cand);
    return queryEmb && e ? cosineSimilarity(queryEmb, e) : 0;
  };
  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0;i < remaining.length; i++) {
      const cand = remaining[i];
      const candEmb = embOf(cand);
      const relevance = relevanceOf(cand);
      const maxSim = candEmb ? selected.reduce((max, s) => {
        const se = embOf(s);
        if (!se)
          return max;
        return Math.max(max, cosineSimilarity(candEmb, se));
      }, 0) : 0;
      const score = lambda * relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}
async function updateWeight(db, id, score, projectId) {
  const result = await db.execute({
    sql: `UPDATE memories
             SET weight     = ?1 * (?2 / 3.0) + (1 - ?1) * weight,
                 used_count = used_count + 1,
                 last_used  = ?3,
                 trust      = CASE
                   WHEN trust = 'observed'
                        AND (?1 * (?2 / 3.0) + (1 - ?1) * weight > ?4
                             OR used_count + 1 >= ?5)
                   THEN 'validated' ELSE trust END
           WHERE id = ?6 AND (?7 IS NULL OR project_id = ?7)`,
    args: [
      CORTEX_WEIGHT_ALPHA,
      score,
      Date.now(),
      CORTEX_PROMOTE_WEIGHT,
      CORTEX_PROMOTE_USES,
      id,
      projectId ?? null
    ]
  });
  return result.rowsAffected > 0;
}
async function deleteMemory(db, id, projectId) {
  const result = await db.execute({
    sql: "DELETE FROM memories WHERE id = ? AND project_id = ?",
    args: [id, projectId]
  });
  if (result.rowsAffected === 0)
    return false;
  await db.execute({ sql: "DELETE FROM memory_tags WHERE memory_id = ?", args: [id] });
  return true;
}
async function purgeRawMessages(db, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0)
    return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = await db.execute({
    sql: `DELETE FROM raw_messages
          WHERE created_at < ?
            AND NOT EXISTS (
              SELECT 1 FROM memories m
              WHERE m.source_session_id = raw_messages.session_id
                AND m.trust IN ('proven', 'canonical')
                AND m.source_start_msg_idx IS NOT NULL
                AND m.source_end_msg_idx IS NOT NULL
                AND raw_messages.msg_idx >= m.source_start_msg_idx
                AND raw_messages.msg_idx <  m.source_end_msg_idx
            )`,
    args: [cutoff]
  });
  return result.rowsAffected;
}
async function decayAndPrune(db, projectId) {
  const now = Date.now();
  const cutoff = now - CORTEX_DECAY_DAYS * 24 * 60 * 60 * 1000;
  const decayResult = await db.execute({
    sql: `UPDATE memories
          SET weight = weight * CASE
            WHEN trust IN ('proven', 'canonical') THEN 1.0
            WHEN trust = 'validated' THEN ?
            ELSE ?
          END,
          last_decay_at = ?
          WHERE project_id = ?
            AND trust NOT IN ('canonical')
            AND COALESCE(last_decay_at, created_at) < ?
            AND (last_used IS NULL OR last_used < ?)`,
    args: [
      CORTEX_DECAY_VALIDATED,
      CORTEX_DECAY_OBSERVED,
      now,
      projectId,
      cutoff,
      cutoff
    ]
  });
  const pruneResult = await db.execute({
    sql: `DELETE FROM memories
          WHERE project_id = ? AND weight < ?
            AND trust NOT IN ('proven', 'canonical')`,
    args: [projectId, CORTEX_PRUNE_WEIGHT]
  });
  return {
    decayed: decayResult.rowsAffected,
    pruned: pruneResult.rowsAffected
  };
}
async function countMemoriesMissingEmbedding(db, projectId) {
  const result = projectId ? await db.execute({
    sql: "SELECT COUNT(*) AS n FROM memories WHERE embedding IS NULL AND project_id = ?",
    args: [projectId]
  }) : await db.execute("SELECT COUNT(*) AS n FROM memories WHERE embedding IS NULL");
  return Number(result.rows[0]?.n ?? 0);
}
async function listMemoriesMissingEmbedding(db, limit, projectId) {
  const result = projectId ? await db.execute({
    sql: "SELECT id, content, context FROM memories WHERE embedding IS NULL AND project_id = ? ORDER BY created_at ASC LIMIT ?",
    args: [projectId, limit]
  }) : await db.execute({
    sql: "SELECT id, content, context FROM memories WHERE embedding IS NULL ORDER BY created_at ASC LIMIT ?",
    args: [limit]
  });
  return result.rows.map((r) => ({
    id: r.id,
    content: r.content,
    context: r.context
  }));
}
async function setMemoryEmbedding(db, id, embedding) {
  const result = await db.execute({
    sql: "UPDATE memories SET embedding = vector(?) WHERE id = ?",
    args: [vecToSql(embedding), id]
  });
  return result.rowsAffected > 0;
}
async function snapshotFileHashes(db, projectId, hashes) {
  const now = Date.now();
  await db.batch(hashes.map((h) => ({
    sql: "INSERT OR REPLACE INTO file_hashes (project_id, path, hash, updated_at) VALUES (?, ?, ?, ?)",
    args: [projectId, h.path, h.hash, now]
  })), "write");
}
async function diffFileHashes(db, projectId, currentHashes) {
  const changed = [];
  for (const cur of currentHashes) {
    const result = await db.execute({
      sql: "SELECT hash FROM file_hashes WHERE project_id = ? AND path = ?",
      args: [projectId, cur.path]
    });
    const prev = result.rows[0];
    if (!prev || prev.hash !== cur.hash) {
      changed.push(cur.path);
    }
  }
  return changed;
}
var _db = null, _initialized = false, GREP_STOP_WORDS;
var init_db = __esm(() => {
  init_config();
  init_runner();
  init_keyring();
  init_validate();
  init_paths();
  init_paths();
  GREP_STOP_WORDS = new Set([
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
});

// src/cli.ts
import {
  existsSync as existsSync9,
  mkdirSync as mkdirSync7,
  readFileSync as readFileSync5,
  rmSync,
  writeFileSync as writeFileSync5
} from "fs";
import { join as join6, resolve, dirname as dirname4, sep } from "path";
import { homedir as homedir4 } from "os";
import { fileURLToPath, pathToFileURL } from "url";

// src/hook-settings.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
var ALL_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SessionEnd",
  "PreCompact"
];
function readJsonFile(path) {
  if (!existsSync(path))
    return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}
function isCortexEntry(e) {
  if (!e || typeof e !== "object")
    return false;
  const entry = e;
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((h) => h.command?.includes("apsolut-cortex"));
  }
  return Boolean(entry.command?.includes("apsolut-cortex"));
}
function buildHookEntries(hookCmd) {
  const cmd = (name, extra = {}) => [
    { matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:${name}`, ...extra }] }
  ];
  return {
    SessionStart: cmd("session-start"),
    UserPromptSubmit: cmd("user-prompt-submit"),
    PostToolUse: cmd("post-tool-use", { async: true }),
    PostToolUseFailure: cmd("post-tool-use", { async: true }),
    Stop: cmd("stop", { async: true }),
    SessionEnd: cmd("session-end"),
    PreCompact: cmd("pre-compact", { timeout: 60, asyncRewake: true })
  };
}
function writeHooks(settingsPath, entries) {
  try {
    const dir = dirname(settingsPath);
    if (!existsSync(dir))
      mkdirSync(dir, { recursive: true });
    const settings = readJsonFile(settingsPath);
    const hooks = settings.hooks ?? {};
    for (const [event, eventEntries] of Object.entries(entries)) {
      const others = (hooks[event] ?? []).filter((e) => !isCortexEntry(e));
      hooks[event] = [...others, ...eventEntries];
    }
    settings.hooks = hooks;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return Object.keys(entries).length;
  } catch {
    return null;
  }
}
function stripHooks(settingsPath) {
  if (!existsSync(settingsPath))
    return 0;
  try {
    const settings = readJsonFile(settingsPath);
    const hooks = settings.hooks;
    if (!hooks)
      return 0;
    let removed = 0;
    for (const event of ALL_HOOK_EVENTS) {
      const current = hooks[event];
      if (!Array.isArray(current))
        continue;
      const kept = current.filter((e) => !isCortexEntry(e));
      removed += current.length - kept.length;
      if (kept.length === 0)
        delete hooks[event];
      else
        hooks[event] = kept;
    }
    if (removed > 0)
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return removed;
  } catch {
    return 0;
  }
}
function findRegisteredHooks(scopes) {
  const out = [];
  for (const { label, path } of scopes) {
    const hooks = readJsonFile(path).hooks;
    if (!hooks)
      continue;
    const events = ALL_HOOK_EVENTS.filter((e) => Array.isArray(hooks[e]) && hooks[e].some(isCortexEntry));
    if (events.length > 0)
      out.push({ label, events: [...events] });
  }
  return out;
}

// src/registry.ts
init_db();
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync2, writeFileSync as writeFileSync2, renameSync } from "fs";
import { dirname as dirname2 } from "path";
function readRegistry() {
  if (!existsSync3(REGISTRY_PATH))
    return { projects: {} };
  try {
    return JSON.parse(readFileSync2(REGISTRY_PATH, "utf-8"));
  } catch {
    return { projects: {} };
  }
}
function writeRegistry(reg) {
  const dir = dirname2(REGISTRY_PATH);
  if (!existsSync3(dir))
    mkdirSync3(dir, { recursive: true });
  const tmp = REGISTRY_PATH + ".tmp";
  writeFileSync2(tmp, JSON.stringify(reg, null, 2));
  renameSync(tmp, REGISTRY_PATH);
}
function registerProject(id, name, path) {
  const reg = readRegistry();
  reg.projects[id] = { name, path, registered_at: Date.now() };
  writeRegistry(reg);
}

// src/cli.ts
init_db();
init_runner();

// src/logs.ts
import { appendFileSync, existsSync as existsSync4, mkdirSync as mkdirSync4, readFileSync as readFileSync3, renameSync as renameSync2, statSync, unlinkSync } from "fs";
import { homedir as homedir2 } from "os";
import { dirname as dirname3, join as join2 } from "path";
var MAX_LOG_BYTES = 5 * 1024 * 1024;
var LOGS_DIR = join2(homedir2(), ".apsolut-cortex", "logs");
var RETRIEVALS_PATH = join2(LOGS_DIR, "retrievals.jsonl");
var CORRECTIONS_PATH = join2(LOGS_DIR, "corrections.jsonl");
var SHADOW_PATH = join2(LOGS_DIR, "shadow.jsonl");
function rotateIfLarge(path) {
  try {
    if (!existsSync4(path))
      return;
    if (statSync(path).size < MAX_LOG_BYTES)
      return;
    const previous = `${path}.1`;
    if (existsSync4(previous))
      unlinkSync(previous);
    renameSync2(path, previous);
  } catch {}
}
function appendJsonl(path, entry) {
  try {
    const dir = dirname3(path);
    if (!existsSync4(dir))
      mkdirSync4(dir, { recursive: true });
    rotateIfLarge(path);
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
  if (!existsSync4(RETRIEVALS_PATH))
    return null;
  const text = readFileSync3(RETRIEVALS_PATH, "utf-8");
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
init_paths();
var _embedder = null;
async function getEmbedder() {
  if (_embedder)
    return _embedder;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = MODELS_DIR;
  env.allowRemoteModels = true;
  _embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  return _embedder;
}
async function embed(text) {
  const e = await getEmbedder();
  const out = await e(text, { pooling: "mean", normalize: true });
  return out.data;
}

// src/cli.ts
init_config();

// src/backup.ts
init_db();
init_runner();
import {
  copyFileSync,
  existsSync as existsSync5,
  mkdirSync as mkdirSync5,
  readdirSync,
  renameSync as renameSync3,
  statSync as statSync2,
  unlinkSync as unlinkSync2
} from "fs";
import { join as join3 } from "path";
import { createClient } from "@libsql/client";
function releaseStaleHandles() {
  globalThis.Bun?.gc(true);
}
async function unlinkRetry(path, attempts = 10) {
  for (let i = 0;i < attempts; i++) {
    try {
      unlinkSync2(path);
      return;
    } catch (e) {
      const code = e.code;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOENT")
        throw e;
      if (code === "ENOENT")
        return;
      releaseStaleHandles();
      await new Promise((r) => setTimeout(r, 25 + i * 25));
    }
  }
  unlinkSync2(path);
}
async function renameRetry(from, to, attempts = 10) {
  for (let i = 0;i < attempts; i++) {
    try {
      renameSync3(from, to);
      return;
    } catch (e) {
      const code = e.code;
      if (code !== "EBUSY" && code !== "EPERM")
        throw e;
      releaseStaleHandles();
      await new Promise((r) => setTimeout(r, 25 + i * 25));
    }
  }
  renameSync3(from, to);
}
var BACKUP_DIR = join3(CORTEX_DIR, "backup");
function timestamp() {
  const d = new Date;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function ensureBackupDir() {
  if (!existsSync5(BACKUP_DIR))
    mkdirSync5(BACKUP_DIR, { recursive: true });
}
async function snapshot(label = "manual") {
  if (!existsSync5(DB_PATH)) {
    throw new Error(`[apsolut-cortex] no DB at ${DB_PATH} — nothing to back up`);
  }
  ensureBackupDir();
  const dest = join3(BACKUP_DIR, `${label}-${timestamp()}.db`);
  const { getDb: getDb2 } = await Promise.resolve().then(() => (init_db(), exports_db));
  return snapshotFrom(await getDb2(), DB_PATH, dest);
}
async function snapshotFrom(db, sourcePath, dest) {
  try {
    await db.execute({ sql: "VACUUM INTO ?", args: [dest] });
    if (existsSync5(dest))
      return dest;
    throw new Error("VACUUM INTO produced no file");
  } catch (e) {
    if (existsSync5(dest)) {
      try {
        unlinkSync2(dest);
      } catch {}
    }
    process.stderr.write(`[apsolut-cortex] consistent snapshot unavailable (${e instanceof Error ? e.message : e}); falling back to file copy
`);
    copyFileSync(sourcePath, dest);
    const wal = `${sourcePath}-wal`;
    if (existsSync5(wal)) {
      copyFileSync(wal, `${dest}-wal`);
    }
    return dest;
  }
}
function listBackups() {
  if (!existsSync5(BACKUP_DIR))
    return [];
  return readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".db")).map((f) => {
    const path = join3(BACKUP_DIR, f);
    const s = statSync2(path);
    return { path, bytes: s.size, mtime: s.mtime };
  }).sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
async function restore(snapshotPath) {
  if (!existsSync5(snapshotPath)) {
    throw new Error(`[apsolut-cortex] snapshot not found: ${snapshotPath}`);
  }
  let safetyBackup = null;
  if (existsSync5(DB_PATH)) {
    safetyBackup = await snapshot("pre-restore");
  }
  const tmp = `${DB_PATH}.restoring`;
  copyFileSync(snapshotPath, tmp);
  for (const ext of ["-wal", "-shm"]) {
    const sidecar = `${DB_PATH}${ext}`;
    if (existsSync5(sidecar)) {
      try {
        unlinkSync2(sidecar);
      } catch {}
    }
  }
  if (existsSync5(DB_PATH)) {
    let attempts = 0;
    while (existsSync5(DB_PATH) && attempts < 10) {
      try {
        unlinkSync2(DB_PATH);
        break;
      } catch {
        attempts++;
      }
      const deadline = Date.now() + 25 + attempts * 25;
      while (Date.now() < deadline) {}
    }
  }
  renameSync3(tmp, DB_PATH);
  const snapshotWal = `${snapshotPath}-wal`;
  if (existsSync5(snapshotWal)) {
    try {
      copyFileSync(snapshotWal, `${DB_PATH}-wal`);
    } catch {}
  }
  return { restored: snapshotPath, safetyBackup };
}
function reencryptUnsupportedReason() {
  return process.platform === "linux" ? "libSQL local encryption is not supported on Linux — the encrypted DB cannot be read back (SQLITE_IOERR). See README → Stability notes." : null;
}
var COPY_TABLES = [
  "projects",
  "sessions",
  "observations",
  "memories",
  "file_hashes",
  "raw_messages",
  "memory_tags"
];
async function listUserTables(src) {
  const result = await src.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'");
  const names = result.rows.map((r) => String(r.name)).filter((n) => n !== "memories_fts" && !n.startsWith("memories_fts_"));
  const known = COPY_TABLES.filter((t) => names.includes(t));
  const rest = names.filter((n) => !COPY_TABLES.includes(n)).sort();
  return [...known, ...rest];
}
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
  if (!existsSync5(sourcePath)) {
    throw new Error(`[apsolut-cortex] no DB at ${sourcePath} — cannot re-encrypt`);
  }
  const newPath = `${sourcePath}.new`;
  if (existsSync5(newPath))
    unlinkSync2(newPath);
  const src = createClient({ url: `file:${sourcePath}` });
  let dst = null;
  const rowsCopied = {};
  try {
    dst = createClient({ url: `file:${newPath}`, encryptionKey });
    await runMigrations(dst);
    for (const table of await listUserTables(src)) {
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
    if (existsSync5(newPath)) {
      try {
        unlinkSync2(newPath);
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
    if (existsSync5(sidecar)) {
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
  const sourceBackup = await snapshot("pre-encrypt");
  const { rows_copied } = await reencryptPathToKey(DB_PATH, encryptionKey);
  return { source_backup: sourceBackup, rows_copied, new_db_path: DB_PATH };
}

// src/cli.ts
init_keyring();

// src/export.ts
init_db();
import {
  existsSync as existsSync6,
  mkdirSync as mkdirSync6,
  readdirSync as readdirSync2,
  unlinkSync as unlinkSync3,
  writeFileSync as writeFileSync3
} from "fs";
import { join as join4 } from "path";
var OBSIDIAN_DIR = join4(CORTEX_DIR, "obsidian");
var MEMORIES_DIR = join4(OBSIDIAN_DIR, "memories");
var INDEX_PATH = join4(OBSIDIAN_DIR, "index.md");
var GENERATED_HEADER = "<!-- generated by apsolut-cortex export — do not edit; changes will be overwritten -->";
function isoDate(ms) {
  return new Date(ms).toISOString();
}
function memoryFilename(m, projectName) {
  const idShort = m.id.slice(0, 8);
  const slug = m.content.slice(0, 50).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  const safe = slug.length > 0 ? slug : "memory";
  return `${idShort}-${safe}.md`;
}
function frontmatter(m, projectName) {
  const fields = [
    ["id", m.id],
    ["project", projectName],
    ["project_id", m.project_id],
    ["tier", m.tier],
    ["category", m.category],
    ["trust", m.trust],
    ["weight", m.weight.toFixed(3)],
    ["used_count", m.used_count],
    ["created_at", isoDate(m.created_at)],
    ["last_used", m.last_used ? isoDate(m.last_used) : null],
    ["source", m.source],
    ["source_session_id", m.source_session_id]
  ];
  const lines = ["---"];
  for (const [k, v] of fields) {
    if (v === null || v === undefined)
      continue;
    const safeValue = String(v).replace(/"/g, "\\\"");
    lines.push(`${k}: "${safeValue}"`);
  }
  lines.push("---");
  return lines.join(`
`);
}
function frontmatterWithTags(m, projectName, tags) {
  const base = frontmatter(m, projectName).replace(/\n---\n?$/, "");
  if (tags.length === 0)
    return base + `
---`;
  const tagsYaml = tags.map((t) => `  - ${t}`).join(`
`);
  return `${base}
tags:
${tagsYaml}
---`;
}
function memoryFile(m, projectName, tags = []) {
  const wikiProject = `[[${projectName}]]`;
  const wikiCategory = `[[category-${m.category}]]`;
  const bodyParts = [
    frontmatterWithTags(m, projectName, tags),
    "",
    GENERATED_HEADER,
    "",
    `# ${m.category} · ${m.tier}`,
    "",
    m.content
  ];
  if (m.context) {
    bodyParts.push("", "## Context", "", m.context);
  }
  const tagLinks = tags.map((t) => `[[tag-${t}]]`).join(" · ");
  bodyParts.push("", "---", `Project: ${wikiProject} · Category: ${wikiCategory} · Trust: ${m.trust}${tagLinks ? ` · Tags: ${tagLinks}` : ""}`);
  return bodyParts.join(`
`) + `
`;
}
function categoryPage(category, memories, projectName) {
  const sorted = [...memories].sort((a, b) => b.weight - a.weight);
  const lines = [
    "---",
    `category: "${category}"`,
    `count: ${sorted.length}`,
    `generated_at: "${new Date().toISOString()}"`,
    "---",
    "",
    GENERATED_HEADER,
    "",
    `# ${category} (${sorted.length})`,
    ""
  ];
  for (const m of sorted) {
    const pName = projectName(m.project_id);
    const fname = memoryFilename(m, pName);
    const snippet = m.content.length > 150 ? m.content.slice(0, 147) + "..." : m.content;
    lines.push(`- [[memories/${fname.replace(/\.md$/, "")}|${m.id.slice(0, 8)}]] · [[${pName}]] · ${m.trust} · w=${m.weight.toFixed(2)} — ${snippet}`);
  }
  return lines.join(`
`) + `
`;
}
function projectPage(projectName, memories) {
  const byCat = new Map;
  for (const m of memories) {
    if (!byCat.has(m.category))
      byCat.set(m.category, []);
    byCat.get(m.category).push(m);
  }
  const lines = [
    "---",
    `project: "${projectName}"`,
    `count: ${memories.length}`,
    `generated_at: "${new Date().toISOString()}"`,
    "---",
    "",
    GENERATED_HEADER,
    "",
    `# ${projectName} (${memories.length})`,
    ""
  ];
  for (const cat of [...byCat.keys()].sort()) {
    const ms = byCat.get(cat).sort((a, b) => b.weight - a.weight);
    lines.push(`## ${cat} (${ms.length})`, "");
    for (const m of ms) {
      const fname = memoryFilename(m, projectName);
      const snippet = m.content.length > 150 ? m.content.slice(0, 147) + "..." : m.content;
      lines.push(`- [[memories/${fname.replace(/\.md$/, "")}|${m.id.slice(0, 8)}]] · ${m.trust} · w=${m.weight.toFixed(2)} — ${snippet}`);
    }
    lines.push("");
  }
  return lines.join(`
`) + `
`;
}
function healthPage(memories, projectName) {
  const now = Date.now();
  const STALE_DAYS = 60;
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
  const lowTrustHighUse = memories.filter((m) => m.trust === "observed" && m.used_count >= 5).sort((a, b) => b.used_count - a.used_count);
  const staleHighTrust = memories.filter((m) => (m.trust === "proven" || m.trust === "canonical") && (m.last_used === null || now - m.last_used > staleMs)).sort((a, b) => (b.last_used ?? 0) - (a.last_used ?? 0));
  const flagged = memories.filter((m) => m.flagged === 1);
  const fmtRow = (m) => {
    const pName = projectName(m.project_id);
    const fname = memoryFilename(m, pName);
    const snippet = m.content.length > 100 ? m.content.slice(0, 97) + "..." : m.content;
    return `- [[memories/${fname.replace(/\.md$/, "")}|${m.id.slice(0, 8)}]] · [[${pName}]] · ${m.trust} · used=${m.used_count} · w=${m.weight.toFixed(2)} — ${snippet}`;
  };
  const lines = [
    "---",
    `generated_at: "${new Date().toISOString()}"`,
    "---",
    "",
    GENERATED_HEADER,
    "",
    "# Vault health",
    "",
    `${memories.length} memories total. This page surfaces things that may need curation.`,
    "",
    `## Low-trust, high-use (consider \`apsolut-cortex promote\`) — ${lowTrustHighUse.length}`,
    "",
    ...lowTrustHighUse.length === 0 ? ["_(none)_"] : lowTrustHighUse.slice(0, 20).map(fmtRow),
    "",
    `## High-trust but stale > ${STALE_DAYS}d (consider \`apsolut-cortex demote\`) — ${staleHighTrust.length}`,
    "",
    ...staleHighTrust.length === 0 ? ["_(none)_"] : staleHighTrust.slice(0, 20).map(fmtRow),
    "",
    `## Flagged by memory_contradict — ${flagged.length}`,
    "",
    ...flagged.length === 0 ? ["_(none)_"] : flagged.slice(0, 20).map(fmtRow)
  ];
  return lines.join(`
`) + `
`;
}
function indexFile(memoriesByProject) {
  const lines = [
    "---",
    `generated_at: "${new Date().toISOString()}"`,
    "---",
    "",
    GENERATED_HEADER,
    "",
    "# apsolut-cortex memory vault",
    "",
    `${[...memoriesByProject.values()].reduce((s, ms) => s + ms.length, 0)} memories across ${memoriesByProject.size} project(s).`,
    ""
  ];
  const projectNames = [...memoriesByProject.keys()].sort();
  for (const projectName of projectNames) {
    const memories = memoriesByProject.get(projectName);
    lines.push(`## ${projectName} (${memories.length})`, "");
    const byCategory = new Map;
    for (const m of memories) {
      if (!byCategory.has(m.category))
        byCategory.set(m.category, []);
      byCategory.get(m.category).push(m);
    }
    for (const category of [...byCategory.keys()].sort()) {
      const ms = byCategory.get(category);
      lines.push(`### ${category} (${ms.length})`, "");
      const sorted = ms.sort((a, b) => b.weight - a.weight);
      for (const m of sorted) {
        const fname = memoryFilename(m, projectName);
        const snippet = m.content.length > 80 ? m.content.slice(0, 77) + "..." : m.content;
        lines.push(`- [[memories/${fname.replace(/\.md$/, "")}|${m.id.slice(0, 8)}]] *(${m.trust}, w=${m.weight.toFixed(2)})* — ${snippet}`);
      }
      lines.push("");
    }
  }
  return lines.join(`
`) + `
`;
}
async function exportVault(db, opts = {}) {
  const vaultDir = opts.vaultDir ?? OBSIDIAN_DIR;
  const memoriesDir = join4(vaultDir, "memories");
  const indexPath = join4(vaultDir, "index.md");
  const projectIdFilter = opts.projectIdFilter;
  if (!existsSync6(vaultDir))
    mkdirSync6(vaultDir, { recursive: true });
  if (!existsSync6(memoriesDir))
    mkdirSync6(memoriesDir, { recursive: true });
  const projects = await db.execute("SELECT id, name FROM projects");
  const projectName = new Map;
  for (const r of projects.rows) {
    projectName.set(r.id, r.name ?? "unknown");
  }
  const sql = projectIdFilter ? "SELECT * FROM memories WHERE project_id = ?" : "SELECT * FROM memories";
  const args = projectIdFilter ? [projectIdFilter] : [];
  const result = await db.execute({ sql, args });
  const memories = result.rows.map((r) => ({
    id: r.id,
    project_id: r.project_id,
    tier: r.tier,
    category: r.category,
    trust: r.trust,
    content: r.content,
    context: r.context,
    source: r.source,
    embedding: r.embedding,
    weight: r.weight,
    used_count: r.used_count,
    last_used: r.last_used,
    created_at: r.created_at,
    session_id: r.session_id,
    flagged: r.flagged,
    flag_reason: r.flag_reason,
    source_session_id: r.source_session_id ?? null,
    source_start_msg_idx: r.source_start_msg_idx ?? null,
    source_end_msg_idx: r.source_end_msg_idx ?? null
  }));
  const tagRows = await db.execute("SELECT memory_id, tag FROM memory_tags ORDER BY memory_id, tag");
  const tagsByMemory = new Map;
  for (const r of tagRows.rows) {
    const mid = r.memory_id;
    if (!tagsByMemory.has(mid))
      tagsByMemory.set(mid, []);
    tagsByMemory.get(mid).push(r.tag);
  }
  const wantedFiles = new Set;
  const byProject = new Map;
  for (const m of memories) {
    const pName = projectName.get(m.project_id) ?? "unknown";
    if (!byProject.has(pName))
      byProject.set(pName, []);
    byProject.get(pName).push(m);
    const fname = memoryFilename(m, pName);
    wantedFiles.add(fname);
    const tags = tagsByMemory.get(m.id) ?? [];
    writeFileSync3(join4(memoriesDir, fname), memoryFile(m, pName, tags));
  }
  let removed = 0;
  if (!projectIdFilter) {
    const present = readdirSync2(memoriesDir).filter((f) => f.endsWith(".md"));
    for (const f of present) {
      if (!wantedFiles.has(f)) {
        try {
          unlinkSync3(join4(memoriesDir, f));
          removed++;
        } catch {}
      }
    }
  }
  if (!projectIdFilter) {
    const byCategoryDir = join4(vaultDir, "by-category");
    const byProjectDir = join4(vaultDir, "by-project");
    if (!existsSync6(byCategoryDir))
      mkdirSync6(byCategoryDir, { recursive: true });
    if (!existsSync6(byProjectDir))
      mkdirSync6(byProjectDir, { recursive: true });
    const byCategory = new Map;
    for (const m of memories) {
      if (!byCategory.has(m.category))
        byCategory.set(m.category, []);
      byCategory.get(m.category).push(m);
    }
    const wantedCategory = new Set;
    for (const [cat, ms] of byCategory) {
      const fname = `${cat}.md`;
      wantedCategory.add(fname);
      writeFileSync3(join4(byCategoryDir, fname), categoryPage(cat, ms, (id) => projectName.get(id) ?? "unknown"));
    }
    for (const f of readdirSync2(byCategoryDir).filter((x) => x.endsWith(".md"))) {
      if (!wantedCategory.has(f)) {
        try {
          unlinkSync3(join4(byCategoryDir, f));
        } catch {}
      }
    }
    const wantedProject = new Set;
    for (const [pName, ms] of byProject) {
      const safe = pName.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      const fname = `${safe}.md`;
      wantedProject.add(fname);
      writeFileSync3(join4(byProjectDir, fname), projectPage(pName, ms));
    }
    for (const f of readdirSync2(byProjectDir).filter((x) => x.endsWith(".md"))) {
      if (!wantedProject.has(f)) {
        try {
          unlinkSync3(join4(byProjectDir, f));
        } catch {}
      }
    }
    writeFileSync3(join4(vaultDir, "_health.md"), healthPage(memories, (id) => projectName.get(id) ?? "unknown"));
  }
  if (!projectIdFilter) {
    writeFileSync3(indexPath, indexFile(byProject));
  }
  return {
    memories_written: memories.length,
    files_removed: removed,
    vault_dir: vaultDir
  };
}

// src/compress.ts
init_validate();
init_config();
import { existsSync as existsSync7, readFileSync as readFileSync4, writeFileSync as writeFileSync4, renameSync as renameSync4 } from "fs";
import { join as join5 } from "path";
import { homedir as homedir3 } from "os";
var BREAKER_PATH = join5(homedir3(), ".apsolut-cortex", "compression-state.json");
var COOLDOWN_MS = 60 * 60 * 1000;
function readBreaker() {
  try {
    if (existsSync7(BREAKER_PATH))
      return JSON.parse(readFileSync4(BREAKER_PATH, "utf-8"));
  } catch {}
  return { failures: 0, lastFailure: 0 };
}
function writeBreaker(state) {
  try {
    const tmp = BREAKER_PATH + ".tmp";
    writeFileSync4(tmp, JSON.stringify(state));
    renameSync4(tmp, BREAKER_PATH);
  } catch {}
}
function resetBreaker() {
  writeBreaker({ failures: 0, lastFailure: 0 });
}
function getBreakerState() {
  return readBreaker();
}
function clearBreaker() {
  const previous = readBreaker();
  resetBreaker();
  return previous;
}

// src/gitbash.ts
import { execFileSync } from "child_process";
import { existsSync as existsSync8 } from "fs";
import { win32 as winPath } from "path";
var FULL_GIT_URL = "https://git-scm.com/download/win";
var FULL_GIT_WINGET = "winget install --id Git.Git -e --source winget";
function realBashPath(gitRoot) {
  return winPath.join(gitRoot, "usr", "bin", "bash.exe");
}
function diagnoseGitBash(probe) {
  if (!probe.isWindows)
    return { status: "not-windows" };
  const configured = probe.envPath ?? probe.settingsPath;
  if (configured) {
    return probe.exists(configured) ? { status: "configured", path: configured } : { status: "configured-missing", path: configured };
  }
  if (!probe.gitRoot)
    return { status: "no-git" };
  return probe.exists(realBashPath(probe.gitRoot)) ? { status: "ok", path: realBashPath(probe.gitRoot) } : { status: "partial-git", gitRoot: probe.gitRoot };
}
function findGitRoot() {
  try {
    const out = execFileSync("where", ["git"], { encoding: "utf-8" });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (!first)
      return;
    return winPath.dirname(winPath.dirname(first));
  } catch {
    return;
  }
}
function bashRuns(bashPath) {
  try {
    execFileSync(bashPath, ["-c", "exit 0"], { stdio: "ignore", timeout: 1e4 });
    return true;
  } catch {
    return false;
  }
}
function gatherGitBashProbe(settingsEnvPath) {
  const isWindows = process.platform === "win32";
  return {
    isWindows,
    envPath: process.env.CLAUDE_CODE_GIT_BASH_PATH,
    settingsPath: settingsEnvPath,
    gitRoot: isWindows ? findGitRoot() : undefined,
    exists: existsSync8
  };
}
function renderGitBashWarning(diag, paint = (s) => s) {
  const installFullGit = [
    "  Claude Code needs a working Git Bash to run hooks. Install the full",
    `  Git for Windows — ${FULL_GIT_URL}`,
    `  or:  ${FULL_GIT_WINGET}`,
    "  then fully quit and relaunch Claude Code. (If you already have a real",
    "  bash elsewhere, set CLAUDE_CODE_GIT_BASH_PATH to that bash.exe instead.)"
  ];
  switch (diag.status) {
    case "partial-git":
      return [
        paint("⚠ Windows: your Git install has no bash — hooks can't run."),
        `  ${realBashPath(diag.gitRoot)} is missing`,
        "  (a partial / MinGit install: the bin\\bash.exe stub is only a wrapper",
        "  to that missing binary, so pointing at it does not help).",
        ...installFullGit
      ].join(`
`);
    case "configured-missing":
      return [
        paint("⚠ Windows: CLAUDE_CODE_GIT_BASH_PATH points at a missing file."),
        `  ${diag.path}`,
        "  Claude Code can't launch hooks. Fix the path (or unset it) in your",
        "  environment or ~/.claude/settings.json, then relaunch Claude Code."
      ].join(`
`);
    default:
      return null;
  }
}

// src/curation.ts
init_db();
var TRUST_ORDER = ["observed", "validated", "proven", "canonical"];
async function changeTrust(db, id, direction) {
  const row = await db.execute({ sql: "SELECT trust FROM memories WHERE id = ?", args: [id] });
  if (row.rows.length === 0)
    return null;
  const previous = row.rows[0].trust;
  const idx = TRUST_ORDER.indexOf(previous);
  if (idx < 0)
    return null;
  const nextIdx = Math.min(TRUST_ORDER.length - 1, Math.max(0, idx + direction));
  const next = TRUST_ORDER[nextIdx];
  if (next === previous)
    return { id, previous, next, changed: false };
  await db.execute({
    sql: "UPDATE memories SET trust = ?, last_used = ? WHERE id = ?",
    args: [next, Date.now(), id]
  });
  return { id, previous, next, changed: true };
}
function promoteMemory(db, id) {
  return changeTrust(db, id, 1);
}
function demoteMemory(db, id) {
  return changeTrust(db, id, -1);
}
async function tagMemory(db, id, tag) {
  const exists = await db.execute({ sql: "SELECT 1 FROM memories WHERE id = ? LIMIT 1", args: [id] });
  if (exists.rows.length === 0)
    return false;
  await db.execute({
    sql: "INSERT OR IGNORE INTO memory_tags (memory_id, tag, created_at) VALUES (?, ?, ?)",
    args: [id, tag.toLowerCase(), Date.now()]
  });
  return true;
}
async function untagMemory(db, id, tag) {
  const result = await db.execute({
    sql: "DELETE FROM memory_tags WHERE memory_id = ? AND tag = ?",
    args: [id, tag.toLowerCase()]
  });
  return result.rowsAffected > 0;
}
async function grepMemories(db, projectId, pattern, limit = 50) {
  const memories = await searchGrep(db, projectId, pattern, limit);
  return memories.map((m) => ({
    id: m.id,
    project_id: m.project_id,
    tier: m.tier,
    category: m.category,
    trust: m.trust,
    weight: m.weight,
    content: m.content
  }));
}
function buildDeleteQuery(filters) {
  if (filters.id) {
    return { sql: "DELETE FROM memories WHERE id = ?", args: [filters.id] };
  }
  const where = [];
  const args = [];
  if (filters.project) {
    where.push("project_id = ?");
    args.push(filters.project);
  }
  if (filters.before) {
    const ts = new Date(filters.before + "T23:59:59.999Z").getTime();
    if (!Number.isFinite(ts)) {
      throw new Error(`invalid --before date: ${filters.before} (expected YYYY-MM-DD)`);
    }
    where.push("created_at <= ?");
    args.push(ts);
  }
  if (filters.grep) {
    const pat = `%${filters.grep.replace(/[%_]/g, "\\$&")}%`;
    where.push("(content LIKE ? ESCAPE '\\' OR COALESCE(context, '') LIKE ? ESCAPE '\\')");
    args.push(pat, pat);
  }
  if (filters.tag) {
    where.push("id IN (SELECT memory_id FROM memory_tags WHERE tag = ?)");
    args.push(filters.tag.toLowerCase());
  }
  if (where.length === 0) {
    throw new Error("at least one filter (--id, --project, --tag, --before, or --grep) is required");
  }
  return {
    sql: `DELETE FROM memories WHERE ${where.join(" AND ")}`,
    args
  };
}
async function previewDeletion(db, filters, sampleSize = 5) {
  const { sql, args } = buildDeleteQuery(filters);
  const selectSql = sql.replace(/^DELETE FROM memories/, "SELECT * FROM memories");
  const result = await db.execute({ sql: selectSql, args });
  const sample = result.rows.slice(0, sampleSize).map((r) => ({
    id: r.id,
    project_id: r.project_id,
    tier: r.tier,
    category: r.category,
    trust: r.trust,
    weight: r.weight,
    content: r.content
  }));
  return { count: result.rows.length, sample, sql, args };
}
async function applyDeletion(db, filters) {
  const { sql, args } = buildDeleteQuery(filters);
  const result = await db.execute({ sql, args });
  await db.execute("DELETE FROM memory_tags WHERE memory_id NOT IN (SELECT id FROM memories)");
  return result.rowsAffected;
}

// src/cli.ts
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = dirname4(__filename2);
var PACKAGE_ROOT = resolve(__dirname2, "..");
var IS_DIST = __dirname2.endsWith("dist") || __dirname2.includes(`${sep}dist${sep}`);
var PKG_VERSION = JSON.parse(readFileSync5(join6(PACKAGE_ROOT, "package.json"), "utf-8")).version;
var PROJECT_ROOT = process.cwd();
var CLAUDE_SETTINGS = join6(homedir4(), ".claude", "settings.json");
var MCP_JSON = join6(PROJECT_ROOT, ".mcp.json");
var PROJECT_APSOLUT = join6(PROJECT_ROOT, ".apsolut-cortex");
var PROJECT_CONFIG = join6(PROJECT_APSOLUT, "project.json");
var PROJECT_CLAUDE_DIR = join6(PROJECT_ROOT, ".claude");
var PROJECT_SETTINGS_LOCAL = join6(PROJECT_CLAUDE_DIR, "settings.local.json");
var PROJECT_SETTINGS = join6(PROJECT_CLAUDE_DIR, "settings.json");
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
  case "export":
    await exportCmd();
    break;
  case "promote":
    await promoteCmd(process.argv[3]);
    break;
  case "demote":
    await demoteCmd(process.argv[3]);
    break;
  case "tag":
    await tagCmd(process.argv[3], process.argv[4]);
    break;
  case "untag":
    await untagCmd(process.argv[3], process.argv[4]);
    break;
  case "grep":
    await grepCmd(process.argv.slice(3));
    break;
  case "delete":
    await deleteCmd(process.argv.slice(3));
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
  case "reembed":
    await reembedCmd(process.argv.slice(3));
    break;
  case "uninstall":
    uninstall();
    break;
  case "hook:session-start":
    await runHook("session-start");
    break;
  case "hook:user-prompt-submit":
    await runHook("user-prompt-submit");
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
  case "hook:pre-compact":
    await runHook("pre-compact");
    break;
  case "hook:compress-worker":
    await runHook("compress-worker");
    break;
  case "install-hooks":
    await installHooksCmd(process.argv.slice(3));
    break;
  case "doctor":
    await doctor();
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
  │    export      Export memories to Obsidian vault │
  │    promote     Promote a memory trust tier       │
  │    demote      Demote a memory trust tier        │
  │    tag/untag   Add/remove a tag                  │
  │    grep        Substring search across memories  │
  │    delete      Single or bulk delete (--id, etc) │
  │    install-hooks  Wire M6 hooks (PreCompact+)    │
  │    reembed     Repair memories missing vectors   │
  │    backup      Snapshot the DB                   │
  │    restore     Restore a snapshot                │
  │    db re-encrypt  Migrate DB to encrypted        │
  │    db reset-breaker  Clear compression breaker   │
  │    uninstall   Remove hooks & MCP config         │
  │    doctor      Diagnose hook/env problems        │
  │    help        Show this help                    │
  ├──────────────────────────────────────────────────┤
  │  DB:     ~/.apsolut-cortex/memory.db             │
  │  Models: ~/.apsolut-cortex/models/               │
  └──────────────────────────────────────────────────┘
`);
}
async function runHook(name) {
  const hookPath = IS_DIST ? join6(PACKAGE_ROOT, "scripts", `${name}.js`) : join6(__dirname2, "hooks", `${name}.ts`);
  if (!existsSync9(hookPath)) {
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
  if (!existsSync9(PROJECT_APSOLUT)) {
    mkdirSync7(PROJECT_APSOLUT, { recursive: true });
  }
  let projectId;
  let projectName;
  if (existsSync9(PROJECT_CONFIG)) {
    const existing = JSON.parse(readFileSync5(PROJECT_CONFIG, "utf-8"));
    projectId = existing.id;
    projectName = existing.name;
    console.log(`[apsolut-cortex] ✓ Project already initialised: ${projectName}`);
  } else {
    projectId = crypto.randomUUID();
    projectName = PROJECT_ROOT.split(/[\\/]/).filter(Boolean).pop() ?? "project";
    writeFileSync5(PROJECT_CONFIG, JSON.stringify({
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
  const mcpServerPath = IS_DIST ? join6(__dirname2, "mcp", "server.js") : join6(__dirname2, "mcp", "server.ts");
  const mcpCommand = IS_DIST ? "node" : "bun";
  const mcpArgs = [mcpServerPath];
  let mcp = {};
  if (existsSync9(MCP_JSON)) {
    try {
      mcp = JSON.parse(readFileSync5(MCP_JSON, "utf-8"));
    } catch {}
  }
  const servers = mcp.mcpServers ?? {};
  servers["apsolut-cortex"] = {
    command: mcpCommand,
    args: mcpArgs,
    env: { APSOLUT_PROJECT_PATH: PROJECT_ROOT }
  };
  mcp.mcpServers = servers;
  writeFileSync5(MCP_JSON, JSON.stringify(mcp, null, 2));
  console.log(`[apsolut-cortex] ✓ Written .mcp.json`);
  const hookCmd = IS_DIST ? "apsolut-cortex" : `bun run "${join6(__dirname2, "cli.ts").replace(/\\/g, "/")}"`;
  const hookEntries = buildHookEntries(hookCmd);
  const written = writeHooks(PROJECT_SETTINGS_LOCAL, hookEntries);
  if (written === null) {
    console.log(`[apsolut-cortex] ✗ Could not write ${PROJECT_SETTINGS_LOCAL}`);
    console.log(`[apsolut-cortex]   Hooks are not installed — fix the permissions and re-run init.`);
    process.exitCode = 1;
  } else {
    console.log(`[apsolut-cortex] ✓ Registered ${written} hook events in .claude/settings.local.json`);
  }
  const strippedGlobal = stripHooks(CLAUDE_SETTINGS);
  if (strippedGlobal > 0) {
    console.log(`[apsolut-cortex] ✓ Removed ${strippedGlobal} legacy machine-wide hook entr${strippedGlobal === 1 ? "y" : "ies"} from ~/.claude/settings.json`);
    console.log(`[apsolut-cortex]   (hooks are per-project now — other projects are no longer affected)`);
  }
  const SKILL_NAMES = ["apsolut-recall", "apsolut-store", "apsolut-status", "apsolut-forget"];
  const skillsSource = join6(PACKAGE_ROOT, "skills");
  const skillsTarget = join6(homedir4(), ".claude", "skills");
  if (!existsSync9(skillsTarget))
    mkdirSync7(skillsTarget, { recursive: true });
  const OLD_SKILL_NAMES = ["remember", "store", "status", "forget"];
  for (const old of OLD_SKILL_NAMES) {
    const oldSkill = join6(skillsTarget, old, "SKILL.md");
    if (existsSync9(oldSkill)) {
      const content = readFileSync5(oldSkill, "utf-8");
      if (content.includes("memory_")) {
        rmSync(join6(skillsTarget, old), { recursive: true, force: true });
      }
    }
  }
  let skillsCopied = 0;
  for (const name of SKILL_NAMES) {
    const src = join6(skillsSource, name, "SKILL.md");
    const destDir = join6(skillsTarget, name);
    const dest = join6(destDir, "SKILL.md");
    if (!existsSync9(src))
      continue;
    const srcContent = readFileSync5(src, "utf-8");
    if (existsSync9(dest) && readFileSync5(dest, "utf-8") === srcContent)
      continue;
    if (!existsSync9(destDir))
      mkdirSync7(destDir, { recursive: true });
    writeFileSync5(dest, srcContent);
    skillsCopied++;
  }
  console.log(skillsCopied > 0 ? `[apsolut-cortex] ✓ Copied ${skillsCopied} skills to ~/.claude/skills/ (/${SKILL_NAMES.join(", /")})` : `[apsolut-cortex] ✓ Skills already installed`);
  const gitignore = join6(PROJECT_ROOT, ".gitignore");
  if (existsSync9(gitignore)) {
    const content = readFileSync5(gitignore, "utf-8");
    if (!content.includes(".apsolut-cortex/")) {
      writeFileSync5(gitignore, content + `
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
  const settingsEnv = readJsonFile(CLAUDE_SETTINGS).env?.CLAUDE_CODE_GIT_BASH_PATH;
  const gitBashWarning = renderGitBashWarning(diagnoseGitBash(gatherGitBashProbe(settingsEnv)), y);
  if (gitBashWarning) {
    console.log(gitBashWarning.split(`
`).map((l) => `  ${l}`).join(`
`) + `
`);
  }
}
async function doctor() {
  const useColor = !process.env.NO_COLOR && process.env.TERM !== "dumb";
  const y = (s) => useColor ? `\x1B[33m${s}\x1B[0m` : s;
  const g = (s) => useColor ? `\x1B[32m${s}\x1B[0m` : s;
  const r = (s) => useColor ? `\x1B[31m${s}\x1B[0m` : s;
  console.log(`
[apsolut-cortex] doctor · v${PKG_VERSION}
`);
  let project = null;
  if (existsSync9(PROJECT_CONFIG)) {
    try {
      project = JSON.parse(readFileSync5(PROJECT_CONFIG, "utf-8"));
    } catch {}
  }
  if (project?.id) {
    console.log(`${g("✓")} Project initialised: ${project.name} (${project.id.slice(0, 8)}…)`);
  } else {
    console.log(`${r("✗")} No .apsolut-cortex/project.json here — run: apsolut-cortex init`);
    process.exitCode = 1;
  }
  const found = findRegisteredHooks([
    { label: ".claude/settings.local.json", path: PROJECT_SETTINGS_LOCAL },
    { label: ".claude/settings.json", path: PROJECT_SETTINGS },
    { label: "~/.claude/settings.json", path: CLAUDE_SETTINGS }
  ]);
  if (found.length === 0) {
    console.log(`${r("✗")} No cortex hooks registered — automatic capture is off.`);
    console.log(`    Fix: apsolut-cortex install-hooks`);
    process.exitCode = 1;
  } else {
    for (const f of found) {
      console.log(`${g("✓")} Hooks in ${f.label}: ${f.events.join(", ")}`);
    }
    const projectScoped = found.some((f) => f.label.startsWith(".claude"));
    const globalScoped = found.some((f) => f.label.startsWith("~"));
    if (globalScoped) {
      console.log(`${y("⚠")} Machine-wide hooks found in ~/.claude/settings.json.`);
      console.log(`    These run in every project on this machine (a Node process per tool call).`);
      console.log(`    Fix: apsolut-cortex install-hooks   (re-registers per-project and removes them)`);
    }
    if (!projectScoped && !globalScoped) {
      console.log(`${y("⚠")} Hooks found, but not in a scope this project uses.`);
    }
    const missing = ALL_HOOK_EVENTS.filter((e) => !found.some((f) => f.events.includes(e)));
    if (missing.length > 0) {
      console.log(`${y("⚠")} Not registered: ${missing.join(", ")} — run: apsolut-cortex install-hooks`);
    }
  }
  const mcpServers = readJsonFile(MCP_JSON).mcpServers;
  if (mcpServers?.["apsolut-cortex"]) {
    console.log(`${g("✓")} MCP server registered in .mcp.json (memory_* tools available)`);
  } else {
    console.log(`${y("⚠")} No apsolut-cortex entry in .mcp.json — Claude has no memory_* tools here.`);
    console.log(`    Fix: apsolut-cortex init`);
  }
  if (!existsSync9(DB_PATH)) {
    console.log(`${y("⚠")} No database yet at ${DB_PATH} (created on first hook run).`);
  } else if (project?.id) {
    try {
      const db = await getDb();
      const counts = await db.execute({
        sql: `SELECT
                (SELECT COUNT(*) FROM memories WHERE project_id = ?1)    AS memories,
                (SELECT COUNT(*) FROM observations WHERE project_id = ?1 AND promoted = 0) AS pending,
                (SELECT COUNT(*) FROM sessions WHERE project_id = ?1)     AS sessions`,
        args: [project.id]
      });
      const row = counts.rows[0];
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      console.log(`${g("✓")} Database reachable: ${plural(row.memories, "memory", "memories")}, ${plural(row.sessions, "session", "sessions")}, ${plural(row.pending, "observation", "observations")} awaiting compression`);
    } catch (e) {
      console.log(`${r("✗")} Database error: ${e instanceof Error ? e.message : e}`);
      process.exitCode = 1;
    }
  }
  const breaker = getBreakerState();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`${y("⚠")} ANTHROPIC_API_KEY not set in this shell — compression falls back to Ollama.`);
    console.log(`    Hooks inherit Claude Code's environment, not your shell profile.`);
  } else {
    console.log(`${g("✓")} ANTHROPIC_API_KEY present (Haiku compression available)`);
  }
  if (breaker.failures > 0) {
    const mins = Math.round((Date.now() - breaker.lastFailure) / 60000);
    const open = breaker.failures >= 3 && Date.now() - breaker.lastFailure < 3600000;
    console.log(`${open ? r("✗") : y("⚠")} Compression circuit breaker: ${breaker.failures} recent failure(s), last ${mins}m ago${open ? " — currently open, compression is skipped" : ""}`);
    if (open) {
      console.log(`    Fixed the provider already? Clear it: apsolut-cortex db reset-breaker`);
    }
  }
  if (existsSync9(DB_PATH) && project?.id) {
    try {
      const db = await getDb();
      const missing = await countMemoriesMissingEmbedding(db, project.id);
      if (missing > 0) {
        console.log(`${y("⚠")} ${missing} memor${missing === 1 ? "y" : "ies"} stored without an embedding — excluded from vector search and dedup.`);
        console.log(`    Repair: apsolut-cortex reembed`);
      } else {
        console.log(`${g("✓")} All memories have embeddings.`);
      }
      const backlog = await countUnprocessedObservations(db, project.id);
      if (backlog > 0) {
        console.log(`${y("⚠")} ${backlog} observation(s) awaiting compression — recovered 50 per session end.`);
      }
    } catch (e) {
      console.log(`${y("⚠")} Could not inspect embeddings: ${e instanceof Error ? e.message : e}`);
    }
  }
  const settingsEnv = readJsonFile(CLAUDE_SETTINGS).env?.CLAUDE_CODE_GIT_BASH_PATH;
  const diag = diagnoseGitBash(gatherGitBashProbe(settingsEnv));
  const brokenBash = (label, path) => {
    console.log(`${y("⚠")} ${label} exists but won't run — hooks can't launch.`);
    console.log(`    ${path}`);
    console.log(`    Your Git is a partial/MinGit install with no real bash.`);
    console.log(`    Install the full Git for Windows:`);
    console.log(`      ${FULL_GIT_URL}`);
    console.log(`      or:  ${FULL_GIT_WINGET}`);
    console.log(`    then fully quit and relaunch Claude Code.`);
    process.exitCode = 1;
  };
  switch (diag.status) {
    case "not-windows":
      console.log(`${g("✓")} Git Bash check skipped (not Windows).`);
      break;
    case "ok":
      if (bashRuns(diag.path)) {
        console.log(`${g("✓")} Git Bash resolves and runs — hooks can launch.`);
        console.log(`    ${diag.path}`);
      } else {
        brokenBash("Git Bash", diag.path);
      }
      break;
    case "configured":
      if (bashRuns(diag.path)) {
        console.log(`${g("✓")} CLAUDE_CODE_GIT_BASH_PATH is set and runs.`);
        console.log(`    ${diag.path}`);
      } else {
        brokenBash("CLAUDE_CODE_GIT_BASH_PATH", diag.path);
      }
      break;
    case "no-git":
      console.log(`${y("?")} Couldn't locate git via PATH, so Git Bash can't be checked.`);
      console.log(`    If hooks don't fire, install the full Git for Windows or set`);
      console.log(`    CLAUDE_CODE_GIT_BASH_PATH to a real bash.exe, then relaunch Claude Code.`);
      break;
    default: {
      const warning = renderGitBashWarning(diag, y);
      if (warning)
        console.log(warning);
      process.exitCode = 1;
    }
  }
  console.log("");
}
async function status() {
  if (!existsSync9(PROJECT_CONFIG)) {
    console.log("[apsolut-cortex] No project found. Run: apsolut-cortex init");
    process.exit(1);
  }
  const project = JSON.parse(readFileSync5(PROJECT_CONFIG, "utf-8"));
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
  const breaker = getBreakerState();
  if (breaker.failures >= 1) {
    const mins = Math.round((Date.now() - breaker.lastFailure) / 60000);
    console.log(`  ├${hr}┤`);
    console.log(`  ${bl(`compression: ${breaker.failures} recent failure${breaker.failures === 1 ? "" : "s"}, last ${mins}m ago`)}`);
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
async function promoteCmd(id) {
  if (!id) {
    console.log("[apsolut-cortex] usage: apsolut-cortex promote <memory-id>");
    return;
  }
  const db = await getDb();
  const result = await promoteMemory(db, id);
  if (!result) {
    console.log(`[apsolut-cortex] No memory found with id "${id}".`);
    process.exitCode = 1;
    return;
  }
  if (!result.changed)
    console.log(`[apsolut-cortex] Memory ${id} already at top trust tier (${result.previous}).`);
  else
    console.log(`[apsolut-cortex] ✓ Promoted ${id}: ${result.previous} → ${result.next}`);
}
async function demoteCmd(id) {
  if (!id) {
    console.log("[apsolut-cortex] usage: apsolut-cortex demote <memory-id>");
    return;
  }
  const db = await getDb();
  const result = await demoteMemory(db, id);
  if (!result) {
    console.log(`[apsolut-cortex] No memory found with id "${id}".`);
    process.exitCode = 1;
    return;
  }
  if (!result.changed)
    console.log(`[apsolut-cortex] Memory ${id} already at bottom trust tier (${result.previous}).`);
  else
    console.log(`[apsolut-cortex] ✓ Demoted ${id}: ${result.previous} → ${result.next}`);
}
async function tagCmd(id, tag) {
  if (!id || !tag) {
    console.log("[apsolut-cortex] usage: apsolut-cortex tag <memory-id> <tag>");
    return;
  }
  const db = await getDb();
  const ok = await tagMemory(db, id, tag);
  if (!ok) {
    console.log(`[apsolut-cortex] No memory found with id "${id}".`);
    process.exitCode = 1;
    return;
  }
  console.log(`[apsolut-cortex] ✓ Tagged ${id} with "${tag.toLowerCase()}"`);
}
async function untagCmd(id, tag) {
  if (!id || !tag) {
    console.log("[apsolut-cortex] usage: apsolut-cortex untag <memory-id> <tag>");
    return;
  }
  const db = await getDb();
  const removed = await untagMemory(db, id, tag);
  console.log(removed ? `[apsolut-cortex] ✓ Removed tag "${tag.toLowerCase()}" from ${id}` : `[apsolut-cortex] Tag "${tag.toLowerCase()}" was not on ${id}.`);
}
async function grepCmd(args) {
  const pattern = args[0];
  if (!pattern) {
    console.log("[apsolut-cortex] usage: apsolut-cortex grep <pattern>");
    return;
  }
  if (!existsSync9(PROJECT_CONFIG)) {
    console.log("[apsolut-cortex] No project here. Run: apsolut-cortex init");
    process.exitCode = 1;
    return;
  }
  const project = JSON.parse(readFileSync5(PROJECT_CONFIG, "utf-8"));
  const db = await getDb();
  const hits = await grepMemories(db, project.id, pattern, 50);
  if (hits.length === 0) {
    console.log(`[apsolut-cortex] No matches for "${pattern}" in project ${project.name}.`);
    return;
  }
  console.log(`[apsolut-cortex] ${hits.length} match(es) in ${project.name}:`);
  for (const h of hits) {
    const snippet = h.content.length > 100 ? h.content.slice(0, 97) + "..." : h.content;
    console.log(`  ${h.id.slice(0, 8)}  [${h.trust}/${h.category}, w=${h.weight.toFixed(2)}]  ${snippet}`);
  }
}
async function deleteCmd(args) {
  const filters = {};
  for (let i = 0;i < args.length; i++) {
    const a = args[i];
    if (a === "--id")
      filters.id = args[++i];
    else if (a === "--project")
      filters.project = args[++i];
    else if (a === "--tag")
      filters.tag = args[++i];
    else if (a === "--before")
      filters.before = args[++i];
    else if (a === "--grep")
      filters.grep = args[++i];
  }
  const yes = args.includes("--yes");
  if (!filters.id && !filters.project && !filters.tag && !filters.before && !filters.grep) {
    console.log(`[apsolut-cortex] usage:`);
    console.log(`  apsolut-cortex delete --id <memory-id>`);
    console.log(`  apsolut-cortex delete --project <project-id> [--yes]`);
    console.log(`  apsolut-cortex delete --tag <tag> [--yes]`);
    console.log(`  apsolut-cortex delete --before YYYY-MM-DD [--yes]`);
    console.log(`  apsolut-cortex delete --grep <pattern> [--yes]`);
    console.log(`  (filters combine with AND. raw SQL is intentionally not accepted.)`);
    return;
  }
  const db = await getDb();
  try {
    const preview = await previewDeletion(db, filters, 5);
    if (preview.count === 0) {
      console.log(`[apsolut-cortex] No memories match those filters.`);
      return;
    }
    console.log(`[apsolut-cortex] Would delete ${preview.count} memor${preview.count === 1 ? "y" : "ies"}.`);
    for (const m of preview.sample) {
      const snippet = m.content.length > 80 ? m.content.slice(0, 77) + "..." : m.content;
      console.log(`  ${m.id.slice(0, 8)}  [${m.trust}/${m.category}]  ${snippet}`);
    }
    if (preview.count > preview.sample.length)
      console.log(`  ... and ${preview.count - preview.sample.length} more.`);
    if (!yes) {
      console.log(`
[apsolut-cortex] Refusing to delete without --yes. Re-run the same command with --yes to proceed.`);
      return;
    }
    const removed = await applyDeletion(db, filters);
    console.log(`[apsolut-cortex] ✓ Deleted ${removed} memor${removed === 1 ? "y" : "ies"}.`);
  } catch (e) {
    console.log(`[apsolut-cortex] delete error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
async function installHooksCmd(args) {
  const global = args.includes("--global");
  if (!IS_DIST && !args.includes("--force")) {
    console.log(`[apsolut-cortex] install-hooks is intended for npm-installed users.`);
    console.log(`[apsolut-cortex] In dev mode, run with --force to wire hooks that point at`);
    console.log(`[apsolut-cortex] this working copy (${join6(__dirname2, "cli.ts")}).`);
    return;
  }
  const hookCmd = IS_DIST ? "apsolut-cortex" : `bun run "${join6(__dirname2, "cli.ts").replace(/\\/g, "/")}"`;
  const target = global ? CLAUDE_SETTINGS : PROJECT_SETTINGS_LOCAL;
  const entries = buildHookEntries(hookCmd);
  const written = writeHooks(target, entries);
  if (written === null) {
    console.log(`[apsolut-cortex] ✗ Could not write ${target}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[apsolut-cortex] ✓ Installed hooks into ${target}`);
  console.log(`[apsolut-cortex]   Events wired: ${Object.keys(entries).join(", ")}`);
  if (global) {
    console.log(`[apsolut-cortex]   ⚠ Machine-wide: these hooks now run in every project.`);
  } else {
    const strippedGlobal = stripHooks(CLAUDE_SETTINGS);
    if (strippedGlobal > 0) {
      console.log(`[apsolut-cortex]   Removed ${strippedGlobal} legacy machine-wide entr${strippedGlobal === 1 ? "y" : "ies"} from ~/.claude/settings.json`);
    }
  }
  console.log(`[apsolut-cortex]   Restart any open Claude Code session for the new hooks to apply.`);
}
async function exportCmd() {
  if (!existsSync9(DB_PATH)) {
    console.log(`[apsolut-cortex] No database at ${DB_PATH} — nothing to export yet.`);
    process.exitCode = 1;
    return;
  }
  const db = await getDb();
  const result = await exportVault(db);
  console.log(`[apsolut-cortex] ✓ Exported ${result.memories_written} memories to ${result.vault_dir}`);
  if (result.files_removed > 0) {
    console.log(`[apsolut-cortex]   Removed ${result.files_removed} orphaned .md files (no longer in DB)`);
  }
  console.log(`[apsolut-cortex]   Open ${OBSIDIAN_DIR} as an Obsidian vault to browse.`);
}
async function backupCmd() {
  if (!existsSync9(DB_PATH)) {
    console.log(`[apsolut-cortex] No database at ${DB_PATH} — nothing to back up yet.`);
    process.exitCode = 1;
    return;
  }
  let dest;
  try {
    dest = await snapshot("manual");
  } catch (e) {
    console.log(`[apsolut-cortex] ✗ Backup failed: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
    return;
  }
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
  if (!existsSync9(target)) {
    console.log(`[apsolut-cortex] Snapshot not found: ${target}`);
    console.log(`[apsolut-cortex] Run \`apsolut-cortex restore\` with no arguments to list snapshots.`);
    process.exitCode = 1;
    return;
  }
  if (!args.includes("--yes")) {
    console.log(`[apsolut-cortex] Refusing to overwrite ${DB_PATH} without --yes.`);
    console.log(`[apsolut-cortex] A safety snapshot will be taken first if you confirm:`);
    console.log(`    apsolut-cortex restore ${target} --yes`);
    return;
  }
  try {
    const result = await restore(target);
    console.log(`[apsolut-cortex] ✓ Restored ${result.restored} → ${DB_PATH}`);
    if (result.safetyBackup) {
      console.log(`[apsolut-cortex]   Pre-restore safety snapshot at ${result.safetyBackup}`);
    }
  } catch (e) {
    console.log(`[apsolut-cortex] ✗ Restore failed: ${e instanceof Error ? e.message : e}`);
    console.log(`[apsolut-cortex]   ${DB_PATH} was left as it was.`);
    process.exitCode = 1;
  }
}
async function reembedCmd(args) {
  const allProjects = args.includes("--all");
  let project = null;
  if (existsSync9(PROJECT_CONFIG)) {
    try {
      project = JSON.parse(readFileSync5(PROJECT_CONFIG, "utf-8"));
    } catch {}
  }
  if (!allProjects && !project?.id) {
    console.log(`[apsolut-cortex] No project here. Run \`apsolut-cortex init\`, or pass --all.`);
    process.exitCode = 1;
    return;
  }
  const scope = allProjects ? undefined : project.id;
  const db = await getDb();
  const total = await countMemoriesMissingEmbedding(db, scope);
  if (total === 0) {
    console.log(`[apsolut-cortex] ✓ Every memory ${allProjects ? "on this machine" : `in ${project.name}`} has an embedding.`);
    return;
  }
  console.log(`[apsolut-cortex] ${total} memor${total === 1 ? "y" : "ies"} without an embedding — invisible to vector search and dedup.`);
  let fixed = 0;
  let failed = 0;
  for (;; ) {
    const batch = await listMemoriesMissingEmbedding(db, 50, scope);
    if (batch.length === 0)
      break;
    for (const m of batch) {
      const text = m.context ? `${m.content} ${m.context}` : m.content;
      try {
        await setMemoryEmbedding(db, m.id, await embed(text));
        fixed++;
      } catch (e) {
        failed++;
        console.log(`[apsolut-cortex] ✗ ${m.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (failed > 0 && fixed === 0) {
      console.log(`[apsolut-cortex] Embedder is still unavailable — stopping. Nothing was lost; re-run when it works.`);
      process.exitCode = 1;
      break;
    }
    if (fixed + failed >= total)
      break;
  }
  console.log(`[apsolut-cortex] ✓ Re-embedded ${fixed} memor${fixed === 1 ? "y" : "ies"}${failed > 0 ? `, ${failed} failed` : ""}.`);
}
async function dbCmd(sub, args) {
  switch (sub) {
    case "re-encrypt": {
      const unsupported = reencryptUnsupportedReason();
      if (unsupported) {
        console.log(`[apsolut-cortex] db re-encrypt is disabled on this platform.`);
        console.log(`  ${unsupported}`);
        console.log(`  Your DB was not modified.`);
        process.exitCode = 1;
        return;
      }
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
    case "reset-breaker": {
      const previous = clearBreaker();
      if (previous.failures === 0) {
        console.log(`[apsolut-cortex] Compression breaker was already closed. Nothing to do.`);
        return;
      }
      const mins = Math.round((Date.now() - previous.lastFailure) / 60000);
      console.log(`[apsolut-cortex] ✓ Compression breaker cleared (was ${previous.failures} failure${previous.failures === 1 ? "" : "s"}, last ${mins}m ago).`);
      console.log(`  The next session end will attempt compression again.`);
      break;
    }
    default:
      console.log(`[apsolut-cortex] db — subcommands:`);
      console.log(`  apsolut-cortex db re-encrypt     Migrate the DB to encrypted at rest`);
      console.log(`  apsolut-cortex db reset-breaker  Clear the compression circuit breaker`);
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
  const evalsRoot = join6(PACKAGE_ROOT, "evals");
  const runnerModule = pathToFileURL(join6(evalsRoot, "runner.ts")).href;
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
  if (existsSync9(MCP_JSON)) {
    try {
      const mcp = JSON.parse(readFileSync5(MCP_JSON, "utf-8"));
      if (mcp.mcpServers?.["apsolut-cortex"]) {
        delete mcp.mcpServers["apsolut-cortex"];
        writeFileSync5(MCP_JSON, JSON.stringify(mcp, null, 2));
        console.log("[apsolut-cortex] ✓ Removed from .mcp.json");
      }
    } catch {}
  }
  for (const [label, path] of [
    [".claude/settings.local.json", PROJECT_SETTINGS_LOCAL],
    [".claude/settings.json", PROJECT_SETTINGS],
    ["~/.claude/settings.json", CLAUDE_SETTINGS]
  ]) {
    const removed = stripHooks(path);
    if (removed > 0) {
      console.log(`[apsolut-cortex] ✓ Removed ${removed} hook entr${removed === 1 ? "y" : "ies"} from ${label}`);
    }
  }
  const SKILL_NAMES = ["apsolut-recall", "apsolut-store", "apsolut-status", "apsolut-forget", "remember", "store", "status", "forget"];
  const skillsDir = join6(homedir4(), ".claude", "skills");
  let skillsRemoved = 0;
  for (const name of SKILL_NAMES) {
    const skillFile = join6(skillsDir, name, "SKILL.md");
    if (existsSync9(skillFile)) {
      const content = readFileSync5(skillFile, "utf-8");
      if (content.includes("memory_")) {
        rmSync(join6(skillsDir, name), { recursive: true, force: true });
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
