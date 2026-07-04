/**
 * Backup, restore, and re-encryption for the cortex DB.
 *
 * Backup is a physical file copy with atomic rename — safe because libSQL
 * is the only writer to ~/.apsolut-cortex/memory.db (we serialize via a
 * single Node/Bun process). When encryption is enabled the file is
 * already encrypted at rest, so the copy IS the encrypted snapshot.
 *
 * Re-encryption copies row-by-row from an unencrypted source DB into a
 * fresh encrypted DB, then atomically swaps. The original file is moved
 * to ~/.apsolut-cortex/backup/pre-encrypt-<ts>.db first and never
 * deleted by this code.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "fs";

// Windows holds file handles after libSQL's .close() returns — the OS
// handle is only released when the client is garbage-collected — so
// unlink/rename can fail with EBUSY. Nudge GC and retry with backoff.
function releaseStaleHandles(): void {
  (globalThis as { Bun?: { gc: (force: boolean) => void } }).Bun?.gc(true);
}

async function unlinkRetry(path: string, attempts = 10): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try { unlinkSync(path); return; }
    catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOENT") throw e;
      if (code === "ENOENT") return;
      releaseStaleHandles();
      await new Promise((r) => setTimeout(r, 25 + i * 25));
    }
  }
  unlinkSync(path); // final attempt, let it throw
}

async function renameRetry(from: string, to: string, attempts = 10): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try { renameSync(from, to); return; }
    catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code !== "EBUSY" && code !== "EPERM") throw e;
      releaseStaleHandles();
      await new Promise((r) => setTimeout(r, 25 + i * 25));
    }
  }
  renameSync(from, to);
}
import { join } from "path";
import { createClient, type Client } from "@libsql/client";
import { CORTEX_DIR, DB_PATH } from "./db.js";
import { runMigrations } from "./migrations/runner.js";

export const BACKUP_DIR = join(CORTEX_DIR, "backup");

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureBackupDir(): void {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Physical file copy of memory.db to backup/<label>-<ts>.db. Returns the
 * absolute path of the snapshot. Throws if the source does not exist.
 */
export function snapshot(label = "manual"): string {
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `[apsolut-cortex] no DB at ${DB_PATH} — nothing to back up`
    );
  }
  ensureBackupDir();
  const dest = join(BACKUP_DIR, `${label}-${timestamp()}.db`);
  copyFileSync(DB_PATH, dest);
  // WAL mode (migration 001) can leave committed rows in the -wal sidecar
  // when the last writer exited without a clean close. Copy it alongside
  // so the snapshot doesn't silently miss those transactions.
  const wal = `${DB_PATH}-wal`;
  if (existsSync(wal)) {
    try { copyFileSync(wal, `${dest}-wal`); } catch { /* best-effort */ }
  }
  return dest;
}

export interface BackupListEntry {
  path: string;
  bytes: number;
  mtime: Date;
}

export function listBackups(): BackupListEntry[] {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const path = join(BACKUP_DIR, f);
      const s = statSync(path);
      return { path, bytes: s.size, mtime: s.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/**
 * Restore a snapshot over the live DB. Caller is responsible for ensuring
 * no other process is holding the DB open — for a single-user setup that
 * means quitting Claude Code or any running `bun run dev:mcp` shell.
 *
 * Always takes a pre-restore safety snapshot first so a wrong --yes can
 * be undone.
 */
export function restore(snapshotPath: string): { restored: string; safetyBackup: string | null } {
  if (!existsSync(snapshotPath)) {
    throw new Error(`[apsolut-cortex] snapshot not found: ${snapshotPath}`);
  }
  let safetyBackup: string | null = null;
  if (existsSync(DB_PATH)) {
    safetyBackup = snapshot("pre-restore");
  }
  // copyFile + rename pattern for atomicity on Windows where rename over an
  // open file may fail. copyFile to a tmp path, then rename.
  const tmp = `${DB_PATH}.restoring`;
  copyFileSync(snapshotPath, tmp);
  // Remove WAL/SHM sidecars so libSQL rebuilds them on next open.
  for (const ext of ["-wal", "-shm"]) {
    const sidecar = `${DB_PATH}${ext}`;
    if (existsSync(sidecar)) {
      try { unlinkSync(sidecar); } catch {}
    }
  }
  if (existsSync(DB_PATH)) {
    // Use retry helpers in case a stale handle is still around.
    // Sync call inside the API because restore is a one-shot from CLI.
    let attempts = 0;
    while (existsSync(DB_PATH) && attempts < 10) {
      try { unlinkSync(DB_PATH); break; } catch { attempts++; }
      const deadline = Date.now() + 25 + attempts * 25;
      while (Date.now() < deadline) { /* busy-wait, restore is rare and CLI */ }
    }
  }
  renameSync(tmp, DB_PATH);
  // If the snapshot carried a -wal sidecar (see snapshot()), restore it
  // too — those are committed transactions the main file doesn't have.
  const snapshotWal = `${snapshotPath}-wal`;
  if (existsSync(snapshotWal)) {
    try { copyFileSync(snapshotWal, `${DB_PATH}-wal`); } catch {}
  }
  return { restored: snapshotPath, safetyBackup };
}

// ── Re-encryption ──────────────────────────────────────────────────────────

/**
 * libSQL's local encryptionKey mode produces a DB that cannot be read back
 * on native Linux (SQLITE_IOERR on first execute) — found by CI on
 * ubuntu-latest. Returns a human-readable reason when re-encryption must be
 * refused on this platform, or null when it is supported.
 */
export function reencryptUnsupportedReason(): string | null {
  return process.platform === "linux"
    ? "libSQL local encryption is not supported on Linux — the encrypted DB cannot be read back (SQLITE_IOERR). See README → Stability notes."
    : null;
}

/**
 * Preferred copy order — foreign-key parents first. Which tables get copied
 * is discovered from the source DB at runtime (see listUserTables); this
 * list only orders the known ones. _migrations is recreated by runMigrations,
 * and memories_fts is repopulated by the AFTER INSERT trigger on memories.
 */
const COPY_TABLES = [
  "projects",
  "sessions",
  "observations",
  "memories",
  "file_hashes",
  "raw_messages",
  "memory_tags",
] as const;

async function listUserTables(src: Client): Promise<string[]> {
  const result = await src.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'"
  );
  const names = result.rows
    .map((r) => String(r.name))
    .filter((n) => n !== "memories_fts" && !n.startsWith("memories_fts_"));
  const known = COPY_TABLES.filter((t) => names.includes(t));
  const rest = names
    .filter((n) => !(COPY_TABLES as readonly string[]).includes(n))
    .sort();
  return [...known, ...rest];
}

async function copyTable(src: Client, dst: Client, table: string): Promise<number> {
  const rows = await src.execute(`SELECT * FROM ${table}`);
  if (rows.rows.length === 0) return 0;

  const columns = rows.columns;
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;

  // Batch all inserts in one statement list for atomicity.
  await dst.batch(
    rows.rows.map((r) => ({
      sql,
      args: columns.map((c) => r[c] as string | number | ArrayBuffer | null),
    })),
    "write"
  );
  return rows.rows.length;
}

export interface ReencryptResult {
  source_backup: string;
  rows_copied: Record<string, number>;
  new_db_path: string;
}

/**
 * Lower-level re-encryption that takes explicit paths. Used by both the
 * public `reencryptToKey` (which operates on DB_PATH) and the test suite
 * (which uses isolated paths so the user's real DB is never touched).
 *
 * Does NOT snapshot the source. Caller is responsible for backup.
 */
export async function reencryptPathToKey(
  sourcePath: string,
  encryptionKey: string
): Promise<{ rows_copied: Record<string, number>; new_path: string }> {
  if (!existsSync(sourcePath)) {
    throw new Error(`[apsolut-cortex] no DB at ${sourcePath} — cannot re-encrypt`);
  }
  const newPath = `${sourcePath}.new`;
  if (existsSync(newPath)) unlinkSync(newPath);

  const src = createClient({ url: `file:${sourcePath}` });
  let dst: Client | null = null;
  const rowsCopied: Record<string, number> = {};

  try {
    dst = createClient({ url: `file:${newPath}`, encryptionKey });
    await runMigrations(dst);

    for (const table of await listUserTables(src)) {
      rowsCopied[table] = await copyTable(src, dst, table);
    }
  } catch (err) {
    if (dst) { try { dst.close(); } catch {} }
    try { src.close(); } catch {}
    if (existsSync(newPath)) {
      try { unlinkSync(newPath); } catch {}
    }
    throw new Error(
      `[apsolut-cortex] re-encryption failed before swap; original untouched. Cause: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  try { dst.close(); } catch {}
  try { src.close(); } catch {}

  for (const ext of ["-wal", "-shm"]) {
    const sidecar = `${sourcePath}${ext}`;
    if (existsSync(sidecar)) {
      try { await unlinkRetry(sidecar); } catch {}
    }
  }
  await unlinkRetry(sourcePath);
  await renameRetry(newPath, sourcePath);

  return { rows_copied: rowsCopied, new_path: sourcePath };
}

/**
 * Re-encrypt the live DB with a new key. Snapshots the source DB to
 * backup/pre-encrypt-<ts>.db first, then delegates to reencryptPathToKey.
 * On any failure before the rename, source is left untouched and the
 * backup is preserved.
 */
export async function reencryptToKey(encryptionKey: string): Promise<ReencryptResult> {
  const sourceBackup = snapshot("pre-encrypt");
  const { rows_copied } = await reencryptPathToKey(DB_PATH, encryptionKey);
  return { source_backup: sourceBackup, rows_copied, new_db_path: DB_PATH };
}
