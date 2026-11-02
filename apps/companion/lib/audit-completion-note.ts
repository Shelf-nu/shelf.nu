/**
 * The closing note an auditor can write when completing an audit.
 *
 * The note is optional free text, sent as `completionNote` to
 * `/api/mobile/audits/complete`, which stores it on the audit and shows it in
 * the audit's report.
 *
 * @see {@link file://../components/audit/complete-audit-sheet.tsx} where it is written
 * @see {@link file://../../webapp/app/routes/api+/mobile+/audits.complete.ts} where it is stored
 */

/**
 * The longest note the sheet accepts. It is enforced by the input alone: the
 * server takes a note of any length.
 */
export const MAX_COMPLETION_NOTE_LENGTH = 5000;

/**
 * The note to send for what the auditor typed.
 *
 * A note holding only whitespace is no note, so it is left out of the request
 * rather than stored as an empty comment.
 *
 * @param input - The note field's current text
 * @returns The trimmed note, or `undefined` when there is nothing to send
 */
export function completionNoteFromInput(input: string): string | undefined {
  const trimmed = input.trim();
  return trimmed ? trimmed : undefined;
}
