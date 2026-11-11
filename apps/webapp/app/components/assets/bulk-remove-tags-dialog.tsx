import { useMemo } from "react";
import { useZorm } from "react-zorm";
import { BulkUpdateTagsSchema } from "./bulk-assign-tags-dialog";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";
import { BulkTagsPicker } from "../tag/bulk-tags-picker";

export default function BulkRemoveTagsDialog() {
  const zo = useZorm("BulkRemoveTags", BulkUpdateTagsSchema);

  // Handle validation errors
  const validationErrors = useMemo(() => {
    const tagsError = zo.errors.tags()?.message;
    const assetIdsError = zo.errors.assetIds()?.message;
    return {
      tags: tagsError,
      assetIds: assetIdsError,
    };
  }, [zo.errors]);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="tag-remove"
      title="Remove tags from assets"
      description="Remove tags to selected assets. Assets that don't have any of the selected tags, will be skipped."
      actionUrl="/api/assets/bulk-assign-tags?remove=true"
      arrayFieldId="assetIds"
      // TagsAutocomplete's suggestion listbox is absolutely positioned inside
      // its own field, so the dialog body must not clip it. Safe here because
      // this dialog is short enough to never need the body to scroll.
      allowBodyOverflow
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          <div className="relative z-50 mb-8">
            <BulkTagsPicker />

            {validationErrors.tags && (
              <p className="text-sm text-error-500">{validationErrors.tags}</p>
            )}
            {validationErrors.assetIds && (
              <p className="text-sm text-error-500">
                {validationErrors.assetIds}
              </p>
            )}
            {fetcherError ? (
              <p className="text-sm text-error-500">{fetcherError}</p>
            ) : null}
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              width="full"
              disabled={disabled}
            >
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
