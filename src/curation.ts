/**
 * Curation helpers for individual memories — promote/demote/tag/delete.
 * Used by the CLI subcommands of the same name. Kept separate from db.ts
 * so the CLI doesn't drag in the full hybrid-retrieval machinery.
 */

import type { Client } from "@libsql/client";
import type { DbConn, TrustLevel } from "./db.js";
import { searchGrep } from "./db.js";

export const TRUST_ORDER: TrustLevel[] = ["observed", "validated", "proven", "canonical"];

export interface MemorySummary {
  id: string;
  project_id: string;
  tier: string;
  category: string;
  trust: string;
  weight: number;
  content: string;
}

// ── Promote / demote ─────────────────────────────────────────────────────────

export interface TrustChangeResult {
  id: string;
  previous: TrustLevel;
  next: TrustLevel;
  changed: boolean;
}

async function changeTrust(
  db: DbConn,
  id: string,
  direction: 1 | -1
): Promise<TrustChangeResult | null> {
  const row = await db.execute({ sql: "SELECT trust FROM memories WHERE id = ?", args: [id] });
  if (row.rows.length === 0) return null;
  const previous = row.rows[0].trust as TrustLevel;
  const idx = TRUST_ORDER.indexOf(previous);
  if (idx < 0) return null;
  const nextIdx = Math.min(TRUST_ORDER.length - 1, Math.max(0, idx + direction));
  const next = TRUST_ORDER[nextIdx];
  if (next === previous) return { id, previous, next, changed: false };
  await db.execute({
    sql: "UPDATE memories SET trust = ?, last_used = ? WHERE id = ?",
    args: [next, Date.now(), id],
  });
  return { id, previous, next, changed: true };
}

export function promoteMemory(db: DbConn, id: string) { return changeTrust(db, id, 1); }
export function demoteMemory(db: DbConn, id: string) { return changeTrust(db, id, -1); }

// ── Tags ─────────────────────────────────────────────────────────────────────

export async function tagMemory(db: DbConn, id: string, tag: string): Promise<boolean> {
  const exists = await db.execute({ sql: "SELECT 1 FROM memories WHERE id = ? LIMIT 1", args: [id] });
  if (exists.rows.length === 0) return false;
  await db.execute({
    sql: "INSERT OR IGNORE INTO memory_tags (memory_id, tag, created_at) VALUES (?, ?, ?)",
    args: [id, tag.toLowerCase(), Date.now()],
  });
  return true;
}

export async function untagMemory(db: DbConn, id: string, tag: string): Promise<boolean> {
  const result = await db.execute({
    sql: "DELETE FROM memory_tags WHERE memory_id = ? AND tag = ?",
    args: [id, tag.toLowerCase()],
  });
  return result.rowsAffected > 0;
}

export async function getTagsForMemory(db: DbConn, id: string): Promise<string[]> {
  const r = await db.execute({
    sql: "SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag",
    args: [id],
  });
  return r.rows.map((x) => x.tag as string);
}

// ── Grep (CLI wrapper around searchGrep) ─────────────────────────────────────

export async function grepMemories(
  db: Client,
  projectId: string,
  pattern: string,
  limit: number = 50
): Promise<MemorySummary[]> {
  const memories = await searchGrep(db, projectId, pattern, limit);
  return memories.map((m) => ({
    id: m.id,
    project_id: m.project_id,
    tier: m.tier,
    category: m.category,
    trust: m.trust,
    weight: m.weight,
    content: m.content,
  }));
}

// ── Delete (single + bulk) ───────────────────────────────────────────────────

export interface DeleteFilters {
  /** Single id; if set, all other filters ignored. */
  id?: string;
  /** Match memories in a given project_id. */
  project?: string;
  /** Match memories carrying a tag. */
  tag?: string;
  /** Match memories created before this YYYY-MM-DD date (inclusive of equal day). */
  before?: string;
  /** Match memories whose content (or context) substring-matches. */
  grep?: string;
}

export interface DeletePreview {
  count: number;
  sample: MemorySummary[];
  /** SQL that would run, for transparency. */
  sql: string;
  args: (string | number)[];
}

function buildDeleteQuery(filters: DeleteFilters): { sql: string; args: (string | number)[] } {
  if (filters.id) {
    return { sql: "DELETE FROM memories WHERE id = ?", args: [filters.id] };
  }

  const where: string[] = [];
  const args: (string | number)[] = [];

  if (filters.project) {
    where.push("project_id = ?");
    args.push(filters.project);
  }
  if (filters.before) {
    const ts = new Date(filters.before + "T23:59:59.999Z").getTime();
    if (!Number.isFinite(ts)) {
      throw new Error(`invalid --before date: ${filters.before} (expected YYYY-MM-DD)`);
    }
    where.push("created_at <= ?");
    args.push(ts);
  }
  if (filters.grep) {
    const pat = `%${filters.grep.replace(/[%_]/g, "\\$&")}%`;
    where.push("(content LIKE ? ESCAPE '\\' OR COALESCE(context, '') LIKE ? ESCAPE '\\')");
    args.push(pat, pat);
  }
  if (filters.tag) {
    where.push(
      "id IN (SELECT memory_id FROM memory_tags WHERE tag = ?)"
    );
    args.push(filters.tag.toLowerCase());
  }

  if (where.length === 0) {
    throw new Error("at least one filter (--id, --project, --tag, --before, or --grep) is required");
  }

  return {
    sql: `DELETE FROM memories WHERE ${where.join(" AND ")}`,
    args,
  };
}

export async function previewDeletion(
  db: Client,
  filters: DeleteFilters,
  sampleSize: number = 5
): Promise<DeletePreview> {
  const { sql, args } = buildDeleteQuery(filters);
  const selectSql = sql.replace(/^DELETE FROM memories/, "SELECT * FROM memories");

  const result = await db.execute({ sql: selectSql, args });
  const sample: MemorySummary[] = result.rows.slice(0, sampleSize).map((r) => ({
    id: r.id as string,
    project_id: r.project_id as string,
    tier: r.tier as string,
    category: r.category as string,
    trust: r.trust as string,
    weight: r.weight as number,
    content: r.content as string,
  }));

  return { count: result.rows.length, sample, sql, args };
}

export async function applyDeletion(
  db: Client,
  filters: DeleteFilters
): Promise<number> {
  const { sql, args } = buildDeleteQuery(filters);
  const result = await db.execute({ sql, args });
  // Clean up orphan tag rows.
  await db.execute(
    "DELETE FROM memory_tags WHERE memory_id NOT IN (SELECT id FROM memories)"
  );
  return result.rowsAffected;
}
