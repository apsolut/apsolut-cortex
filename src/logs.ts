/**
 * JSONL-based logging for retrieval observability. Two complementary streams:
 *
 *   retrievals.jsonl  — one line per memory_search call (always written).
 *                       Captures what was retrieved and what was actually
 *                       injected back to Claude. The cheapest input for
 *                       evaluating retrieval quality.
 *
 *   corrections.jsonl — one line per `apsolut-cortex correct` invocation,
 *                       linked back to the retrieval entry by timestamp.
 *                       Either flags the retrieval as a miss, or stores a
 *                       correction memory ID alongside (Karpathy
 *                       bidirectional capture).
 *
 *   shadow.jsonl      — written instead of retrievals when shadow mode is
 *                       active (handled in mcp/server.ts).
 *
 * All writes are append-only, newline-terminated JSON. Failures are
 * swallowed and logged to stderr — logging must never break retrieval.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export const LOGS_DIR = join(homedir(), ".apsolut-cortex", "logs");
export const RETRIEVALS_PATH = join(LOGS_DIR, "retrievals.jsonl");
export const CORRECTIONS_PATH = join(LOGS_DIR, "corrections.jsonl");
export const SHADOW_PATH = join(LOGS_DIR, "shadow.jsonl");

export interface RetrievalCandidate {
  id: string;
  tier: string;
  trust: string;
  weight: number;
  bm25_rank: number | null;
  vector_rank: number | null;
  final_rank: number;
}

export interface RetrievalEntry {
  ts: number;
  project_id: string;
  project_name: string;
  query: string;
  candidates: RetrievalCandidate[];
  injected_ids: string[];
  latency_ms: number;
  shadow: boolean;
}

export interface CorrectionEntry {
  ts: number;
  retrieval_ts: number;
  retrieval_query: string;
  is_miss: boolean;
  correction_memory_id: string | null;
  correction_text: string | null;
}

function appendJsonl(path: string, entry: object): void {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + "\n");
  } catch (e) {
    process.stderr.write(
      `[apsolut-cortex] log write failed (${path}): ${e}\n`
    );
  }
}

export function logRetrieval(entry: RetrievalEntry): void {
  appendJsonl(entry.shadow ? SHADOW_PATH : RETRIEVALS_PATH, entry);
}

export function logCorrection(entry: CorrectionEntry): void {
  appendJsonl(CORRECTIONS_PATH, entry);
}

/**
 * Returns the last retrieval entry written, or null if none exists.
 * Used by `apsolut-cortex correct` to know what the user is annotating.
 *
 * Reads the whole file to find the last line — fine for the scale we
 * expect (one retrieval per Claude turn, ~thousands per active week).
 * If this becomes a bottleneck, switch to a reverse-stream read.
 */
export function getLastRetrieval(): RetrievalEntry | null {
  if (!existsSync(RETRIEVALS_PATH)) return null;
  const text = readFileSync(RETRIEVALS_PATH, "utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]) as RetrievalEntry;
  } catch {
    return null;
  }
}
