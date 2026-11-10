/**
 * Whether the audit evidence sheet holds something not yet added: a typed
 * note or a picked photo. The sheet asks before a link closes it while this
 * is true.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it.
 *
 * @see {@link file://../components/audit/evidence-modal.tsx} `leaveForLink`
 * @see {@link file://./audit-evidence-draft.test.ts}
 */

/**
 * @param noteText - The note field as typed.
 * @param selectedImageUri - The picked photo, or null.
 * @returns True when leaving would lose a note or photo.
 */
export function hasUnsentEvidence(
  noteText: string,
  selectedImageUri: string | null
): boolean {
  return noteText.trim().length > 0 || selectedImageUri !== null;
}
