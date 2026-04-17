/**
 * Claude Code hook: PostToolUse
 *
 * Captures tool failures and config reads as raw observations.
 * Compressed into memories at session end — not stored as memories directly.
 *
 * Input: { session_id, cwd, tool_name, tool_input, tool_response }
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getDb, upsertSession, insertObservation } from "../db.js";
import { classifyToolUse } from "../compress.js";
import { stripPrivate } from "../privacy.js";

async function main() {
  const raw = await new Promise<string>((resolve) => {
    let d = ""; process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c: string) => d += c);
    process.stdin.on("end", () => resolve(d));
  });
  let data: {
    session_id?: string;
    cwd?: string;
    tool_name?: string;
    tool_input?: unknown;
    tool_response?: unknown;
  } = {};
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
    await upsertSession(db, { id: sessionId, project_id: project.id });

    const result = classifyToolUse(
      data.tool_name ?? "",
      data.tool_input,
      data.tool_response
    );

    if (result?.worth_storing) {
      const content = stripPrivate(result.summary);
      if (content) {
        // Skip duplicate observations in the same session
        const existing = await db.execute({
          sql: "SELECT 1 FROM observations WHERE session_id = ? AND content = ? LIMIT 1",
          args: [sessionId, content],
        });
        if (existing.rows.length === 0) {
          await insertObservation(db, {
            session_id: sessionId,
            project_id: project.id,
            tool_name: data.tool_name,
            content,
            category: result.category,
          });
        }
      }

      if (result.category === "correction") {
        await db.execute({
          sql: "UPDATE sessions SET tool_failures = tool_failures + 1 WHERE id = ?",
          args: [sessionId],
        });
      }
    }
  } catch {
    process.exit(0);
  }
}

main();
