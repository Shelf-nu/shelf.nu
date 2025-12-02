import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import {
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";

import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { MAX_SAVED_FILTER_PRESETS } from "~/modules/asset-filter-presets/constants";
import type {
  CreatePresetFormSchema,
  RenamePresetFormSchema,
} from "~/modules/asset-filter-presets/schemas";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { CreatePresetDialog } from "./saved-filter-presets/create-preset-dialog";
import {
  PresetListItem,
  type NormalizedPreset,
} from "./saved-filter-presets/preset-list-item";
import { RenamePresetDialog } from "./saved-filter-presets/rename-preset-dialog";

/** Loader data from the asset index route. */
type LoaderData = AssetIndexLoaderData;

/** Response structure from the server when saving/renaming/deleting presets. */
type SavedPresetResponse = {
  id: string;
  name: string;
  query: string;
};

/** Action response data from preset mutation operations. */
type PresetActionData = DataOrErrorResponse<{
  savedFilterPresets: SavedPresetResponse[];
}>;

/**
 * Validates and normalizes preset data from the server.
 * Filters out invalid preset objects and ensures all required fields are present.
 *
 * @param value - Raw preset data from loader or fetcher
 * @returns Array of validated presets
 */
function mapToNormalizedPresets(value: unknown): NormalizedPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return (
    value
      .map((preset) => {
        // Skip non-object entries
        if (!preset || typeof preset !== "object") {
          return null;
        }

        // Extract and validate required fields
        const record = preset as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id : null;
        const name = typeof record.name === "string" ? record.name : null;
        const query = typeof record.query === "string" ? record.query : null;

        // Reject presets missing any required field
        if (!id || !name || !query) {
          return null;
        }

        return {
          id,
          name,
          query,
        } satisfies NormalizedPreset;
      })
      // Filter out null entries from validation failures
      .filter((preset): preset is NormalizedPreset => preset !== null)
  );
}

/**
 * Manages saved filter presets for the asset index (advanced mode only).
 *
 * Provides UI controls for:
 * - Saving the current filter state as a named preset
 * - Loading saved presets (applies query params)
 * - Renaming existing presets
 * - Deleting presets
 *
 * Limits the number of saved presets per user via `savedFilterPresetLimit`.
 */
export function SavedFilterPresetsControls() {
  const loaderData = useLoaderData<LoaderData>();
  const {
    savedFilterPresets: loaderPresets = [],
    savedFilterPresetLimit = MAX_SAVED_FILTER_PRESETS,
  } = loaderData;

  const location = useLocation();
  const actionData = useActionData<PresetActionData>();
  const navigation = useNavigation();
  const [, setSearchParams] = useSearchParams();

  // Extract validation errors from action data
  const createValidationErrors = getValidationErrors<
    typeof CreatePresetFormSchema
  >(actionData?.error);
  const renameValidationErrors = getValidationErrors<
    typeof RenamePresetFormSchema
  >(actionData?.error);

  // Track which form is currently submitting based on navigation state
  const isCreating =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "create-preset";
  const isRenaming =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "rename-preset";

  // Dialog visibility state
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  // Form state for save dialog
  const [presetName, setPresetName] = useState("");

  // Form state for rename dialog
  const [presetBeingRenamed, setPresetBeingRenamed] =
    useState<NormalizedPreset | null>(null);
  const [renameValue, setRenameValue] = useState("");

  /** Closes save dialog and resets form. */
  const closeSaveDialog = () => {
    setIsSaveDialogOpen(false);
    setPresetName("");
  };

  /** Closes rename dialog and resets form. */
  const closeRenameDialog = () => {
    setPresetBeingRenamed(null);
    setRenameValue("");
  };

  // Extract current URL search params (contains all active filters)
  const searchParams = new URLSearchParams(location.search);

  const queryString = searchParams.toString();

  // Normalize and validate presets from loader
  const presets = useMemo(
    () => mapToNormalizedPresets(loaderPresets),
    [loaderPresets]
  );

  /**
   * Auto-close save dialog when create operation succeeds.
   * Watches navigation state and closes dialog on successful response.
   */
  useEffect(() => {
    if (
      isSaveDialogOpen &&
      navigation.state === "idle" &&
      actionData &&
      !actionData.error &&
      actionData.savedFilterPresets
    ) {
      // Success: close dialog and reset form
      setIsSaveDialogOpen(false);
      setPresetName("");
    }
  }, [actionData, navigation.state, isSaveDialogOpen]);

  /**
   * Auto-close rename dialog when rename operation succeeds.
   * Watches navigation state and closes dialog on successful response.
   */
  useEffect(() => {
    if (
      presetBeingRenamed &&
      navigation.state === "idle" &&
      actionData &&
      !actionData.error &&
      actionData.savedFilterPresets
    ) {
      // Success: close dialog and reset form
      setPresetBeingRenamed(null);
      setRenameValue("");
    }
  }, [actionData, navigation.state, presetBeingRenamed]);

  /**
   * Opens rename dialog for a specific preset.
   * Initializes the form with the preset's current name.
   */
  const openRenameDialog = (preset: NormalizedPreset) => {
    setPresetBeingRenamed(preset);
    setRenameValue(preset.name);
  };

  /**
   * Identifies which preset (if any) matches the current query string.
   * Used to highlight the active preset in the list.
   */
  const activePreset = presets.find((p) => p.query === queryString);

  /**
   * Applies a saved preset by updating search params with the preset's query.
   * Uses setSearchParams to maintain client-side navigation.
   */
  const handleApplyPreset = (preset: NormalizedPreset) => {
    const presetParams = new URLSearchParams(preset.query);
    setSearchParams(presetParams);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Save current filters button */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsSaveDialogOpen(true)}
        disabled={presets.length >= savedFilterPresetLimit}
        title={
          presets.length >= savedFilterPresetLimit
            ? `Maximum ${savedFilterPresetLimit} presets allowed`
            : "Save current filters"
        }
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        <span className="hidden md:inline">Save Filter</span>
      </Button>

      {/* Saved presets dropdown */}
      {presets.length > 0 && (
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
                <path d="M8 11h8" />
                <path d="M8 7h6" />
              </svg>
              <span className="hidden md:inline">
                Saved Filters ({presets.length})
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent
              className="z-[9999] w-64 rounded-md border bg-white p-3 shadow-lg"
              sideOffset={5}
              align="end"
            >
              <div className="space-y-1">
                {presets.map((preset) => (
                  <PresetListItem
                    key={preset.id}
                    preset={preset}
                    isActive={activePreset?.id === preset.id}
                    onApply={handleApplyPreset}
                    onRename={openRenameDialog}
                  />
                ))}
              </div>
            </PopoverContent>
          </PopoverPortal>
        </Popover>
      )}

      <CreatePresetDialog
        open={isSaveDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeSaveDialog();
        }}
        name={presetName}
        onNameChange={(e: ChangeEvent<HTMLInputElement>) =>
          setPresetName(e.target.value)
        }
        query={queryString}
        isSubmitting={isCreating}
        validationErrors={createValidationErrors}
      />

      <RenamePresetDialog
        open={!!presetBeingRenamed}
        onOpenChange={(open) => {
          if (!open) closeRenameDialog();
        }}
        presetId={presetBeingRenamed?.id ?? ""}
        name={renameValue}
        onNameChange={(e: ChangeEvent<HTMLInputElement>) =>
          setRenameValue(e.target.value)
        }
        isSubmitting={isRenaming}
        validationErrors={renameValidationErrors}
      />
    </div>
  );
}
