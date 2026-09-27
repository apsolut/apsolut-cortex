/**
 * Value-domain guards for everything that reaches the `memories` table.
 *
 * Two untrusted producers write memories: MCP tool arguments (model-authored)
 * and compression output (LLM-authored JSON, previously cast with `as`). The
 * table has no CHECK constraints — adding them would require rebuilding a
 * table that ships in users' databases — so the domain is enforced here, at
 * every write boundary, instead.
 *
 * Policy differs by caller on purpose:
 *   - MCP boundary  → reject with a message the model can act on.
 *   - LLM output    → coerce to the default and keep the memory; the content
 *                     is the valuable part and a bad enum is not worth
 *                     dropping it.
 */

import type { MemoryCategory, MemoryTier, TrustLevel } from "./db.js";

export const MEMORY_TIERS: readonly MemoryTier[] = [
  "episodic", "semantic", "procedural", "strategic", "meta",
];

export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  "correction", "insight", "decision", "discovery", "fact", "pattern",
];

export const TRUST_LEVELS: readonly TrustLevel[] = [
  "observed", "validated", "proven", "canonical",
];

/** Hard ceiling on a single memory's content. Longer content is truncated. */
export const CONTENT_MAX = 4000;
/** Hard ceiling on a memory's context field. */
export const CONTEXT_MAX = 2000;

export function isTier(v: unknown): v is MemoryTier {
  return typeof v === "string" && (MEMORY_TIERS as readonly string[]).includes(v);
}

export function isCategory(v: unknown): v is MemoryCategory {
  return typeof v === "string" && (MEMORY_CATEGORIES as readonly string[]).includes(v);
}

export function isTrust(v: unknown): v is TrustLevel {
  return typeof v === "string" && (TRUST_LEVELS as readonly string[]).includes(v);
}

/** Lenient path: unknown tier → "semantic". Used on LLM-authored output. */
export function coerceTier(v: unknown, fallback: MemoryTier = "semantic"): MemoryTier {
  return isTier(v) ? v : fallback;
}

/** Lenient path: unknown category → "insight". Used on LLM-authored output. */
export function coerceCategory(v: unknown, fallback: MemoryCategory = "insight"): MemoryCategory {
  return isCategory(v) ? v : fallback;
}

/**
 * Truncate over-long text at a word-ish boundary and mark the cut. Returns
 * null for empty input so callers can treat "nothing left" uniformly with
 * stripPrivate().
 */
export function clampText(text: string, max: number): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut;
  return `${body} […truncated]`;
}

export interface ValidatedMemoryInput {
  tier: MemoryTier;
  category: MemoryCategory;
  content: string;
  context: string | null;
}

/**
 * Strict path for the MCP boundary. Throws with an actionable message; the
 * caller turns that into an isError tool result.
 */
export function validateMemoryInput(input: {
  content: string;
  category: unknown;
  tier: unknown;
  context: string | null;
}): ValidatedMemoryInput {
  if (!isCategory(input.category)) {
    throw new Error(
      `invalid category "${String(input.category)}" — must be one of: ${MEMORY_CATEGORIES.join(", ")}`
    );
  }
  if (!isTier(input.tier)) {
    throw new Error(
      `invalid tier "${String(input.tier)}" — must be one of: ${MEMORY_TIERS.join(", ")}`
    );
  }
  const content = clampText(input.content, CONTENT_MAX);
  if (!content) throw new Error("content is required");

  return {
    tier: input.tier,
    category: input.category,
    content,
    context: input.context ? clampText(input.context, CONTEXT_MAX) : null,
  };
}
