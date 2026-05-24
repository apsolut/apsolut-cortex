#!/usr/bin/env bun
// @bun

// src/mcp/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "fs";
import { join as join4, dirname as dirname2, resolve } from "path";
import { fileURLToPath } from "url";

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

// src/migrations/runner.ts
var MIGRATIONS = [
  _001_initial_schema_default,
  _002_range_linked_memories_default,
  _003_raw_messages_default
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
  const existing = await db.execute({
    sql: "SELECT id FROM projects WHERE id = ?",
    args: [project.id]
  });
  if (existing.rows.length > 0) {
    await db.execute({
      sql: "UPDATE projects SET last_session = ? WHERE id = ?",
      args: [Date.now(), project.id]
    });
  } else {
    await db.execute({
      sql: "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)",
      args: [project.id, project.name, project.path ?? null, Date.now()]
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
async function getMemoryWithRange(db, memoryId) {
  const result = await db.execute({
    sql: "SELECT * FROM memories WHERE id = ?",
    args: [memoryId]
  });
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
  const escaped = `"${query.replace(/"/g, '""')}"`;
  const result = await db.execute({
    sql: `SELECT m.* FROM memories_fts
          JOIN memories m ON m.rowid = memories_fts.rowid
          WHERE memories_fts MATCH ? AND m.project_id = ?
          ORDER BY bm25(memories_fts) LIMIT ?`,
    args: [escaped, projectId, limit]
  });
  return result.rows.map(rowToMemory);
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
async function updateWeight(db, id, score) {
  const result = await db.execute({
    sql: "SELECT weight, used_count FROM memories WHERE id = ?",
    args: [id]
  });
  if (result.rows.length === 0)
    return;
  const mem = result.rows[0];
  const alpha = CORTEX_WEIGHT_ALPHA;
  const oldWeight = mem.weight;
  const usedCount = mem.used_count;
  const newWeight = alpha * (score / 3) + (1 - alpha) * oldWeight;
  const newTrust = newWeight > CORTEX_PROMOTE_WEIGHT || usedCount + 1 >= CORTEX_PROMOTE_USES ? "validated" : undefined;
  if (newTrust) {
    await db.execute({
      sql: "UPDATE memories SET weight = ?, used_count = used_count + 1, last_used = ?, trust = CASE WHEN trust = 'observed' THEN ? ELSE trust END WHERE id = ?",
      args: [newWeight, Date.now(), newTrust, id]
    });
  } else {
    await db.execute({
      sql: "UPDATE memories SET weight = ?, used_count = used_count + 1, last_used = ? WHERE id = ?",
      args: [newWeight, Date.now(), id]
    });
  }
}

// src/embed.ts
import { pipeline, env } from "@huggingface/transformers";

// src/db.ts
import { createClient as createClient2 } from "@libsql/client";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
var CORTEX_DIR2 = join2(homedir2(), ".apsolut-cortex");
var DB_PATH2 = join2(CORTEX_DIR2, "memory.db");
var REGISTRY_PATH2 = join2(CORTEX_DIR2, "registry.json");
var MODELS_DIR2 = join2(CORTEX_DIR2, "models");
var GREP_STOP_WORDS2 = new Set([
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
env.cacheDir = MODELS_DIR2;
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

// src/config.ts
function envNum2(key, fallback) {
  const val = process.env[key];
  if (val === undefined)
    return fallback;
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
var CORTEX_DUPLICATE_THRESHOLD2 = envNum2("APSOLUT_CORTEX_DUPLICATE_THRESHOLD", 0.92);
var CORTEX_DECAY_DAYS2 = envNum2("APSOLUT_CORTEX_DECAY_DAYS", 7);
var CORTEX_DECAY_OBSERVED2 = envNum2("APSOLUT_CORTEX_DECAY_OBSERVED", 0.95);
var CORTEX_DECAY_VALIDATED2 = envNum2("APSOLUT_CORTEX_DECAY_VALIDATED", 0.98);
var CORTEX_PRUNE_WEIGHT2 = envNum2("APSOLUT_CORTEX_PRUNE_WEIGHT", 0.1);
var CORTEX_RRF_K2 = envNum2("APSOLUT_CORTEX_RRF_K", 60);
var CORTEX_MMR_LAMBDA2 = envNum2("APSOLUT_CORTEX_MMR_LAMBDA", 0.7);
var CORTEX_SEARCH_LIMIT_MAX2 = envNum2("APSOLUT_CORTEX_SEARCH_LIMIT_MAX", 10);
var CORTEX_SEARCH_MULTIPLIER2 = envNum2("APSOLUT_CORTEX_SEARCH_MULTIPLIER", 2);
var CORTEX_WEIGHT_ALPHA2 = envNum2("APSOLUT_CORTEX_WEIGHT_ALPHA", 0.3);
var CORTEX_PROMOTE_WEIGHT2 = envNum2("APSOLUT_CORTEX_PROMOTE_WEIGHT", 1.4);
var CORTEX_PROMOTE_USES2 = envNum2("APSOLUT_CORTEX_PROMOTE_USES", 3);
var CORTEX_BUMP_BOOST2 = envNum2("APSOLUT_CORTEX_BUMP_BOOST", 0.1);
var CORTEX_WEIGHT_CAP2 = envNum2("APSOLUT_CORTEX_WEIGHT_CAP", 3);
var CORTEX_CORRECTION_WEIGHT2 = envNum2("APSOLUT_CORTEX_CORRECTION_WEIGHT", 1.5);
var CORTEX_MANUAL_WEIGHT2 = envNum2("APSOLUT_CORTEX_MANUAL_WEIGHT", 1.2);
var CORTEX_RAW_RETENTION_DAYS2 = envNum2("APSOLUT_CORTEX_RAW_RETENTION_DAYS", 90);

// src/logs.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync } from "fs";
import { homedir as homedir3 } from "os";
import { dirname, join as join3 } from "path";
var LOGS_DIR = join3(homedir3(), ".apsolut-cortex", "logs");
var RETRIEVALS_PATH = join3(LOGS_DIR, "retrievals.jsonl");
var CORRECTIONS_PATH = join3(LOGS_DIR, "corrections.jsonl");
var SHADOW_PATH = join3(LOGS_DIR, "shadow.jsonl");
function appendJsonl(path, entry) {
  try {
    const dir = dirname(path);
    if (!existsSync2(dir))
      mkdirSync2(dir, { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + `
`);
  } catch (e) {
    process.stderr.write(`[apsolut-cortex] log write failed (${path}): ${e}
`);
  }
}
function logRetrieval(entry) {
  appendJsonl(entry.shadow ? SHADOW_PATH : RETRIEVALS_PATH, entry);
}

// src/mcp/server.ts
var PROJECT_PATH = process.env.APSOLUT_PROJECT_PATH ?? process.cwd();
var projectFile = join4(PROJECT_PATH, ".apsolut-cortex", "project.json");
var project = null;
if (existsSync3(projectFile)) {
  try {
    project = JSON.parse(readFileSync2(projectFile, "utf-8"));
  } catch {}
}
var db = await getDb();
if (project?.id) {
  await upsertProject(db, { id: project.id, name: project.name, path: PROJECT_PATH });
}
var __mcp_dirname = dirname2(fileURLToPath(import.meta.url));
var PKG_VERSION = JSON.parse(readFileSync2(resolve(__mcp_dirname, "..", "..", "package.json"), "utf-8")).version;
var server = new Server({ name: "apsolut-cortex", version: PKG_VERSION }, { capabilities: { tools: {} } });
var TAG = "[apsolut-cortex]";
var SHADOW_MODE = ["true", "1", "yes"].includes((process.env.APSOLUT_CORTEX_SHADOW ?? "").toLowerCase());
function requireProject() {
  if (!project?.id)
    throw new Error("No project found. Run: apsolut-cortex init");
  return project;
}
async function hybridSearch(projectId, query, limit) {
  const fetchCount = limit * CORTEX_SEARCH_MULTIPLIER2;
  const bm25 = await searchBM25(db, projectId, query, fetchCount);
  let vectorResults = [];
  let queryEmb = null;
  try {
    queryEmb = await embed(query);
    vectorResults = await searchVector(db, projectId, queryEmb, fetchCount);
  } catch (e) {
    console.error(`[apsolut-cortex] search embedding failed, falling back to BM25: ${e}`);
  }
  const ranks = new Map;
  bm25.forEach((m, i) => {
    ranks.set(m.id, { bm25_rank: i + 1, vector_rank: null });
  });
  vectorResults.forEach((m, i) => {
    const cur = ranks.get(m.id) ?? { bm25_rank: null, vector_rank: null };
    cur.vector_rank = i + 1;
    ranks.set(m.id, cur);
  });
  const allItems = new Map;
  bm25.forEach((m) => allItems.set(m.id, m));
  vectorResults.forEach((m) => allItems.set(m.id, m));
  const merged = mergeRRF(bm25, vectorResults, fetchCount, allItems);
  const withSimilarity = merged.map((m) => ({
    ...m,
    similarity: vectorResults.find((v) => v.id === m.id)?.similarity ?? 0
  }));
  return { results: applyMMR(withSimilarity, queryEmb, limit), ranks };
}
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "memory_search",
      description: "Search project memory for relevant context. Use when you need to recall decisions, patterns, corrections, or facts about this project. Triggered by user saying 'remember <topic>' or when you're uncertain about project-specific details.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Topic or question to search for" },
          limit: { type: "number", description: "Max results, default 5" },
          tier: {
            type: "string",
            enum: ["episodic", "semantic", "procedural", "strategic", "meta"],
            description: "Optional: filter to a specific memory tier"
          },
          trust: {
            type: "string",
            enum: ["observed", "validated", "proven", "canonical"],
            description: "Optional: filter to a minimum trust level"
          }
        },
        required: ["query"]
      }
    },
    {
      name: "memory_store",
      description: "Store something important about this project. Use when you make a correction, discover something about the codebase, reach a decision, or find a pattern worth preserving.",
      inputSchema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The memory \u2014 specific, actionable, one clear sentence"
          },
          category: {
            type: "string",
            enum: ["correction", "insight", "decision", "discovery", "fact", "pattern"],
            description: "correction=I was wrong about X; insight=I learned X; decision=we decided X; fact=stable fact; pattern=recurring pattern"
          },
          tier: {
            type: "string",
            enum: ["episodic", "semantic", "procedural", "strategic", "meta"],
            description: "episodic=specific event; semantic=general fact; procedural=how-to; strategic=architectural decision; meta=how to work with this project"
          },
          context: {
            type: "string",
            description: "Optional: what was happening when you stored this"
          }
        },
        required: ["content", "category"]
      }
    },
    {
      name: "memory_rate",
      description: "Rate a memory you retrieved \u2014 helps the system learn what's useful. Always call this after using results from memory_search.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory ID from memory_search result" },
          score: {
            type: "number",
            description: "0=useless/ignored, 1=marginally relevant, 2=helpful context, 3=directly applied"
          }
        },
        required: ["id", "score"]
      }
    },
    {
      name: "memory_contradict",
      description: "Mark a memory as wrong and optionally replace it with the correct information.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID of the wrong memory" },
          correction: {
            type: "string",
            description: "Optional: what the correct information actually is"
          }
        },
        required: ["id"]
      }
    },
    {
      name: "memory_status",
      description: "Show memory stats for this project.",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "memory_recall",
      description: "Fetch the raw conversation slice that a compressed memory was derived from. Use when a memory is ambiguous or you need the exact wording, tool output, or chronology that compression removed. Returns the raw messages, or a clear message if the memory predates source-range tracking or its raw window has been pruned.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory ID from memory_search" }
        },
        required: ["id"]
      }
    }
  ]
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    switch (name) {
      case "memory_search": {
        const p = requireProject();
        const query = String(args?.query ?? "");
        const limit = Math.min(Number(args?.limit ?? 5), CORTEX_SEARCH_LIMIT_MAX2);
        const tierFilter = args?.tier;
        const trustFilter = args?.trust;
        const t0 = Date.now();
        const { results: rawResults, ranks } = await hybridSearch(p.id, query, limit * CORTEX_SEARCH_MULTIPLIER2);
        let results = rawResults;
        if (tierFilter)
          results = results.filter((m) => m.tier === tierFilter);
        if (trustFilter) {
          const trustOrder = ["observed", "validated", "proven", "canonical"];
          const minIdx = trustOrder.indexOf(trustFilter);
          results = results.filter((m) => trustOrder.indexOf(m.trust) >= minIdx);
        }
        results = results.slice(0, limit);
        const latencyMs = Date.now() - t0;
        const injectedIds = SHADOW_MODE ? [] : results.map((r) => r.id);
        const candidates = results.map((r, i) => {
          const rk = ranks.get(r.id);
          return {
            id: r.id,
            tier: r.tier,
            trust: r.trust,
            weight: r.weight,
            bm25_rank: rk?.bm25_rank ?? null,
            vector_rank: rk?.vector_rank ?? null,
            final_rank: i + 1
          };
        });
        logRetrieval({
          ts: Date.now(),
          project_id: p.id,
          project_name: p.name,
          query,
          candidates,
          injected_ids: injectedIds,
          latency_ms: latencyMs,
          shadow: SHADOW_MODE
        });
        if (SHADOW_MODE) {
          return {
            content: [{
              type: "text",
              text: `${TAG} Shadow mode active \u2014 ${results.length} would-be matches logged to ~/.apsolut-cortex/logs/shadow.jsonl (none injected).`
            }]
          };
        }
        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: `${TAG} No memories found for "${query}" in project ${p.name}.

You can store something with memory_store.`
            }]
          };
        }
        const text = results.map((r, i) => {
          const age = Math.round((Date.now() - r.created_at) / (24 * 60 * 60 * 1000));
          return [
            `[${i + 1}] ID: ${r.id}`,
            `    ${r.tier}/${r.category} \xB7 trust: ${r.trust} \xB7 weight: ${r.weight.toFixed(2)} \xB7 ${age}d ago`,
            `    ${r.content}`,
            r.context ? `    Context: ${r.context}` : ""
          ].filter(Boolean).join(`
`);
        }).join(`

`);
        return {
          content: [{
            type: "text",
            text: `${TAG} Found ${results.length} memories for "${query}":

${text}

Call memory_rate(id, score) after using these.`
          }]
        };
      }
      case "memory_store": {
        const p = requireProject();
        const rawContent = String(args?.content ?? "").trim();
        const content = stripPrivate(rawContent) ?? "";
        const category = args?.category ?? "insight";
        const tier = args?.tier ?? "semantic";
        const context = args?.context ? stripPrivate(String(args.context)) : null;
        if (!content) {
          return { content: [{ type: "text", text: `${TAG} Error: content is required (or entirely private)` }] };
        }
        const textToEmbed = context ? `${content} ${context}` : content;
        let embeddingRaw = null;
        try {
          embeddingRaw = await embed(textToEmbed);
        } catch (e) {
          console.error(`[apsolut-cortex] embedding failed for store: ${e}`);
        }
        if (embeddingRaw) {
          const dup = await findDuplicate(db, p.id, embeddingRaw);
          if (dup) {
            await bumpWeight(db, dup.id);
            return {
              content: [{
                type: "text",
                text: `${TAG} Similar memory already exists (${dup.id}). Boosted its weight instead of duplicating.`
              }]
            };
          }
        }
        const weight = category === "correction" ? CORTEX_CORRECTION_WEIGHT2 : CORTEX_MANUAL_WEIGHT2;
        const id = await insertMemory(db, {
          project_id: p.id,
          tier,
          category,
          trust: "observed",
          content,
          context,
          source: "manual",
          embedding: embeddingRaw,
          weight,
          session_id: null
        });
        return {
          content: [{
            type: "text",
            text: `${TAG} Stored memory ${id}
${tier}/${category}: ${content}`
          }]
        };
      }
      case "memory_rate": {
        const id = String(args?.id ?? "");
        const score = Math.min(3, Math.max(0, Math.round(Number(args?.score ?? 1))));
        if (!id) {
          return { content: [{ type: "text", text: `${TAG} Error: id is required` }] };
        }
        await updateWeight(db, id, score);
        const labels = ["useless", "marginal", "helpful", "directly applied"];
        return {
          content: [{
            type: "text",
            text: `${TAG} Rated memory ${id}: ${score}/3 (${labels[score]}). Weight updated.`
          }]
        };
      }
      case "memory_contradict": {
        const p = requireProject();
        const id = String(args?.id ?? "");
        const correction = args?.correction ? String(args.correction) : null;
        if (!id) {
          return { content: [{ type: "text", text: `${TAG} Error: id is required` }] };
        }
        await db.execute({ sql: "DELETE FROM memories WHERE id = ?", args: [id] });
        let newId = null;
        if (correction) {
          let embedding = null;
          try {
            embedding = await embed(correction);
          } catch (e) {
            console.error(`[apsolut-cortex] embedding failed for correction: ${e}`);
          }
          newId = await insertMemory(db, {
            project_id: p.id,
            tier: "episodic",
            category: "correction",
            trust: "observed",
            content: correction,
            context: `Replaced wrong memory ${id}`,
            source: "manual",
            embedding,
            weight: CORTEX_CORRECTION_WEIGHT2,
            session_id: null
          });
        }
        return {
          content: [{
            type: "text",
            text: correction ? `${TAG} Deleted wrong memory ${id}. Stored correction as ${newId}.` : `${TAG} Deleted wrong memory ${id}.`
          }]
        };
      }
      case "memory_recall": {
        const id = String(args?.id ?? "");
        if (!id) {
          return { content: [{ type: "text", text: `${TAG} Error: id is required` }] };
        }
        const result = await getMemoryWithRange(db, id);
        if (!result) {
          return {
            content: [{
              type: "text",
              text: `${TAG} No memory found with id "${id}".`
            }]
          };
        }
        const { memory, rawMessages } = result;
        if (memory.source_session_id === null) {
          return {
            content: [{
              type: "text",
              text: `${TAG} Memory ${id} has no source range. It either predates M4 (range-linked memories) or was stored manually without a session context. Memory content:

${memory.content}`
            }]
          };
        }
        if (rawMessages.length === 0) {
          return {
            content: [{
              type: "text",
              text: `${TAG} Memory ${id} points at session ${memory.source_session_id} messages [${memory.source_start_msg_idx}, ${memory.source_end_msg_idx}), but no raw messages were found at that range. They may have been pruned by retention policy. Memory content:

${memory.content}`
            }]
          };
        }
        const transcript = rawMessages.map((m) => `[${m.msg_idx}] ${m.role}: ${m.content}`).join(`

`);
        return {
          content: [{
            type: "text",
            text: `${TAG} Raw source for memory ${id}
Session: ${memory.source_session_id}  Range: [${memory.source_start_msg_idx}, ${memory.source_end_msg_idx})  ${rawMessages.length} messages

Compressed memory:
  ${memory.content}

Raw transcript:
${transcript}`
          }]
        };
      }
      case "memory_status": {
        const p = requireProject();
        const statsResult = await db.execute({
          sql: `SELECT tier, category, trust,
                       COUNT(*) as count,
                       ROUND(AVG(weight), 2) as avg_weight,
                       SUM(used_count) as total_uses
                FROM memories
                WHERE project_id = ?
                GROUP BY tier, category, trust
                ORDER BY tier, category, trust`,
          args: [p.id]
        });
        const stats = statsResult.rows;
        const total = stats.reduce((s, r) => s + r.count, 0);
        const sessionsResult = await db.execute({
          sql: "SELECT COUNT(*) as n FROM sessions WHERE project_id = ?",
          args: [p.id]
        });
        const sessionCount = sessionsResult.rows[0]?.n ?? 0;
        const summaryResult = await db.execute({
          sql: `SELECT summary FROM sessions
                WHERE project_id = ? AND summary IS NOT NULL
                ORDER BY started_at DESC LIMIT 1`,
          args: [p.id]
        });
        const lastSummary = summaryResult.rows[0]?.summary;
        const lines = [
          `${TAG} Project: ${p.name}`,
          `Total memories: ${total} across ${sessionCount} sessions`,
          "",
          ...stats.map((r) => `  ${r.tier}/${r.category} [${r.trust}] \u2014 ${r.count} memories, avg weight ${r.avg_weight}, ${r.total_uses} uses`)
        ];
        if (lastSummary) {
          lines.push("", "Last session:", `  ${lastSummary}`);
        }
        return { content: [{ type: "text", text: lines.join(`
`) }] };
      }
      default:
        return { content: [{ type: "text", text: `${TAG} Unknown tool: ${name}` }] };
    }
  } catch (e) {
    return {
      content: [{
        type: "text",
        text: `${TAG} Error: ${e instanceof Error ? e.message : String(e)}`
      }]
    };
  }
});
var transport = new StdioServerTransport;
await server.connect(transport);
