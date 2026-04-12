import { createClient, type Client, type Row } from "@libsql/client";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const CORTEX_DIR = join(homedir(), ".apsolut");
export const DB_PATH = join(CORTEX_DIR, "memory.db");
export const REGISTRY_PATH = join(CORTEX_DIR, "registry.json");
export const MODELS_DIR = join(CORTEX_DIR, "models");

let _db: Client | null = null;
let _initialized = false;

export async function getDb(): Promise<Client> {
  if (_db && _initialized) return _db;

  if (!existsSync(CORTEX_DIR)) mkdirSync(CORTEX_DIR, { recursive: true });
  if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true });

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

// ── Helpers ─────────────────────────────────────────────────────────────────

function vecToSql(arr: Float32Array): string {
  return JSON.stringify(Array.from(arr));
}

function rowToMemory(r: Row): Memory {
  return {
    id: r.id as string,
    project_id: r.project_id as string,
    tier: r.tier as MemoryTier,
    category: r.category as MemoryCategory,
    trust: r.trust as TrustLevel,
    content: r.content as string,
    context: r.context as string | null,
    source: r.source as string,
    embedding: r.embedding as ArrayBuffer | null,
    weight: r.weight as number,
    used_count: r.used_count as number,
    last_used: r.last_used as number | null,
    created_at: r.created_at as number,
    session_id: r.session_id as string | null,
    flagged: r.flagged as number,
    flag_reason: r.flag_reason as string | null,
  };
}

// ── Types ────────────────────────────────────────────────────────────────────

export type MemoryTier =
  | "episodic"
  | "semantic"
  | "procedural"
  | "strategic"
  | "meta";

export type MemoryCategory =
  | "correction"
  | "insight"
  | "decision"
  | "discovery"
  | "fact"
  | "pattern";

export type TrustLevel = "observed" | "validated" | "proven" | "canonical";

export interface Memory {
  id: string;
  project_id: string;
  tier: MemoryTier;
  category: MemoryCategory;
  trust: TrustLevel;
  content: string;
  context: string | null;
  source: string;
  embedding: ArrayBuffer | null;
  weight: number;
  used_count: number;
  last_used: number | null;
  created_at: number;
  session_id: string | null;
  flagged: number;
  flag_reason: string | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string | null;
  created_at: number;
  last_session: number | null;
}

// ── Project ──────────────────────────────────────────────────────────────────

export async function upsertProject(
  db: Client,
  project: { id: string; name: string; path?: string }
): Promise<void> {
  const existing = await db.execute({
    sql: "SELECT id FROM projects WHERE id = ?",
    args: [project.id],
  });
  if (existing.rows.length > 0) {
    await db.execute({
      sql: "UPDATE projects SET last_session = ? WHERE id = ?",
      args: [Date.now(), project.id],
    });
  } else {
    await db.execute({
      sql: "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)",
      args: [project.id, project.name, project.path ?? null, Date.now()],
    });
  }
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function upsertSession(
  db: Client,
  s: { id: string; project_id: string; ended_at?: number; summary?: string;
       memories_stored?: number; tool_failures?: number }
): Promise<void> {
  const existing = await db.execute({
    sql: "SELECT id FROM sessions WHERE id = ?",
    args: [s.id],
  });
  if (existing.rows.length > 0) {
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if (s.ended_at !== undefined) { sets.push("ended_at = ?"); vals.push(s.ended_at); }
    if (s.summary !== undefined) { sets.push("summary = ?"); vals.push(s.summary); }
    if (s.memories_stored !== undefined) { sets.push("memories_stored = ?"); vals.push(s.memories_stored); }
    if (s.tool_failures !== undefined) { sets.push("tool_failures = ?"); vals.push(s.tool_failures); }
    if (sets.length) {
      vals.push(s.id);
      await db.execute({ sql: `UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`, args: vals });
    }
  } else {
    await db.execute({
      sql: "INSERT INTO sessions (id, project_id, started_at) VALUES (?, ?, ?)",
      args: [s.id, s.project_id, Date.now()],
    });
  }
}

export async function getRecentSummaries(
  db: Client,
  projectId: string,
  limit = 3
): Promise<string[]> {
  const result = await db.execute({
    sql: `SELECT summary FROM sessions
          WHERE project_id = ? AND summary IS NOT NULL AND summary != ''
          ORDER BY started_at DESC LIMIT ?`,
    args: [projectId, limit],
  });
  return result.rows.map((r) => r.summary as string);
}

// ── Observations ─────────────────────────────────────────────────────────────

export async function insertObservation(
  db: Client,
  obs: { session_id: string; project_id: string; tool_name?: string;
         content: string; category?: string }
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO observations (id, session_id, project_id, tool_name, content, category, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(), obs.session_id, obs.project_id,
      obs.tool_name ?? null, obs.content, obs.category ?? null, Date.now(),
    ],
  });
}

export async function getSessionObservations(
  db: Client,
  sessionId: string
): Promise<Array<{ tool_name: string | null; content: string; category: string | null }>> {
  const result = await db.execute({
    sql: "SELECT tool_name, content, category FROM observations WHERE session_id = ? AND promoted = 0 ORDER BY created_at ASC",
    args: [sessionId],
  });
  return result.rows.map((r) => ({
    tool_name: r.tool_name as string | null,
    content: r.content as string,
    category: r.category as string | null,
  }));
}

export async function getUnprocessedObservations(
  db: Client,
  projectId: string,
  excludeSessionId: string
): Promise<Array<{ tool_name: string | null; content: string; category: string | null; session_id: string }>> {
  const result = await db.execute({
    sql: "SELECT tool_name, content, category, session_id FROM observations WHERE project_id = ? AND session_id != ? AND promoted = 0 ORDER BY created_at ASC LIMIT 50",
    args: [projectId, excludeSessionId],
  });
  return result.rows.map((r) => ({
    tool_name: r.tool_name as string | null,
    content: r.content as string,
    category: r.category as string | null,
    session_id: r.session_id as string,
  }));
}

export async function markObservationsPromoted(
  db: Client,
  sessionId: string
): Promise<void> {
  await db.execute({
    sql: "UPDATE observations SET promoted = 1 WHERE session_id = ?",
    args: [sessionId],
  });
}

export async function markProjectObservationsPromoted(
  db: Client,
  projectId: string
): Promise<void> {
  await db.execute({
    sql: "UPDATE observations SET promoted = 1 WHERE project_id = ? AND promoted = 0",
    args: [projectId],
  });
}

// ── Memories ─────────────────────────────────────────────────────────────────

export async function findDuplicate(
  db: Client,
  projectId: string,
  embedding: Float32Array,
  threshold = 0.92
): Promise<{ id: string; weight: number } | null> {
  // cosine distance = 1 - cosine similarity, so threshold becomes 1 - 0.92 = 0.08
  const maxDistance = 1 - threshold;
  const result = await db.execute({
    sql: `SELECT id, weight, vector_distance_cos(embedding, vector(?)) as distance
          FROM memories
          WHERE project_id = ? AND embedding IS NOT NULL
          ORDER BY distance LIMIT 1`,
    args: [vecToSql(embedding), projectId],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const distance = row.distance as number;
  if (distance <= maxDistance) {
    return { id: row.id as string, weight: row.weight as number };
  }
  return null;
}

export async function bumpWeight(
  db: Client,
  id: string,
  boost: number = 0.1
): Promise<void> {
  await db.execute({
    sql: "UPDATE memories SET weight = MIN(weight + ?, 3.0), last_used = ? WHERE id = ?",
    args: [boost, Date.now(), id],
  });
}

export async function insertMemory(
  db: Client,
  m: {
    project_id: string; tier: string; category: string; trust: string;
    content: string; context: string | null; source: string;
    embedding: Float32Array | null; weight: number; session_id: string | null;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  if (m.embedding) {
    await db.execute({
      sql: `INSERT INTO memories
              (id, project_id, tier, category, trust, content, context,
               source, embedding, weight, used_count, created_at, session_id)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, vector(?), ?, 0, ?, ?)`,
      args: [
        id, m.project_id, m.tier, m.category, m.trust,
        m.content, m.context ?? null, m.source,
        vecToSql(m.embedding), m.weight, Date.now(), m.session_id ?? null,
      ],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO memories
              (id, project_id, tier, category, trust, content, context,
               source, embedding, weight, used_count, created_at, session_id)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)`,
      args: [
        id, m.project_id, m.tier, m.category, m.trust,
        m.content, m.context ?? null, m.source,
        m.weight, Date.now(), m.session_id ?? null,
      ],
    });
  }
  return id;
}

export async function searchBM25(
  db: Client,
  projectId: string,
  query: string,
  limit: number
): Promise<Memory[]> {
  const escaped = `"${query.replace(/"/g, '""')}"`;
  const result = await db.execute({
    sql: `SELECT m.* FROM memories_fts
          JOIN memories m ON m.rowid = memories_fts.rowid
          WHERE memories_fts MATCH ? AND m.project_id = ?
          ORDER BY bm25(memories_fts) LIMIT ?`,
    args: [escaped, projectId, limit],
  });
  return result.rows.map(rowToMemory);
}

export async function searchVector(
  db: Client,
  projectId: string,
  queryEmb: Float32Array,
  limit: number
): Promise<Array<Memory & { similarity: number }>> {
  const result = await db.execute({
    sql: `SELECT *, vector_distance_cos(embedding, vector(?)) as distance
          FROM memories
          WHERE project_id = ? AND embedding IS NOT NULL
          ORDER BY distance LIMIT ?`,
    args: [vecToSql(queryEmb), projectId, limit],
  });
  return result.rows.map((r) => ({
    ...rowToMemory(r),
    similarity: 1 - (r.distance as number), // convert distance to similarity
  }));
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export function mergeRRF<T extends { id: string }>(
  list1: T[],
  list2: T[],
  limit: number,
  allItems: Map<string, T>
): T[] {
  const k = 60;
  const scores = new Map<string, number>();
  list1.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (i + k)));
  list2.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (i + k)));
  return [...scores.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([id]) => allItems.get(id)!)
    .filter(Boolean);
}

export function applyMMR(
  candidates: Array<Memory & { similarity?: number }>,
  queryEmb: Float32Array | null,
  limit: number,
  lambda = 0.7
): Memory[] {
  if (!queryEmb || candidates.length <= limit) return candidates.slice(0, limit);

  const selected: Memory[] = [];
  const remaining = [...candidates];

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const candEmb = cand.embedding
        ? new Float32Array(cand.embedding as ArrayBuffer)
        : null;
      if (!candEmb) { bestIdx = i; break; }

      const relevance = (cand as Memory & { similarity?: number }).similarity ?? cosineSimilarity(queryEmb, candEmb);
      const maxSim = selected.reduce((max, s) => {
        if (!s.embedding) return max;
        const sim = cosineSimilarity(candEmb, new Float32Array(s.embedding as ArrayBuffer));
        return Math.max(max, sim);
      }, 0);

      const score = lambda * relevance - (1 - lambda) * maxSim;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

export async function updateWeight(
  db: Client,
  id: string,
  score: 0 | 1 | 2 | 3
): Promise<void> {
  const result = await db.execute({
    sql: "SELECT weight, used_count FROM memories WHERE id = ?",
    args: [id],
  });
  if (result.rows.length === 0) return;
  const mem = result.rows[0];

  const alpha = 0.3;
  const oldWeight = mem.weight as number;
  const usedCount = mem.used_count as number;
  const newWeight = alpha * (score / 3) + (1 - alpha) * oldWeight;

  const newTrust =
    newWeight > 1.4 || usedCount + 1 >= 3 ? "validated" : undefined;

  if (newTrust) {
    await db.execute({
      sql: "UPDATE memories SET weight = ?, used_count = used_count + 1, last_used = ?, trust = CASE WHEN trust = 'observed' THEN ? ELSE trust END WHERE id = ?",
      args: [newWeight, Date.now(), newTrust, id],
    });
  } else {
    await db.execute({
      sql: "UPDATE memories SET weight = ?, used_count = used_count + 1, last_used = ? WHERE id = ?",
      args: [newWeight, Date.now(), id],
    });
  }
}

export async function decayAndPrune(
  db: Client,
  projectId: string
): Promise<{ decayed: number; pruned: number }> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const decayResult = await db.execute({
    sql: `UPDATE memories
          SET weight = weight * CASE
            WHEN trust IN ('proven', 'canonical') THEN 1.0
            WHEN trust = 'validated' THEN 0.98
            ELSE 0.95
          END
          WHERE project_id = ?
            AND trust NOT IN ('canonical')
            AND (last_used IS NULL OR last_used < ?)`,
    args: [projectId, cutoff],
  });

  const pruneResult = await db.execute({
    sql: `DELETE FROM memories
          WHERE project_id = ? AND weight < 0.1 AND used_count > 3
            AND trust NOT IN ('proven', 'canonical')`,
    args: [projectId],
  });

  return {
    decayed: decayResult.rowsAffected,
    pruned: pruneResult.rowsAffected,
  };
}

// ── File Hashes ─────────────────────────────────────────────────────────────

export async function snapshotFileHashes(
  db: Client,
  projectId: string,
  hashes: Array<{ path: string; hash: string }>
): Promise<void> {
  const now = Date.now();
  await db.batch(
    hashes.map((h) => ({
      sql: "INSERT OR REPLACE INTO file_hashes (project_id, path, hash, updated_at) VALUES (?, ?, ?, ?)",
      args: [projectId, h.path, h.hash, now],
    })),
    "write"
  );
}

export async function diffFileHashes(
  db: Client,
  projectId: string,
  currentHashes: Array<{ path: string; hash: string }>
): Promise<string[]> {
  const changed: string[] = [];
  for (const cur of currentHashes) {
    const result = await db.execute({
      sql: "SELECT hash FROM file_hashes WHERE project_id = ? AND path = ?",
      args: [projectId, cur.path],
    });
    const prev = result.rows[0];
    if (!prev || prev.hash !== cur.hash) {
      changed.push(cur.path);
    }
  }
  return changed;
}
