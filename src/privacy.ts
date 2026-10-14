/**
 * Strip <private>...</private> blocks from text.
 * Returns null if the entire content is private.
 *
 * An unterminated `<private>` (the user opened the tag and the closing tag
 * never arrived, because the message was truncated or they simply forgot)
 * discards everything from the tag onward. This used to keep the text —
 * failing open on the one construct whose entire purpose is to withhold
 * something. A forgotten `>` is not consent to store a secret.
 */
export function stripPrivate(text: string): string | null {
  let result = text;
  let start: number;
  while ((start = result.toLowerCase().indexOf("<private>")) !== -1) {
    const end = result.toLowerCase().indexOf("</private>", start);
    if (end === -1) {
      // Fail closed: drop the open tag and all text after it.
      result = result.slice(0, start);
      break;
    }
    result = result.slice(0, start) + result.slice(end + "</private>".length);
  }
  const stripped = result.trim();
  return stripped.length > 0 ? stripped : null;
}
