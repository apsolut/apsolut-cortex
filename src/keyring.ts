/**
 * OS-keychain interface for the libSQL encryption key.
 *
 * Backend: @napi-rs/keyring → Windows Credential Manager (native), macOS
 * Keychain, libsecret on Linux/WSL2. The key never lives on disk except
 * in the encrypted DB itself.
 *
 * Guarded native load. `@napi-rs/keyring`'s own loader requires a platform
 * `.node` binding at import time and THROWS if it can't load — a missing
 * `libsecret-1.so.0` on Linux, an arch outside its prebuild matrix, or the
 * well-known npm optional-dependencies bug (npm/cli#4828). A static
 * `import { Entry }` would propagate that throw during module evaluation and
 * crash every hook, the MCP server, and the CLI (including `doctor`) at
 * startup. We load it through `createRequire` in a try/catch instead, so an
 * unavailable backend degrades to "no keychain" (unencrypted, the opt-in
 * default) rather than taking the process down.
 *
 * Service/account naming: one entry per (project, purpose) pair. We use
 * "apsolut-cortex" as the service name and "db-encryption-key" as the
 * account. Tests can pass a unique service name to avoid polluting the
 * user's real keychain entry.
 */

import { createRequire } from "module";
import { randomBytes } from "crypto";

export const KEYRING_SERVICE = "apsolut-cortex";
export const KEYRING_ACCOUNT_DB_KEY = "db-encryption-key";

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}
type EntryCtor = new (service: string, account: string) => KeyringEntry;

let _EntryCtor: EntryCtor | null = null;
let _loadError: unknown = null;
try {
  const require = createRequire(import.meta.url);
  _EntryCtor = require("@napi-rs/keyring").Entry as EntryCtor;
} catch (e) {
  _loadError = e;
}

/** True when the native keychain backend loaded on this platform/install. */
export function keyringAvailable(): boolean {
  return _EntryCtor !== null;
}

/** The load failure, if the keychain backend couldn't be loaded (diagnostics). */
export function keyringLoadError(): unknown {
  return _loadError;
}

/**
 * Test seam: swap the Entry constructor (pass null to simulate an unavailable
 * backend). Returns the previous value so tests can restore it.
 */
export function __setEntryCtorForTest(ctor: EntryCtor | null): EntryCtor | null {
  const prev = _EntryCtor;
  _EntryCtor = ctor;
  return prev;
}

/**
 * Returns the stored encryption key, or null if none is set.
 *
 * Distinguishes "no key configured" (null) from "keyring backend present but
 * the read failed" (throws). A caller treats null as "encryption is not
 * enabled" and opens the DB unencrypted.
 *
 * When the backend didn't load at all we also return null: a key can't be read,
 * so we behave as if none is set. This is safe — if a genuinely encrypted DB
 * exists, opening it without a key fails loud with SQLITE_NOTADB on the first
 * query (libSQL does not silently create a new plaintext DB over it), so there
 * is no path to silent data loss.
 */
export function getDbKey(
  service: string = KEYRING_SERVICE,
  account: string = KEYRING_ACCOUNT_DB_KEY
): string | null {
  if (!_EntryCtor) return null;

  const entry = new _EntryCtor(service, account);
  try {
    return entry.getPassword();
  } catch (e) {
    // @napi-rs/keyring throws when the entry doesn't exist on most
    // backends. Treat "not found" as null; rethrow other errors so we
    // don't accidentally silently create a new DB when the keychain is
    // simply unreachable (gnome-keyring not running on WSL2, etc.).
    const msg = e instanceof Error ? e.message.toLowerCase() : String(e);
    if (
      msg.includes("not found") ||
      msg.includes("no matching") ||
      msg.includes("does not exist") ||
      msg.includes("the specified item could not be found")
    ) {
      return null;
    }
    throw new Error(
      `[apsolut-cortex] keychain read failed (${service}/${account}): ${e}`
    );
  }
}

export function setDbKey(
  key: string,
  service: string = KEYRING_SERVICE,
  account: string = KEYRING_ACCOUNT_DB_KEY
): void {
  if (!_EntryCtor) {
    // The user is explicitly enabling encryption — fail loud rather than let
    // them believe a key was stored when no keychain backend exists.
    throw new Error(
      `[apsolut-cortex] OS keychain backend is unavailable on this platform/install, ` +
        `so encryption can't be enabled. (${_loadError ?? "no backend loaded"})`
    );
  }
  const entry = new _EntryCtor(service, account);
  entry.setPassword(key);
}

export function deleteDbKey(
  service: string = KEYRING_SERVICE,
  account: string = KEYRING_ACCOUNT_DB_KEY
): boolean {
  if (!_EntryCtor) return false;
  const entry = new _EntryCtor(service, account);
  try {
    return entry.deletePassword();
  } catch {
    return false;
  }
}

/**
 * Generates a fresh 32-byte random key, hex-encoded (64 chars). libSQL
 * accepts any string as `encryptionKey` and derives the actual cipher
 * key internally, so the exact format does not matter as long as it has
 * enough entropy. Hex is human-copyable for emergency export.
 */
export function generateDbKey(): string {
  return randomBytes(32).toString("hex");
}
