import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useFetcher, useLoaderData, useLocation } from "react-router";

import Input from "~/components/forms/input";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import {
  MAX_SAVED_FILTER_PRESETS,
  type SavedFilterView,
} from "~/modules/asset-filter-presets/constants";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import type { DataOrErrorResponse } from "~/utils/http.server";

/**
 * Displays validation errors for preset name inputs.
 * Shows nothing when no error is present.
 */
function PresetNameFormError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-2 text-sm text-error-500">{message}</p>;
}

/** Loader data from the asset index route. */
type LoaderData = AssetIndexLoaderData;

/** Response structure from the server when saving/renaming/deleting presets. */
type SavedPresetResponse = {
  id: string;
  name: string;
  query: string;
  view: string | null;
};

/** Normalized preset with validated view field as SavedFilterView enum. */
type NormalizedPreset = {
  id: string;
  name: string;
  query: string;
  view: SavedFilterView;
};

/** Action response data from preset mutation operations. */
type PresetActionData = DataOrErrorResponse<{
  savedFilterPresets: SavedPresetResponse[];
}>;

/**
 * Validates and normalizes preset data from the server.
 * Filters out invalid preset objects and ensures all required fields are present.
 * Falls back to "table" view if the view field is missing or invalid.
 *
 * @param value - Raw preset data from loader or fetcher
 * @returns Array of validated presets with normalized view types
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

        // Normalize view to lowercase, defaulting to "table"
        const rawView = typeof record.view === "string" ? record.view : null;

        return {
          id,
          name,
          query,
          view: String(rawView ?? "table").toLowerCase() as SavedFilterView,
        } satisfies NormalizedPreset;
      })
      // Filter out null entries from validation failures
      .filter((preset): preset is NormalizedPreset => preset !== null)
  );
}

/**
 * Manages saved filter presets for the asset index.
 *
 * Provides UI controls for:
 * - Saving the current filter/view state as a named preset
 * - Loading saved presets (applies query params and switches view)
 * - Renaming existing presets
 * - Deleting presets
 *
 * Presets are stored per-user/per-organization and include:
 * - Filter query string (search, categories, tags, locations, etc.)
 * - View mode (table, grid, map)
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

  // Separate fetchers for each mutation to avoid state conflicts
  const createFetcher = useFetcher<PresetActionData>();
  const renameFetcher = useFetcher<PresetActionData>();
  const deleteFetcher = useFetcher<PresetActionData>();

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
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );

  // Serialize search params into query string for storage
  const queryString = useMemo(() => searchParams.toString(), [searchParams]);

  // Current view mode (table, grid, or map)
  const currentView = searchParams.get("view") ?? "table";

  // Normalize and validate presets from loader
  const presets = useMemo(
    () => mapToNormalizedPresets(loaderPresets),
    [loaderPresets]
  );

  /**
   * Auto-close save dialog when create operation succeeds.
   * Watches fetcher state and closes dialog on successful response.
   */
  useEffect(() => {
    if (
      isSaveDialogOpen &&
      createFetcher.state === "idle" &&
      createFetcher.data &&
      !createFetcher.data.error
    ) {
      // Success: close dialog and reset form
      setIsSaveDialogOpen(false);
      setPresetName("");
    }
  }, [createFetcher.data, createFetcher.state, isSaveDialogOpen]);

  /**
   * Auto-close rename dialog when rename operation succeeds.
   * Watches fetcher state and closes dialog on successful response.
   */
  useEffect(() => {
    if (
      presetBeingRenamed &&
      renameFetcher.state === "idle" &&
      renameFetcher.data &&
      !renameFetcher.data.error
    ) {
      // Success: close dialog and reset form
      setPresetBeingRenamed(null);
      setRenameValue("");
    }
  }, [presetBeingRenamed, renameFetcher.data, renameFetcher.state]);

  /**
   * Detects if the current URL exactly matches a saved preset.
   * Compares query strings and view mode to determine active preset.
   */
  const currentPresetId = useMemo(() => {
    const match = presets.find(
      (p) => p.query === queryString && p.view === currentView
    );
    return match?.id;
  }, [presets, queryString, currentView]);

  /** Check if user has reached their preset limit. */
  const hasReachedLimit = presets.length >= savedFilterPresetLimit;

  /** Extract error message from create fetcher. */
  const createError = createFetcher.data?.error?.message;

  /** Extract error message from rename fetcher. */
  const renameError = renameFetcher.data?.error?.message;

  /** Updates preset name as user types in save dialog. */
  const handlePresetNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPresetName(e.target.value);
  };

  /**
   * Submits new preset to server.
   * Sends current query string, view mode, and user-provided name.
   */
  const handleSavePreset = () => {
    if (!presetName.trim()) return;

    void createFetcher.submit(
      { name: presetName.trim(), query: queryString, view: currentView },
      { method: "post", action: "/api/assets/save-filter-preset" }
    );
  };

  /**
   * Opens rename dialog for the given preset.
   * Pre-fills the dialog with the preset's current name.
   */
  const openRenameDialog = (preset: NormalizedPreset) => {
    setPresetBeingRenamed(preset);
    setRenameValue(preset.name);
  };

  /** Updates new name as user types in rename dialog. */
  const handleRenameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setRenameValue(e.target.value);
  };

  /**
   * Submits preset rename to server.
   * Sends preset ID and new name.
   */
  const handleRenamePreset = () => {
    if (!presetBeingRenamed || !renameValue.trim()) return;

    void renameFetcher.submit(
      { id: presetBeingRenamed.id, name: renameValue.trim() },
      { method: "post", action: "/api/assets/rename-filter-preset" }
    );
  };

  /**
   * Deletes a preset by ID.
   * Shows browser confirmation before proceeding.
   */
  const handleDeletePreset = (id: string) => {
    if (!confirm("Delete this preset?")) return;

    void deleteFetcher.submit(
      { id },
      { method: "post", action: "/api/assets/delete-filter-preset" }
    );
  };

  /**
   * Applies a saved preset to the current view.
   * Navigates to the asset index with the preset's query params and view mode.
   */
  const handleApplyPreset = (preset: NormalizedPreset) => {
    window.location.href = `/assets?${preset.query}&view=${preset.view}`;
  };

  return (
    <div className="flex items-center gap-2">
      {/* Save current filters button */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsSaveDialogOpen(true)}
        disabled={hasReachedLimit}
        title={
          hasReachedLimit
            ? `You've reached the maximum of ${savedFilterPresetLimit} saved presets`
            : "Save current filters as a preset"
        }
      >
        <svg
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
          />
        </svg>
        Save filters
      </Button>

      {/* Saved presets popover - only show if presets exist */}
      {presets.length > 0 && (
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm" title="View saved presets">
              <svg
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
              Saved presets ({presets.length})
            </Button>
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent
              className="z-50 w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
              sideOffset={5}
            >
              <div className="mb-2 px-2 py-1 text-xs font-medium text-gray-500">
                SAVED PRESETS
              </div>
              <div className="max-h-96 space-y-1 overflow-y-auto">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="group flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-gray-50"
                  >
                    {/* Apply preset button */}
                    <button
                      type="button"
                      onClick={() => handleApplyPreset(preset)}
                      className={
                        "flex-1 truncate text-left text-sm " +
                        (preset.id === currentPresetId
                          ? "font-semibold text-primary"
                          : "text-gray-700")
                      }
                      title={preset.name}
                    >
                      {preset.name}
                    </button>
                    {/* Rename and delete action buttons */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => openRenameDialog(preset)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title="Rename"
                      >
                        <svg
                          className="size-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePreset(preset.id)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                        title="Delete"
                      >
                        <svg
                          className="size-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </PopoverPortal>
        </Popover>
      )}

      {/* Save Dialog */}
      <Dialog
        open={isSaveDialogOpen}
        onClose={closeSaveDialog}
        title="Save filter preset"
      >
        <DialogPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
              <Input
                label="Preset name"
                value={presetName}
                onChange={handlePresetNameChange}
                placeholder="e.g., Available laptops"
                maxLength={60}
                autoFocus
              />
              <PresetNameFormError message={createError} />
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={closeSaveDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSavePreset}
                  disabled={
                    !presetName.trim() || createFetcher.state !== "idle"
                  }
                >
                  {createFetcher.state !== "idle" ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </DialogPortal>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog
        open={!!presetBeingRenamed}
        onClose={closeRenameDialog}
        title="Rename preset"
      >
        <DialogPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
              <Input
                label="New name"
                value={renameValue}
                onChange={handleRenameChange}
                placeholder="Enter new name"
                maxLength={60}
                autoFocus
              />
              <PresetNameFormError message={renameError} />
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={closeRenameDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleRenamePreset}
                  disabled={
                    !renameValue.trim() || renameFetcher.state !== "idle"
                  }
                >
                  {renameFetcher.state !== "idle" ? "Renaming..." : "Rename"}
                </Button>
              </div>
            </div>
          </div>
        </DialogPortal>
      </Dialog>
    </div>
  );
}
