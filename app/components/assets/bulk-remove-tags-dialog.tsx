import { useEffect, useMemo } from "react";
import { useFetcher } from "@remix-run/react";
import { useZorm } from "react-zorm";
import {
  type TagsFetcherData,
  BulkUpdateTagsSchema,
} from "./bulk-assign-tags-dialog";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";
import { TagsAutocomplete } from "../tag/tags-autocomplete";

export default function BulkRemoveTagsDialog() {
  const zo = useZorm("BulkRemoveTags", BulkUpdateTagsSchema);

  const fetcher = useFetcher<TagsFetcherData>();

  const suggestions = useMemo(() => {
    if (!fetcher.data?.filters) {
      return [];
    }

    return fetcher.data.filters.map((tagResponse) => ({
      label: tagResponse.name,
      value: tagResponse.id,
    }));
  }, [fetcher.data]);

  useEffect(() => {
    fetcher.submit(
      {
        name: "tag",
        queryKey: "name",
        queryValue: "",
      },
      {
        method: "GET",
        action: "/api/model-filters",
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          <div className="relative z-50 mb-8">
            <TagsAutocomplete existingTags={[]} suggestions={suggestions} />

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
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>
            <Button variant="primary" width="full" disabled={disabled}>
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
