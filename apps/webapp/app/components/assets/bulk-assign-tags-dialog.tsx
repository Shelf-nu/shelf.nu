import { useMemo } from "react";
import { TagUseFor } from "@prisma/client";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";
import { TagsAutocomplete } from "../tag/tags-autocomplete";
import {
  TAG_SEARCHING_TEXT,
  useTagSuggestions,
} from "../tag/use-tag-suggestions";

/**
 * Schema for bulk tag update validation
 * Ensures at least one asset and one tag are selected
 */
export const BulkUpdateTagsSchema = z.object({
  // Validate array of asset IDs
  assetIds: z.array(z.string()).min(1, "At least one asset must be selected"),
  // Transform comma-separated string to array and validate
  tags: z
    .string()
    .transform((str) => str.split(",").filter(Boolean))
    .pipe(
      z.array(z.string()).min(1, {
        message: "At least one tag must be selected",
      })
    ),
});

export default function BulkAssignTagsDialog() {
  const zo = useZorm("BulkAssignTags", BulkUpdateTagsSchema);

  const {
    suggestions,
    onInputChange,
    isSearching,
    error: searchError,
  } = useTagSuggestions({
    useFor: TagUseFor.ASSET,
  });

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
      type="tag-add"
      title="Assign tags to assets"
      description="Assign tags to selected assets. Assets that already have any of the selected tags, will be skipped."
      actionUrl="/api/assets/bulk-assign-tags"
      arrayFieldId="assetIds"
      // TagsAutocomplete's suggestion listbox is absolutely positioned inside
      // its own field, so the dialog body must not clip it. Safe here because
      // this dialog is short enough to never need the body to scroll.
      allowBodyOverflow
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          <div className="relative z-50 mb-8">
            <TagsAutocomplete
              existingTags={[]}
              suggestions={suggestions}
              onInputChange={onInputChange}
              noOptionsText={isSearching ? TAG_SEARCHING_TEXT : undefined}
            />

            {searchError && (
              <p className="text-sm text-error-500">{searchError}</p>
            )}

            {validationErrors.tags && (
              <p className="text-sm text-error-500">{validationErrors.tags}</p>
            )}
            {validationErrors.assetIds && (
              <p className="text-sm text-error-500">
                {validationErrors.assetIds}
              </p>
            )}
            {fetcherError && (
              <p className="text-sm text-error-500">{fetcherError}</p>
            )}
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
