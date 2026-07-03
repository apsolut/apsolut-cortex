/**
 * Claude Code hook: Stop
 *
 * Scans the transcript for self-correction patterns and stores them as
 * observations.
 *
 * Input: { session_id, cwd, transcript_path }
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getDb, upsertSession, insertObservation } from "../db.js";
import { stripPrivate } from "../privacy.js";
import { readTranscript } from "../transcript.js";

const CORRECTION_PATTERNS = [
  /actually,?\s+(?:the|it'?s?|that'?s?)\s+(.{20,150})/gi,
  /(?:my mistake|i was wrong|incorrect)[^.]*[.!]\s*(.{20,150})/gi,
  /(?:wait|oops)[,.]?\s+(.{20,150})/gi,
  /(?:turns? out|it seems?)\s+(.{20,150})/gi,
  /(?:should(?:n'?t)? have|shouldn'?t).{0,30}[—–-]\s*(.{20,150})/gi,
  /(?:the correct|correct(?:ly)?)\s+(?:way|path|file|approach)\s+is\s+(.{20,150})/gi,
];

function extractCorrections(transcript: string): string[] {
  const found: string[] = [];
  for (const pattern of CORRECTION_PATTERNS) {
    let match;
    while ((match = pattern.exec(transcript)) !== null) {
      const text = match[1]?.trim();
      if (text && text.length > 20 && text.length < 200) {
        found.push(`Self-correction: ${text}`);
      }
    }
  }
  return [...new Set(found)].slice(0, 5);
}

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

  // Claude Code passes transcript_path (a JSONL file), not inline text.
  // Self-corrections are Claude's own, so scan assistant messages only.
  let transcriptText = data.transcript ?? "";
  if (!transcriptText && data.transcript_path) {
    transcriptText = readTranscript(data.transcript_path)
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("\n");
  }
  if (!transcriptText) process.exit(0);
  const cleaned = stripPrivate(transcriptText);
  if (!cleaned) process.exit(0);

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
    const db = await getDb();
    await upsertSession(db, { id: sessionId, project_id: project.id });

    const corrections = extractCorrections(cleaned);
    for (const correction of corrections) {
      // Stop fires every turn and the transcript accumulates, so the same
      // correction resurfaces on each scan — skip ones already stored.
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
  } catch {
    process.exit(0);
  }
}

main();
