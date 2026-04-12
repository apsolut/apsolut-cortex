import { pipeline, env } from "@xenova/transformers";
import { MODELS_DIR } from "./db.js";

env.cacheDir = MODELS_DIR;
env.allowRemoteModels = true;

let _embedder: Awaited<ReturnType<typeof pipeline>> | null = null;

async function getEmbedder() {
  if (_embedder) return _embedder;
  _embedder = await pipeline(
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

