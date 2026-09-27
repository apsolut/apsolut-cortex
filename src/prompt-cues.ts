/**
 * Pushback detection on user prompts.
 *
 * The UserPromptSubmit hook runs on every prompt with a 30s budget, so this
 * must stay cheap: regex cues only, no embedder, no LLM. A positive here is
 * a *candidate* — session-end compression decides whether it becomes a
 * correction memory, and a matching stored memory becomes a contradiction
 * candidate for supersession.
 */

const PUSHBACK_CUES = [
  /^\s*no[,.\s]/i,
  /\b(?:that'?s|this is|it'?s)\s+(?:wrong|incorrect|not right|not true)\b/i,
  /\bdon'?t\s+(?:do|use|touch|add|change|delete|remove)\b/i,
  /\bstop\s+(?:doing|using|adding)\b/i,
  /\bnever\s+(?:do|use|touch|add|commit|push)\b/i,
  /\bnot\s+what\s+i\s+(?:asked|meant|wanted)\b/i,
  /\bi\s+(?:said|told you|already told)\b/i,
  /\bundo\s+(?:that|this|the)\b/i,
  /\brevert\s+(?:that|this)\b/i,
  /\bwe\s+(?:don'?t|no longer|stopped)\s+us(?:e|ing)\b/i,
  /\binstead\s+of\s+that\b/i,
  /\bwhy\s+(?:did|are|would)\s+you\b/i,
];

/** True when the prompt reads like the user is correcting or pushing back. */
export function isPushback(prompt: string): boolean {
  if (!prompt || prompt.length < 4) return false;
  return PUSHBACK_CUES.some((re) => re.test(prompt));
}

/**
 * Terms worth matching against stored memories, for finding which memory
 * the pushback might contradict. Drops stopwords and short tokens.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "not", "no", "yes", "you", "your",
  "that", "this", "these", "those", "it", "its", "is", "are", "was", "were",
  "do", "don", "did", "does", "have", "has", "had", "will", "would", "should",
  "can", "could", "what", "why", "how", "when", "where", "i", "we", "me",
  "my", "our", "to", "of", "in", "on", "for", "with", "at", "by", "from",
  "please", "just", "said", "told", "asked", "want", "wanted", "instead",
  "never", "stop", "wrong", "again", "use", "using",
]);

export function contentTerms(prompt: string, max = 8): string[] {
  const terms = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s_.-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return [...new Set(terms)].slice(0, max);
}

// ── Claude's own self-corrections (Stop hook) ────────────────────────────────

/**
 * Explicit self-correction cues only.
 *
 * Two patterns were removed after being shown to fire on ordinary prose:
 * `(wait|oops)` matched "I will wait for the build to finish", and
 * `(turns out|it seems)` matched "It seems reasonable to…". Both stored their
 * match as a `correction` — the highest-priority category, weighted 1.5 and
 * surfaced first at SessionStart — so a false positive there was expensive.
 *
 * Lives here rather than in the hook so it can be tested without executing a
 * hook's stdin-reading entry point.
 */
const CORRECTION_PATTERNS = [
  /actually,?\s+(?:the|it'?s?|that'?s?)\s+(.{20,150})/gi,
  /(?:my mistake|i was wrong|incorrect)[^.]*[.!]\s*(.{20,150})/gi,
  /(?:should(?:n'?t)? have|shouldn'?t).{0,30}[—–-]\s*(.{20,150})/gi,
  /(?:the correct|correct(?:ly)?)\s+(?:way|path|file|approach)\s+is\s+(.{20,150})/gi,
];

/** At most five distinct self-corrections, prefixed for the observation log. */
export function extractCorrections(transcript: string): string[] {
  const found: string[] = [];
  for (const pattern of CORRECTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(transcript)) !== null) {
      const text = match[1]?.trim();
      if (text && text.length > 20 && text.length < 200) {
        found.push(`Self-correction: ${text}`);
      }
    }
  }
  return [...new Set(found)].slice(0, 5);
}
