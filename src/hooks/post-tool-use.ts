/**
 * Claude Code hook: PostToolUse + PostToolUseFailure
 *
 * Captures tool failures and config reads as raw observations.
 * Compressed into memories at session end — not stored as memories directly.
 *
 * Registered for both events: PostToolUseFailure (Claude Code ≥ 2.1.x)
 * fires only on failed tool calls with the error in tool_response/error,
 * so failure capture no longer depends on sniffing error strings out of
 * successful-call payloads. When the event is a failure and the classifier
 * finds nothing, we synthesize an observation from the error directly.
 *
 * Input: { session_id, cwd, hook_event_name, prompt_id, tool_name,
 *          tool_input, tool_response, error? }
 */

import { readFileSync, existsSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import { getDb, upsertSession, insertObservation } from "../db.js";
import { classifyToolUse } from "../compress.js";
import { stripPrivate } from "../privacy.js";
import { countTranscriptTokens } from "../tokens.js";
import { compressSlice } from "../compress-runner.js";
import { tryAcquireLock, releaseLock, readCursor } from "../buffer.js";
import {
  CORTEX_OBSERVE_THRESHOLD,
  CORTEX_OBSERVE_BLOCK_MULT,
} from "../config.js";

async function main() {
  const raw = await new Promise<string>((resolve) => {
    let d = ""; process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c: string) => d += c);
    process.stdin.on("end", () => resolve(d));
  });
  let data: {
    session_id?: string;
    cwd?: string;
    transcript_path?: string;
    hook_event_name?: string;
    prompt_id?: string;
    tool_name?: string;
    tool_input?: unknown;
    tool_response?: unknown;
    error?: unknown;
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
    const db = await getDb();
    await upsertSession(db, { id: sessionId, project_id: project.id });

    const isFailureEvent = data.hook_event_name === "PostToolUseFailure";
    let result = classifyToolUse(
      data.tool_name ?? "",
      data.tool_input,
      isFailureEvent ? (data.error ?? data.tool_response) : data.tool_response
    );

    // PostToolUseFailure is authoritative: the call failed even if the
    // classifier's error-string heuristics didn't recognize the payload.
    if (isFailureEvent && !result?.worth_storing) {
      const errText = JSON.stringify(data.error ?? data.tool_response ?? "")
        .replace(/^"|"$/g, "").slice(0, 200);
      if (errText.length > 10) {
        result = {
          worth_storing: true,
          category: "failure",
          summary: `Tool ${data.tool_name ?? "unknown"} failed: ${errText}`,
        };
      }
    }

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
            prompt_id: data.prompt_id,
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

    // ── M6: token-budget compression trigger ────────────────────────────
    // The original Phase 1 hook stopped here. M6 adds: if the conversation
    // is getting long, fork a detached worker (or fall back to synchronous
    // compression if it's already past the safety threshold). transcript_path
    // is only present when the user has installed the M6 hook set.
    const transcriptPath = data.transcript_path;
    if (transcriptPath) {
      // Count only the tokens accumulated since the last compression
      // (cursor). Counting the whole transcript would keep the trigger
      // permanently armed once crossed — one compression per tool use.
      const tokens = countTranscriptTokens(transcriptPath, readCursor(sessionId));
      const blockThreshold = CORTEX_OBSERVE_THRESHOLD * CORTEX_OBSERVE_BLOCK_MULT;

      if (tokens >= blockThreshold) {
        // Synchronous safety net — block tool execution briefly to make
        // sure we capture before Claude Code compacts on its own.
        if (tryAcquireLock(sessionId)) {
          try {
            await compressSlice({
              db,
              sessionId,
              projectId: project.id,
              projectName: project.name,
              transcriptPath,
              source: "compress-worker",
            });
          } catch (e) {
            process.stderr.write(`[apsolut-cortex] sync compression failed: ${e}\n`);
          } finally {
            releaseLock(sessionId);
          }
        }
      } else if (tokens >= CORTEX_OBSERVE_THRESHOLD) {
        // Async path — spawn detached worker and exit fast.
        // process.argv[1] is the cli.{ts,js} script that the dispatcher
        // is currently running, so re-invoking it with hook:compress-worker
        // works in both dev (bun) and dist (node) modes.
        try {
          const child = spawn(
            process.execPath,
            [process.argv[1], "hook:compress-worker"],
            // windowsHide: a detached child on Windows gets its own console
            // window otherwise — it would flash on every trigger.
            { detached: true, stdio: ["pipe", "ignore", "ignore"], windowsHide: true }
          );
          const payload = JSON.stringify({
            session_id: sessionId,
            cwd,
            transcript_path: transcriptPath,
          });
          child.stdin?.write(payload);
          child.stdin?.end();
          child.unref();
        } catch (e) {
          process.stderr.write(`[apsolut-cortex] async worker spawn failed: ${e}\n`);
        }
      }
    }
  } catch {
    process.exit(0);
  }
}

main();
