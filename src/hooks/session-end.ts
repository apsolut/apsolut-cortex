/**
 * Claude Code hook: SessionEnd
 *
 * Compresses session observations into memories + summary.
 * Runs weight decay and pruning.
 *
 * Input: { session_id, cwd }
 */

import { readFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import {
  getDb,
  upsertSession,
  getSessionObservations,
  getUnprocessedObservations,
  markProjectObservationsPromoted,
  insertMemory,
  findDuplicate,
  bumpWeight,
  diffFileHashes,
  snapshotFileHashes,
  decayAndPrune,
} from "../db.js";
import { compressSession } from "../compress.js";
import { embed } from "../embed.js";

const TRACKED_FILES = [
  "package.json", "tsconfig.json", "tsconfig.base.json",
  ".env", ".env.local", "cargo.toml", "pyproject.toml",
  "go.mod", "composer.json", "Gemfile", "vite.config.ts",
  "next.config.js", "next.config.ts",
];

function hashFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch { return null; }
}

async function main() {
  const raw = await new Promise<string>((resolve) => {
    let d = ""; process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c: string) => d += c);
    process.stdin.on("end", () => resolve(d));
  });
  let data: { session_id?: string; cwd?: string } = {};
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  const cwd = data.cwd ?? process.cwd();
  const sessionId = data.session_id ?? "unknown";

  const projectFile = join(cwd, ".apsolut", "project.json");
  if (!existsSync(projectFile)) process.exit(0);

  let project: { id: string; name: string } | null = null;
  try {
    project = JSON.parse(readFileSync(projectFile, "utf-8"));
  } catch { process.exit(0); }
  if (!project?.id) process.exit(0);

  try {
    const db = await getDb();
    const currentObs = await getSessionObservations(db, sessionId);
    const staleObs = await getUnprocessedObservations(db, project.id, sessionId);
    const observations = [...currentObs, ...staleObs];

    // Detect which tracked files changed since session start
    const currentHashes = TRACKED_FILES
      .map((f) => ({ path: f, hash: hashFile(join(cwd, f)) }))
      .filter((h): h is { path: string; hash: string } => h.hash !== null);
    const changedFiles = await diffFileHashes(db, project.id, currentHashes);

    // Update stored hashes for next session
    if (currentHashes.length > 0) await snapshotFileHashes(db, project.id, currentHashes);

    // Include changed files as extra context for compression
    const projectContext = changedFiles.length > 0
      ? `${project.name} (files changed: ${changedFiles.join(", ")})`
      : project.name;

    const { memories, summary } = await compressSession(
      observations,
      projectContext
    );

    let stored = 0;
    for (const mem of memories) {
      const textToEmbed = mem.context
        ? `${mem.content} ${mem.context}`
        : mem.content;

      let embeddingRaw: Float32Array | null = null;
      try {
        embeddingRaw = await embed(textToEmbed);
      } catch {}

      // Dedup: skip if a very similar memory already exists
      if (embeddingRaw) {
        const dup = await findDuplicate(db, project.id, embeddingRaw);
        if (dup) {
          await bumpWeight(db, dup.id);
          continue;
        }
      }

      const weight = mem.category === "correction" ? 1.5 : 1.0;

      await insertMemory(db, {
        project_id: project.id,
        tier: mem.tier,
        category: mem.category,
        trust: "observed",
        content: mem.content,
        context: mem.context ?? null,
        source: "hook_auto",
        embedding: embeddingRaw,
        weight,
        session_id: sessionId,
      });
      stored++;
    }

    if (observations.length > 0) {
      await markProjectObservationsPromoted(db, project.id);
    }

    await upsertSession(db, {
      id: sessionId,
      project_id: project.id,
      ended_at: Date.now(),
      summary: summary || undefined,
      memories_stored: stored,
    });

    const { pruned } = await decayAndPrune(db, project.id);
    if (pruned > 0) {
      console.error(`[apsolut-cortex] pruned ${pruned} stale memories`);
    }
  } catch (e) {
    console.error(`[apsolut-cortex] session-end error: ${e}`);
    process.exit(0);
  }
}

main();
