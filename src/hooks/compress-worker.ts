/**
 * Detached background compression worker.
 *
 * Invoked by post-tool-use.ts via `spawn(... { detached: true })` when
 * the conversation token budget is exceeded. Reads its job payload from
 * stdin (session_id, cwd, transcript_path) so callers don't have to
 * worry about argv quoting.
 *
 * Single-flight: tryAcquireLock returns false if another worker (or
 * PreCompact) is already running for this session — in that case we
 * exit quietly. A future trigger will pick up the slack.
 *
 * Critical property: this process is detached from Claude Code's hook
 * timeout. We can spend tens of seconds in Anthropic without blocking
 * the user's tool execution.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getDb } from "../db.js";
import { compressSlice } from "../compress-runner.js";
import { tryAcquireLock, releaseLock } from "../buffer.js";

async function main(): Promise<void> {
  const raw = await new Promise<string>((resolve) => {
    let d = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c: string) => { d += c; });
    process.stdin.on("end", () => resolve(d));
  });

  let data: { session_id?: string; cwd?: string; transcript_path?: string } = {};
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  const cwd = data.cwd;
  const sessionId = data.session_id;
  const transcriptPath = data.transcript_path;
  if (!cwd || !sessionId || !transcriptPath) process.exit(0);

  const projectFile = join(cwd, ".apsolut-cortex", "project.json");
  if (!existsSync(projectFile)) process.exit(0);

  let project: { id: string; name: string } | null = null;
  try { project = JSON.parse(readFileSync(projectFile, "utf-8")); } catch { process.exit(0); }
  if (!project?.id) process.exit(0);

  // Single-flight: another worker or PreCompact may be mid-run. Just exit.
  if (!tryAcquireLock(sessionId)) {
    process.stderr.write(`[apsolut-cortex] compress-worker: lock held, skipping\n`);
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
      source: "compress-worker",
    });
    if (result.memories_stored > 0 || result.duplicates_bumped > 0) {
      process.stderr.write(
        `[apsolut-cortex] compress-worker: ${result.memories_stored} new memories, ${result.duplicates_bumped} dup-bumped (cursor=${result.new_cursor})\n`
      );
    }
  } catch (e) {
    process.stderr.write(`[apsolut-cortex] compress-worker error: ${e}\n`);
  } finally {
    releaseLock(sessionId);
  }
}

main().catch(() => process.exit(0));
