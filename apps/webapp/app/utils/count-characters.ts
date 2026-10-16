/**
 * Counts the characters of user-entered text the way the user sees them.
 *
 * A browser submits each textarea line break as "\r\n" but shows and counts it
 * as one character, and stored text carries both forms. Counting "\r\n" as one
 * keeps a server-side length rule and an on-screen counter in agreement.
 *
 * @param text - The text to count
 * @returns The number of characters, with each line break counted once
 */
export function countCharacters(text: string): number {
  return text.replace(/\r\n/g, "\n").length;
}
