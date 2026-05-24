/**
 * Centralized configuration for apsolut-cortex.
 * All thresholds are configurable via environment variables with sensible defaults.
 */

function envNum(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// ── Duplicate Detection ─────────────────────────────────────────────────────

/** Cosine similarity threshold for dedup (0-1). Higher = stricter matching. */
export const CORTEX_DUPLICATE_THRESHOLD = envNum("APSOLUT_CORTEX_DUPLICATE_THRESHOLD", 0.92);

// ── Memory Decay ────────────────────────────────────────────────────────────

/** Days before unused memories start decaying. */
export const CORTEX_DECAY_DAYS = envNum("APSOLUT_CORTEX_DECAY_DAYS", 7);

/** Weekly decay multiplier for "observed" trust memories. */
export const CORTEX_DECAY_OBSERVED = envNum("APSOLUT_CORTEX_DECAY_OBSERVED", 0.95);

/** Weekly decay multiplier for "validated" trust memories. */
export const CORTEX_DECAY_VALIDATED = envNum("APSOLUT_CORTEX_DECAY_VALIDATED", 0.98);

/** Weight below which memories can be pruned. */
export const CORTEX_PRUNE_WEIGHT = envNum("APSOLUT_CORTEX_PRUNE_WEIGHT", 0.1);

// ── Search & Ranking ────────────────────────────────────────────────────────

/** RRF (Reciprocal Rank Fusion) constant. Higher = more weight to lower ranks. */
export const CORTEX_RRF_K = envNum("APSOLUT_CORTEX_RRF_K", 60);

/** MMR lambda (0-1). Higher = prefer relevance over diversity. */
export const CORTEX_MMR_LAMBDA = envNum("APSOLUT_CORTEX_MMR_LAMBDA", 0.7);

/** Max search results returned to caller. */
export const CORTEX_SEARCH_LIMIT_MAX = envNum("APSOLUT_CORTEX_SEARCH_LIMIT_MAX", 10);

/** Overfetch multiplier — fetch limit×N candidates for RRF/MMR to filter. */
export const CORTEX_SEARCH_MULTIPLIER = envNum("APSOLUT_CORTEX_SEARCH_MULTIPLIER", 2);

// ── Weight Updates ──────────────────────────────────────────────────────────

/** EMA alpha for weight updates (0-1). Higher = recent ratings matter more. */
export const CORTEX_WEIGHT_ALPHA = envNum("APSOLUT_CORTEX_WEIGHT_ALPHA", 0.3);

/** Weight threshold for trust promotion to "validated". */
export const CORTEX_PROMOTE_WEIGHT = envNum("APSOLUT_CORTEX_PROMOTE_WEIGHT", 1.4);

/** used_count threshold for trust promotion to "validated". */
export const CORTEX_PROMOTE_USES = envNum("APSOLUT_CORTEX_PROMOTE_USES", 3);

/** Weight bump added when a duplicate memory is detected. */
export const CORTEX_BUMP_BOOST = envNum("APSOLUT_CORTEX_BUMP_BOOST", 0.1);

/** Maximum weight a memory can reach. */
export const CORTEX_WEIGHT_CAP = envNum("APSOLUT_CORTEX_WEIGHT_CAP", 3.0);

// ── Memory Creation ─────────────────────────────────────────────────────────

/** Initial weight for correction-type memories. */
export const CORTEX_CORRECTION_WEIGHT = envNum("APSOLUT_CORTEX_CORRECTION_WEIGHT", 1.5);

/** Initial weight for manually stored memories. */
export const CORTEX_MANUAL_WEIGHT = envNum("APSOLUT_CORTEX_MANUAL_WEIGHT", 1.2);

// ── Raw message retention (M4) ──────────────────────────────────────────────

/**
 * Days to keep rows in raw_messages before cleanup. The cleanup job runs
 * on SessionEnd and only deletes raw rows whose memories have been
 * promoted to is_pinned=true (introduced in M8). Until M8, all rows are
 * retained regardless of this value.
 */
export const CORTEX_RAW_RETENTION_DAYS = envNum("APSOLUT_CORTEX_RAW_RETENTION_DAYS", 90);

// ── Tracked Config Files ────────────────────────────────────────────────────

export const TRACKED_FILES = [
  // Package managers & language configs
  "package.json", "tsconfig.json", "tsconfig.base.json",
  ".env", ".env.local",
  "cargo.toml", "pyproject.toml", "go.mod",
  "composer.json", "Gemfile",
  "bun.lock", "bunfig.toml",
  "deno.json", "deno.jsonc",

  // Build tools
  "vite.config.ts", "vite.config.js", "vite.config.mjs",
  "webpack.config.js", "webpack.config.ts",
  "next.config.js", "next.config.ts", "next.config.mjs",

  // Linting & formatting
  ".eslintrc.json", ".eslintrc.js",
  "eslint.config.js", "eslint.config.mjs",
  ".prettierrc", ".prettierrc.json",
  "biome.json", "biome.jsonc",

  // CSS & UI
  "tailwind.config.js", "tailwind.config.ts",

  // Database
  "drizzle.config.ts", "drizzle.config.js",

  // Containers & orchestration
  "docker-compose.yml", "docker-compose.yaml", "Dockerfile",

  // Monorepo tools
  "turbo.json", "nx.json", "lerna.json",

  // Build scripts
  "Makefile", "justfile",
];
