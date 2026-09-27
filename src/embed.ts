/**
 * Local sentence embeddings (all-MiniLM-L6-v2 via transformers.js).
 *
 * The transformers runtime is loaded on first use, not at module load:
 * `@huggingface/transformers` is the single heaviest import in the tree, and
 * most processes that touch this module (hooks, CLI subcommands) never embed
 * anything. Paths come from paths.ts so this module does not drag the database
 * client in either.
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { MODELS_DIR } from "./paths.js";

let _embedder: FeatureExtractionPipeline | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (_embedder) return _embedder;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = MODELS_DIR;
  env.allowRemoteModels = true;
  _embedder = await pipeline<"feature-extraction">(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );
  return _embedder;
}

export async function embed(text: string): Promise<Float32Array> {
  const e = await getEmbedder();
  const out = await e(text, { pooling: "mean", normalize: true });
  return out.data as Float32Array;
}
