/**
 * Eval runner. Scores hybrid retrieval and the grep baseline against
 * golden.jsonl. Used by `apsolut-cortex eval run` and `eval baseline`.
 *
 * Output: per-query results (hit/miss + rank) + aggregate hit rate + MRR
 * for both retrievals, plus the delta (does hybrid earn its complexity?).
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { Client } from "@libsql/client";
import {
  searchBM25,
  searchVector,
  searchGrep,
  mergeRRF,
  applyMMR,
  type Memory,
} from "../src/db.js";
import { embed } from "../src/embed.js";
import { seedFixtureDb } from "./fixtures/seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(__dirname, "golden.jsonl");
const BASELINE_PATH = resolve(__dirname, "baseline.json");

export interface GoldenEntry {
  id: string;
  query: string;
  expected_patterns?: string[];
  expected_ids?: string[];
  notes?: string;
}

export interface PerQueryResult {
  id: string;
  query: string;
  hybrid: { hit: boolean; rank: number | null; first_match_id: string | null };
  grep: { hit: boolean; rank: number | null; first_match_id: string | null };
}

export interface AggregateResult {
  total: number;
  hybrid: { hits: number; hit_rate: number; mrr: number };
  grep: { hits: number; hit_rate: number; mrr: number };
  delta: { hit_rate: number; mrr: number };
}

export interface EvalResult {
  ran_at: string;
  per_query: PerQueryResult[];
  aggregate: AggregateResult;
}

const TOP_K = 5;

function loadGolden(): GoldenEntry[] {
  const text = readFileSync(GOLDEN_PATH, "utf-8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as GoldenEntry);
}

function matches(memory: Memory, entry: GoldenEntry): boolean {
  if (entry.expected_ids?.includes(memory.id)) return true;
  if (entry.expected_patterns) {
    const haystack = `${memory.content} ${memory.context ?? ""}`.toLowerCase();
    return entry.expected_patterns.some((p) =>
      haystack.includes(p.toLowerCase())
    );
  }
  return false;
}

function scoreResults(
  results: Memory[],
  entry: GoldenEntry
): { hit: boolean; rank: number | null; first_match_id: string | null } {
  for (let i = 0; i < results.length && i < TOP_K; i++) {
    if (matches(results[i], entry)) {
      return { hit: true, rank: i + 1, first_match_id: results[i].id };
    }
  }
  return { hit: false, rank: null, first_match_id: null };
}

async function hybridSearch(
  db: Client,
  projectId: string,
  query: string,
  limit: number
): Promise<Memory[]> {
  const fetchCount = limit * 2;
  const bm25 = await searchBM25(db, projectId, query, fetchCount);

  let vectorResults: Array<Memory & { similarity: number }> = [];
  let queryEmb: Float32Array | null = null;
  try {
    queryEmb = await embed(query);
    vectorResults = await searchVector(db, projectId, queryEmb, fetchCount);
  } catch {
    // Fall through with BM25 only.
  }

  const allItems = new Map<string, Memory>();
  bm25.forEach((m) => allItems.set(m.id, m));
  vectorResults.forEach((m) => allItems.set(m.id, m));

  const merged = mergeRRF(bm25, vectorResults, fetchCount, allItems);
  const withSim = merged.map((m) => ({
    ...m,
    similarity: vectorResults.find((v) => v.id === m.id)?.similarity ?? 0,
  }));

  return applyMMR(withSim, queryEmb, limit);
}

export async function runEvals(): Promise<EvalResult> {
  const golden = loadGolden();
  if (golden.length === 0) {
    throw new Error(`[apsolut-cortex] no golden entries found at ${GOLDEN_PATH}`);
  }

  const { db, projectId } = await seedFixtureDb();
  const perQuery: PerQueryResult[] = [];

  try {
    for (const entry of golden) {
      const hybridResults = await hybridSearch(db, projectId, entry.query, TOP_K);
      const grepResults = await searchGrep(db, projectId, entry.query, TOP_K);

      perQuery.push({
        id: entry.id,
        query: entry.query,
        hybrid: scoreResults(hybridResults, entry),
        grep: scoreResults(grepResults, entry),
      });
    }
  } finally {
    db.close();
  }

  const total = perQuery.length;
  const hybridHits = perQuery.filter((r) => r.hybrid.hit).length;
  const grepHits = perQuery.filter((r) => r.grep.hit).length;
  const hybridMrr =
    perQuery.reduce((s, r) => s + (r.hybrid.rank ? 1 / r.hybrid.rank : 0), 0) /
    total;
  const grepMrr =
    perQuery.reduce((s, r) => s + (r.grep.rank ? 1 / r.grep.rank : 0), 0) /
    total;

  return {
    ran_at: new Date().toISOString(),
    per_query: perQuery,
    aggregate: {
      total,
      hybrid: { hits: hybridHits, hit_rate: hybridHits / total, mrr: hybridMrr },
      grep: { hits: grepHits, hit_rate: grepHits / total, mrr: grepMrr },
      delta: {
        hit_rate: hybridHits / total - grepHits / total,
        mrr: hybridMrr - grepMrr,
      },
    },
  };
}

export function formatResult(result: EvalResult): string {
  const lines: string[] = [];
  lines.push(`[apsolut-cortex] eval — ${result.aggregate.total} queries · ${result.ran_at}`);
  lines.push("");
  lines.push("Per-query:");
  lines.push("  id     hybrid  grep   query");
  lines.push("  -----  ------  -----  -----");
  for (const r of result.per_query) {
    const h = r.hybrid.hit ? `#${r.hybrid.rank}` : "miss";
    const g = r.grep.hit ? `#${r.grep.rank}` : "miss";
    const q = r.query.length > 50 ? r.query.slice(0, 47) + "..." : r.query;
    lines.push(`  ${r.id.padEnd(5)}  ${h.padEnd(6)}  ${g.padEnd(5)}  ${q}`);
  }
  lines.push("");
  const a = result.aggregate;
  lines.push("Aggregate:");
  lines.push(
    `  hybrid: ${a.hybrid.hits}/${a.total} hits (${(a.hybrid.hit_rate * 100).toFixed(1)}%) · MRR ${a.hybrid.mrr.toFixed(3)}`
  );
  lines.push(
    `  grep:   ${a.grep.hits}/${a.total} hits (${(a.grep.hit_rate * 100).toFixed(1)}%) · MRR ${a.grep.mrr.toFixed(3)}`
  );
  lines.push(
    `  delta:  hit_rate ${(a.delta.hit_rate * 100).toFixed(1)}pp · MRR ${a.delta.mrr >= 0 ? "+" : ""}${a.delta.mrr.toFixed(3)}`
  );
  lines.push("");
  if (a.delta.hit_rate >= 0.05) {
    lines.push("  → Hybrid earns its complexity (delta ≥ 5pp). Karpathy provocation: rejected.");
  } else if (a.delta.hit_rate <= -0.05) {
    lines.push("  → Grep beats hybrid by ≥ 5pp. Karpathy provocation: confirmed. Time to simplify.");
  } else {
    lines.push("  → Hybrid and grep are within 5pp. Inconclusive — add more golden entries.");
  }
  return lines.join("\n");
}

export function saveBaseline(result: EvalResult): void {
  writeFileSync(BASELINE_PATH, JSON.stringify(result, null, 2));
}

export function loadBaseline(): EvalResult | null {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as EvalResult;
}

export function formatComparison(current: EvalResult, baseline: EvalResult): string {
  const ca = current.aggregate;
  const ba = baseline.aggregate;
  const lines: string[] = [];
  lines.push(`[apsolut-cortex] eval delta vs baseline (${baseline.ran_at})`);
  lines.push("");
  lines.push(
    `  hybrid hit_rate: ${(ba.hybrid.hit_rate * 100).toFixed(1)}% → ${(ca.hybrid.hit_rate * 100).toFixed(1)}% (${((ca.hybrid.hit_rate - ba.hybrid.hit_rate) * 100).toFixed(1)}pp)`
  );
  lines.push(
    `  hybrid MRR:      ${ba.hybrid.mrr.toFixed(3)} → ${ca.hybrid.mrr.toFixed(3)} (${(ca.hybrid.mrr - ba.hybrid.mrr).toFixed(3)})`
  );
  lines.push(
    `  grep   hit_rate: ${(ba.grep.hit_rate * 100).toFixed(1)}% → ${(ca.grep.hit_rate * 100).toFixed(1)}% (${((ca.grep.hit_rate - ba.grep.hit_rate) * 100).toFixed(1)}pp)`
  );
  lines.push(
    `  grep   MRR:      ${ba.grep.mrr.toFixed(3)} → ${ca.grep.mrr.toFixed(3)} (${(ca.grep.mrr - ba.grep.mrr).toFixed(3)})`
  );
  const regressed =
    ca.hybrid.hit_rate < ba.hybrid.hit_rate - 0.02 ||
    ca.hybrid.mrr < ba.hybrid.mrr - 0.02;
  lines.push("");
  if (regressed) {
    lines.push("  ⚠ Regression beyond 2pp / 0.02 MRR. Investigate before shipping.");
  } else {
    lines.push("  ✓ Within tolerance.");
  }
  return lines.join("\n");
}
