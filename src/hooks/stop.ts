/**
 * Claude Code hook: Stop
 *
 * Scans the transcript for self-correction patterns and stores them as
 * observations.
 *
 * Two cost controls, both mattering because Stop fires on every turn:
 *   - heavy modules load only after the project check (dynamic import);
 *   - only messages after the scan cursor are read, so a long session does
 *     not re-scan its whole history on every turn.
 *
 * Input: { session_id, cwd, transcript_path }
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { extractCorrections } from "../prompt-cues.js";

async function main() {
  const raw = await new Promise<string>((resolve) => {
    let d = ""; process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c: string) => d += c);
    process.stdin.on("end", () => resolve(d));
  });
  let data: {
    session_id?: string;
    cwd?: string;
    transcript?: string;
    transcript_path?: string;
  } = {};
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  const cwd = data.cwd ?? process.cwd();
  const sessionId = data.session_id ?? "unknown";

  const projectFile = join(cwd, ".apsolut-cortex", "project.json");
  if (!existsSync(projectFile)) process.exit(0);

  let project: { id: string; name: string } | null = null;
  try {
    project = JSON.parse(readFileSync(projectFile, "utf-8"));
  } catch { process.exit(0); }
  if (!project?.id) process.exit(0);

  try {
    const [{ stripPrivate }, { readScanCursor, writeScanCursor }] = await Promise.all([
      import("../privacy.js"),
      import("../buffer.js"),
    ]);

    // Claude Code passes transcript_path (a JSONL file), not inline text.
    // Self-corrections are Claude's own, so scan assistant messages only.
    let transcriptText = data.transcript ?? "";
    let scanned = 0;
    if (!transcriptText && data.transcript_path) {
      const { readTranscript } = await import("../transcript.js");
      const all = readTranscript(data.transcript_path);
      const from = readScanCursor(sessionId);
      scanned = all.length;
      transcriptText = all
        .filter((m) => m.msg_idx >= from && m.role === "assistant")
        .map((m) => m.content)
        .join("\n");
    }
    if (!transcriptText) {
      if (scanned > 0) writeScanCursor(sessionId, scanned);
      process.exit(0);
    }
    const cleaned = stripPrivate(transcriptText);
    if (!cleaned) {
      if (scanned > 0) writeScanCursor(sessionId, scanned);
      process.exit(0);
    }

    const corrections = extractCorrections(cleaned);
    if (corrections.length > 0) {
      const { getDb, upsertProject, upsertSession, insertObservation } = await import("../db.js");
      const db = await getDb();
      // The session row has a foreign key to projects; if SessionStart never
      // ran (hooks wired mid-session), inserting it would fail and the
      // observation would be lost silently.
      await upsertProject(db, { id: project.id, name: project.name, path: cwd });
      await upsertSession(db, { id: sessionId, project_id: project.id });

      for (const correction of corrections) {
        // Cheap second line of defense: the cursor means we normally see each
        // message once, but a cursor reset (crash, cleared buffer) must not
        // duplicate observations.
        const existing = await db.execute({
          sql: "SELECT 1 FROM observations WHERE session_id = ? AND content = ? LIMIT 1",
          args: [sessionId, correction],
        });
        if (existing.rows.length > 0) continue;
        await insertObservation(db, {
          session_id: sessionId,
          project_id: project.id,
          content: correction,
          category: "correction",
        });
      }
    }

    if (scanned > 0) writeScanCursor(sessionId, scanned);
  } catch {
    process.exit(0);
  }
}

main();
