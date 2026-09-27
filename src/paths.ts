/**
 * Filesystem layout, in a module with no dependencies.
 *
 * These constants used to live in db.ts, which meant that anything needing a
 * path (the embedder needing the model cache dir, for instance) pulled in the
 * libSQL client, the keyring and the migration list with it. Hooks pay that
 * cost on every tool call, so the paths live on their own.
 *
 * Namespace note: `~/.apsolut-cortex/` — never `~/.apsolut/`, which belongs to
 * the other apsolut-* tools.
 */

import { homedir } from "os";
import { join } from "path";

export const CORTEX_DIR = join(homedir(), ".apsolut-cortex");
export const DB_PATH = join(CORTEX_DIR, "memory.db");
export const REGISTRY_PATH = join(CORTEX_DIR, "registry.json");
export const MODELS_DIR = join(CORTEX_DIR, "models");
