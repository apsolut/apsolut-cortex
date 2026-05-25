// src/hooks/pre-compact.ts
import { readFileSync as readFileSync4, existsSync as existsSync5 } from "fs";
import { join as join4 } from "path";

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
var CORTEX_RAW_RETENTION_DAYS = envNum("APSOLUT_CORTEX_RAW_RETENTION_DAYS", 90);
var CORTEX_OBSERVE_THRESHOLD = envNum("APSOLUT_CORTEX_OBSERVE_THRESHOLD", 30000);
var CORTEX_OBSERVE_BLOCK_MULT = envNum("APSOLUT_CORTEX_OBSERVE_BLOCK_MULT", 1.2);
var CORTEX_REFLECT_THRESHOLD = envNum("APSOLUT_CORTEX_REFLECT_THRESHOLD", 40000);

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

// src/migrations/002-range-linked-memories.ts
var migration2 = {
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
var _002_range_linked_memories_default = migration2;

// src/migrations/003-raw-messages.ts
var migration3 = {
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
var _003_raw_messages_default = migration3;

// src/migrations/004-memory-tags.ts
var migration4 = {
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
var _004_memory_tags_default = migration4;

// src/migrations/runner.ts
var MIGRATIONS = [
  _001_initial_schema_default,
  _002_range_linked_memories_default,
  _003_raw_messages_default,
  _004_memory_tags_default
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
        m.tier,
        m.category,
        m.trust,
        m.content,
        m.context ?? null,
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
        m.tier,
        m.category,
        m.trust,
        m.content,
        m.context ?? null,
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

// src/compress.ts
import Anthropic from "@anthropic-ai/sdk";
import { existsSync as existsSync2, readFileSync, writeFileSync, renameSync } from "fs";
import { join as join2 } from "path";
import { homedir as homedir2 } from "os";
var BREAKER_PATH = join2(homedir2(), ".apsolut-cortex", "compression-state.json");
var MAX_FAILURES = 3;
var COOLDOWN_MS = 60 * 60 * 1000;
function readBreaker() {
  try {
    if (existsSync2(BREAKER_PATH))
      return JSON.parse(readFileSync(BREAKER_PATH, "utf-8"));
  } catch {}
  return { failures: 0, lastFailure: 0 };
}
function writeBreaker(state) {
  try {
    const tmp = BREAKER_PATH + ".tmp";
    writeFileSync(tmp, JSON.stringify(state));
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
var SYSTEM_PROMPT = `You are analyzing a Claude Code session to extract durable memories and write a session summary.

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
async function compressWithAnthropic(observations, project) {
  const client = new Anthropic;
  const obsText = observations.map((o, i) => `[${i + 1}]${o.tool_name ? ` Tool: ${o.tool_name}` : ""}
${o.content}`).join(`

---

`);
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
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
  const MODEL = process.env.APSOLUT_CORTEX_OLLAMA_MODEL ?? "qwen2.5-coder:7b";
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
  const parsed = JSON.parse(clean);
  return {
    memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : ""
  };
}
async function compressSession(observations, project) {
  if (observations.length === 0) {
    return { memories: [], summary: "" };
  }
  if (isBreakerOpen()) {
    console.error("[apsolut-cortex] Compression circuit breaker open — skipping (retries in ~1h)");
    return { memories: [], summary: "" };
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
    return { memories: [], summary: "" };
  }
}

// src/buffer.ts
import {
  appendFileSync,
  existsSync as existsSync3,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync2,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "fs";
import { join as join3 } from "path";
import { homedir as homedir3 } from "os";
var BUFFER_DIR = join3(homedir3(), ".apsolut-cortex", "buffer");
var LOCK_TTL_MS = 5 * 60 * 1000;
function ensureDir() {
  if (!existsSync3(BUFFER_DIR))
    mkdirSync2(BUFFER_DIR, { recursive: true });
}
function lockPath(sessionId) {
  return join3(BUFFER_DIR, `${sessionId}.lock`);
}
function cursorPath(sessionId) {
  return join3(BUFFER_DIR, `${sessionId}.cursor`);
}
function readCursor(sessionId) {
  const path = cursorPath(sessionId);
  if (!existsSync3(path))
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
  writeFileSync2(cursorPath(sessionId), String(msgIdx));
}
function tryAcquireLock(sessionId) {
  ensureDir();
  const path = lockPath(sessionId);
  if (existsSync3(path)) {
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
    writeFileSync2(path, String(process.pid));
    return true;
  } catch {
    return false;
  }
}
function releaseLock2(sessionId) {
  const path = lockPath(sessionId);
  if (existsSync3(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }
}

// src/transcript.ts
import { existsSync as existsSync4, readFileSync as readFileSync3 } from "fs";

// src/tokens.ts
import { encode } from "gpt-tokenizer";
function flattenMessageContent(msg) {
  if (!msg || typeof msg !== "object")
    return "";
  const m = msg;
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

// src/transcript.ts
function readTranscript(transcriptPath) {
  if (!existsSync4(transcriptPath))
    return [];
  let raw;
  try {
    raw = readFileSync3(transcriptPath, "utf-8");
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
    const role = msg && typeof msg === "object" && typeof msg.role === "string" ? msg.role : "unknown";
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
    await insertRawMessage(db, {
      session_id: sessionId,
      msg_idx: m.msg_idx,
      role: m.role,
      content: m.content,
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

// src/compress-runner.ts
async function compressSlice(args) {
  const { db, sessionId, projectId, projectName, transcriptPath, source } = args;
  await upsertSession(db, { id: sessionId, project_id: projectId });
  const transcript = await captureTranscript(db, sessionId, transcriptPath);
  if (transcript.length === 0) {
    return { raw_persisted: 0, memories_stored: 0, duplicates_bumped: 0, new_cursor: 0 };
  }
  const cursor = readCursor(sessionId);
  const endIdx = transcript[transcript.length - 1].msg_idx + 1;
  if (cursor >= endIdx) {
    return { raw_persisted: transcript.length, memories_stored: 0, duplicates_bumped: 0, new_cursor: cursor };
  }
  const slice = sliceRange(transcript, cursor, endIdx);
  const observations = slice.map((m) => ({
    tool_name: null,
    content: `[${m.role}] ${m.content}`,
    category: null
  }));
  const { memories } = await compressSession(observations, projectName);
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

// src/hooks/pre-compact.ts
async function main() {
  const raw = await new Promise((resolve) => {
    let d = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => {
      d += c;
    });
    process.stdin.on("end", () => resolve(d));
  });
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const cwd = data.cwd ?? process.cwd();
  const sessionId = data.session_id;
  const transcriptPath = data.transcript_path;
  if (!sessionId || !transcriptPath)
    process.exit(0);
  const projectFile = join4(cwd, ".apsolut-cortex", "project.json");
  if (!existsSync5(projectFile))
    process.exit(0);
  let project = null;
  try {
    project = JSON.parse(readFileSync4(projectFile, "utf-8"));
  } catch {
    process.exit(0);
  }
  if (!project?.id)
    process.exit(0);
  const deadline = Date.now() + 3000;
  while (!tryAcquireLock(sessionId) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    const db = await getDb();
    const result = await compressSlice({
      db,
      sessionId,
      projectId: project.id,
      projectName: project.name,
      transcriptPath,
      source: "precompact"
    });
    process.stderr.write(`[apsolut-cortex] PreCompact captured: ${result.raw_persisted} raw msgs, ${result.memories_stored} memories (+${result.duplicates_bumped} bumped)
`);
  } catch (e) {
    process.stderr.write(`[apsolut-cortex] PreCompact error: ${e}
`);
  } finally {
    releaseLock2(sessionId);
  }
}
main().catch(() => process.exit(0));
