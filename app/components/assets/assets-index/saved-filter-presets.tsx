import {
  useEffect,
  useState,
  useRef,
  useMemo,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { Search, BookMarked, BookOpen } from "lucide-react";
import {
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
  useFetchers,
} from "react-router";

import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { MAX_SAVED_FILTER_PRESETS } from "~/modules/asset-filter-presets/constants";
import type {
  CreatePresetFormSchema,
  RenamePresetFormSchema,
} from "~/modules/asset-filter-presets/schemas";
import type { Column } from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { CreatePresetDialog } from "./saved-filter-presets/create-preset-dialog";
import {
  PresetListItem,
  type NormalizedPreset,
} from "./saved-filter-presets/preset-list-item";
import { RenamePresetDialog } from "./saved-filter-presets/rename-preset-dialog";

export { SaveFilterButton } from "./saved-filter-presets/save-filter-button";

/** Loader data from the asset index route. */
type LoaderData = AssetIndexLoaderData;

/** Response structure from the server when saving/renaming/deleting presets. */
type SavedPresetResponse = {
  id: string;
  name: string;
  query: string;
  starred: boolean;
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
        const starred =
          typeof record.starred === "boolean" ? record.starred : false;

        // Reject presets missing any required field
        if (!id || !name || !query) {
          return null;
        }

        return {
          id,
          name,
          query,
          starred,
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
    savedFilterPresetLimit: _savedFilterPresetLimit = MAX_SAVED_FILTER_PRESETS,
    settings,
  } = loaderData;

  const location = useLocation();
  const actionData = useActionData<PresetActionData>();
  const navigation = useNavigation();
  const fetchers = useFetchers();
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
    navigation.formData?.get("intent") === "create-preset" &&
    (navigation.state === "submitting" || navigation.state === "loading");
  const isRenaming =
    navigation.formData?.get("intent") === "rename-preset" &&
    (navigation.state === "submitting" || navigation.state === "loading");

  // State for save/rename dialogs
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState<string>("");
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [presetBeingRenamed, setPresetBeingRenamed] =
    useState<NormalizedPreset | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Derive the current query string from the URL params
  const queryString = location.search.slice(1); // Remove '?' prefix

  // Merge loader presets with optimistic action data (if present)
  const basePresets = mapToNormalizedPresets(
    actionData &&
      "data" in actionData &&
      typeof actionData.data === "object" &&
      actionData.data &&
      "savedFilterPresets" in actionData.data
      ? actionData.data.savedFilterPresets
      : loaderPresets
  );

  // Build optimistic presets list that includes pending star toggles
  const presets = useMemo(() => {
    // Apply optimistic updates for all pending star toggles
    // Find all fetchers submitting star toggles
    const starFetchers = fetchers.filter(
      (f) => f.formData?.get("intent") === "toggle-star-preset"
    );

    if (starFetchers.length === 0) {
      return basePresets;
    }

    // Apply all pending star changes
    return basePresets.map((preset) => {
      const pendingStarChange = starFetchers.find(
        (f) => f.formData?.get("presetId") === preset.id
      );

      if (pendingStarChange?.formData) {
        const newStarredValue =
          pendingStarChange.formData.get("starred") === "true";
        return { ...preset, starred: newStarredValue };
      }

      return preset;
    });
  }, [basePresets, fetchers]);

  // Separate starred and regular presets
  const starredPresets = presets.filter((p) => p.starred);
  const regularPresets = presets.filter((p) => !p.starred);

  // Filter presets based on search query
  const filteredStarredPresets = useMemo(
    () =>
      starredPresets.filter((preset) =>
        preset.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [starredPresets, searchQuery]
  );

  const filteredRegularPresets = useMemo(
    () =>
      regularPresets.filter((preset) =>
        preset.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [regularPresets, searchQuery]
  );

  // All filtered presets for keyboard navigation
  const allFilteredPresets = useMemo(
    () => [...filteredStarredPresets, ...filteredRegularPresets],
    [filteredStarredPresets, filteredRegularPresets]
  );

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    setSelectedIndex(0);
  };

  // Scroll to selected item
  const scrollToIndex = (index: number) => {
    setTimeout(() => {
      const selectedElement = document.getElementById(`preset-option-${index}`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex =
            prev < allFilteredPresets.length - 1 ? prev + 1 : prev;
          scrollToIndex(newIndex);
          return newIndex;
        });
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex = prev > 0 ? prev - 1 : prev;
          scrollToIndex(newIndex);
          return newIndex;
        });
        break;
      case "Enter":
        event.preventDefault();
        if (allFilteredPresets[selectedIndex]) {
          handleApplyPreset(allFilteredPresets[selectedIndex]);
          setIsPopoverOpen(false);
        }
        break;
    }
  };

  // Reset search when popover opens/closes
  useEffect(() => {
    if (isPopoverOpen) {
      setSearchQuery("");
      setSelectedIndex(0);
      // Focus search input when popover opens
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }
  }, [isPopoverOpen]);

  // Close rename dialog when submission completes successfully
  useEffect(() => {
    if (
      actionData &&
      "savedFilterPresets" in actionData &&
      actionData?.savedFilterPresets
    ) {
      closeRenameDialog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isRenaming is omitted because it is derived from navigation state, which updates in sync with actionData; including isRenaming would cause unnecessary re-renders
  }, [actionData]);

  /**
   * Closes the save dialog and resets form state.
   */
  const closeSaveDialog = () => {
    setIsSaveDialogOpen(false);
    setPresetName("");
  };

  /**
   * Closes the rename dialog and clears the preset being renamed.
   */
  const closeRenameDialog = () => {
    setPresetBeingRenamed(null);
    setRenameValue("");
  };

  /**
   * Opens the rename dialog for a specific preset.
   * Does NOT close the popover so the dialog appears above it.
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
      {/* Saved presets dropdown */}
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            className={"font-normal text-gray-500"}
          >
            <div className="flex items-center gap-2">
              <BookOpen className="size-4" />
              <span className="hidden whitespace-nowrap md:inline">
                {presets.length > 0
                  ? `Saved Filters (${presets.length})`
                  : "Saved Filters"}
              </span>
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            className="z-[9999] max-h-[500px] w-80 rounded-md border bg-white shadow-lg"
            sideOffset={5}
            align="end"
          >
            {presets.length === 0 ? (
              <div className="space-y-4 p-6 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-gray-100">
                  <BookMarked className="size-6 text-gray-400" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-gray-900">
                    No saved filters yet
                  </h3>
                  <p className="text-sm text-gray-500">
                    Save your current filter configuration to quickly access it
                    later. Apply filters, then click Save in the filters menu to
                    create your first preset.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Search bar */}
                <div className="flex items-center border-b">
                  <Search className="ml-4 size-4 text-gray-500" />
                  <input
                    ref={searchInputRef}
                    placeholder="Search presets..."
                    className="w-full border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
                    value={searchQuery}
                    onChange={handleSearch}
                    onKeyDown={handleKeyDown}
                  />
                </div>

                {allFilteredPresets.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-gray-500">
                    No presets found
                  </div>
                ) : (
                  <div className="max-h-[400px] space-y-3 overflow-y-auto p-3">
                    {/* Starred section */}
                    {filteredStarredPresets.length > 0 && (
                      <div>
                        <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Starred
                        </div>
                        <div className="space-y-1">
                          {filteredStarredPresets.map((preset, index) => (
                            <PresetListItem
                              key={`starred-${preset.id}`}
                              id={`preset-option-${index}`}
                              preset={preset}
                              isActive={activePreset?.id === preset.id}
                              isSelected={selectedIndex === index}
                              columns={settings.columns as Column[]}
                              onApply={handleApplyPreset}
                              onRename={openRenameDialog}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Divider between sections */}
                    {filteredStarredPresets.length > 0 &&
                      filteredRegularPresets.length > 0 && (
                        <div className="border-t border-gray-200" />
                      )}

                    {/* Regular presets section */}
                    {filteredRegularPresets.length > 0 && (
                      <div>
                        {filteredStarredPresets.length > 0 && (
                          <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            All presets
                          </div>
                        )}
                        <div className="space-y-1">
                          {filteredRegularPresets.map((preset, index) => {
                            const globalIndex =
                              filteredStarredPresets.length + index;
                            return (
                              <PresetListItem
                                key={`regular-${preset.id}`}
                                id={`preset-option-${globalIndex}`}
                                preset={preset}
                                isActive={activePreset?.id === preset.id}
                                isSelected={selectedIndex === globalIndex}
                                columns={settings.columns as Column[]}
                                onApply={handleApplyPreset}
                                onRename={openRenameDialog}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </PopoverContent>
        </PopoverPortal>
      </Popover>

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
