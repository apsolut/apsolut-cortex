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
 * Input: { session_id, cwd, transcript_path, ... }
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getDb } from "../db.js";
import { compressSlice } from "../compress-runner.js";
import {
  tryAcquireLock,
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

  // Wait up to 3 seconds for any in-flight worker to release its lock,
  // then force-acquire (the lock has a 5-min TTL anyway, but for the
  // PreCompact emergency capture we do not want to skip just because
  // something else is mid-run).
  const deadline = Date.now() + 3000;
  while (!tryAcquireLock(sessionId) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
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
    process.stderr.write(`[apsolut-cortex] PreCompact error: ${e}\n`);
  } finally {
    releaseLock(sessionId);
  }
}

main().catch(() => process.exit(0));
