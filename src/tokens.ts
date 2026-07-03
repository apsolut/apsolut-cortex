/**
 * Local token counting for budget triggers. Uses gpt-tokenizer (cl100k
 * by default, which matches Claude well enough for budget decisions —
 * we are not invoicing, we are deciding when to compress).
 *
 * Never calls a model just to count tokens.
 */

import { readFileSync } from "fs";
import { encode } from "gpt-tokenizer";

export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

/**
 * Best-effort token count over a Claude Code transcript file.
 *
 * Claude Code transcripts are JSON-lines: one message per line, each line
 * is an object with at least `role` and `content`. Content can be a
 * string OR an array of typed blocks (text, tool_use, tool_result, etc.).
 * We flatten the content to plain text and tokenize the whole thing.
 *
 * Returns 0 if the path does not exist or is unreadable — callers should
 * treat that as "no signal" and skip the budget trigger rather than
 * fail the hook.
 */
export function countTranscriptTokens(transcriptPath: string, fromMsgIdx = 0): number {
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf-8");
  } catch {
    return 0;
  }

  // Index lines the same way readTranscript() does (blank lines skipped,
  // malformed lines bump the counter) so `fromMsgIdx` can be fed straight
  // from the compression cursor.
  let total = 0;
  let idx = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let msg: unknown;
    try { msg = JSON.parse(line); } catch { idx++; continue; }
    if (idx >= fromMsgIdx) total += countTokens(flattenMessageContent(msg));
    idx++;
  }
  return total;
}

/**
 * Reduce a Claude Code transcript message to a flat string for tokenization.
 * Handles both legacy string-content messages and structured-block messages.
 */
export function flattenMessageContent(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  // Claude Code transcript lines wrap the API message in an envelope:
  // { type: "user"|"assistant", message: { role, content }, ... }.
  // Unwrap it; fall back to the object itself for flat { role, content }.
  const outer = msg as { message?: unknown };
  const m = (outer.message && typeof outer.message === "object"
    ? outer.message
    : msg) as { role?: string; content?: unknown };
  if (typeof m.content === "string") return m.content;
  if (!Array.isArray(m.content)) return "";

  const parts: string[] = [];
  for (const block of m.content) {
    if (!block || typeof block !== "object") continue;
    const b = block as {
      type?: string;
      text?: string;
      input?: unknown;
      content?: unknown;
      name?: string;
    };
    if (typeof b.text === "string") parts.push(b.text);
    if (b.type === "tool_use") {
      parts.push(`[tool_use ${b.name ?? "?"}: ${JSON.stringify(b.input ?? {}).slice(0, 200)}]`);
    }
    if (b.type === "tool_result") {
      if (typeof b.content === "string") parts.push(b.content);
      else if (Array.isArray(b.content)) {
        for (const c of b.content) {
          if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
            parts.push((c as { text: string }).text);
          }
        }
      }
    }
  }
  return parts.join("\n");
}
