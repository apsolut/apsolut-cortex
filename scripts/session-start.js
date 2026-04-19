// src/hooks/session-start.ts
import { readFileSync, existsSync as existsSync2 } from "fs";
import { createHash } from "crypto";
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
var TRACKED_FILES = [
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
async function snapshotFileHashes(db, projectId, hashes) {
  const now = Date.now();
  await db.batch(hashes.map((h) => ({
    sql: "INSERT OR REPLACE INTO file_hashes (project_id, path, hash, updated_at) VALUES (?, ?, ?, ?)",
    args: [projectId, h.path, h.hash, now]
  })), "write");
}

// src/hooks/session-start.ts
function hashFile(path) {
  try {
    if (!existsSync2(path))
      return null;
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}
var W = 60;
var HR = "─".repeat(W - 2);
function top() {
  return `┌${HR}┐`;
}
function bot() {
  return `└${HR}┘`;
}
function sep() {
  return `├${HR}┤`;
}
function ln(t) {
  const pad = Math.max(0, W - 4 - t.length);
  return `│ ${t}${" ".repeat(pad)} │`;
}
function em() {
  return ln("");
}
function center(text, width) {
  const pad = Math.max(0, width - text.length);
  return " ".repeat(Math.floor(pad / 2)) + text + " ".repeat(Math.ceil(pad / 2));
}
function wrap(text, max, limit = 3) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur.length + w.length + 1 > max) {
      if (cur)
        lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur)
    lines.push(cur);
  return lines.length > limit ? [...lines.slice(0, limit), "..."] : lines;
}
function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
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
  const sessionId = data.session_id ?? crypto.randomUUID();
  const projectFile = join2(cwd, ".apsolut-cortex", "project.json");
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
    await upsertProject(db, { id: project.id, name: project.name, path: cwd });
    await upsertSession(db, { id: sessionId, project_id: project.id });
    const hashes = TRACKED_FILES.map((f) => ({ path: f, hash: hashFile(join2(cwd, f)) })).filter((h) => h.hash !== null);
    if (hashes.length > 0)
      await snapshotFileHashes(db, project.id, hashes);
    const memCountResult = await db.execute({
      sql: "SELECT COUNT(*) as n FROM memories WHERE project_id = ?",
      args: [project.id]
    });
    const memCount = memCountResult.rows[0]?.n ?? 0;
    const sessionCountResult = await db.execute({
      sql: "SELECT COUNT(*) as n FROM sessions WHERE project_id = ?",
      args: [project.id]
    });
    const sessionCount = sessionCountResult.rows[0]?.n ?? 0;
    const out = [];
    out.push(top());
    out.push(em());
    out.push(ln(center(`[apsolut-cortex]  ${project.name}`, W - 4)));
    out.push(em());
    if (memCount === 0) {
      out.push(sep());
      out.push(ln("Welcome! apsolut-cortex gives you persistent"));
      out.push(ln("memory. It learns from sessions automatically."));
      out.push(em());
      out.push(sep());
      out.push(ln("What happens automatically:"));
      out.push(em());
      out.push(ln("  • Tool failures & fixes are captured"));
      out.push(ln("  • Self-corrections are detected"));
      out.push(ln("  • Sessions are compressed into memories"));
      out.push(ln("  • Stale memories decay over time"));
      out.push(em());
      out.push(sep());
      out.push(ln("What you can say to Claude:"));
      out.push(em());
      out.push(ln("  /apsolut-recall    Search past memories"));
      out.push(ln("  /apsolut-store     Save something explicitly"));
      out.push(em());
      out.push(sep());
      out.push(ln("MCP tools available to Claude:"));
      out.push(em());
      out.push(ln("  memory_search     Find relevant memories"));
      out.push(ln("  memory_store      Save a memory explicitly"));
      out.push(ln("  memory_rate       Upvote/downvote a memory"));
      out.push(ln("  memory_contradict Delete wrong memories"));
      out.push(ln("  memory_status     Show project stats"));
      out.push(em());
      out.push(sep());
      out.push(ln(`Session ${sessionCount} | 0 memories | learning...`));
      out.push(bot());
    } else {
      out.push(sep());
      const lastSessionResult = await db.execute({
        sql: "SELECT summary, ended_at FROM sessions WHERE project_id = ? AND summary IS NOT NULL ORDER BY ended_at DESC LIMIT 1",
        args: [project.id]
      });
      const lastSession = lastSessionResult.rows[0];
      if (lastSession?.summary) {
        out.push(ln(`Last session (${formatAgo(lastSession.ended_at)}):`));
        out.push(em());
        for (const line of wrap(lastSession.summary, W - 6)) {
          out.push(ln(`  ${line}`));
        }
        out.push(sep());
      }
      const TOKEN_BUDGET = 2000;
      const CHARS_PER_TOKEN = 4;
      let budgetRemaining = TOKEN_BUDGET * CHARS_PER_TOKEN;
      const memoriesResult = await db.execute({
        sql: `SELECT content, category FROM memories
              WHERE project_id = ? AND weight > 0.5
              ORDER BY
                CASE WHEN category = 'correction' THEN 0
                     WHEN category = 'decision' THEN 1
                     ELSE 2 END,
                weight DESC,
                created_at DESC
              LIMIT 20`,
        args: [project.id]
      });
      const memories = memoriesResult.rows;
      if (memories.length > 0) {
        out.push(ln("Key memories:"));
        out.push(em());
        for (const m of memories) {
          if (budgetRemaining <= 0)
            break;
          const icon = m.category === "correction" ? "!" : m.category === "decision" ? ">" : m.category === "pattern" ? "~" : "-";
          const maxLen = Math.min(W - 8, budgetRemaining);
          const text = truncate(m.content, maxLen);
          out.push(ln(`  ${icon} ${text}`));
          budgetRemaining -= m.content.length;
        }
        out.push(sep());
      }
      out.push(ln(`${memCount} memories | ${sessionCount} sessions`));
      out.push(ln(`Say "/apsolut-recall <topic>" to search memory`));
      out.push(bot());
    }
    process.stdout.write(out.join(`
`));
  } catch (e) {
    process.stderr.write(`[apsolut-cortex] session-start error: ${e}
`);
    process.exit(0);
  }
}
function formatAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60)
    return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24)
    return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
main();
