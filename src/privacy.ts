/**
 * Strip <private>...</private> blocks from text.
 * Returns null if the entire content is private.
 */
const PRIVATE_RE = /<private>[\s\S]*?<\/private>/gi;

export function stripPrivate(text: string): string | null {
  const stripped = text.replace(PRIVATE_RE, "").trim();
  return stripped.length > 0 ? stripped : null;
}
