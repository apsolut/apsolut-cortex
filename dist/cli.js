#!/usr/bin/env node

// src/cli.ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "fs";
import { join as join6, resolve, dirname as dirname2, sep } from "path";
import { homedir as homedir4 } from "os";
import { fileURLToPath, pathToFileURL } from "url";

// src/config.ts
function envNum(key, fallback) {
  const val = process.env[key];
  if (val === undefined)
    return fallback;
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
var CORTEX_DUPLICATE_THRESHOLD = envNum("APSOLUT_CORTEX_DUPLICATE_THRESHOLD", 0.92);
var CORTEX_DECAY_DAYS = envNum("APSOLUT_CORTEX_DECAY_DAYS", 7);
var CORTEX_DECAY_OBSERVED = envNum("APSOLUT_CORTEX_DECAY_OBSERVED", 0.95);
var CORTEX_DECAY_VALIDATED = envNum("APSOLUT_CORTEX_DECAY_VALIDATED", 0.98);
var CORTEX_PRUNE_WEIGHT = envNum("APSOLUT_CORTEX_PRUNE_WEIGHT", 0.1);
var CORTEX_RRF_K = envNum("APSOLUT_CORTEX_RRF_K", 60);
var CORTEX_MMR_LAMBDA = envNum("APSOLUT_CORTEX_MMR_LAMBDA", 0.7);
var CORTEX_SEARCH_LIMIT_MAX = envNum("APSOLUT_CORTEX_SEARCH_LIMIT_MAX", 10);
var CORTEX_SEARCH_MULTIPLIER = envNum("APSOLUT_CORTEX_SEARCH_MULTIPLIER", 2);
var CORTEX_WEIGHT_ALPHA = envNum("APSOLUT_CORTEX_WEIGHT_ALPHA", 0.3);
var CORTEX_PROMOTE_WEIGHT = envNum("APSOLUT_CORTEX_PROMOTE_WEIGHT", 1.4);
var CORTEX_PROMOTE_USES = envNum("APSOLUT_CORTEX_PROMOTE_USES", 3);
var CORTEX_BUMP_BOOST = envNum("APSOLUT_CORTEX_BUMP_BOOST", 0.1);
var CORTEX_WEIGHT_CAP = envNum("APSOLUT_CORTEX_WEIGHT_CAP", 3);
var CORTEX_CORRECTION_WEIGHT = envNum("APSOLUT_CORTEX_CORRECTION_WEIGHT", 1.5);
var CORTEX_MANUAL_WEIGHT = envNum("APSOLUT_CORTEX_MANUAL_WEIGHT", 1.2);
var CORTEX_RAW_RETENTION_DAYS = envNum("APSOLUT_CORTEX_RAW_RETENTION_DAYS", 90);
var CORTEX_RECALL_TOKEN_BUDGET = envNum("APSOLUT_CORTEX_RECALL_TOKEN_BUDGET", 4000);
var CORTEX_OBSERVE_THRESHOLD = envNum("APSOLUT_CORTEX_OBSERVE_THRESHOLD", 30000);
var CORTEX_OBSERVE_BLOCK_MULT = envNum("APSOLUT_CORTEX_OBSERVE_BLOCK_MULT", 1.2);
var CORTEX_REFLECT_THRESHOLD = envNum("APSOLUT_CORTEX_REFLECT_THRESHOLD", 40000);

// src/keyring.ts
import { createRequire } from "module";
var _EntryCtor = null;
var _loadError = null;
try {
  const require2 = createRequire(import.meta.url);
  _EntryCtor = require2("@napi-rs/keyring").Entry;
} catch (e) {
  _loadError = e;
}

// src/paths.ts
import { homedir } from "os";
import { join } from "path";
var CORTEX_DIR = join(homedir(), ".apsolut-cortex");
var DB_PATH = join(CORTEX_DIR, "memory.db");
var REGISTRY_PATH = join(CORTEX_DIR, "registry.json");
var MODELS_DIR = join(CORTEX_DIR, "models");
// src/db.ts
var GREP_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "do",
  "does",
  "for",
  "from",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "such",
  "that",
  "the",
  "this",
  "to",
  "use",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "you"
]);

// src/logs.ts
import { homedir as homedir2 } from "os";
import { dirname, join as join2 } from "path";
var MAX_LOG_BYTES = 5 * 1024 * 1024;
var LOGS_DIR = join2(homedir2(), ".apsolut-cortex", "logs");
var RETRIEVALS_PATH = join2(LOGS_DIR, "retrievals.jsonl");
var CORRECTIONS_PATH = join2(LOGS_DIR, "corrections.jsonl");
var SHADOW_PATH = join2(LOGS_DIR, "shadow.jsonl");

// src/backup.ts
import { join as join3 } from "path";
import { createClient } from "@libsql/client";
var BACKUP_DIR = join3(CORTEX_DIR, "backup");

// src/export.ts
import { join as join4 } from "path";
var OBSIDIAN_DIR = join4(CORTEX_DIR, "obsidian");
var MEMORIES_DIR = join4(OBSIDIAN_DIR, "memories");
var INDEX_PATH = join4(OBSIDIAN_DIR, "index.md");

// src/compress.ts
import { join as join5 } from "path";
import { homedir as homedir3 } from "os";
var BREAKER_PATH = join5(homedir3(), ".apsolut-cortex", "compression-state.json");
var COOLDOWN_MS = 60 * 60 * 1000;

// src/cli.ts
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = dirname2(__filename2);
var PACKAGE_ROOT = resolve(__dirname2, "..");
var IS_DIST = __dirname2.endsWith("dist") || __dirname2.includes(`${sep}dist${sep}`);
var PKG_VERSION = JSON.parse(readFileSync(join6(PACKAGE_ROOT, "package.json"), "utf-8")).version;
var PROJECT_ROOT = process.cwd();
var CLAUDE_SETTINGS = join6(homedir4(), ".claude", "settings.json");
var MCP_JSON = join6(PROJECT_ROOT, ".mcp.json");
var PROJECT_APSOLUT = join6(PROJECT_ROOT, ".apsolut-cortex");
var PROJECT_CONFIG = join6(PROJECT_APSOLUT, "project.json");
var PROJECT_CLAUDE_DIR = join6(PROJECT_ROOT, ".claude");
var PROJECT_SETTINGS_LOCAL = join6(PROJECT_CLAUDE_DIR, "settings.local.json");
var PROJECT_SETTINGS = join6(PROJECT_CLAUDE_DIR, "settings.json");
