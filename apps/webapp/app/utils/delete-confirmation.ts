/**
 * Delete Confirmation (shared by the server guard and the dialogs)
 *
 * The key under which a refused bulk delete carries the number the user must
 * type. {@link assertBulkDeleteConfirmed} sets it on the error's
 * `additionalData`; the bulk delete dialogs read it from
 * `fetcherErrorAdditionalData` and ask for that number instead. The matching
 * rule itself lives in `@shelf/labels` so the companion shares it.
 *
 * @see {@link file://./delete-confirmation.server.ts}
 * @see {@link file://../components/bulk-update-dialog/bulk-delete-confirmation.tsx}
 */
export const EXPECTED_CONFIRMATION_KEY = "expectedConfirmation";
