// src/hooks/user-prompt-submit.ts
import { readFileSync, writeFileSync, existsSync as existsSync2, mkdirSync as mkdirSync2 } from "fs";
import { join as join3 } from "path";

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

// src/migrations/005-observation-prompt-id.ts
var migration5 = {
  name: "005-observation-prompt-id",
  async up(client) {
    await client.executeMultiple(`
      ALTER TABLE observations ADD COLUMN prompt_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_obs_prompt ON observations(prompt_id);
    `);
  }
};
var _005_observation_prompt_id_default = migration5;

// src/migrations/runner.ts
var MIGRATIONS = [
  _001_initial_schema_default,
  _002_range_linked_memories_default,
  _003_raw_messages_default,
  _004_memory_tags_default,
  _005_observation_prompt_id_default
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
import { createRequire } from "module";
var KEYRING_SERVICE = "apsolut-cortex";
var KEYRING_ACCOUNT_DB_KEY = "db-encryption-key";
var _EntryCtor = null;
var _loadError = null;
try {
  const require2 = createRequire(import.meta.url);
  _EntryCtor = require2("@napi-rs/keyring").Entry;
} catch (e) {
  _loadError = e;
}
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

// src/prompt-cues.ts
var PUSHBACK_CUES = [
  /^\s*no[,.\s]/i,
  /\b(?:that'?s|this is|it'?s)\s+(?:wrong|incorrect|not right|not true)\b/i,
  /\bdon'?t\s+(?:do|use|touch|add|change|delete|remove)\b/i,
  /\bstop\s+(?:doing|using|adding)\b/i,
  /\bnever\s+(?:do|use|touch|add|commit|push)\b/i,
  /\bnot\s+what\s+i\s+(?:asked|meant|wanted)\b/i,
  /\bi\s+(?:said|told you|already told)\b/i,
  /\bundo\s+(?:that|this|the)\b/i,
  /\brevert\s+(?:that|this)\b/i,
  /\bwe\s+(?:don'?t|no longer|stopped)\s+us(?:e|ing)\b/i,
  /\binstead\s+of\s+that\b/i,
  /\bwhy\s+(?:did|are|would)\s+you\b/i
];
function isPushback(prompt) {
  if (!prompt || prompt.length < 4)
    return false;
  return PUSHBACK_CUES.some((re) => re.test(prompt));
}
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
function contentTerms(prompt, max = 8) {
  const terms = prompt.toLowerCase().replace(/[^a-z0-9\s_.-]/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return [...new Set(terms)].slice(0, max);
}

// src/buffer.ts
import { join as join2 } from "path";
import { homedir as homedir2 } from "os";
var BUFFER_DIR = join2(homedir2(), ".apsolut-cortex", "buffer");
var LOCK_TTL_MS = 5 * 60 * 1000;

// src/hooks/user-prompt-submit.ts
var INJECT_LIMIT = 2;
var INJECT_MIN_WEIGHT = 1;
function injectedPath(sessionId) {
  return join3(BUFFER_DIR, `${sessionId}.injected.json`);
}
function readInjected(sessionId) {
  try {
    return new Set(JSON.parse(readFileSync(injectedPath(sessionId), "utf-8")));
  } catch {
    return new Set;
  }
}
function writeInjected(sessionId, ids) {
  try {
    if (!existsSync2(BUFFER_DIR))
      mkdirSync2(BUFFER_DIR, { recursive: true });
    writeFileSync(injectedPath(sessionId), JSON.stringify([...ids]));
  } catch {}
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
  const promptText = (data.text ?? data.prompt ?? "").trim();
  if (!promptText)
    process.exit(0);
  const projectFile = join3(cwd, ".apsolut-cortex", "project.json");
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
    const terms = contentTerms(promptText);
    const candidates = terms.length > 0 ? await searchBM25(db, project.id, terms.join(" "), 5) : [];
    if (isPushback(promptText)) {
      const contradicted = candidates[0];
      const snippet = stripPrivate(promptText.slice(0, 300));
      if (snippet) {
        const content = contradicted ? `User pushback: "${snippet}" — may contradict memory ${contradicted.id}: "${contradicted.content.slice(0, 150)}"` : `User pushback: "${snippet}"`;
        await insertObservation(db, {
          session_id: sessionId,
          project_id: project.id,
          content,
          category: "correction",
          prompt_id: data.prompt_id
        });
        await db.execute({
          sql: "UPDATE sessions SET tool_failures = tool_failures + 1 WHERE id = ?",
          args: [sessionId]
        });
      }
      process.exit(0);
    }
    if (process.env.CORTEX_PROMPT_INJECT === "0")
      process.exit(0);
    const already = readInjected(sessionId);
    const picks = candidates.filter((m) => (m.category === "correction" || m.category === "decision") && m.weight >= INJECT_MIN_WEIGHT && !already.has(m.id)).slice(0, INJECT_LIMIT);
    if (picks.length === 0)
      process.exit(0);
    picks.forEach((m) => already.add(m.id));
    writeInjected(sessionId, already);
    const lines = picks.map((m) => `- [${m.category}] ${m.content}`);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `[apsolut-cortex] Stored memories relevant to this prompt:
${lines.join(`
`)}`
      }
    }));
    process.exit(0);
  } catch {
    process.exit(0);
  }
}
main().catch(() => process.exit(0));
