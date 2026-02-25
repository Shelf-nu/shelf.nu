import { useEffect, useState, type ChangeEvent } from "react";
import { Save } from "lucide-react";
import { useActionData, useNavigation, useLoaderData } from "react-router";
import { Button } from "~/components/shared/button";
import { cleanParamsForCookie, useSearchParams } from "~/hooks/search-params";
import { MAX_SAVED_FILTER_PRESETS } from "~/modules/asset-filter-presets/constants";
import type { CreatePresetFormSchema } from "~/modules/asset-filter-presets/schemas";
import type { Column } from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { CreatePresetDialog } from "./create-preset-dialog";

type PresetActionData = DataOrErrorResponse<{
  savedFilterPresets: { id: string; name: string; query: string }[];
}>;

/**
 * Button component that triggers the save filter preset dialog.
 * Designed to be used within the AdvancedFilter popover next to "Apply filters".
 *
 * This component manages all the logic for:
 * - Opening/closing the save dialog
 * - Getting the current query string from URL
 * - Handling form submission state
 * - Validation errors display
 * - Auto-closing on successful save
 */
export function SaveFilterButton({
  hasUnappliedFilters = false,
}: {
  hasUnappliedFilters?: boolean;
}) {
  const {
    savedFilterPresets: loaderPresets = [],
    savedFilterPresetLimit = MAX_SAVED_FILTER_PRESETS,
    settings,
  } = useLoaderData<AssetIndexLoaderData>();

  const [searchParams] = useSearchParams();
  const actionData = useActionData<PresetActionData>();
  const navigation = useNavigation();

  // Dialog and form state
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");

  // Validation errors from server
  const createValidationErrors = getValidationErrors<
    typeof CreatePresetFormSchema
  >(actionData?.error);

  // Check if currently submitting
  const isCreating =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "create-preset";

  // Get current query string for saving preset
  const queryString = cleanParamsForCookie(searchParams).toString();

  // Auto-close save dialog on successful save
  useEffect(() => {
    if (
      actionData &&
      "savedFilterPresets" in actionData &&
      actionData?.savedFilterPresets
    ) {
      setIsSaveDialogOpen(false);
      setPresetName("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isCreating is derived from navigation state which updates with actionData, so [actionData] is sufficient
  }, [actionData]);

  const handleOpenDialog = () => setIsSaveDialogOpen(true);

  const handleCloseDialog = () => {
    setIsSaveDialogOpen(false);
    setPresetName("");
  };

  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPresetName(e.target.value);
  };

  // Disable if at limit or if no filters are applied
  const hasFilters = queryString.length > 0;
  const atLimit = loaderPresets.length >= savedFilterPresetLimit;
  const isDisabled = atLimit || !hasFilters || hasUnappliedFilters;

  const title = atLimit
    ? `Maximum ${savedFilterPresetLimit} presets allowed`
    : hasUnappliedFilters
    ? "Apply filters first before saving"
    : !hasFilters
    ? "No filters to save"
    : "Save current filters";

  return (
    <>
      <Button
        variant="secondary"
        className="text-[14px] font-medium"
        size="xs"
        onClick={handleOpenDialog}
        disabled={isDisabled}
        title={title}
      >
        <div className="flex items-center gap-2">
          <Save className="size-4" />
          <span className="hidden whitespace-nowrap md:inline">
            Save Filter
          </span>
        </div>
      </Button>

      <CreatePresetDialog
        open={isSaveDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
        }}
        columns={settings.columns as Column[]}
        name={presetName}
        onNameChange={handleNameChange}
        query={queryString}
        isSubmitting={isCreating}
        validationErrors={createValidationErrors}
      />
    </>
  );
}
