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

// ── Stop-hook scan cursor ────────────────────────────────────────────────────

/**
 * How many transcript messages the Stop hook has already scanned for
 * self-corrections. Stop fires on every turn and the transcript only grows,
 * so without this the whole conversation is re-read and re-regexed each turn —
 * O(turns²) work per session, and the dedup query had to catch every repeat.
 */
export function readScanCursor(sessionId: string): number {
  const path = join(BUFFER_DIR, `${sessionId}.scan`);
  if (!existsSync(path)) return 0;
  try {
    const n = parseInt(readFileSync(path, "utf-8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}

export function writeScanCursor(sessionId: string, msgCount: number): void {
  ensureDir();
  try {
    writeFileSync(join(BUFFER_DIR, `${sessionId}.scan`), String(msgCount));
  } catch { /* best-effort — worst case we rescan next turn */ }
}

// ── Single-flight lock ───────────────────────────────────────────────────────

/**
 * Opaque proof that the holder owns the lock. Pass it back to releaseLock.
 */
export type LockToken = string;

function newToken(): LockToken {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Try to acquire the per-session compression lock. Returns an ownership token
 * on success and null when another worker holds a fresh lock. Stale locks
 * (> LOCK_TTL_MS old) are treated as abandoned.
 *
 * The token exists because releases used to be unconditional: any process
 * could delete any lock. PreCompact force-proceeded after its wait and then
 * released in a `finally`, and SessionEnd deleted whatever was left as
 * "cleanup" — so a live worker's lock was routinely removed underneath it and
 * two processes compressed the same window, double-billing the provider and
 * racing each other's cursor write.
 */
export function tryAcquireLock(sessionId: string): LockToken | null {
  ensureDir();
  const path = lockPath(sessionId);

  // Clear stale lock first.
  if (existsSync(path)) {
    try {
      const age = Date.now() - statSync(path).mtimeMs;
      if (age > LOCK_TTL_MS) {
        try { unlinkSync(path); } catch { /* ignore */ }
      } else {
        return null;
      }
    } catch {
      // statSync failed — try to recover by treating as stale.
      try { unlinkSync(path); } catch { /* ignore */ }
    }
  }

  // Exclusive create — 'wx' throws EEXIST if another process won the race
  // between the staleness check above and this write. Works on all
  // platforms (Windows included).
  const token = newToken();
  try {
    writeFileSync(path, token, { flag: "wx" });
    return token;
  } catch {
    return null;
  }
}

/**
 * Wait up to `timeoutMs` for the lock, polling. Returns a token or null.
 * Used where giving up means losing a capture (PreCompact, SessionEnd tail)
 * rather than merely skipping an optimization.
 */
export async function acquireLockWaiting(
  sessionId: string,
  timeoutMs: number,
  pollMs = 200
): Promise<LockToken | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const token = tryAcquireLock(sessionId);
    if (token) return token;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** True when the lock file exists and is still within its TTL. */
export function lockHeld(sessionId: string): boolean {
  const path = lockPath(sessionId);
  if (!existsSync(path)) return false;
  try {
    return Date.now() - statSync(path).mtimeMs <= LOCK_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Release the lock, but only if `token` is the one that acquired it. Without
 * a token this is a no-op — a caller that never acquired cannot release.
 */
export function releaseLock(sessionId: string, token: LockToken | null): void {
  if (!token) return;
  const path = lockPath(sessionId);
  if (!existsSync(path)) return;
  try {
    if (readFileSync(path, "utf-8").trim() !== token) return; // not ours
    unlinkSync(path);
  } catch { /* best-effort */ }
}

/**
 * Delete a lock regardless of ownership.
 *
 * The escape hatch, not the normal path: a machine that hard-powers-off
 * inside a compression leaves a lock whose TTL has not yet expired. Used by
 * maintenance tooling and tests, never by the hooks.
 */
export function forceClearLock(sessionId: string): void {
  const path = lockPath(sessionId);
  if (existsSync(path)) {
    try { unlinkSync(path); } catch { /* best-effort */ }
  }
}

/**
 * Per-session cleanup at SessionEnd. Deliberately does NOT touch the lock:
 * if a detached worker is still mid-compression, its lock is load-bearing,
 * and the TTL already reclaims genuinely abandoned ones.
 */
export function clearAllForSession(sessionId: string): void {
  clearCursor(sessionId);
  // Per-session side files: Stop's scan cursor and UserPromptSubmit's
  // already-injected id set. Left behind, these accumulate one pair per
  // session forever in ~/.apsolut-cortex/buffer/.
  for (const suffix of [".scan", ".injected.json"]) {
    const path = join(BUFFER_DIR, `${sessionId}${suffix}`);
    if (existsSync(path)) {
      try { unlinkSync(path); } catch { /* best-effort */ }
    }
  }
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export function listBufferedSessions(): string[] {
  if (!existsSync(BUFFER_DIR)) return [];
  return readdirSync(BUFFER_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(/\.jsonl$/, ""));
}
