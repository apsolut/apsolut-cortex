/**
 * Claude Code hook: SessionEnd
 *
 * Compresses session observations into memories + summary.
 * Runs weight decay and pruning.
 *
 * Input: { session_id, cwd }
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import {
  CORTEX_DIR,
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
  purgeRawMessages,
  upsertProject,
} from "../db.js";
import { compressSession } from "../compress.js";
import { embed } from "../embed.js";
import { TRACKED_FILES, CORTEX_CORRECTION_WEIGHT, CORTEX_RAW_RETENTION_DAYS } from "../config.js";
import { exportVault } from "../export.js";
import { compressSlice } from "../compress-runner.js";
import {
  tryAcquireLock,
  releaseLock,
  clearAllForSession,
} from "../buffer.js";
import { maybeReflect } from "../reflector.js";

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
  // Optional in dev / legacy installs; required for M6 transcript capture.
  const transcriptPath = (data as { transcript_path?: string }).transcript_path;

  const projectFile = join(cwd, ".apsolut-cortex", "project.json");
  if (!existsSync(projectFile)) process.exit(0);

  let project: { id: string; name: string } | null = null;
  try {
    project = JSON.parse(readFileSync(projectFile, "utf-8"));
  } catch { process.exit(0); }
  if (!project?.id) process.exit(0);

  try {
    const db = await getDb();
    // Foreign key on sessions.project_id — see post-tool-use.ts.
    await upsertProject(db, { id: project.id, name: project.name, path: cwd });
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

    const compression = await compressSession(observations, projectContext);
    let compressionFailed = compression === null;
    const { memories, summary } = compression ?? { memories: [], summary: "" };

    // Embed *before* opening the write transaction. The first embed() call
    // loads the MiniLM model (seconds on a cold cache); doing that inside the
    // transaction held a write lock the whole time, so every concurrent hook
    // and the MCP server queued on SQLITE_BUSY behind model loading.
    const prepared: Array<{ mem: typeof memories[number]; embedding: Float32Array | null }> = [];
    for (const mem of memories) {
      const textToEmbed = mem.context ? `${mem.content} ${mem.context}` : mem.content;
      let embeddingRaw: Float32Array | null = null;
      try {
        embeddingRaw = await embed(textToEmbed);
      } catch (e) {
        console.error(`[apsolut-cortex] embedding failed for memory: ${e}`);
      }
      prepared.push({ mem, embedding: embeddingRaw });
    }

    // Wrap memory storage + observation promotion + session update in a transaction
    const tx = await db.transaction("write");
    try {
      let stored = 0;
      for (const { mem, embedding: embeddingRaw } of prepared) {
        // Dedup: skip if a very similar memory already exists
        if (embeddingRaw) {
          const dup = await findDuplicate(tx, project.id, embeddingRaw);
          if (dup) {
            await bumpWeight(tx, dup.id);
            continue;
          }
        }

        const weight = mem.category === "correction" ? CORTEX_CORRECTION_WEIGHT : 1.0;

        await insertMemory(tx, {
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

      if (observations.length > 0 && !compressionFailed) {
        await markProjectObservationsPromoted(tx, project.id);
      }

      await upsertSession(tx, {
        id: sessionId,
        project_id: project.id,
        ended_at: Date.now(),
        summary: summary || undefined,
        memories_stored: stored,
      });

      await tx.commit();
    } finally {
      tx.close();
    }

    const { pruned } = await decayAndPrune(db, project.id);
    if (pruned > 0) {
      console.error(`[apsolut-cortex] pruned ${pruned} stale memories`);
    }

    // Raw-transcript retention. raw_messages holds verbatim conversation text
    // including tool output; APSOLUT_CORTEX_RAW_RETENTION_DAYS was documented
    // as a retention window while nothing ever deleted a row.
    try {
      const purged = await purgeRawMessages(db, CORTEX_RAW_RETENTION_DAYS);
      if (purged > 0) {
        console.error(
          `[apsolut-cortex] purged ${purged} raw messages older than ${CORTEX_RAW_RETENTION_DAYS}d`
        );
      }
    } catch (e) {
      console.error(`[apsolut-cortex] raw retention purge skipped: ${e}`);
    }

    // ── M6: final transcript capture + compress tail ────────────────────
    // If transcript_path is present (M6 hook install), persist any
    // remaining raw_messages and compress the slice the cursor hasn't
    // covered yet. This guarantees that on the next session, memory_recall
    // can resolve every memory created this session back to raw context.
    if (transcriptPath) {
      const got = tryAcquireLock(sessionId);
      try {
        const result = await compressSlice({
          db,
          sessionId,
          projectId: project.id,
          projectName: project.name,
          transcriptPath,
          source: "session-end",
        });
        if (result.failed) compressionFailed = true;
        if (result.memories_stored > 0 || result.raw_persisted > 0) {
          console.error(
            `[apsolut-cortex] SessionEnd tail: ${result.raw_persisted} raw msgs, ${result.memories_stored} memories`
          );
        }
      } catch (e) {
        console.error(`[apsolut-cortex] SessionEnd tail compression failed: ${e}`);
      } finally {
        if (got) releaseLock(sessionId);
      }
    }

    if (compressionFailed) {
      console.log(JSON.stringify({ systemMessage: "apsolut-cortex: session compression failed (no provider available) — observations kept for next session. Set ANTHROPIC_API_KEY or run Ollama." }));
    }

    // ── M6 reflector: consolidate large sessions into denser memories ──
    try {
      const ref = await maybeReflect(db, sessionId, project.id, project.name);
      if (ref.triggered) {
        console.error(
          `[apsolut-cortex] reflector: ${ref.reflections_stored} reflections from ${ref.source_memories} memories (${ref.source_tokens} tok)`
        );
      }
    } catch (e) {
      console.error(`[apsolut-cortex] reflector skipped: ${e}`);
    }

    // Auto-export to the Obsidian vault. Wrapped in its own try so a
    // markdown write failure cannot break compression (which is the
    // primary responsibility of this hook).
    //
    // Scoped by default: a full export rewrites every memory of every project
    // on the machine (plus compiled views) on every single session end. The
    // full pass — which is what refreshes the index, by-category, by-project
    // and _health pages — runs at most once a day, or on demand via
    // `apsolut-cortex export`.
    try {
      const fullMarker = join(CORTEX_DIR, "last-full-export");
      let lastFull = 0;
      if (existsSync(fullMarker)) {
        const parsed = Number(readFileSync(fullMarker, "utf-8").trim());
        if (Number.isFinite(parsed)) lastFull = parsed;
      }
      if (Date.now() - lastFull > 24 * 60 * 60 * 1000) {
        await exportVault(db);
        try { writeFileSync(fullMarker, String(Date.now())); } catch { /* best-effort */ }
      } else {
        await exportVault(db, { projectIdFilter: project.id });
      }
    } catch (e) {
      console.error(`[apsolut-cortex] export skipped: ${e}`);
    }

    // Clean up per-session buffer artifacts (cursor + any stray lock).
    clearAllForSession(sessionId);
  } catch (e) {
    console.error(`[apsolut-cortex] session-end error: ${e}`);
    process.exit(0);
  }
}

main();
