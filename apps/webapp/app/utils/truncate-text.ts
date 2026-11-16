/**
 * Shortens text to at most `maxLength` characters plus an ellipsis.
 *
 * Text that already fits is returned unchanged. Trailing whitespace before the
 * cut is dropped so the ellipsis sits against the last word.
 *
 * @param text - The text to shorten
 * @param maxLength - The most characters kept before the ellipsis
 * @returns The text, or its first `maxLength` characters followed by "…"
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}
