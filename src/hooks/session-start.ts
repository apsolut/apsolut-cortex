/**
 * Claude Code hook: SessionStart
 *
 * First session: shows onboarding guide with available tools
 * Returning sessions: shows last session summary + key memories
 *
 * Input:  { session_id: string, cwd: string }
 * Output: formatted context block
 */

import { readFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { getDb, upsertProject, upsertSession, snapshotFileHashes } from "../db.js";
import { TRACKED_FILES } from "../config.js";

function hashFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch { return null; }
}

const W = 60;
const HR = "\u2500".repeat(W - 2);

function top()  { return `\u250C${HR}\u2510`; }
function bot()  { return `\u2514${HR}\u2518`; }
function sep()  { return `\u251C${HR}\u2524`; }
function ln(t: string) {
  const pad = Math.max(0, W - 4 - t.length);
  return `\u2502 ${t}${" ".repeat(pad)} \u2502`;
}
function em() { return ln(""); }

function center(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  return " ".repeat(Math.floor(pad / 2)) + text + " ".repeat(Math.ceil(pad / 2));
}

function wrap(text: string, max: number, limit = 3): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length + w.length + 1 > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > limit ? [...lines.slice(0, limit), "..."] : lines;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
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
  const sessionId = data.session_id ?? crypto.randomUUID();

  const projectFile = join(cwd, ".apsolut-cortex", "project.json");
  if (!existsSync(projectFile)) process.exit(0);

  let project: { id: string; name: string } | null = null;
  try {
    project = JSON.parse(readFileSync(projectFile, "utf-8"));
  } catch { process.exit(0); }
  if (!project?.id) process.exit(0);

  try {
    const db = await getDb();
    await upsertProject(db, { id: project.id, name: project.name, path: cwd });
    await upsertSession(db, { id: sessionId, project_id: project.id });

    // Snapshot config file hashes for change detection
    const hashes = TRACKED_FILES
      .map((f) => ({ path: f, hash: hashFile(join(cwd, f)) }))
      .filter((h): h is { path: string; hash: string } => h.hash !== null);
    if (hashes.length > 0) await snapshotFileHashes(db, project.id, hashes);

    // Check if this is a fresh project (no memories yet)
    const memCountResult = await db.execute({
      sql: "SELECT COUNT(*) as n FROM memories WHERE project_id = ?",
      args: [project.id],
    });
    const memCount = memCountResult.rows[0]?.n as number ?? 0;

    const sessionCountResult = await db.execute({
      sql: "SELECT COUNT(*) as n FROM sessions WHERE project_id = ?",
      args: [project.id],
    });
    const sessionCount = sessionCountResult.rows[0]?.n as number ?? 0;

    const out: string[] = [];

    // Header — always shown
    out.push(top());
    out.push(em());
    out.push(ln(center(`c o r t e x  \u00B7  ${project.name}`, W - 4)));
    out.push(em());

    if (memCount === 0) {
      // ── First time / no memories yet ── show onboarding
      out.push(sep());
      out.push(ln("Welcome! Cortex gives you persistent memory."));
      out.push(ln("It learns from your sessions automatically."));
      out.push(em());
      out.push(sep());
      out.push(ln("What happens automatically:"));
      out.push(em());
      out.push(ln("  \u2022 Tool failures & fixes are captured"));
      out.push(ln("  \u2022 Self-corrections are detected"));
      out.push(ln("  \u2022 Sessions are compressed into memories"));
      out.push(ln("  \u2022 Stale memories decay over time"));
      out.push(em());
      out.push(sep());
      out.push(ln("What you can say to Claude:"));
      out.push(em());
      out.push(ln('  "remember auth"    Search past memories'));
      out.push(ln('  "store: always..." Save something explicitly'));
      out.push(em());
      out.push(sep());
      out.push(ln("MCP tools available to Claude:"));
      out.push(em());
      out.push(ln("  memory_search     Find relevant memories"));
      out.push(ln("  memory_store      Save a memory explicitly"));
      out.push(ln("  memory_rate       Upvote/downvote a memory"));
      out.push(ln("  memory_contradict Delete wrong memories"));
      out.push(ln("  memory_status     Show project stats"));
      out.push(em());
      out.push(sep());
      out.push(ln(`Session ${sessionCount} | 0 memories | learning...`));
      out.push(bot());
    } else {
      // ── Returning session ── show context
      out.push(sep());

      // Last session summary
      const lastSessionResult = await db.execute({
        sql: "SELECT summary, ended_at FROM sessions WHERE project_id = ? AND summary IS NOT NULL ORDER BY ended_at DESC LIMIT 1",
        args: [project.id],
      });
      const lastSession = lastSessionResult.rows[0] as { summary: string; ended_at: number } | undefined;

      if (lastSession?.summary) {
        out.push(ln(`Last session (${formatAgo(lastSession.ended_at)}):`));
        out.push(em());
        for (const line of wrap(lastSession.summary, W - 6)) {
          out.push(ln(`  ${line}`));
        }
        out.push(sep());
      }

      // Key memories — token-budgeted (2000 tokens ~ 8000 chars)
      const TOKEN_BUDGET = 2000;
      const CHARS_PER_TOKEN = 4;
      let budgetRemaining = TOKEN_BUDGET * CHARS_PER_TOKEN;

      const memoriesResult = await db.execute({
        sql: `SELECT content, category FROM memories
              WHERE project_id = ? AND weight > 0.5
              ORDER BY
                CASE WHEN category = 'correction' THEN 0
                     WHEN category = 'decision' THEN 1
                     ELSE 2 END,
                weight DESC,
                created_at DESC
              LIMIT 20`,
        args: [project.id],
      });
      const memories = memoriesResult.rows as Array<{ content: string; category: string }>;

      if (memories.length > 0) {
        out.push(ln("Key memories:"));
        out.push(em());
        for (const m of memories) {
          if (budgetRemaining <= 0) break;
          const icon = m.category === "correction" ? "!" :
                       m.category === "decision"   ? ">" :
                       m.category === "pattern"    ? "~" : "-";
          const maxLen = Math.min(W - 8, budgetRemaining);
          const text = truncate(m.content, maxLen);
          out.push(ln(`  ${icon} ${text}`));
          budgetRemaining -= m.content.length;
        }
        out.push(sep());
      }

      // Stats footer
      out.push(ln(`${memCount} memories | ${sessionCount} sessions`));
      out.push(ln(`Say "remember <topic>" to search memory`));
      out.push(bot());
    }

    process.stdout.write(out.join("\n"));
  } catch (e) {
    process.stderr.write(`[apsolut-cortex] session-start error: ${e}\n`);
    process.exit(0);
  }
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

main();
