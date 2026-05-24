/**
 * OS-keychain interface for the libSQL encryption key.
 *
 * Backend: @napi-rs/keyring → Windows Credential Manager (native), macOS
 * Keychain, libsecret on Linux/WSL2. The key never lives on disk except
 * in the encrypted DB itself.
 *
 * Service/account naming: one entry per (project, purpose) pair. We use
 * "apsolut-cortex" as the service name and "db-encryption-key" as the
 * account. Tests can pass a unique service name to avoid polluting the
 * user's real keychain.
 */

import { Entry } from "@napi-rs/keyring";
import { randomBytes } from "crypto";

export const KEYRING_SERVICE = "apsolut-cortex";
export const KEYRING_ACCOUNT_DB_KEY = "db-encryption-key";

/**
 * Returns the stored encryption key, or null if none is set.
 * Distinguishes "no key configured" (null) from "keyring backend failed"
 * (throws). Callers should treat null as "encryption is not enabled."
 */
export function getDbKey(
  service: string = KEYRING_SERVICE,
  account: string = KEYRING_ACCOUNT_DB_KEY
): string | null {
  const entry = new Entry(service, account);
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
  const entry = new Entry(service, account);
  entry.setPassword(key);
}

export function deleteDbKey(
  service: string = KEYRING_SERVICE,
  account: string = KEYRING_ACCOUNT_DB_KEY
): boolean {
  const entry = new Entry(service, account);
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
