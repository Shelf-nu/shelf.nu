import { useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";
import { TagsAutocomplete, type TagSuggestion } from "../tag/tags-autocomplete";

export const BulkAssignTagsSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  tags: z.string(),
});

export default function BulkAssignTagsDialog() {
  const zo = useZorm("BulkAssignTags", BulkAssignTagsSchema);

  const fetcher = useFetcher();
  // @ts-ignore
  const suggestions = fetcher.data?.filters.map((tagResponse) => ({
    label: tagResponse.name,
    value: tagResponse.id,
  })) as TagSuggestion[];

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

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="tag-add"
      title="Assign tags to assets"
      description="Assign tags to selected assets. Assets that already have any of the selected tags, will be skipped."
      actionUrl="/api/assets/bulk-assign-tags"
      arrayFieldId="assetIds"
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          <div className="relative z-50 mb-8">
            <TagsAutocomplete existingTags={[]} suggestions={suggestions} />

            {zo.errors.tags()?.message ? (
              <p className="text-sm text-error-500">
                {zo.errors.tags()?.message}
              </p>
            ) : null}
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
