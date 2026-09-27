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

// src/privacy.ts
var exports_privacy = {};
__export(exports_privacy, {
  stripPrivate: () => stripPrivate
});
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

// src/buffer.ts
var exports_buffer = {};
__export(exports_buffer, {
  writeScanCursor: () => writeScanCursor,
  writeCursor: () => writeCursor,
  tryAcquireLock: () => tryAcquireLock,
  releaseLock: () => releaseLock,
  readScanCursor: () => readScanCursor,
  readCursor: () => readCursor,
  readBuffer: () => readBuffer,
  listBufferedSessions: () => listBufferedSessions,
  drainAndDelete: () => drainAndDelete,
  clearCursor: () => clearCursor,
  clearAllForSession: () => clearAllForSession,
  appendObservation: () => appendObservation,
  BUFFER_DIR: () => BUFFER_DIR
});
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { join } from "path";
import { homedir } from "os";
function ensureDir() {
  if (!existsSync(BUFFER_DIR))
    mkdirSync(BUFFER_DIR, { recursive: true });
}
function bufferPath(sessionId) {
  return join(BUFFER_DIR, `${sessionId}.jsonl`);
}
function lockPath(sessionId) {
  return join(BUFFER_DIR, `${sessionId}.lock`);
}
function cursorPath(sessionId) {
  return join(BUFFER_DIR, `${sessionId}.cursor`);
}
function appendObservation(sessionId, obs) {
  ensureDir();
  appendFileSync(bufferPath(sessionId), JSON.stringify(obs) + `
`);
}
function readBuffer(sessionId) {
  const path = bufferPath(sessionId);
  if (!existsSync(path))
    return [];
  const raw = readFileSync(path, "utf-8");
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim())
      continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}
function drainAndDelete(sessionId) {
  const obs = readBuffer(sessionId);
  const path = bufferPath(sessionId);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }
  return obs;
}
function readCursor(sessionId) {
  const path = cursorPath(sessionId);
  if (!existsSync(path))
    return 0;
  try {
    const n = parseInt(readFileSync(path, "utf-8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
function writeCursor(sessionId, msgIdx) {
  ensureDir();
  writeFileSync(cursorPath(sessionId), String(msgIdx));
}
function clearCursor(sessionId) {
  const path = cursorPath(sessionId);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }
}
function readScanCursor(sessionId) {
  const path = join(BUFFER_DIR, `${sessionId}.scan`);
  if (!existsSync(path))
    return 0;
  try {
    const n = parseInt(readFileSync(path, "utf-8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
function writeScanCursor(sessionId, msgCount) {
  ensureDir();
  try {
    writeFileSync(join(BUFFER_DIR, `${sessionId}.scan`), String(msgCount));
  } catch {}
}
function tryAcquireLock(sessionId) {
  ensureDir();
  const path = lockPath(sessionId);
  if (existsSync(path)) {
    try {
      const age = Date.now() - statSync(path).mtimeMs;
      if (age > LOCK_TTL_MS) {
        try {
          unlinkSync(path);
        } catch {}
      } else {
        return false;
      }
    } catch {
      try {
        unlinkSync(path);
      } catch {}
    }
  }
  try {
    writeFileSync(path, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}
function releaseLock(sessionId) {
  const path = lockPath(sessionId);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }
}
function clearAllForSession(sessionId) {
  releaseLock(sessionId);
  clearCursor(sessionId);
  for (const suffix of [".scan", ".injected.json"]) {
    const path = join(BUFFER_DIR, `${sessionId}${suffix}`);
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {}
    }
  }
}
function listBufferedSessions() {
  if (!existsSync(BUFFER_DIR))
    return [];
  return readdirSync(BUFFER_DIR).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, ""));
}
var BUFFER_DIR, LOCK_TTL_MS;
var init_buffer = __esm(() => {
  BUFFER_DIR = join(homedir(), ".apsolut-cortex", "buffer");
  LOCK_TTL_MS = 5 * 60 * 1000;
});

// src/config.ts
function envNum(key, fallback) {
  const val = process.env[key];
  if (val === undefined)
    return fallback;
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
var CORTEX_DUPLICATE_THRESHOLD, CORTEX_DECAY_DAYS, CORTEX_DECAY_OBSERVED, CORTEX_DECAY_VALIDATED, CORTEX_PRUNE_WEIGHT, CORTEX_RRF_K, CORTEX_MMR_LAMBDA, CORTEX_SEARCH_LIMIT_MAX, CORTEX_SEARCH_MULTIPLIER, CORTEX_WEIGHT_ALPHA, CORTEX_PROMOTE_WEIGHT, CORTEX_PROMOTE_USES, CORTEX_BUMP_BOOST, CORTEX_WEIGHT_CAP, CORTEX_CORRECTION_WEIGHT, CORTEX_MANUAL_WEIGHT, CORTEX_RAW_RETENTION_DAYS, CORTEX_RECALL_TOKEN_BUDGET, CORTEX_OBSERVE_THRESHOLD, CORTEX_OBSERVE_BLOCK_MULT, CORTEX_REFLECT_THRESHOLD;
var init_config = __esm(() => {
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
      await client.executeMultiple(`
      ALTER TABLE observations ADD COLUMN prompt_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_obs_prompt ON observations(prompt_id);
    `);
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
    await releaseLock2(client);
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
async function releaseLock2(client) {
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
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
var CORTEX_DIR, DB_PATH, REGISTRY_PATH, MODELS_DIR;
var init_paths = __esm(() => {
  CORTEX_DIR = join2(homedir2(), ".apsolut-cortex");
  DB_PATH = join2(CORTEX_DIR, "memory.db");
  REGISTRY_PATH = join2(CORTEX_DIR, "registry.json");
  MODELS_DIR = join2(CORTEX_DIR, "models");
});

// src/db.ts
var exports_db = {};
__export(exports_db, {
  upsertSession: () => upsertSession,
  upsertProject: () => upsertProject,
  updateWeight: () => updateWeight,
  snapshotFileHashes: () => snapshotFileHashes,
  searchVector: () => searchVector,
  searchGrep: () => searchGrep,
  searchBM25: () => searchBM25,
  purgeRawMessages: () => purgeRawMessages,
  mergeRRF: () => mergeRRF,
  markProjectObservationsPromoted: () => markProjectObservationsPromoted,
  markObservationsPromoted: () => markObservationsPromoted,
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
  await db.execute({
    sql: `INSERT INTO observations (id, session_id, project_id, tool_name, content, category, created_at, prompt_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      obs.session_id,
      obs.project_id,
      obs.tool_name ?? null,
      obs.content,
      obs.category ?? null,
      Date.now(),
      obs.prompt_id ?? null
    ]
  });
}
async function getSessionObservations(db, sessionId) {
  const result = await db.execute({
    sql: "SELECT tool_name, content, category FROM observations WHERE session_id = ? AND promoted = 0 ORDER BY created_at ASC",
    args: [sessionId]
  });
  return result.rows.map((r) => ({
    tool_name: r.tool_name,
    content: r.content,
    category: r.category
  }));
}
async function getUnprocessedObservations(db, projectId, excludeSessionId) {
  const result = await db.execute({
    sql: "SELECT tool_name, content, category, session_id FROM observations WHERE project_id = ? AND session_id != ? AND promoted = 0 ORDER BY created_at ASC LIMIT 50",
    args: [projectId, excludeSessionId]
  });
  return result.rows.map((r) => ({
    tool_name: r.tool_name,
    content: r.content,
    category: r.category,
    session_id: r.session_id
  }));
}
async function markObservationsPromoted(db, sessionId) {
  await db.execute({
    sql: "UPDATE observations SET promoted = 1 WHERE session_id = ?",
    args: [sessionId]
  });
}
async function markProjectObservationsPromoted(db, projectId) {
  await db.execute({
    sql: "UPDATE observations SET promoted = 1 WHERE project_id = ? AND promoted = 0",
    args: [projectId]
  });
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
  return [...scores.entries()].sort(([, a], [, b]) => b - a).slice(0, limit).map(([id]) => allItems.get(id)).filter(Boolean);
}
function applyMMR(candidates, queryEmb, limit, lambda = CORTEX_MMR_LAMBDA) {
  if (!queryEmb || candidates.length <= limit)
    return candidates.slice(0, limit);
  const selected = [];
  const remaining = [...candidates];
  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0;i < remaining.length; i++) {
      const cand = remaining[i];
      const candEmb = cand.embedding ? new Float32Array(cand.embedding) : null;
      if (!candEmb) {
        bestIdx = i;
        break;
      }
      const relevance = cand.similarity ?? cosineSimilarity(queryEmb, candEmb);
      const maxSim = selected.reduce((max, s) => {
        if (!s.embedding)
          return max;
        const sim = cosineSimilarity(candEmb, new Float32Array(s.embedding));
        return Math.max(max, sim);
      }, 0);
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
    sql: "DELETE FROM raw_messages WHERE created_at < ?",
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

// src/tokens.ts
function flattenMessageContent(msg) {
  if (!msg || typeof msg !== "object")
    return "";
  const outer = msg;
  const m = outer.message && typeof outer.message === "object" ? outer.message : msg;
  if (typeof m.content === "string")
    return m.content;
  if (!Array.isArray(m.content))
    return "";
  const parts = [];
  for (const block of m.content) {
    if (!block || typeof block !== "object")
      continue;
    const b = block;
    if (typeof b.text === "string")
      parts.push(b.text);
    if (b.type === "tool_use") {
      parts.push(`[tool_use ${b.name ?? "?"}: ${JSON.stringify(b.input ?? {}).slice(0, 200)}]`);
    }
    if (b.type === "tool_result") {
      if (typeof b.content === "string")
        parts.push(b.content);
      else if (Array.isArray(b.content)) {
        for (const c of b.content) {
          if (c && typeof c === "object" && typeof c.text === "string") {
            parts.push(c.text);
          }
        }
      }
    }
  }
  return parts.join(`
`);
}
var init_tokens = () => {};

// src/transcript.ts
var exports_transcript = {};
__export(exports_transcript, {
  sliceRange: () => sliceRange,
  readTranscript: () => readTranscript,
  persistRawMessages: () => persistRawMessages,
  captureTranscript: () => captureTranscript
});
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "fs";
function readTranscript(transcriptPath) {
  if (!existsSync3(transcriptPath))
    return [];
  let raw;
  try {
    raw = readFileSync2(transcriptPath, "utf-8");
  } catch {
    return [];
  }
  const out = [];
  let idx = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim())
      continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      idx++;
      continue;
    }
    const obj = msg && typeof msg === "object" ? msg : {};
    const inner = obj.message && typeof obj.message === "object" ? obj.message : null;
    const role = typeof inner?.role === "string" ? inner.role : typeof obj.role === "string" ? obj.role : typeof obj.type === "string" ? obj.type : "unknown";
    out.push({
      msg_idx: idx,
      role,
      content: flattenMessageContent(msg),
      raw: msg
    });
    idx++;
  }
  return out;
}
function sliceRange(transcript, startIdx, endIdx) {
  return transcript.filter((m) => m.msg_idx >= startIdx && m.msg_idx < endIdx);
}
async function persistRawMessages(db, sessionId, messages, now = Date.now()) {
  let inserted = 0;
  for (const m of messages) {
    const content = stripPrivate(m.content);
    if (content === null)
      continue;
    await insertRawMessage(db, {
      session_id: sessionId,
      msg_idx: m.msg_idx,
      role: m.role,
      content,
      created_at: now
    });
    inserted++;
  }
  return inserted;
}
async function captureTranscript(db, sessionId, transcriptPath) {
  const transcript = readTranscript(transcriptPath);
  if (transcript.length === 0)
    return [];
  await persistRawMessages(db, sessionId, transcript);
  return transcript;
}
var init_transcript = __esm(() => {
  init_db();
  init_tokens();
});

// src/hooks/stop.ts
import { readFileSync as readFileSync3, existsSync as existsSync4 } from "fs";
import { join as join3 } from "path";

// src/prompt-cues.ts
var STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "not",
  "no",
  "yes",
  "you",
  "your",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "is",
  "are",
  "was",
  "were",
  "do",
  "don",
  "did",
  "does",
  "have",
  "has",
  "had",
  "will",
  "would",
  "should",
  "can",
  "could",
  "what",
  "why",
  "how",
  "when",
  "where",
  "i",
  "we",
  "me",
  "my",
  "our",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "please",
  "just",
  "said",
  "told",
  "asked",
  "want",
  "wanted",
  "instead",
  "never",
  "stop",
  "wrong",
  "again",
  "use",
  "using"
]);
var CORRECTION_PATTERNS = [
  /actually,?\s+(?:the|it'?s?|that'?s?)\s+(.{20,150})/gi,
  /(?:my mistake|i was wrong|incorrect)[^.]*[.!]\s*(.{20,150})/gi,
  /(?:should(?:n'?t)? have|shouldn'?t).{0,30}[—–-]\s*(.{20,150})/gi,
  /(?:the correct|correct(?:ly)?)\s+(?:way|path|file|approach)\s+is\s+(.{20,150})/gi
];
function extractCorrections(transcript) {
  const found = [];
  for (const pattern of CORRECTION_PATTERNS) {
    pattern.lastIndex = 0;
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

// src/hooks/stop.ts
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
  const cwd = data.cwd ?? process.cwd();
  const sessionId = data.session_id ?? "unknown";
  const projectFile = join3(cwd, ".apsolut-cortex", "project.json");
  if (!existsSync4(projectFile))
    process.exit(0);
  let project = null;
  try {
    project = JSON.parse(readFileSync3(projectFile, "utf-8"));
  } catch {
    process.exit(0);
  }
  if (!project?.id)
    process.exit(0);
  try {
    const [{ stripPrivate: stripPrivate2 }, { readScanCursor: readScanCursor2, writeScanCursor: writeScanCursor2 }] = await Promise.all([
      Promise.resolve().then(() => exports_privacy),
      Promise.resolve().then(() => (init_buffer(), exports_buffer))
    ]);
    let transcriptText = data.transcript ?? "";
    let scanned = 0;
    if (!transcriptText && data.transcript_path) {
      const { readTranscript: readTranscript2 } = await Promise.resolve().then(() => (init_transcript(), exports_transcript));
      const all = readTranscript2(data.transcript_path);
      const from = readScanCursor2(sessionId);
      scanned = all.length;
      transcriptText = all.filter((m) => m.msg_idx >= from && m.role === "assistant").map((m) => m.content).join(`
`);
    }
    if (!transcriptText) {
      if (scanned > 0)
        writeScanCursor2(sessionId, scanned);
      process.exit(0);
    }
    const cleaned = stripPrivate2(transcriptText);
    if (!cleaned) {
      if (scanned > 0)
        writeScanCursor2(sessionId, scanned);
      process.exit(0);
    }
    const corrections = extractCorrections(cleaned);
    if (corrections.length > 0) {
      const { getDb: getDb2, upsertProject: upsertProject2, upsertSession: upsertSession2, insertObservation: insertObservation2 } = await Promise.resolve().then(() => (init_db(), exports_db));
      const db = await getDb2();
      await upsertProject2(db, { id: project.id, name: project.name, path: cwd });
      await upsertSession2(db, { id: sessionId, project_id: project.id });
      for (const correction of corrections) {
        const existing = await db.execute({
          sql: "SELECT 1 FROM observations WHERE session_id = ? AND content = ? LIMIT 1",
          args: [sessionId, correction]
        });
        if (existing.rows.length > 0)
          continue;
        await insertObservation2(db, {
          session_id: sessionId,
          project_id: project.id,
          content: correction,
          category: "correction"
        });
      }
    }
    if (scanned > 0)
      writeScanCursor2(sessionId, scanned);
  } catch {
    process.exit(0);
  }
}
main();
