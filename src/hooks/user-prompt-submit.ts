/**
 * Claude Code hook: UserPromptSubmit (requires Claude Code ≥ 2.1.196 for
 * prompt_id; the hook itself works on any version that has the event).
 *
 * Two jobs, both cheap (SQLite only — no embedder, no LLM):
 *
 * 1. Correction detection — if the prompt reads like pushback ("no,",
 *    "that's wrong", "I already told you"…), record a correction
 *    observation, linked via BM25 to the stored memory it most likely
 *    contradicts. Session-end compression turns confirmed ones into
 *    correction memories / supersessions.
 *
 * 2. Contextual injection — for normal prompts, if a high-weight
 *    correction/decision memory matches the prompt terms and wasn't
 *    already injected this session, return it as additionalContext.
 *    Disable with CORTEX_PROMPT_INJECT=0.
 *
 * This hook must NEVER exit non-zero: exit 2 on UserPromptSubmit blocks
 * the user's prompt. Every failure path is a silent exit 0.
 *
 * Input:  { session_id, cwd, text | prompt, prompt_id }
 * Output: optional { hookSpecificOutput: { additionalContext } }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { Memory } from "../db.js";
import { isPushback, contentTerms } from "../prompt-cues.js";
import { BUFFER_DIR } from "../buffer.js";
import { frameMemoryList } from "../framing.js";

const INJECT_LIMIT = 2;
const INJECT_MIN_WEIGHT = 1.0;

function injectedPath(sessionId: string): string {
  return join(BUFFER_DIR, `${sessionId}.injected.json`);
}

function readInjected(sessionId: string): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(injectedPath(sessionId), "utf-8")));
  } catch {
    return new Set();
  }
}

function writeInjected(sessionId: string, ids: Set<string>): void {
  try {
    if (!existsSync(BUFFER_DIR)) mkdirSync(BUFFER_DIR, { recursive: true });
    writeFileSync(injectedPath(sessionId), JSON.stringify([...ids]));
  } catch {
    // best-effort — worst case a memory is injected twice
  }
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
    text?: string;
    prompt?: string;
    prompt_id?: string;
  } = {};
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  const cwd = data.cwd ?? process.cwd();
  const sessionId = data.session_id ?? "unknown";
  const promptText = (data.text ?? data.prompt ?? "").trim();
  if (!promptText) process.exit(0);

  const projectFile = join(cwd, ".apsolut-cortex", "project.json");
  if (!existsSync(projectFile)) process.exit(0);

  let project: { id: string; name: string } | null = null;
  try { project = JSON.parse(readFileSync(projectFile, "utf-8")); } catch { process.exit(0); }
  if (!project?.id) process.exit(0);

  try {
    // Heavy modules after the project check — see post-tool-use.ts.
    const [{ getDb, upsertProject, upsertSession, insertObservation, searchBM25 }, { stripPrivate }] =
      await Promise.all([import("../db.js"), import("../privacy.js")]);

    const db = await getDb();
    await upsertProject(db, { id: project.id, name: project.name, path: cwd });
    await upsertSession(db, { id: sessionId, project_id: project.id });

    const terms = contentTerms(promptText);
    const candidates: Memory[] = terms.length > 0
      ? await searchBM25(db, project.id, terms.join(" "), 5)
      : [];

    if (isPushback(promptText)) {
      const contradicted = candidates[0];
      const snippet = stripPrivate(promptText.slice(0, 300));
      if (snippet) {
        const content = contradicted
          ? `User pushback: "${snippet}" — may contradict memory ${contradicted.id}: "${contradicted.content.slice(0, 150)}"`
          : `User pushback: "${snippet}"`;
        await insertObservation(db, {
          session_id: sessionId,
          project_id: project.id,
          content,
          category: "correction",
          prompt_id: data.prompt_id,
        });
        await db.execute({
          sql: "UPDATE sessions SET tool_failures = tool_failures + 1 WHERE id = ?",
          args: [sessionId],
        });
      }
      process.exit(0);
    }

    // Contextual injection for normal prompts
    if (process.env.CORTEX_PROMPT_INJECT === "0") process.exit(0);
    const already = readInjected(sessionId);
    const picks = candidates
      .filter((m) =>
        (m.category === "correction" || m.category === "decision") &&
        m.weight >= INJECT_MIN_WEIGHT &&
        !already.has(m.id)
      )
      .slice(0, INJECT_LIMIT);
    if (picks.length === 0) process.exit(0);

    picks.forEach((m) => already.add(m.id));
    writeInjected(sessionId, already);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: frameMemoryList(
          picks,
          "[apsolut-cortex] Stored memories relevant to this prompt:"
        ),
      },
    }));
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
