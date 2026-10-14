/**
 * Claude Code hook: PreCompact
 *
 * Fires synchronously just before Claude Code compacts its own context.
 * This is the highest-value capture moment — anything not persisted by
 * the time this returns is about to be irrecoverably summarized away.
 *
 * We run a full-fidelity compression here regardless of token budget.
 * Single-flight is still respected (a background worker may already be
 * mid-compression) — if it is, we wait briefly, then take over.
 *
 * Registered with `asyncRewake: true` (Claude Code ≥ 2.1.196): the hook
 * runs in the background without delaying compaction, and a compression
 * failure (exit code 2) wakes Claude with our stderr so the loss is
 * surfaced instead of silent. On older Claude Code the flag is ignored
 * and the hook simply runs synchronously as before. The transcript file
 * on disk survives compaction, so background execution loses nothing.
 *
 * Input: { session_id, cwd, transcript_path, ... }
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getDb } from "../db.js";
import { compressSlice } from "../compress-runner.js";
import {
  acquireLockWaiting,
  releaseLock,
} from "../buffer.js";

async function main(): Promise<void> {
  const raw = await new Promise<string>((resolve) => {
    let d = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c: string) => { d += c; });
    process.stdin.on("end", () => resolve(d));
  });

  let data: { session_id?: string; cwd?: string; transcript_path?: string } = {};
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  const cwd = data.cwd ?? process.cwd();
  const sessionId = data.session_id;
  const transcriptPath = data.transcript_path;
  if (!sessionId || !transcriptPath) process.exit(0);

  const projectFile = join(cwd, ".apsolut-cortex", "project.json");
  if (!existsSync(projectFile)) process.exit(0);

  let project: { id: string; name: string } | null = null;
  try { project = JSON.parse(readFileSync(projectFile, "utf-8")); } catch { process.exit(0); }
  if (!project?.id) process.exit(0);

  // Wait for any in-flight worker to finish. If it is still running after
  // the wait we do NOT barge in: the worker is compressing the same window,
  // so proceeding would duplicate the provider call and race its cursor
  // write. Previously the wait expired and we continued regardless, then
  // deleted the worker's lock on the way out.
  const token = await acquireLockWaiting(sessionId, 3000);
  if (!token) {
    process.stderr.write(
      "[apsolut-cortex] PreCompact: a compression worker is already running this window — deferring to it\n"
    );
    process.exit(0);
  }

  try {
    const db = await getDb();
    const result = await compressSlice({
      db,
      sessionId,
      projectId: project.id,
      projectName: project.name,
      transcriptPath,
      source: "precompact",
    });
    process.stderr.write(
      `[apsolut-cortex] PreCompact captured: ${result.raw_persisted} raw msgs, ${result.memories_stored} memories (+${result.duplicates_bumped} bumped)\n`
    );
  } catch (e) {
    process.stderr.write(
      `[apsolut-cortex] PreCompact compression failed — this compaction window was NOT persisted to memory: ${e}\n`
    );
    releaseLock(sessionId, token);
    // Exit 2 → with asyncRewake, Claude is woken and shown the stderr
    // above; it can retry via the MCP tools or warn the user.
    process.exit(2);
  } finally {
    releaseLock(sessionId, token);
  }
}

main().catch(() => process.exit(0));
