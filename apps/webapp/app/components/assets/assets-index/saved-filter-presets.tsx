import {
  useEffect,
  useReducer,
  useRef,
  useMemo,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { Search, BookMarked, BookOpen, Save } from "lucide-react";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useFetchers,
} from "react-router";

import { Button } from "~/components/shared/button";
import { cleanParamsForCookie, useSearchParams } from "~/hooks/search-params";
import { useFilterPreview } from "~/hooks/use-filter-preview";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { MAX_SAVED_FILTER_PRESETS } from "~/modules/asset-filter-presets/constants";
import type {
  CreatePresetFormSchema,
  RenamePresetFormSchema,
} from "~/modules/asset-filter-presets/schemas";
import type { Column } from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
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
type SavedPresetResponse = NormalizedPreset;

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
        const shared =
          typeof record.shared === "boolean" ? record.shared : false;
        // A row is the viewer's own only when the server says so. Assuming
        // ownership would offer a star and a rename the server then refuses.
        const isOwn = record.isOwn === true;
        const sharedByName =
          typeof record.sharedByName === "string" ? record.sharedByName : null;

        // Reject presets missing any required field
        if (!id || !name || !query) {
          return null;
        }

        return {
          id,
          name,
          query,
          starred,
          shared,
          isOwn,
          sharedByName,
        } satisfies NormalizedPreset;
      })
      // Filter out null entries from validation failures
      .filter((preset): preset is NormalizedPreset => preset !== null)
  );
}

/**
 * UI state for the saved-filter controls. Consolidates popover + dialog +
 * apply-transition state into a single reducer so related updates happen
 * atomically (prevents no-cascading-set-state) and reduces the number of
 * `useState` calls in the parent component (satisfies prefer-useReducer).
 */
type PresetsUIState = {
  /** Popover (list of saved presets) */
  isPopoverOpen: boolean;
  searchQuery: string;
  selectedIndex: number;
  /** Save dialog */
  isSaveDialogOpen: boolean;
  presetName: string;
  /** Rename dialog */
  presetBeingRenamed: NormalizedPreset | null;
  renameValue: string;
  /** Id of preset whose apply/clear navigation is in flight */
  applyingPresetId: string | null;
};

type PresetsUIAction =
  | { type: "openPopoverAtIndex"; index: number }
  | { type: "closePopover" }
  | { type: "setSearchQuery"; value: string }
  | { type: "setSelectedIndex"; index: number }
  | { type: "openSaveDialog" }
  | { type: "closeSaveDialog" }
  | { type: "setPresetName"; value: string }
  | { type: "openRenameDialog"; preset: NormalizedPreset }
  | { type: "closeRenameDialog" }
  | { type: "setRenameValue"; value: string }
  | { type: "setApplyingPresetId"; id: string | null };

/**
 * Reducer for presets UI state. See {@link PresetsUIState}.
 */
function presetsUIReducer(
  state: PresetsUIState,
  action: PresetsUIAction
): PresetsUIState {
  switch (action.type) {
    case "openPopoverAtIndex":
      // Opening the popover always resets the search query and selects the
      // provided index (usually the active preset, or 0 if none).
      return {
        ...state,
        isPopoverOpen: true,
        searchQuery: "",
        selectedIndex: action.index,
      };
    case "closePopover":
      return { ...state, isPopoverOpen: false };
    case "setSearchQuery":
      // Typing in the search input resets the selection to the first match.
      return { ...state, searchQuery: action.value, selectedIndex: 0 };
    case "setSelectedIndex":
      return { ...state, selectedIndex: action.index };
    case "openSaveDialog":
      return { ...state, isSaveDialogOpen: true };
    case "closeSaveDialog":
      return { ...state, isSaveDialogOpen: false, presetName: "" };
    case "setPresetName":
      return { ...state, presetName: action.value };
    case "openRenameDialog":
      return {
        ...state,
        presetBeingRenamed: action.preset,
        renameValue: action.preset.name,
      };
    case "closeRenameDialog":
      return { ...state, presetBeingRenamed: null, renameValue: "" };
    case "setRenameValue":
      return { ...state, renameValue: action.value };
    case "setApplyingPresetId":
      return { ...state, applyingPresetId: action.id };
    default:
      return state;
  }
}

/**
 * One titled block of the saved-filters list.
 *
 * Module scope, not an inline closure: the list re-renders on every keystroke
 * in the search box, and a fresh component identity would unmount and remount
 * every row under it.
 *
 * @param title - Section heading, or null to render the rows without one
 * @param presets - The rows of this section, already filtered by the search
 * @param startIndex - Index of this section's first row within the flat
 *   keyboard-navigation list, so arrow keys and the rendered DOM ids agree
 */
function PresetGroup({
  title,
  presets,
  startIndex,
  activePresetId,
  applyingPresetId,
  selectedIndex,
  canManageSharing,
  columns,
  formatPreview,
  onApply,
  onRename,
}: {
  title: string | null;
  presets: NormalizedPreset[];
  startIndex: number;
  activePresetId: string | undefined;
  applyingPresetId: string | null;
  selectedIndex: number;
  canManageSharing: boolean;
  columns: Column[];
  formatPreview: (query: string, columns: Column[]) => ReactElement;
  onApply: (preset: NormalizedPreset) => void;
  onRename: (preset: NormalizedPreset) => void;
}) {
  if (presets.length === 0) {
    return null;
  }

  return (
    <div>
      {title ? (
        <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </div>
      ) : null}
      <div className="space-y-1">
        {presets.map((preset, index) => {
          const globalIndex = startIndex + index;

          return (
            <PresetListItem
              key={preset.id}
              id={`preset-option-${globalIndex}`}
              preset={preset}
              isActive={activePresetId === preset.id}
              isApplying={applyingPresetId === preset.id}
              isSelected={selectedIndex === globalIndex}
              canManageSharing={canManageSharing}
              columns={columns}
              formatPreview={formatPreview}
              onApply={onApply}
              onRename={onRename}
            />
          );
        })}
      </div>
    </div>
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
// react-doctor:no-giant-component — deferred for follow-up refactor
export function SavedFilterPresetsControls() {
  const loaderData = useLoaderData<LoaderData>();
  const {
    savedFilterPresets: loaderPresets = [],
    savedFilterPresetLimit: _savedFilterPresetLimit = MAX_SAVED_FILTER_PRESETS,
    settings,
  } = loaderData;

  const { formatPreview } = useFilterPreview();

  /**
   * Who may publish a view to the workspace — and retire or delete one the
   * workspace already has. Cosmetic: the route proves the same permission.
   */
  const { roles } = useUserRoleHelper();
  const canManageSharing = userHasPermission({
    roles,
    entity: PermissionEntity.assetIndexSettings,
    action: PermissionAction.update,
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const queryString = cleanParamsForCookie(searchParams).toString();
  const hasActiveFilters = queryString.length > 0;
  const actionData = useActionData<PresetActionData>();
  const navigation = useNavigation();
  const fetchers = useFetchers();

  // Track delete fetchers for optimistic UI - filter out presets being deleted
  const deletingPresetIds = useMemo(
    () =>
      new Set(
        fetchers
          .filter((f) => f.formData?.get("intent") === "delete-preset")
          .map((f) => f.formData?.get("presetId"))
          .filter((id): id is string => typeof id === "string")
      ),
    [fetchers]
  );

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

  // All non-server UI state (popover, dialogs, apply-in-flight marker) is
  // managed through a single reducer so opening a dialog or toggling the
  // popover applies related resets atomically — and so the component stays
  // under the react-doctor prefer-useReducer threshold.
  const [uiState, dispatchUI] = useReducer(presetsUIReducer, {
    isPopoverOpen: false,
    searchQuery: "",
    selectedIndex: 0,
    isSaveDialogOpen: false,
    presetName: "",
    presetBeingRenamed: null,
    renameValue: "",
    applyingPresetId: null,
  });
  const {
    isPopoverOpen,
    searchQuery,
    selectedIndex,
    isSaveDialogOpen,
    presetName,
    presetBeingRenamed,
    renameValue,
    applyingPresetId,
  } = uiState;

  const searchInputRef = useRef<HTMLInputElement>(null);

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
      // Filter out presets being deleted even when no star changes
      return basePresets.filter((preset) => !deletingPresetIds.has(preset.id));
    }

    // Apply all pending star changes
    // Also filter out presets being deleted while applying star changes
    return basePresets
      .filter((preset) => !deletingPresetIds.has(preset.id))
      .map((preset) => {
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
  }, [basePresets, fetchers, deletingPresetIds]);

  // Three groups, in render order: the views the workspace shared with you,
  // your starred shortcuts, then the rest of yours. A preset you own and
  // shared stays in your own groups — one row, with its star and its controls.
  const sharedPresets = presets.filter((p) => !p.isOwn);
  const starredPresets = presets.filter((p) => p.isOwn && p.starred);
  const regularPresets = presets.filter((p) => p.isOwn && !p.starred);

  // Filter presets based on search query
  const filteredSharedPresets = useMemo(
    () =>
      sharedPresets.filter((preset) =>
        preset.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [sharedPresets, searchQuery]
  );

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

  // All filtered presets for keyboard navigation, in the order they render —
  // the arrow keys index into this, so it must match the sections below.
  const allFilteredPresets = useMemo(
    () => [
      ...filteredSharedPresets,
      ...filteredStarredPresets,
      ...filteredRegularPresets,
    ],
    [filteredSharedPresets, filteredStarredPresets, filteredRegularPresets]
  );

  // Determine which preset is currently active (matches current URL query)
  const activePreset = useMemo(
    () => allFilteredPresets.find((p) => p.query === queryString),
    [allFilteredPresets, queryString]
  );

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    dispatchUI({ type: "setSearchQuery", value: event.target.value });
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
      case "ArrowDown": {
        event.preventDefault();
        const newIndex =
          selectedIndex < allFilteredPresets.length - 1
            ? selectedIndex + 1
            : selectedIndex;
        dispatchUI({ type: "setSelectedIndex", index: newIndex });
        scrollToIndex(newIndex);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const newIndex = selectedIndex > 0 ? selectedIndex - 1 : selectedIndex;
        dispatchUI({ type: "setSelectedIndex", index: newIndex });
        scrollToIndex(newIndex);
        break;
      }
      case "Enter":
        event.preventDefault();
        if (allFilteredPresets[selectedIndex]) {
          handleApplyPreset(allFilteredPresets[selectedIndex]);
          dispatchUI({ type: "closePopover" });
        }
        break;
    }
  };

  /**
   * Drives the popover's open/close lifecycle. When the popover opens we
   * reset the search, pick the index of the currently-active preset (if
   * any), and focus the search input. Previously this work lived in a
   * `useEffect` watching `isPopoverOpen` — moving it into the handler
   * satisfies react-doctor/no-effect-event-handler and keeps the state
   * transitions atomic.
   */
  const handlePopoverOpenChange = (open: boolean) => {
    if (!open) {
      dispatchUI({ type: "closePopover" });
      return;
    }

    const activeIndex = activePreset
      ? allFilteredPresets.findIndex((p) => p.id === activePreset.id)
      : -1;
    dispatchUI({
      type: "openPopoverAtIndex",
      index: activeIndex >= 0 ? activeIndex : 0,
    });
    // Focus after the popover has mounted the input.
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  };

  // Clear applying state when navigation completes
  useEffect(() => {
    if (!applyingPresetId) return;

    const applyingPreset = presets.find((p) => p.id === applyingPresetId);
    if (!applyingPreset) return;

    // Check if we're toggling off (clearing filters)
    const isTogglingOff = activePreset?.id === applyingPresetId;

    // For toggle-off, wait for navigation to complete (URL becomes empty)
    // For toggle-on/apply, check if URL matches the preset query
    if (isTogglingOff && queryString === "") {
      // Navigation complete - filters cleared
      dispatchUI({ type: "setApplyingPresetId", id: null });
    } else if (!isTogglingOff && queryString === applyingPreset.query) {
      // Navigation complete - preset applied
      dispatchUI({ type: "setApplyingPresetId", id: null });
    }
  }, [queryString, applyingPresetId, presets, activePreset]);

  // Also clear on navigation complete (backup)
  useEffect(() => {
    if (navigation.state === "idle") {
      dispatchUI({ type: "setApplyingPresetId", id: null });
    }
  }, [navigation.state]);

  // Close save and rename dialogs when submission completes successfully
  useEffect(() => {
    if (
      actionData &&
      "savedFilterPresets" in actionData &&
      actionData?.savedFilterPresets
    ) {
      dispatchUI({ type: "closeSaveDialog" });
      dispatchUI({ type: "closeRenameDialog" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isRenaming is omitted because it is derived from navigation state, which updates in sync with actionData; including isRenaming would cause unnecessary re-renders
  }, [actionData]);

  /**
   * Applies a saved preset by updating search params with the preset's query.
   * Uses setSearchParams to maintain client-side navigation.
   */
  const handleApplyPreset = (preset: NormalizedPreset) => {
    // If clicking the currently active preset, clear all filters (toggle off)
    if (activePreset?.id === preset.id) {
      setSearchParams(new URLSearchParams());
    } else {
      // Apply the preset filters
      const presetParams = new URLSearchParams(preset.query);
      setSearchParams(presetParams);
    }
    dispatchUI({ type: "setApplyingPresetId", id: preset.id });
  };

  const handleOpenRenameDialog = (preset: NormalizedPreset) => {
    dispatchUI({ type: "openRenameDialog", preset });
  };

  /** How many of the viewer's own presets the search left on screen. */
  const ownPresetsShown =
    filteredStarredPresets.length + filteredRegularPresets.length;

  /** Everything the three sections of the list render identically. */
  const groupProps = {
    activePresetId: activePreset?.id,
    applyingPresetId,
    selectedIndex,
    canManageSharing,
    columns: settings.columns as Column[],
    formatPreview,
    onApply: handleApplyPreset,
    onRename: handleOpenRenameDialog,
  };

  return (
    <div className="flex items-center gap-2">
      {/* Saved presets dropdown */}
      <Popover open={isPopoverOpen} onOpenChange={handlePopoverOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
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
            className="z-[9999] max-h-[500px] w-[480px] rounded-md border bg-white shadow-lg"
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
                  {hasActiveFilters && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => dispatchUI({ type: "openSaveDialog" })}
                    >
                      <div className="flex items-center gap-2">
                        <Save className="size-4" />
                        Save Filter
                      </div>
                    </Button>
                  )}
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
                    {/* Shared with the workspace by someone else. Read-only:
                        apply it, and nothing more, unless you may manage the
                        workspace's shared views. */}
                    <PresetGroup
                      title="Shared"
                      presets={filteredSharedPresets}
                      startIndex={0}
                      {...groupProps}
                    />

                    {filteredSharedPresets.length > 0 &&
                      ownPresetsShown > 0 && (
                        <div className="border-t border-gray-200" />
                      )}

                    <PresetGroup
                      title="Starred"
                      presets={filteredStarredPresets}
                      startIndex={filteredSharedPresets.length}
                      {...groupProps}
                    />

                    {/* Divider between sections */}
                    {filteredStarredPresets.length > 0 &&
                      filteredRegularPresets.length > 0 && (
                        <div className="border-t border-gray-200" />
                      )}

                    {/* Your remaining presets. They only need a heading once
                        another section sits above them. */}
                    <PresetGroup
                      title={
                        filteredSharedPresets.length > 0 ||
                        filteredStarredPresets.length > 0
                          ? "All presets"
                          : null
                      }
                      presets={filteredRegularPresets}
                      startIndex={
                        filteredSharedPresets.length +
                        filteredStarredPresets.length
                      }
                      {...groupProps}
                    />
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
          if (!open) dispatchUI({ type: "closeSaveDialog" });
        }}
        name={presetName}
        onNameChange={(e: ChangeEvent<HTMLInputElement>) =>
          dispatchUI({ type: "setPresetName", value: e.target.value })
        }
        query={queryString}
        columns={settings.columns as Column[]}
        isSubmitting={isCreating}
        validationErrors={createValidationErrors}
      />

      <RenamePresetDialog
        open={!!presetBeingRenamed}
        onOpenChange={(open) => {
          if (!open) dispatchUI({ type: "closeRenameDialog" });
        }}
        presetId={presetBeingRenamed?.id ?? ""}
        name={renameValue}
        onNameChange={(e: ChangeEvent<HTMLInputElement>) =>
          dispatchUI({ type: "setRenameValue", value: e.target.value })
        }
        isSubmitting={isRenaming}
        validationErrors={renameValidationErrors}
      />
    </div>
  );
}
