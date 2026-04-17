/**
 * Strip <private>...</private> blocks from text.
 * Returns null if the entire content is private.
 */
export function stripPrivate(text: string): string | null {
  let result = text;
  let start: number;
  while ((start = result.toLowerCase().indexOf("<private>")) !== -1) {
    const end = result.toLowerCase().indexOf("</private>", start);
    if (end === -1) break;
    result = result.slice(0, start) + result.slice(end + "</private>".length);
  }
  const stripped = result.trim();
  return stripped.length > 0 ? stripped : null;
}
