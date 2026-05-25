/**
 * Reflector layer (M6, two-tier compression).
 *
 * When the cumulative content of a session's memories exceeds
 * CORTEX_REFLECT_THRESHOLD tokens, we re-summarize them into denser
 * "reflection" memories (tier = meta, source = "reflector"). This keeps
 * a long working session from producing dozens of small overlapping
 * memories — the reflector consolidates them into a handful of higher
 * level statements.
 *
 * v1 scope: runs at SessionEnd only (synchronous). The async observer
 * trigger does not invoke the reflector — observers stay focused on
 * fresh capture, reflections are a tidy-up pass.
 */

import type { Client } from "@libsql/client";
import {
  insertMemory,
  findDuplicate,
  bumpWeight,
  type Memory,
  type MemoryTier,
  type MemoryCategory,
} from "./db.js";
import { compressSession } from "./compress.js";
import { embed } from "./embed.js";
import { countTokens } from "./tokens.js";
import { CORTEX_REFLECT_THRESHOLD } from "./config.js";

export interface ReflectResult {
  source_memories: number;
  source_tokens: number;
  reflections_stored: number;
  triggered: boolean;
}

/**
 * If the cumulative content of this session's memories exceeds
 * CORTEX_REFLECT_THRESHOLD tokens, generate denser reflections.
 *
 * Returns triggered=false (no work done) if under threshold or if the
 * session has fewer than 3 memories — single-memory or near-empty
 * sessions have nothing to consolidate.
 */
export async function maybeReflect(
  db: Client,
  sessionId: string,
  projectId: string,
  projectName: string
): Promise<ReflectResult> {
  const memRows = await db.execute({
    sql: `SELECT * FROM memories
          WHERE session_id = ? AND project_id = ?
            AND source != 'reflector'
          ORDER BY created_at ASC`,
    args: [sessionId, projectId],
  });

  const total = memRows.rows.length;
  if (total < 3) {
    return { source_memories: total, source_tokens: 0, reflections_stored: 0, triggered: false };
  }

  const memories: Memory[] = memRows.rows.map((r) => ({
    id: r.id as string,
    project_id: r.project_id as string,
    tier: r.tier as MemoryTier,
    category: r.category as MemoryCategory,
    trust: r.trust as Memory["trust"],
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
    source_session_id: (r.source_session_id as string | null) ?? null,
    source_start_msg_idx: (r.source_start_msg_idx as number | null) ?? null,
    source_end_msg_idx: (r.source_end_msg_idx as number | null) ?? null,
  }));

  const text = memories
    .map((m) => `[${m.category}] ${m.content}${m.context ? ` — ${m.context}` : ""}`)
    .join("\n\n");
  const tokens = countTokens(text);

  if (tokens < CORTEX_REFLECT_THRESHOLD) {
    return { source_memories: total, source_tokens: tokens, reflections_stored: 0, triggered: false };
  }

  // Feed memories as "observations" into the existing compressor. The
  // resulting memories are higher-level reflections.
  const observations = memories.map((m) => ({
    tool_name: m.category,
    content: m.content,
    category: m.category,
  }));

  const { memories: reflections } = await compressSession(observations, projectName);

  let stored = 0;
  for (const r of reflections) {
    const textToEmbed = r.context ? `${r.content} ${r.context}` : r.content;
    let embedding: Float32Array | null = null;
    try { embedding = await embed(textToEmbed); }
    catch (e) { process.stderr.write(`[apsolut-cortex] reflector embed failed: ${e}\n`); }

    if (embedding) {
      const dup = await findDuplicate(db, projectId, embedding);
      if (dup) { await bumpWeight(db, dup.id); continue; }
    }

    await insertMemory(db, {
      project_id: projectId,
      tier: "meta",
      category: r.category as MemoryCategory,
      trust: "observed",
      content: r.content,
      context: r.context ?? `Reflection over ${total} memories from session ${sessionId.slice(0, 8)}`,
      source: "reflector",
      embedding,
      weight: 1.2, // reflections start slightly above default
      session_id: sessionId,
      source_session_id: sessionId,
      source_start_msg_idx: null,
      source_end_msg_idx: null,
    });
    stored++;
  }

  return { source_memories: total, source_tokens: tokens, reflections_stored: stored, triggered: true };
}
