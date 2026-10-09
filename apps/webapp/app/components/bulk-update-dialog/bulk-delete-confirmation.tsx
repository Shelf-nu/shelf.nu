/**
 * Bulk Delete Confirmation
 *
 * The body every bulk delete dialog shares, rendered as the children of
 * {@link BulkUpdateDialogContent}: the typed count, the server's refusal, and
 * the Cancel and Delete buttons. Delete stays disabled until the user types
 * the number of selected items.
 *
 * The server counts a "select all" itself (see `assertBulkDeleteConfirmed`).
 * When its count differs from the one this dialog showed, it refuses and sends
 * the real number back; the field then asks for that number, so the user
 * confirms exactly what will be removed.
 *
 * @see {@link file://./../../utils/delete-confirmation.server.ts} - Server guard
 * @see {@link file://./../shared/type-to-confirm.tsx} - The field itself
 */
import { EXPECTED_CONFIRMATION_KEY } from "~/utils/delete-confirmation";
import { Button } from "../shared/button";
import { TypeToConfirm, useTypeToConfirm } from "../shared/type-to-confirm";

/**
 * How many items a bulk delete dialog is about to remove: the server's count
 * after a refused "select all" (see `assertBulkDeleteConfirmed`), otherwise
 * the count the dialog opened with. The title, description and field all read
 * it, so none of them keeps showing a number the server has corrected.
 *
 * @param selectedCount - The count the dialog opened with
 * @param fetcherErrorAdditionalData - The last refusal's `additionalData`
 * @returns The number the user must confirm
 */
export function bulkDeleteCount(
  selectedCount: number,
  fetcherErrorAdditionalData?: Record<string, unknown>
): number {
  const serverExpected =
    fetcherErrorAdditionalData?.[EXPECTED_CONFIRMATION_KEY];
  return typeof serverExpected === "number" ? serverExpected : selectedCount;
}

type BulkDeleteConfirmationProps = {
  /** How many items the dialog says are selected. */
  count: number;
  /** True while the delete is submitting. */
  disabled: boolean;
  /** The server's refusal message, if the last submit was refused. */
  fetcherError?: string;
  /** The refusal's `additionalData`; may carry the number to type instead. */
  fetcherErrorAdditionalData?: Record<string, unknown>;
  /** Closes the dialog. */
  onCancel: () => void;
};

/**
 * Typed-count confirmation plus the dialog's buttons.
 *
 * @param props - See {@link BulkDeleteConfirmationProps}
 */
export function BulkDeleteConfirmation({
  count,
  disabled,
  fetcherError,
  fetcherErrorAdditionalData,
  onCancel,
}: BulkDeleteConfirmationProps) {
  const expected = bulkDeleteCount(count, fetcherErrorAdditionalData);
  const { value, setValue, isConfirmed } = useTypeToConfirm(expected);

  return (
    <>
      <TypeToConfirm
        expected={expected}
        value={value}
        onChange={setValue}
        disabled={disabled}
      />

      {fetcherError ? (
        <p className="mt-2 text-sm text-error-500" role="alert">
          {fetcherError}
        </p>
      ) : null}

      <div className="mt-4 flex gap-3">
        <Button
          type="button"
          variant="secondary"
          width="full"
          disabled={disabled}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          width="full"
          disabled={disabled || !isConfirmed}
          className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
          data-test-id="confirm-bulk-delete-button"
        >
          {disabled ? "Deleting..." : "Delete"}
        </Button>
      </div>
    </>
  );
}
