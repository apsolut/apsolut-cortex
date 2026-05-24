/**
 * Seeds an in-memory libSQL DB with a known fixture set for reproducible
 * eval runs. The golden.jsonl entries reference content from these
 * memories — keep them in sync.
 *
 * Memories are inserted with realistic embeddings via the production
 * embed() function. First run is slow (model load); subsequent runs use
 * the cached model in ~/.apsolut-cortex/models/.
 */

import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "../../src/migrations/runner.js";
import { insertMemory, upsertProject } from "../../src/db.js";
import { embed } from "../../src/embed.js";

export const FIXTURE_PROJECT_ID = "00000000-0000-0000-0000-000000000eva";

interface SeedMemory {
  tier: "episodic" | "semantic" | "procedural" | "strategic" | "meta";
  category: "correction" | "insight" | "decision" | "discovery" | "fact" | "pattern";
  trust: "observed" | "validated" | "proven" | "canonical";
  content: string;
  context?: string;
}

export const SEED_MEMORIES: SeedMemory[] = [
  {
    tier: "strategic",
    category: "decision",
    trust: "canonical",
    content:
      "libSQL has built-in encryption at rest via the encryptionKey option on createClient(). No SQLCipher or separate native dependency needed.",
    context: "Why we chose @libsql/client over better-sqlite3 + SQLCipher.",
  },
  {
    tier: "meta",
    category: "fact",
    trust: "canonical",
    content:
      "apsolut-cortex always uses ~/.apsolut-cortex/ for its data directory. Never write to ~/.apsolut/ — that path is reserved for other apsolut-* tools.",
    context: "Permanent namespace invariant.",
  },
  {
    tier: "procedural",
    category: "pattern",
    trust: "validated",
    content:
      "Migration files live in src/migrations/NNN-name.ts and must be registered in the MIGRATIONS array in runner.ts so the bundler picks them up.",
  },
  {
    tier: "procedural",
    category: "discovery",
    trust: "validated",
    content:
      "Bun ships a built-in test runner. Run `bun test` to execute all *.test.ts files. No vitest or jest dependency is needed.",
    context: "How tests are wired in this repo.",
  },
  {
    tier: "semantic",
    category: "fact",
    trust: "proven",
    content:
      "memories_fts uses FTS5 with tokenize='porter ascii' — English stemming, ASCII-only. Non-ASCII content gets approximated, which is acceptable for code-centric memories.",
  },
  {
    tier: "meta",
    category: "fact",
    trust: "validated",
    content:
      "The MCP server reads the APSOLUT_PROJECT_PATH env var on startup to determine which project's .apsolut-cortex/project.json to load.",
  },
  {
    tier: "strategic",
    category: "correction",
    trust: "canonical",
    content:
      "Replaced @xenova/transformers with @huggingface/transformers because of CVE-2026-41242. The two packages have compatible APIs for our embedding use case.",
    context: "Security fix in 0.5.x.",
  },
  {
    tier: "semantic",
    category: "fact",
    trust: "validated",
    content:
      "Duplicate detection uses cosine similarity with a threshold of 0.92 by default. Configurable via APSOLUT_CORTEX_DUPLICATE_THRESHOLD. Lower = more permissive dedup.",
  },
  {
    tier: "strategic",
    category: "decision",
    trust: "proven",
    content:
      "Compression uses Claude Haiku (claude-haiku-4-5-20251001) as the primary model with Ollama (qwen2.5-coder:7b) as a fallback. Circuit breaker trips after 3 failures with a 1-hour cooldown.",
  },
  {
    tier: "strategic",
    category: "pattern",
    trust: "proven",
    content:
      "Trust tiers progress observed → validated → proven → canonical. Auto-promotion to validated requires weight > 1.4 OR used_count >= 3. Higher tiers require explicit user action.",
  },
];

/**
 * Build a fresh in-memory DB, run migrations, and insert the seed memories
 * with embeddings. Returns the client and the inserted memory IDs in
 * declaration order so the eval runner can correlate ids with content.
 */
export async function seedFixtureDb(): Promise<{
  db: Client;
  projectId: string;
  memoryIds: string[];
}> {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);

  await upsertProject(db, {
    id: FIXTURE_PROJECT_ID,
    name: "apsolut-cortex-evals",
    path: "/eval/fixture",
  });

  const memoryIds: string[] = [];
  for (const m of SEED_MEMORIES) {
    const text = m.context ? `${m.content} ${m.context}` : m.content;
    const embedding = await embed(text);
    const id = await insertMemory(db, {
      project_id: FIXTURE_PROJECT_ID,
      tier: m.tier,
      category: m.category,
      trust: m.trust,
      content: m.content,
      context: m.context ?? null,
      source: "eval-fixture",
      embedding,
      weight: 1.0,
      session_id: null,
    });
    memoryIds.push(id);
  }

  return { db, projectId: FIXTURE_PROJECT_ID, memoryIds };
}
