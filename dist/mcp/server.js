#!/usr/bin/env bun
// @bun

// src/mcp/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync as existsSync2 } from "fs";
import { join as join3, dirname, resolve } from "path";
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
    flag_reason: r.flag_reason
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
import { pipeline, env } from "@xenova/transformers";

// src/db.ts
import { createClient as createClient2 } from "@libsql/client";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
var CORTEX_DIR2 = join2(homedir2(), ".apsolut-cortex");
var DB_PATH2 = join2(CORTEX_DIR2, "memory.db");
var REGISTRY_PATH2 = join2(CORTEX_DIR2, "registry.json");
var MODELS_DIR2 = join2(CORTEX_DIR2, "models");

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
var CORTEX_DUPLICATE_THRESHOLD2 = envNum2("CORTEX_DUPLICATE_THRESHOLD", 0.92);
var CORTEX_DECAY_DAYS2 = envNum2("CORTEX_DECAY_DAYS", 7);
var CORTEX_DECAY_OBSERVED2 = envNum2("CORTEX_DECAY_OBSERVED", 0.95);
var CORTEX_DECAY_VALIDATED2 = envNum2("CORTEX_DECAY_VALIDATED", 0.98);
var CORTEX_PRUNE_WEIGHT2 = envNum2("CORTEX_PRUNE_WEIGHT", 0.1);
var CORTEX_RRF_K2 = envNum2("CORTEX_RRF_K", 60);
var CORTEX_MMR_LAMBDA2 = envNum2("CORTEX_MMR_LAMBDA", 0.7);
var CORTEX_SEARCH_LIMIT_MAX2 = envNum2("CORTEX_SEARCH_LIMIT_MAX", 10);
var CORTEX_SEARCH_MULTIPLIER2 = envNum2("CORTEX_SEARCH_MULTIPLIER", 2);
var CORTEX_WEIGHT_ALPHA2 = envNum2("CORTEX_WEIGHT_ALPHA", 0.3);
var CORTEX_PROMOTE_WEIGHT2 = envNum2("CORTEX_PROMOTE_WEIGHT", 1.4);
var CORTEX_PROMOTE_USES2 = envNum2("CORTEX_PROMOTE_USES", 3);
var CORTEX_BUMP_BOOST2 = envNum2("CORTEX_BUMP_BOOST", 0.1);
var CORTEX_WEIGHT_CAP2 = envNum2("CORTEX_WEIGHT_CAP", 3);
var CORTEX_CORRECTION_WEIGHT2 = envNum2("CORTEX_CORRECTION_WEIGHT", 1.5);
var CORTEX_MANUAL_WEIGHT2 = envNum2("CORTEX_MANUAL_WEIGHT", 1.2);

// src/mcp/server.ts
var PROJECT_PATH = process.env.APSOLUT_PROJECT_PATH ?? process.cwd();
var projectFile = join3(PROJECT_PATH, ".apsolut-cortex", "project.json");
var project = null;
if (existsSync2(projectFile)) {
  try {
    project = JSON.parse(readFileSync(projectFile, "utf-8"));
  } catch {}
}
var db = await getDb();
if (project?.id) {
  await upsertProject(db, { id: project.id, name: project.name, path: PROJECT_PATH });
}
var __mcp_dirname = dirname(fileURLToPath(import.meta.url));
var PKG_VERSION = JSON.parse(readFileSync(resolve(__mcp_dirname, "..", "..", "package.json"), "utf-8")).version;
var server = new Server({ name: "apsolut-cortex", version: PKG_VERSION }, { capabilities: { tools: {} } });
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
  const allItems = new Map;
  bm25.forEach((m) => allItems.set(m.id, m));
  vectorResults.forEach((m) => allItems.set(m.id, m));
  const merged = mergeRRF(bm25, vectorResults, fetchCount, allItems);
  const withSimilarity = merged.map((m) => ({
    ...m,
    similarity: vectorResults.find((v) => v.id === m.id)?.similarity ?? 0
  }));
  return applyMMR(withSimilarity, queryEmb, limit);
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
        let results = await hybridSearch(p.id, query, limit * CORTEX_SEARCH_MULTIPLIER2);
        if (tierFilter)
          results = results.filter((m) => m.tier === tierFilter);
        if (trustFilter) {
          const trustOrder = ["observed", "validated", "proven", "canonical"];
          const minIdx = trustOrder.indexOf(trustFilter);
          results = results.filter((m) => trustOrder.indexOf(m.trust) >= minIdx);
        }
        results = results.slice(0, limit);
        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No memories found for "${query}" in project ${p.name}.

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
            text: `Found ${results.length} memories for "${query}":

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
          return { content: [{ type: "text", text: "Error: content is required (or entirely private)" }] };
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
                text: `Similar memory already exists (${dup.id}). Boosted its weight instead of duplicating.`
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
            text: `Stored memory ${id}
${tier}/${category}: ${content}`
          }]
        };
      }
      case "memory_rate": {
        const id = String(args?.id ?? "");
        const score = Math.min(3, Math.max(0, Math.round(Number(args?.score ?? 1))));
        if (!id) {
          return { content: [{ type: "text", text: "Error: id is required" }] };
        }
        await updateWeight(db, id, score);
        const labels = ["useless", "marginal", "helpful", "directly applied"];
        return {
          content: [{
            type: "text",
            text: `Rated memory ${id}: ${score}/3 (${labels[score]}). Weight updated.`
          }]
        };
      }
      case "memory_contradict": {
        const p = requireProject();
        const id = String(args?.id ?? "");
        const correction = args?.correction ? String(args.correction) : null;
        if (!id) {
          return { content: [{ type: "text", text: "Error: id is required" }] };
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
            text: correction ? `Deleted wrong memory ${id}. Stored correction as ${newId}.` : `Deleted wrong memory ${id}.`
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
          `Project: ${p.name}`,
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
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (e) {
    return {
      content: [{
        type: "text",
        text: `Error: ${e instanceof Error ? e.message : String(e)}`
      }]
    };
  }
});
var transport = new StdioServerTransport;
await server.connect(transport);
