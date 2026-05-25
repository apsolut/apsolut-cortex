/**
 * Claude Code transcript reader + raw_messages persistence.
 *
 * The hook payload gives us `transcript_path` — a JSON-l file with one
 * message per line. We parse it lazily (only when needed), slice it by
 * message index, and persist slices into the M4 raw_messages table so
 * memory_recall(id) can return the exact wording later.
 *
 * The transcript file is owned by Claude Code; we only read it.
 */

import { existsSync, readFileSync } from "fs";
import type { DbConn } from "./db.js";
import { insertRawMessage } from "./db.js";
import { flattenMessageContent } from "./tokens.js";

export interface TranscriptMessage {
  /** Position in the transcript, 0-indexed from the top. Stable per session. */
  msg_idx: number;
  /** "user", "assistant", "system", "tool", etc. — whatever Claude Code writes. */
  role: string;
  /** Flattened content (text blocks + tool_use summaries + tool_result text). */
  content: string;
  /** Original raw object, in case we need the structured form later. */
  raw: unknown;
}

/**
 * Parse a Claude Code transcript file. Each line is a JSON object; bad
 * lines are skipped. Order is preserved and indices are 0-based from
 * the start of the file.
 */
export function readTranscript(transcriptPath: string): TranscriptMessage[] {
  if (!existsSync(transcriptPath)) return [];
  let raw: string;
  try { raw = readFileSync(transcriptPath, "utf-8"); } catch { return []; }

  const out: TranscriptMessage[] = [];
  let idx = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let msg: unknown;
    try { msg = JSON.parse(line); } catch { idx++; continue; }
    const role =
      (msg && typeof msg === "object" && typeof (msg as { role?: unknown }).role === "string")
        ? (msg as { role: string }).role
        : "unknown";
    out.push({
      msg_idx: idx,
      role,
      content: flattenMessageContent(msg),
      raw: msg,
    });
    idx++;
  }
  return out;
}

/**
 * Inclusive-start, exclusive-end slice of the transcript by msg_idx.
 * Same shape memory.source_start_msg_idx / source_end_msg_idx records.
 */
export function sliceRange(
  transcript: TranscriptMessage[],
  startIdx: number,
  endIdx: number
): TranscriptMessage[] {
  return transcript.filter((m) => m.msg_idx >= startIdx && m.msg_idx < endIdx);
}

/**
 * Persist a slice of transcript messages into raw_messages. Idempotent —
 * insertRawMessage uses INSERT OR IGNORE on the composite primary key.
 *
 * `now` is injected so all messages from one call share a created_at
 * (matches when *we* observed them, not when Claude Code wrote them —
 * the transcript file does not carry per-message timestamps).
 */
export async function persistRawMessages(
  db: DbConn,
  sessionId: string,
  messages: TranscriptMessage[],
  now: number = Date.now()
): Promise<number> {
  let inserted = 0;
  for (const m of messages) {
    await insertRawMessage(db, {
      session_id: sessionId,
      msg_idx: m.msg_idx,
      role: m.role,
      content: m.content,
      created_at: now,
    });
    inserted++;
  }
  return inserted;
}

/**
 * Convenience: read transcript, persist any new rows (idempotent), and
 * return the full transcript so caller can decide what to compress.
 */
export async function captureTranscript(
  db: DbConn,
  sessionId: string,
  transcriptPath: string
): Promise<TranscriptMessage[]> {
  const transcript = readTranscript(transcriptPath);
  if (transcript.length === 0) return [];
  await persistRawMessages(db, sessionId, transcript);
  return transcript;
}
