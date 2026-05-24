import { createClient, type Client, type Row, type InStatement, type ResultSet } from "@libsql/client";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  CORTEX_DUPLICATE_THRESHOLD,
  CORTEX_BUMP_BOOST,
  CORTEX_WEIGHT_CAP,
  CORTEX_RRF_K,
  CORTEX_MMR_LAMBDA,
  CORTEX_WEIGHT_ALPHA,
  CORTEX_PROMOTE_WEIGHT,
  CORTEX_PROMOTE_USES,
  CORTEX_DECAY_DAYS,
  CORTEX_DECAY_OBSERVED,
  CORTEX_DECAY_VALIDATED,
  CORTEX_PRUNE_WEIGHT,
} from "./config.js";
import { runMigrations } from "./migrations/runner.js";
import { getDbKey } from "./keyring.js";

/** Anything with an execute() method — works for both Client and Transaction. */
export type DbConn = { execute(stmt: InStatement): Promise<ResultSet> };

export const CORTEX_DIR = join(homedir(), ".apsolut-cortex");
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
    // Try the OS keychain for an encryption key. Absent → unencrypted DB
    // (legacy / opt-in mode). Present → pass it to libSQL. If the key is
    // wrong, the FIRST query will throw with SQLITE_NOTADB, which is the
    // correct "fail loud" behavior — we do NOT want to silently create a
    // new DB next to a real one the user can no longer read.
    let key: string | null = null;
    try {
      key = getDbKey();
    } catch (e) {
      process.stderr.write(
        `[apsolut-cortex] keychain unreachable; opening DB without encryption. (${e})\n`
      );
    }
    _db = key
      ? createClient({ url: `file:${DB_PATH}`, encryptionKey: key })
      : createClient({ url: `file:${DB_PATH}` });
  }

  if (!_initialized) {
    await runMigrations(_db);
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
  db: DbConn,
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
  db: DbConn,
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
  db: DbConn,
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
  db: DbConn,
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
  db: DbConn,
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
  db: DbConn,
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
  db: DbConn,
  sessionId: string
): Promise<void> {
  await db.execute({
    sql: "UPDATE observations SET promoted = 1 WHERE session_id = ?",
    args: [sessionId],
  });
}

export async function markProjectObservationsPromoted(
  db: DbConn,
  projectId: string
): Promise<void> {
  await db.execute({
    sql: "UPDATE observations SET promoted = 1 WHERE project_id = ? AND promoted = 0",
    args: [projectId],
  });
}

// ── Memories ─────────────────────────────────────────────────────────────────

export async function findDuplicate(
  db: DbConn,
  projectId: string,
  embedding: Float32Array,
  threshold = CORTEX_DUPLICATE_THRESHOLD
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
  db: DbConn,
  id: string,
  boost: number = CORTEX_BUMP_BOOST
): Promise<void> {
  await db.execute({
    sql: `UPDATE memories SET weight = MIN(weight + ?, ${CORTEX_WEIGHT_CAP}), last_used = ? WHERE id = ?`,
    args: [boost, Date.now(), id],
  });
}

export async function insertMemory(
  db: DbConn,
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
  db: DbConn,
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

// Stop-words we drop from grep tokenization — same words Karpathy's LLM
// would ignore when scanning markdown for relevance. Tiny list on purpose;
// real BM25 has the porter stemmer + IDF, the point of grep is to NOT have
// those things.
const GREP_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "does",
  "for", "from", "have", "how", "i", "in", "is", "it", "of", "on", "or",
  "our", "such", "that", "the", "this", "to", "use", "was", "we", "what",
  "when", "where", "which", "why", "with", "you",
]);

/**
 * Karpathy-style "LLM reads the markdown" retrieval baseline. Tokenizes
 * the query into significant words (≥3 chars, stop-words dropped), scores
 * each memory by how many query tokens appear in its content+context
 * (case-insensitive), and breaks ties by recency.
 *
 * Deliberately stupid — no stemming, no IDF, no embeddings. Exists so the
 * eval harness can answer: does the hybrid stack actually beat "just look
 * for the words" at our scale?
 */
export async function searchGrep(
  db: DbConn,
  projectId: string,
  query: string,
  limit: number
): Promise<Memory[]> {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 3 && !GREP_STOP_WORDS.has(t));

  if (tokens.length === 0) return [];

  // Pull candidates that match at least one token, then score in JS.
  const orClauses = tokens
    .map(() => "(LOWER(content) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(context, '')) LIKE ? ESCAPE '\\')")
    .join(" OR ");
  const args: (string | number)[] = [projectId];
  for (const t of tokens) {
    const pattern = `%${t.replace(/[%_]/g, "\\$&")}%`;
    args.push(pattern, pattern);
  }

  const result = await db.execute({
    sql: `SELECT * FROM memories
          WHERE project_id = ? AND (${orClauses})
          ORDER BY created_at DESC`,
    args,
  });

  const scored = result.rows.map((r) => {
    const m = rowToMemory(r);
    const hay = `${m.content} ${m.context ?? ""}`.toLowerCase();
    const score = tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
    return { memory: m, score };
  });

  // Sort by token-overlap desc, then recency desc (already in result order)
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.memory);
}

export async function searchVector(
  db: DbConn,
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
  const k = CORTEX_RRF_K;
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
  lambda = CORTEX_MMR_LAMBDA
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
  db: DbConn,
  id: string,
  score: 0 | 1 | 2 | 3
): Promise<void> {
  const result = await db.execute({
    sql: "SELECT weight, used_count FROM memories WHERE id = ?",
    args: [id],
  });
  if (result.rows.length === 0) return;
  const mem = result.rows[0];

  const alpha = CORTEX_WEIGHT_ALPHA;
  const oldWeight = mem.weight as number;
  const usedCount = mem.used_count as number;
  const newWeight = alpha * (score / 3) + (1 - alpha) * oldWeight;

  const newTrust =
    newWeight > CORTEX_PROMOTE_WEIGHT || usedCount + 1 >= CORTEX_PROMOTE_USES ? "validated" : undefined;

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
  db: DbConn,
  projectId: string
): Promise<{ decayed: number; pruned: number }> {
  const cutoff = Date.now() - CORTEX_DECAY_DAYS * 24 * 60 * 60 * 1000;

  const decayResult = await db.execute({
    sql: `UPDATE memories
          SET weight = weight * CASE
            WHEN trust IN ('proven', 'canonical') THEN 1.0
            WHEN trust = 'validated' THEN ?
            ELSE ?
          END
          WHERE project_id = ?
            AND trust NOT IN ('canonical')
            AND (last_used IS NULL OR last_used < ?)`,
    args: [CORTEX_DECAY_VALIDATED, CORTEX_DECAY_OBSERVED, projectId, cutoff],
  });

  const pruneResult = await db.execute({
    sql: `DELETE FROM memories
          WHERE project_id = ? AND weight < ?
            AND trust NOT IN ('proven', 'canonical')`,
    args: [projectId, CORTEX_PRUNE_WEIGHT],
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
  db: DbConn,
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
