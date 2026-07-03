/**
 * Per-session spill buffer + single-flight lock for in-session compression.
 *
 * Layout (under ~/.apsolut-cortex/buffer/):
 *   <session_id>.jsonl   — appended observations awaiting compression
 *   <session_id>.lock    — single-flight marker; absence means free to run
 *   <session_id>.cursor  — last raw-message index already compressed
 *                          (used by compress-worker to advance the window)
 *
 * Lock TTL: 5 minutes. A stale lock past TTL is considered abandoned and
 * gets cleared on next acquire. Hooks crash, processes die — single-user
 * single-machine means we just need "good enough" mutual exclusion.
 *
 * Files survive process kills. Drain happens on SessionEnd or on the next
 * worker invocation, whichever comes first.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";

export const BUFFER_DIR = join(homedir(), ".apsolut-cortex", "buffer");
const LOCK_TTL_MS = 5 * 60 * 1000;

export interface BufferedObservation {
  ts: number;
  /** Marker for what kind of capture this is (observer | reflector | precompact). */
  kind: "observer" | "reflector" | "precompact";
  /** Raw transcript message-index range this observation summarizes, if any. */
  start_msg_idx: number | null;
  end_msg_idx: number | null;
  /** Memory payload — same shape compress.ts already produces. */
  tier: string;
  category: string;
  content: string;
  context: string | null;
}

function ensureDir(): void {
  if (!existsSync(BUFFER_DIR)) mkdirSync(BUFFER_DIR, { recursive: true });
}

function bufferPath(sessionId: string): string {
  return join(BUFFER_DIR, `${sessionId}.jsonl`);
}

function lockPath(sessionId: string): string {
  return join(BUFFER_DIR, `${sessionId}.lock`);
}

function cursorPath(sessionId: string): string {
  return join(BUFFER_DIR, `${sessionId}.cursor`);
}

// ── Observations ──────────────────────────────────────────────────────────────

export function appendObservation(sessionId: string, obs: BufferedObservation): void {
  ensureDir();
  appendFileSync(bufferPath(sessionId), JSON.stringify(obs) + "\n");
}

export function readBuffer(sessionId: string): BufferedObservation[] {
  const path = bufferPath(sessionId);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  const out: BufferedObservation[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as BufferedObservation); } catch { /* skip bad line */ }
  }
  return out;
}

export function drainAndDelete(sessionId: string): BufferedObservation[] {
  const obs = readBuffer(sessionId);
  const path = bufferPath(sessionId);
  if (existsSync(path)) {
    try { unlinkSync(path); } catch { /* best-effort */ }
  }
  return obs;
}

// ── Cursor (last compressed msg_idx, used by worker to advance window) ───────

export function readCursor(sessionId: string): number {
  const path = cursorPath(sessionId);
  if (!existsSync(path)) return 0;
  try {
    const n = parseInt(readFileSync(path, "utf-8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}

export function writeCursor(sessionId: string, msgIdx: number): void {
  ensureDir();
  writeFileSync(cursorPath(sessionId), String(msgIdx));
}

export function clearCursor(sessionId: string): void {
  const path = cursorPath(sessionId);
  if (existsSync(path)) {
    try { unlinkSync(path); } catch { /* best-effort */ }
  }
}

// ── Single-flight lock ───────────────────────────────────────────────────────

/**
 * Try to acquire the per-session compression lock. Returns true if we got
 * it (caller must releaseLock when done), false if another worker holds
 * a fresh lock. Stale locks (> LOCK_TTL_MS old) are treated as abandoned.
 */
export function tryAcquireLock(sessionId: string): boolean {
  ensureDir();
  const path = lockPath(sessionId);

  // Clear stale lock first.
  if (existsSync(path)) {
    try {
      const age = Date.now() - statSync(path).mtimeMs;
      if (age > LOCK_TTL_MS) {
        try { unlinkSync(path); } catch { /* ignore */ }
      } else {
        return false;
      }
    } catch {
      // statSync failed — try to recover by treating as stale.
      try { unlinkSync(path); } catch { /* ignore */ }
    }
  }

  // Exclusive create — 'wx' throws EEXIST if another process won the race
  // between the staleness check above and this write. Works on all
  // platforms (Windows included).
  try {
    writeFileSync(path, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(sessionId: string): void {
  const path = lockPath(sessionId);
  if (existsSync(path)) {
    try { unlinkSync(path); } catch { /* best-effort */ }
  }
}

/**
 * Force-release any lock for a session — used by SessionEnd to make sure
 * we are not leaving stale lockfiles around between sessions.
 */
export function clearAllForSession(sessionId: string): void {
  releaseLock(sessionId);
  clearCursor(sessionId);
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export function listBufferedSessions(): string[] {
  if (!existsSync(BUFFER_DIR)) return [];
  return readdirSync(BUFFER_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(/\.jsonl$/, ""));
}
