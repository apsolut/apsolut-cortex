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
 * Cost discipline: this hook fires after every single tool call, in every
 * project. Only `fs`/`path` are imported at module load; the database
 * client, tokenizer and compression pipeline are behind dynamic imports
 * that run *after* the `.apsolut-cortex/project.json` check. In a project
 * that never ran `init`, this process does nothing but parse stdin and
 * stat one path.
 *
 * Input: { session_id, cwd, hook_event_name, prompt_id, tool_name,
 *          tool_input, tool_response, error? }
 */

import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { classifyToolUse } from "../classify.js";

/**
 * Locate the CLI entry point to re-invoke for the detached worker.
 *
 * `process.argv[1]` is the right answer when the hook ran through the
 * dispatcher (`apsolut-cortex hook:post-tool-use` → dist/cli.js). When the
 * bundled `scripts/post-tool-use.js` is invoked directly, argv[1] is this
 * script — re-invoking it would spawn another PostToolUse hook instead of a
 * worker, silently losing every async compression. Fall back to the sibling
 * worker bundle in that case.
 */
function resolveWorkerCommand(): { script: string; args: string[] } | null {
  const entry = process.argv[1];
  if (!entry) return null;
  const name = basename(entry);
  if (name.startsWith("cli.")) return { script: entry, args: ["hook:compress-worker"] };

  const sibling = entry.replace(/post-tool-use\.(js|ts)$/, "compress-worker.$1");
  if (sibling !== entry && existsSync(sibling)) return { script: sibling, args: [] };
  return null;
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

  const transcriptPath = data.transcript_path;

  // Nothing to store and no transcript to measure → skip the DB entirely.
  if (!result?.worth_storing && !transcriptPath) process.exit(0);

  try {
    const [{ getDb, upsertProject, upsertSession, insertObservation }, { stripPrivate }] =
      await Promise.all([import("../db.js"), import("../privacy.js")]);

    const db = await getDb();
    // sessions.project_id is a foreign key. When hooks are wired into an
    // already-running session, SessionStart never fired, so the project row
    // does not exist yet and the session INSERT fails — taking the whole
    // capture with it, silently. Upsert the project first; it is one
    // statement and idempotent.
    await upsertProject(db, { id: project.id, name: project.name, path: cwd });
    await upsertSession(db, { id: sessionId, project_id: project.id });

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
    if (transcriptPath) {
      const [{ countTranscriptTokens }, { readCursor }, config] = await Promise.all([
        import("../tokens.js"),
        import("../buffer.js"),
        import("../config.js"),
      ]);

      // Count only the tokens accumulated since the last compression
      // (cursor). Counting the whole transcript would keep the trigger
      // permanently armed once crossed — one compression per tool use.
      const tokens = countTranscriptTokens(transcriptPath, readCursor(sessionId));
      const blockThreshold =
        config.CORTEX_OBSERVE_THRESHOLD * config.CORTEX_OBSERVE_BLOCK_MULT;

      if (tokens >= blockThreshold) {
        // Synchronous safety net — block tool execution briefly to make
        // sure we capture before Claude Code compacts on its own.
        const { tryAcquireLock, releaseLock } = await import("../buffer.js");
        const token = tryAcquireLock(sessionId);
        if (token) {
          try {
            const { compressSlice } = await import("../compress-runner.js");
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
            releaseLock(sessionId, token);
          }
        }
      } else if (tokens >= config.CORTEX_OBSERVE_THRESHOLD) {
        // Async path — spawn detached worker and exit fast.
        try {
          const target = resolveWorkerCommand();
          if (!target) {
            process.stderr.write(
              `[apsolut-cortex] cannot locate worker entry point from ${process.argv[1]}\n`
            );
          } else {
            const { spawn } = await import("child_process");
            const child = spawn(
              process.execPath,
              [target.script, ...target.args],
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
          }
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
