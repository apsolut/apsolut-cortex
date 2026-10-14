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

// src/classify.ts
function classifyToolUse(toolName, toolInput, toolResponse) {
  const output = JSON.stringify(toolResponse ?? "").toLowerCase();
  const input = JSON.stringify(toolInput ?? "").toLowerCase();
  const isError = output.includes('"error"') || output.includes('"failed"') || output.includes("error:") || output.includes("permission denied") || output.includes("enoent") || output.includes("cannot find module");
  const readTools = ["read", "glob", "grep", "search", "list"];
  const isReadTool = readTools.some((t) => toolName.toLowerCase().includes(t));
  const isNotFoundError = output.includes("not found") && !isReadTool;
  if (isError || isNotFoundError) {
    return {
      worth_storing: true,
      category: "correction",
      summary: `${toolName} failed: ${JSON.stringify(toolResponse)?.slice(0, 300)}`
    };
  }
  if (toolName === "Edit" || toolName === "Write") {
    const filePath = toolInput?.file_path ?? "";
    return {
      worth_storing: true,
      category: "change",
      summary: `${toolName}: ${String(filePath).slice(-120)}`
    };
  }
  const testPatterns = ["jest", "vitest", "pytest", "mocha", "bun test", "npm test", "cargo test", "go test"];
  if (toolName === "Bash" && testPatterns.some((p) => input.includes(p))) {
    const passed = output.includes("pass") && !output.includes("fail");
    return {
      worth_storing: true,
      category: "pattern",
      summary: `Tests ${passed ? "passed" : "failed"}: ${JSON.stringify(toolInput)?.slice(0, 150)}`
    };
  }
  const installPatterns = ["npm install", "npm add", "bun add", "bun install", "pip install", "cargo add", "go get"];
  if (toolName === "Bash" && installPatterns.some((p) => input.includes(p))) {
    return {
      worth_storing: true,
      category: "discovery",
      summary: `Dependency: ${JSON.stringify(toolInput)?.slice(0, 200)}`
    };
  }
  const configPatterns = [
    "package.json",
    "tsconfig",
    ".env",
    "cargo.toml",
    "pyproject.toml",
    "go.mod",
    "composer.json",
    "gemfile",
    ".eslintrc",
    "vite.config",
    "next.config",
    "drizzle.config"
  ];
  if (toolName === "Read" && configPatterns.some((p) => input.includes(p))) {
    return {
      worth_storing: true,
      category: "discovery",
      summary: `Read config: ${JSON.stringify(toolInput)?.slice(0, 150)}`
    };
  }
  return null;
}

// src/config.ts
var exports_config = {};
__export(exports_config, {
  TRACKED_FILES: () => TRACKED_FILES,
  CORTEX_WEIGHT_CAP: () => CORTEX_WEIGHT_CAP,
  CORTEX_WEIGHT_ALPHA: () => CORTEX_WEIGHT_ALPHA,
  CORTEX_UNPROCESSED_BATCH: () => CORTEX_UNPROCESSED_BATCH,
  CORTEX_SEARCH_MULTIPLIER: () => CORTEX_SEARCH_MULTIPLIER,
  CORTEX_SEARCH_LIMIT_MAX: () => CORTEX_SEARCH_LIMIT_MAX,
  CORTEX_RRF_K: () => CORTEX_RRF_K,
  CORTEX_REFLECT_THRESHOLD: () => CORTEX_REFLECT_THRESHOLD,
  CORTEX_RECALL_TOKEN_BUDGET: () => CORTEX_RECALL_TOKEN_BUDGET,
  CORTEX_RAW_RETENTION_DAYS: () => CORTEX_RAW_RETENTION_DAYS,
  CORTEX_PRUNE_WEIGHT: () => CORTEX_PRUNE_WEIGHT,
  CORTEX_PROMOTE_WEIGHT: () => CORTEX_PROMOTE_WEIGHT,
  CORTEX_PROMOTE_USES: () => CORTEX_PROMOTE_USES,
  CORTEX_OLLAMA_MODEL: () => CORTEX_OLLAMA_MODEL,
  CORTEX_OBSERVE_THRESHOLD: () => CORTEX_OBSERVE_THRESHOLD,
  CORTEX_OBSERVE_BLOCK_MULT: () => CORTEX_OBSERVE_BLOCK_MULT,
  CORTEX_MMR_LAMBDA: () => CORTEX_MMR_LAMBDA,
  CORTEX_MANUAL_WEIGHT: () => CORTEX_MANUAL_WEIGHT,
  CORTEX_DUPLICATE_THRESHOLD: () => CORTEX_DUPLICATE_THRESHOLD,
  CORTEX_DECAY_VALIDATED: () => CORTEX_DECAY_VALIDATED,
  CORTEX_DECAY_OBSERVED: () => CORTEX_DECAY_OBSERVED,
  CORTEX_DECAY_DAYS: () => CORTEX_DECAY_DAYS,
  CORTEX_CORRECTION_WEIGHT: () => CORTEX_CORRECTION_WEIGHT,
  CORTEX_BUMP_BOOST: () => CORTEX_BUMP_BOOST,
  CORTEX_ANTHROPIC_MODEL: () => CORTEX_ANTHROPIC_MODEL
});
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
var CORTEX_ANTHROPIC_MODEL, CORTEX_OLLAMA_MODEL, CORTEX_DUPLICATE_THRESHOLD, CORTEX_DECAY_DAYS, CORTEX_DECAY_OBSERVED, CORTEX_DECAY_VALIDATED, CORTEX_PRUNE_WEIGHT, CORTEX_RRF_K, CORTEX_MMR_LAMBDA, CORTEX_SEARCH_LIMIT_MAX, CORTEX_SEARCH_MULTIPLIER, CORTEX_WEIGHT_ALPHA, CORTEX_PROMOTE_WEIGHT, CORTEX_PROMOTE_USES, CORTEX_BUMP_BOOST, CORTEX_WEIGHT_CAP, CORTEX_CORRECTION_WEIGHT, CORTEX_MANUAL_WEIGHT, CORTEX_RAW_RETENTION_DAYS, CORTEX_UNPROCESSED_BATCH, CORTEX_RECALL_TOKEN_BUDGET, CORTEX_OBSERVE_THRESHOLD, CORTEX_OBSERVE_BLOCK_MULT, CORTEX_REFLECT_THRESHOLD, TRACKED_FILES;
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
  TRACKED_FILES = [
    "package.json",
    "tsconfig.json",
    "tsconfig.base.json",
    ".env",
    ".env.local",
    "cargo.toml",
    "pyproject.toml",
    "go.mod",
    "composer.json",
    "Gemfile",
    "bun.lock",
    "bunfig.toml",
    "deno.json",
    "deno.jsonc",
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    "webpack.config.js",
    "webpack.config.ts",
    "next.config.js",
    "next.config.ts",
    "next.config.mjs",
    ".eslintrc.json",
    ".eslintrc.js",
    "eslint.config.js",
    "eslint.config.mjs",
    ".prettierrc",
    ".prettierrc.json",
    "biome.json",
    "biome.jsonc",
    "tailwind.config.js",
    "tailwind.config.ts",
    "drizzle.config.ts",
    "drizzle.config.js",
    "docker-compose.yml",
    "docker-compose.yaml",
    "Dockerfile",
    "turbo.json",
    "nx.json",
    "lerna.json",
    "Makefile",
    "justfile"
  ];
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
import { existsSync, mkdirSync } from "fs";
async function getDb() {
  if (_db && _initialized)
    return _db;
  if (!existsSync(CORTEX_DIR))
    mkdirSync(CORTEX_DIR, { recursive: true });
  if (!existsSync(MODELS_DIR))
    mkdirSync(MODELS_DIR, { recursive: true });
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
    if (end === -1) {
      result = result.slice(0, start);
      break;
    }
    result = result.slice(0, start) + result.slice(end + "</private>".length);
  }
  const stripped = result.trim();
  return stripped.length > 0 ? stripped : null;
}

// src/tokens.ts
var exports_tokens = {};
__export(exports_tokens, {
  flattenMessageContent: () => flattenMessageContent,
  countTranscriptTokens: () => countTranscriptTokens,
  countTokens: () => countTokens
});
import { readFileSync } from "fs";
import { createRequire as createRequire3 } from "module";
function getEncoder() {
  if (_encode)
    return _encode;
  const require2 = createRequire3(import.meta.url);
  _encode = require2("gpt-tokenizer").encode;
  return _encode;
}
function countTokens(text) {
  if (!text)
    return 0;
  return getEncoder()(text).length;
}
function countTranscriptTokens(transcriptPath, fromMsgIdx = 0) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf-8");
  } catch {
    return 0;
  }
  let total = 0;
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
    if (idx >= fromMsgIdx)
      total += countTokens(flattenMessageContent(msg));
    idx++;
  }
  return total;
}
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
var _encode = null;
var init_tokens = () => {};

// src/buffer.ts
var exports_buffer = {};
__export(exports_buffer, {
  writeScanCursor: () => writeScanCursor,
  writeCursor: () => writeCursor,
  tryAcquireLock: () => tryAcquireLock,
  releaseLock: () => releaseLock2,
  readScanCursor: () => readScanCursor,
  readCursor: () => readCursor,
  readBuffer: () => readBuffer,
  lockHeld: () => lockHeld,
  listBufferedSessions: () => listBufferedSessions,
  forceClearLock: () => forceClearLock,
  drainAndDelete: () => drainAndDelete,
  clearCursor: () => clearCursor,
  clearAllForSession: () => clearAllForSession,
  appendObservation: () => appendObservation,
  acquireLockWaiting: () => acquireLockWaiting,
  BUFFER_DIR: () => BUFFER_DIR
});
import {
  appendFileSync,
  existsSync as existsSync2,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync2,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { join as join2 } from "path";
import { homedir as homedir2 } from "os";
function ensureDir() {
  if (!existsSync2(BUFFER_DIR))
    mkdirSync2(BUFFER_DIR, { recursive: true });
}
function bufferPath(sessionId) {
  return join2(BUFFER_DIR, `${sessionId}.jsonl`);
}
function lockPath(sessionId) {
  return join2(BUFFER_DIR, `${sessionId}.lock`);
}
function cursorPath(sessionId) {
  return join2(BUFFER_DIR, `${sessionId}.cursor`);
}
function appendObservation(sessionId, obs) {
  ensureDir();
  appendFileSync(bufferPath(sessionId), JSON.stringify(obs) + `
`);
}
function readBuffer(sessionId) {
  const path = bufferPath(sessionId);
  if (!existsSync2(path))
    return [];
  const raw = readFileSync2(path, "utf-8");
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
  if (existsSync2(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }
  return obs;
}
function readCursor(sessionId) {
  const path = cursorPath(sessionId);
  if (!existsSync2(path))
    return 0;
  try {
    const n = parseInt(readFileSync2(path, "utf-8").trim(), 10);
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
  if (existsSync2(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }
}
function readScanCursor(sessionId) {
  const path = join2(BUFFER_DIR, `${sessionId}.scan`);
  if (!existsSync2(path))
    return 0;
  try {
    const n = parseInt(readFileSync2(path, "utf-8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
function writeScanCursor(sessionId, msgCount) {
  ensureDir();
  try {
    writeFileSync(join2(BUFFER_DIR, `${sessionId}.scan`), String(msgCount));
  } catch {}
}
function newToken() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function tryAcquireLock(sessionId) {
  ensureDir();
  const path = lockPath(sessionId);
  if (existsSync2(path)) {
    try {
      const age = Date.now() - statSync(path).mtimeMs;
      if (age > LOCK_TTL_MS) {
        try {
          unlinkSync(path);
        } catch {}
      } else {
        return null;
      }
    } catch {
      try {
        unlinkSync(path);
      } catch {}
    }
  }
  const token = newToken();
  try {
    writeFileSync(path, token, { flag: "wx" });
    return token;
  } catch {
    return null;
  }
}
async function acquireLockWaiting(sessionId, timeoutMs, pollMs = 200) {
  const deadline = Date.now() + timeoutMs;
  for (;; ) {
    const token = tryAcquireLock(sessionId);
    if (token)
      return token;
    if (Date.now() >= deadline)
      return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
function lockHeld(sessionId) {
  const path = lockPath(sessionId);
  if (!existsSync2(path))
    return false;
  try {
    return Date.now() - statSync(path).mtimeMs <= LOCK_TTL_MS;
  } catch {
    return false;
  }
}
function releaseLock2(sessionId, token) {
  if (!token)
    return;
  const path = lockPath(sessionId);
  if (!existsSync2(path))
    return;
  try {
    if (readFileSync2(path, "utf-8").trim() !== token)
      return;
    unlinkSync(path);
  } catch {}
}
function forceClearLock(sessionId) {
  const path = lockPath(sessionId);
  if (existsSync2(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }
}
function clearAllForSession(sessionId) {
  clearCursor(sessionId);
  for (const suffix of [".scan", ".injected.json"]) {
    const path = join2(BUFFER_DIR, `${sessionId}${suffix}`);
    if (existsSync2(path)) {
      try {
        unlinkSync(path);
      } catch {}
    }
  }
}
function listBufferedSessions() {
  if (!existsSync2(BUFFER_DIR))
    return [];
  return readdirSync(BUFFER_DIR).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, ""));
}
var BUFFER_DIR, LOCK_TTL_MS;
var init_buffer = __esm(() => {
  BUFFER_DIR = join2(homedir2(), ".apsolut-cortex", "buffer");
  LOCK_TTL_MS = 5 * 60 * 1000;
});

// src/embed.ts
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
var _embedder = null;
var init_embed = __esm(() => {
  init_paths();
});

// src/compress.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync2, renameSync } from "fs";
import { join as join3 } from "path";
import { homedir as homedir3 } from "os";
function providerConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OLLAMA_HOST || process.env.APSOLUT_CORTEX_OLLAMA_MODEL);
}
function readBreaker() {
  try {
    if (existsSync3(BREAKER_PATH))
      return JSON.parse(readFileSync3(BREAKER_PATH, "utf-8"));
  } catch {}
  return { failures: 0, lastFailure: 0 };
}
function writeBreaker(state) {
  try {
    const tmp = BREAKER_PATH + ".tmp";
    writeFileSync2(tmp, JSON.stringify(state));
    renameSync(tmp, BREAKER_PATH);
  } catch {}
}
function isBreakerOpen() {
  const state = readBreaker();
  return state.failures >= MAX_FAILURES && Date.now() - state.lastFailure < COOLDOWN_MS;
}
function recordFailure() {
  const state = readBreaker();
  writeBreaker({ failures: state.failures + 1, lastFailure: Date.now() });
}
function resetBreaker() {
  writeBreaker({ failures: 0, lastFailure: 0 });
}
async function compressWithAnthropic(observations, project) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ timeout: 30000, maxRetries: 1 });
  const obsText = observations.map((o, i) => `[${i + 1}]${o.tool_name ? ` Tool: ${o.tool_name}` : ""}
${o.content}`).join(`

---

`);
  const response = await client.messages.create({
    model: CORTEX_ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Project: ${project}

Session observations:

${obsText}`
      }
    ]
  });
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseResult(text);
}
async function compressWithOllama(observations, project) {
  const OLLAMA_URL = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const MODEL = CORTEX_OLLAMA_MODEL;
  const obsText = observations.map((o, i) => `[${i + 1}]${o.tool_name ? ` Tool: ${o.tool_name}` : ""}
${o.content}`).join(`

---

`);
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${SYSTEM_PROMPT}

Project: ${project}

Session observations:

${obsText}

Respond ONLY with valid JSON:`,
      stream: false
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  return parseResult(data.response);
}
function parseResult(raw) {
  const clean = raw.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error(`compression output was not JSON: ${clean.slice(0, 120)}`);
    }
    parsed = JSON.parse(clean.slice(start, end + 1));
  }
  return {
    memories: sanitizeMemories(parsed.memories),
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : ""
  };
}
function sanitizeMemories(raw) {
  if (!Array.isArray(raw))
    return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object")
      continue;
    const m = item;
    const content = typeof m.content === "string" ? clampText(m.content, CONTENT_MAX) : null;
    if (!content)
      continue;
    out.push({
      tier: coerceTier(m.tier),
      category: coerceCategory(m.category),
      content,
      context: typeof m.context === "string" ? clampText(m.context, CONTEXT_MAX) ?? undefined : undefined
    });
  }
  return out;
}
async function compressSession(observations, project) {
  if (observations.length === 0) {
    return { memories: [], summary: "" };
  }
  if (isBreakerOpen()) {
    console.error("[apsolut-cortex] Compression circuit breaker open — skipping (retries in ~1h). " + "If you just fixed the provider, run: apsolut-cortex db reset-breaker");
    return null;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const result = await compressWithAnthropic(observations, project);
      resetBreaker();
      return result;
    } catch (e) {
      console.error(`[apsolut-cortex] Haiku compression failed: ${e}`);
      console.error("[apsolut-cortex] Falling back to Ollama...");
    }
  }
  try {
    const result = await compressWithOllama(observations, project);
    resetBreaker();
    console.error("[apsolut-cortex] Used Ollama for compression.");
    return result;
  } catch (e) {
    if (providerConfigured())
      recordFailure();
    const msg = [
      "",
      "╔══════════════════════════════════════════════════════════════╗",
      "║  apsolut-cortex: SESSION COMPRESSION FAILED                 ║",
      "║                                                              ║",
      "║  Neither Anthropic API nor Ollama is available.             ║",
      "║                                                              ║",
      "║  To fix:                                                     ║",
      "║  Option 1: Set ANTHROPIC_API_KEY in your environment         ║",
      "║  Option 2: Run Ollama locally (ollama serve)                 ║",
      "║            Default model: qwen2.5-coder:7b                  ║",
      "║  Custom model: APSOLUT_CORTEX_OLLAMA_MODEL=<model>           ║",
      "║                                                              ║",
      "║  Observations were saved. They will be compressed next       ║",
      "║  session when a compression provider is available.           ║",
      "╚══════════════════════════════════════════════════════════════╝",
      ""
    ].join(`
`);
    console.error(msg);
    return null;
  }
}
var BREAKER_PATH, MAX_FAILURES = 3, COOLDOWN_MS, SYSTEM_PROMPT = `You are analyzing a Claude Code session to extract durable memories and write a session summary.

Given observations from a coding session, output ONLY valid JSON with this shape:
{
  "memories": [
    {
      "tier": "episodic|semantic|procedural|strategic|meta",
      "category": "correction|insight|decision|discovery|fact|pattern",
      "content": "specific, actionable, one sentence",
      "context": "optional: what was happening"
    }
  ],
  "summary": "2-3 sentence human-readable recap of this session"
}

Memory tiers:
- episodic: specific events, what happened, corrections
- semantic: stable facts about the codebase
- procedural: how-to patterns, SOPs, step-by-step knowledge
- strategic: architectural decisions, conventions, non-negotiables
- meta: how to work effectively with this project

Rules:
- Max 5 memories. Fewer if the session was simple.
- Corrections (tried X, actually Y) get highest priority — always store these
- Skip temporary or task-specific details
- Be concrete: file paths, library names, specific patterns
- Summary should help the next session pick up context fast
- If nothing worth preserving happened, return {"memories":[],"summary":"Short session with no significant findings."}
- Return ONLY the JSON object, no markdown, no preamble`;
var init_compress = __esm(() => {
  init_validate();
  init_config();
  BREAKER_PATH = join3(homedir3(), ".apsolut-cortex", "compression-state.json");
  COOLDOWN_MS = 60 * 60 * 1000;
});

// src/transcript.ts
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "fs";
function readTranscript(transcriptPath) {
  if (!existsSync4(transcriptPath))
    return [];
  let raw;
  try {
    raw = readFileSync4(transcriptPath, "utf-8");
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
function sanitizeTranscript(messages) {
  const out = [];
  for (const m of messages) {
    const content = stripPrivate(m.content);
    if (content === null)
      continue;
    out.push({ ...m, content });
  }
  return out;
}
async function captureTranscript(db, sessionId, transcriptPath) {
  const transcript = readTranscript(transcriptPath);
  if (transcript.length === 0)
    return { messages: [], total: 0 };
  const safe = sanitizeTranscript(transcript);
  await persistRawMessages(db, sessionId, safe);
  return { messages: safe, total: transcript.length };
}
var init_transcript = __esm(() => {
  init_db();
  init_tokens();
});

// src/compress-runner.ts
var exports_compress_runner = {};
__export(exports_compress_runner, {
  compressSlice: () => compressSlice
});
async function compressSlice(args) {
  const { db, sessionId, projectId, projectName, transcriptPath, source } = args;
  await upsertSession(db, { id: sessionId, project_id: projectId });
  const { messages: transcript, total } = await captureTranscript(db, sessionId, transcriptPath);
  if (total === 0) {
    return { raw_persisted: 0, memories_stored: 0, duplicates_bumped: 0, new_cursor: 0 };
  }
  const cursor = readCursor(sessionId);
  const endIdx = total;
  if (cursor >= endIdx) {
    return { raw_persisted: transcript.length, memories_stored: 0, duplicates_bumped: 0, new_cursor: cursor };
  }
  const slice = sliceRange(transcript, cursor, endIdx);
  const observations = slice.map((m) => ({
    tool_name: null,
    content: `[${m.role}] ${m.content}`,
    category: null
  }));
  const compression = await compressSession(observations, projectName);
  if (!compression) {
    return {
      raw_persisted: transcript.length,
      memories_stored: 0,
      duplicates_bumped: 0,
      new_cursor: cursor,
      failed: true
    };
  }
  const { memories } = compression;
  let stored = 0;
  let bumped = 0;
  for (const mem of memories) {
    const textToEmbed = mem.context ? `${mem.content} ${mem.context}` : mem.content;
    let embedding = null;
    try {
      embedding = await embed(textToEmbed);
    } catch (e) {
      process.stderr.write(`[apsolut-cortex] embed failed: ${e}
`);
    }
    if (embedding) {
      const dup = await findDuplicate(db, projectId, embedding);
      if (dup) {
        await bumpWeight(db, dup.id);
        bumped++;
        continue;
      }
    }
    const weight = mem.category === "correction" ? CORTEX_CORRECTION_WEIGHT : 1;
    await insertMemory(db, {
      project_id: projectId,
      tier: mem.tier,
      category: mem.category,
      trust: "observed",
      content: mem.content,
      context: mem.context ?? null,
      source,
      embedding,
      weight,
      session_id: sessionId,
      source_session_id: sessionId,
      source_start_msg_idx: cursor,
      source_end_msg_idx: endIdx
    });
    stored++;
  }
  writeCursor(sessionId, endIdx);
  return {
    raw_persisted: transcript.length,
    memories_stored: stored,
    duplicates_bumped: bumped,
    new_cursor: endIdx
  };
}
var init_compress_runner = __esm(() => {
  init_db();
  init_embed();
  init_compress();
  init_buffer();
  init_transcript();
  init_config();
});

// src/hooks/post-tool-use.ts
import { readFileSync as readFileSync5, existsSync as existsSync5 } from "fs";
import { join as join4, basename } from "path";
function resolveWorkerCommand() {
  const entry = process.argv[1];
  if (!entry)
    return null;
  const name = basename(entry);
  if (name.startsWith("cli."))
    return { script: entry, args: ["hook:compress-worker"] };
  const sibling = entry.replace(/post-tool-use\.(js|ts)$/, "compress-worker.$1");
  if (sibling !== entry && existsSync5(sibling))
    return { script: sibling, args: [] };
  return null;
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
  const cwd = data.cwd ?? process.cwd();
  const sessionId = data.session_id ?? "unknown";
  const projectFile = join4(cwd, ".apsolut-cortex", "project.json");
  if (!existsSync5(projectFile))
    process.exit(0);
  let project = null;
  try {
    project = JSON.parse(readFileSync5(projectFile, "utf-8"));
  } catch {
    process.exit(0);
  }
  if (!project?.id)
    process.exit(0);
  const isFailureEvent = data.hook_event_name === "PostToolUseFailure";
  let result = classifyToolUse(data.tool_name ?? "", data.tool_input, isFailureEvent ? data.error ?? data.tool_response : data.tool_response);
  if (isFailureEvent && !result?.worth_storing) {
    const errText = JSON.stringify(data.error ?? data.tool_response ?? "").replace(/^"|"$/g, "").slice(0, 200);
    if (errText.length > 10) {
      result = {
        worth_storing: true,
        category: "failure",
        summary: `Tool ${data.tool_name ?? "unknown"} failed: ${errText}`
      };
    }
  }
  const transcriptPath = data.transcript_path;
  if (!result?.worth_storing && !transcriptPath)
    process.exit(0);
  try {
    const [{ getDb: getDb2, upsertProject: upsertProject2, upsertSession: upsertSession2, insertObservation: insertObservation2 }, { stripPrivate: stripPrivate2 }] = await Promise.all([Promise.resolve().then(() => (init_db(), exports_db)), Promise.resolve().then(() => exports_privacy)]);
    const db = await getDb2();
    await upsertProject2(db, { id: project.id, name: project.name, path: cwd });
    await upsertSession2(db, { id: sessionId, project_id: project.id });
    if (result?.worth_storing) {
      const content = stripPrivate2(result.summary);
      if (content) {
        const existing = await db.execute({
          sql: "SELECT 1 FROM observations WHERE session_id = ? AND content = ? LIMIT 1",
          args: [sessionId, content]
        });
        if (existing.rows.length === 0) {
          await insertObservation2(db, {
            session_id: sessionId,
            project_id: project.id,
            tool_name: data.tool_name,
            content,
            category: result.category,
            prompt_id: data.prompt_id
          });
        }
      }
      if (result.category === "correction") {
        await db.execute({
          sql: "UPDATE sessions SET tool_failures = tool_failures + 1 WHERE id = ?",
          args: [sessionId]
        });
      }
    }
    if (transcriptPath) {
      const [{ countTranscriptTokens: countTranscriptTokens2 }, { readCursor: readCursor2 }, config] = await Promise.all([
        Promise.resolve().then(() => (init_tokens(), exports_tokens)),
        Promise.resolve().then(() => (init_buffer(), exports_buffer)),
        Promise.resolve().then(() => (init_config(), exports_config))
      ]);
      const tokens = countTranscriptTokens2(transcriptPath, readCursor2(sessionId));
      const blockThreshold = config.CORTEX_OBSERVE_THRESHOLD * config.CORTEX_OBSERVE_BLOCK_MULT;
      if (tokens >= blockThreshold) {
        const { tryAcquireLock: tryAcquireLock2, releaseLock: releaseLock3 } = await Promise.resolve().then(() => (init_buffer(), exports_buffer));
        const token = tryAcquireLock2(sessionId);
        if (token) {
          try {
            const { compressSlice: compressSlice2 } = await Promise.resolve().then(() => (init_compress_runner(), exports_compress_runner));
            await compressSlice2({
              db,
              sessionId,
              projectId: project.id,
              projectName: project.name,
              transcriptPath,
              source: "compress-worker"
            });
          } catch (e) {
            process.stderr.write(`[apsolut-cortex] sync compression failed: ${e}
`);
          } finally {
            releaseLock3(sessionId, token);
          }
        }
      } else if (tokens >= config.CORTEX_OBSERVE_THRESHOLD) {
        try {
          const target = resolveWorkerCommand();
          if (!target) {
            process.stderr.write(`[apsolut-cortex] cannot locate worker entry point from ${process.argv[1]}
`);
          } else {
            const { spawn } = await import("child_process");
            const child = spawn(process.execPath, [target.script, ...target.args], { detached: true, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
            const payload = JSON.stringify({
              session_id: sessionId,
              cwd,
              transcript_path: transcriptPath
            });
            child.stdin?.write(payload);
            child.stdin?.end();
            child.unref();
          }
        } catch (e) {
          process.stderr.write(`[apsolut-cortex] async worker spawn failed: ${e}
`);
        }
      }
    }
  } catch {
    process.exit(0);
  }
}
main();
