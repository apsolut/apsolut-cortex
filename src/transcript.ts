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
import { stripPrivate } from "./privacy.js";

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
    // Claude Code lines carry the role inside a `message` envelope and a
    // line kind in top-level `type` ("user", "assistant", "attachment",
    // ...). Prefer the inner role, fall back to flat `role`, then `type`.
    const obj = (msg && typeof msg === "object" ? msg : {}) as Record<string, unknown>;
    const inner = (obj.message && typeof obj.message === "object"
      ? obj.message
      : null) as Record<string, unknown> | null;
    const role =
      typeof inner?.role === "string" ? (inner.role as string)
      : typeof obj.role === "string" ? (obj.role as string)
      : typeof obj.type === "string" ? (obj.type as string)
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
 *
 * `<private>…</private>` is honoured here as well as on observations. This is
 * the one write path that stores conversation text verbatim — tool output
 * included — so a `<private>` block the user wrote to keep a secret out of
 * memory used to be stripped from the derived observation and then kept in
 * full in raw_messages, where memory_recall could read it straight back.
 * A message that is entirely private is skipped; its index simply has no row.
 */
export async function persistRawMessages(
  db: DbConn,
  sessionId: string,
  messages: TranscriptMessage[],
  now: number = Date.now()
): Promise<number> {
  let inserted = 0;
  for (const m of messages) {
    const content = stripPrivate(m.content);
    if (content === null) continue;
    await insertRawMessage(db, {
      session_id: sessionId,
      msg_idx: m.msg_idx,
      role: m.role,
      content,
      created_at: now,
    });
    inserted++;
  }
  return inserted;
}

/**
 * Apply `<private>` stripping to a parsed transcript, dropping messages that
 * are private in their entirety and preserving `msg_idx` on the rest.
 *
 * Exported because it is the guarantee, not an implementation detail: any
 * path that forwards transcript text anywhere — the database, a compression
 * provider, a log — goes through here first.
 */
export function sanitizeTranscript(messages: TranscriptMessage[]): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  for (const m of messages) {
    const content = stripPrivate(m.content);
    if (content === null) continue;
    out.push({ ...m, content });
  }
  return out;
}

export interface CapturedTranscript {
  /** Sanitized messages, original `msg_idx` preserved. */
  messages: TranscriptMessage[];
  /**
   * Number of messages in the file before sanitizing. The compression cursor
   * is an index into the *file*, so it must advance past private messages
   * that were dropped — otherwise the window never clears and every
   * subsequent run re-reads the same tail forever.
   */
  total: number;
}

/**
 * Read transcript, persist any new rows (idempotent), and return the
 * sanitized messages plus the pre-sanitize message count.
 *
 * Returning sanitized content is the point. `persistRawMessages` has always
 * stripped `<private>` on its way into the database, but this function used
 * to hand back the *unstripped* array — and `compressSlice` forwarded it
 * straight to Anthropic or Ollama, where a block the user explicitly marked
 * private could be summarized into a memory and stored. The guarantee is now
 * enforced here, once, for every consumer.
 */
export async function captureTranscript(
  db: DbConn,
  sessionId: string,
  transcriptPath: string
): Promise<CapturedTranscript> {
  const transcript = readTranscript(transcriptPath);
  if (transcript.length === 0) return { messages: [], total: 0 };
  const safe = sanitizeTranscript(transcript);
  await persistRawMessages(db, sessionId, safe);
  return { messages: safe, total: transcript.length };
}
