/**
 * Shared compression entry point for in-session compression (M6).
 * Used by:
 *   - PreCompact hook (sync, full-fidelity capture before Claude compacts)
 *   - PostToolUse hook (async via detached worker, token-budget triggered)
 *   - SessionEnd hook (drains spill buffer + last range)
 *
 * The function reuses the existing compress.ts pipeline (Anthropic Haiku
 * primary, Ollama fallback, circuit breaker, JSON output schema) by
 * adapting transcript messages into the "observation" shape it expects.
 *
 * Idempotency: writes are gated by the cursor (last compressed msg_idx).
 * Concurrent invocations are prevented at the call site via tryAcquireLock.
 * `findDuplicate` provides a second safety net via embedding similarity.
 */

import type { Client } from "@libsql/client";
import {
  insertMemory,
  findDuplicate,
  bumpWeight,
  upsertSession,
  type MemoryTier,
  type MemoryCategory,
} from "./db.js";
import { embed } from "./embed.js";
import { compressSession } from "./compress.js";
import { readCursor, writeCursor } from "./buffer.js";
import { captureTranscript, sliceRange, type TranscriptMessage } from "./transcript.js";
import { CORTEX_CORRECTION_WEIGHT } from "./config.js";

export interface CompressSliceArgs {
  db: Client;
  sessionId: string;
  projectId: string;
  projectName: string;
  transcriptPath: string;
  /** Marker stored on each new memory's `source` column. */
  source: "precompact" | "compress-worker" | "session-end";
}

export interface CompressSliceResult {
  /** Number of new transcript messages persisted into raw_messages. */
  raw_persisted: number;
  /** Number of new memories created. */
  memories_stored: number;
  /** Number of duplicate detections (existing memory weight-bumped instead). */
  duplicates_bumped: number;
  /** New cursor position (= end_msg_idx of the range that was compressed). */
  new_cursor: number;
  /** True when compression failed (no provider) — cursor left unchanged. */
  failed?: boolean;
}

/**
 * Capture the current transcript into raw_messages (idempotent), then
 * compress the unprocessed slice (from cursor to end) into memories with
 * source-range links. Returns a summary of what happened.
 *
 * Returns immediately with zeros if no new messages exist beyond the
 * cursor — safe to call frequently.
 */
export async function compressSlice(args: CompressSliceArgs): Promise<CompressSliceResult> {
  const { db, sessionId, projectId, projectName, transcriptPath, source } = args;

  // Make sure the session row exists before we attach memories to it.
  await upsertSession(db, { id: sessionId, project_id: projectId });

  // 1) Persist the full transcript (INSERT OR IGNORE handles repeats).
  const transcript = await captureTranscript(db, sessionId, transcriptPath);
  if (transcript.length === 0) {
    return { raw_persisted: 0, memories_stored: 0, duplicates_bumped: 0, new_cursor: 0 };
  }

  // 2) Slice from cursor → end.
  const cursor = readCursor(sessionId);
  const endIdx = transcript[transcript.length - 1].msg_idx + 1;
  if (cursor >= endIdx) {
    return { raw_persisted: transcript.length, memories_stored: 0, duplicates_bumped: 0, new_cursor: cursor };
  }
  const slice = sliceRange(transcript, cursor, endIdx);

  // 3) Adapt transcript messages to the "observation" shape compressSession
  //    expects. Each transcript message becomes one observation. The LLM
  //    decides which spans become memories.
  const observations = slice.map((m: TranscriptMessage) => ({
    tool_name: null,
    content: `[${m.role}] ${m.content}`,
    category: null,
  }));

  const compression = await compressSession(observations, projectName);
  if (!compression) {
    return {
      raw_persisted: transcript.length,
      memories_stored: 0,
      duplicates_bumped: 0,
      new_cursor: cursor,
      failed: true,
    };
  }
  const { memories } = compression;

  // 4) Insert memories with the source range, dedup by embedding.
  let stored = 0;
  let bumped = 0;
  for (const mem of memories) {
    const textToEmbed = mem.context ? `${mem.content} ${mem.context}` : mem.content;
    let embedding: Float32Array | null = null;
    try { embedding = await embed(textToEmbed); }
    catch (e) { process.stderr.write(`[apsolut-cortex] embed failed: ${e}\n`); }

    if (embedding) {
      const dup = await findDuplicate(db, projectId, embedding);
      if (dup) {
        await bumpWeight(db, dup.id);
        bumped++;
        continue;
      }
    }

    const weight = mem.category === "correction" ? CORTEX_CORRECTION_WEIGHT : 1.0;
    await insertMemory(db, {
      project_id: projectId,
      tier: mem.tier as MemoryTier,
      category: mem.category as MemoryCategory,
      trust: "observed",
      content: mem.content,
      context: mem.context ?? null,
      source,
      embedding,
      weight,
      session_id: sessionId,
      source_session_id: sessionId,
      source_start_msg_idx: cursor,
      source_end_msg_idx: endIdx,
    });
    stored++;
  }

  // 5) Advance the cursor. Even when zero memories were produced (model
  //    decided nothing was worth keeping), we still advance so we do not
  //    re-process the same slice next time.
  writeCursor(sessionId, endIdx);

  return {
    raw_persisted: transcript.length,
    memories_stored: stored,
    duplicates_bumped: bumped,
    new_cursor: endIdx,
  };
}
