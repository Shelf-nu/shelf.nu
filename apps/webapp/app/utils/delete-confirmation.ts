/**
 * Delete Confirmation (shared by the server guards and the dialogs)
 *
 * Pieces of the typed delete confirmation that both the browser and the
 * server import. The matching rule itself lives in `@shelf/labels` so the
 * companion shares it.
 *
 * @see {@link file://./delete-confirmation.server.ts}
 * @see {@link file://../components/bulk-update-dialog/bulk-delete-confirmation.tsx}
 */
import { z } from "zod";

/**
 * The key under which a refused bulk delete carries the number the user must
 * type. `assertBulkDeleteConfirmed` sets it on the error's `additionalData`;
 * the bulk delete dialogs read it from `fetcherErrorAdditionalData` and ask
 * for that number instead.
 */
export const EXPECTED_CONFIRMATION_KEY = "expectedConfirmation";

/**
 * Reads the typed confirmation a single delete form posts. Optional so a
 * missing value reaches `assertDeleteConfirmed`, which answers with a message
 * the user can act on.
 */
export const DeleteConfirmationSchema = z.object({
  confirmation: z.string().optional(),
});
