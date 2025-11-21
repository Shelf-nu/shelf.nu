import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import type { SerializeFrom } from "@remix-run/node";
import { useFetcher, useLoaderData, useLocation } from "@remix-run/react";

import Input from "~/components/forms/input";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import {
  MAX_SAVED_FILTER_PRESETS,
  type SavedFilterView,
} from "~/modules/asset-filter-presets/constants";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import type { DataOrErrorResponse } from "~/utils/http.server";

function PresetNameFormError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-2 text-sm text-error-500">{message}</p>;
}

type LoaderData = SerializeFrom<AssetIndexLoaderData>;
type SavedPresetResponse = {
  id: string;
  name: string;
  query: string;
  view: string | null;
};
type NormalizedPreset = {
  id: string;
  name: string;
  query: string;
  view: SavedFilterView;
};
type PresetActionData = DataOrErrorResponse<{
  savedFilterPresets: SavedPresetResponse[];
}>;

function mapToNormalizedPresets(value: unknown): NormalizedPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((preset) => {
      if (!preset || typeof preset !== "object") {
        return null;
      }

      const record = preset as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : null;
      const name = typeof record.name === "string" ? record.name : null;
      const query = typeof record.query === "string" ? record.query : null;

      if (!id || !name || !query) {
        return null;
      }

      const rawView = typeof record.view === "string" ? record.view : null;

      return {
        id,
        name,
        query,
        view: String(rawView ?? "table").toLowerCase() as SavedFilterView,
      } satisfies NormalizedPreset;
    })
    .filter((preset): preset is NormalizedPreset => preset !== null);
}

export function SavedFilterPresetsControls() {
  const loaderData = useLoaderData<LoaderData>();
  const {
    savedFilterPresets: loaderPresets = [],
    savedFilterPresetsEnabled,
    savedFilterPresetLimit = MAX_SAVED_FILTER_PRESETS,
  } = loaderData;
  const location = useLocation();
  const createFetcher = useFetcher<PresetActionData>();
  const renameFetcher = useFetcher<PresetActionData>();
  const deleteFetcher = useFetcher<PresetActionData>();

  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetBeingRenamed, setPresetBeingRenamed] =
    useState<NormalizedPreset | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );
  const queryString = useMemo(() => searchParams.toString(), [searchParams]);
  const currentView = searchParams.get("view") ?? "table";

  const presets = useMemo(
    () => mapToNormalizedPresets(loaderPresets),
    [loaderPresets]
  );

  // Close save dialog on success
  useEffect(() => {
    if (
      isSaveDialogOpen &&
      createFetcher.state === "idle" &&
      createFetcher.data &&
      !createFetcher.data.error
    ) {
      setIsSaveDialogOpen(false);
      setPresetName("");
    }
  }, [createFetcher.data, createFetcher.state, isSaveDialogOpen]);

  // Close rename dialog on success
  useEffect(() => {
    if (
      presetBeingRenamed &&
      renameFetcher.state === "idle" &&
      renameFetcher.data &&
      !renameFetcher.data.error
    ) {
      setPresetBeingRenamed(null);
      setRenameValue("");
    }
  }, [presetBeingRenamed, renameFetcher.data, renameFetcher.state]);

  const isLimitReached =
    presets.length >= savedFilterPresetLimit ||
    presets.length >= MAX_SAVED_FILTER_PRESETS;

  if (!savedFilterPresetsEnabled) {
    return null;
  }

  const handlePresetNameChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setPresetName(event.target.value);
  };

  const handleRenameChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setRenameValue(event.target.value);
  };

  const handleSavePreset = () => {
    if (!presetName.trim()) return;

    createFetcher.submit(
      {
        intent: "create-preset",
        name: presetName.trim(),
        query: queryString,
        view: currentView,
      },
      { method: "post" }
    );
  };

  const handleApplyPreset = (preset: NormalizedPreset) => {
    const newUrl = `${location.pathname}?${preset.query}${preset.view !== "table" ? `&view=${preset.view}` : ""}`;
    window.location.href = newUrl;
    setIsPopoverOpen(false);
  };

  const handleRenamePreset = () => {
    if (!presetBeingRenamed || !renameValue.trim()) return;

    renameFetcher.submit(
      {
        intent: "rename-preset",
        presetId: presetBeingRenamed.id,
        name: renameValue.trim(),
      },
      { method: "post" }
    );
  };

  const handleDeletePreset = (presetId: string) => {
    deleteFetcher.submit(
      {
        intent: "delete-preset",
        presetId,
      },
      { method: "post" }
    );
  };

  const openRenameDialog = (preset: NormalizedPreset) => {
    setPresetBeingRenamed(preset);
    setRenameValue(preset.name);
    setIsPopoverOpen(false);
  };

  const createError =
    createFetcher.data?.error?.message ||
    (createFetcher.state === "idle" && createFetcher.data?.error
      ? "Failed to save preset"
      : undefined);

  const renameError =
    renameFetcher.data?.error?.message ||
    (renameFetcher.state === "idle" && renameFetcher.data?.error
      ? "Failed to rename preset"
      : undefined);

  return (
    <div className="flex items-center gap-2">
      {/* Save Current Filter Button */}
      <Button
        variant="secondary"
        onClick={() => setIsSaveDialogOpen(true)}
        disabled={!queryString || isLimitReached}
        title={
          isLimitReached
            ? `Maximum ${MAX_SAVED_FILTER_PRESETS} presets reached`
            : !queryString
              ? "Apply filters first to save"
              : "Save current filters"
        }
      >
        Save filters
      </Button>

      {/* Saved Presets Dropdown */}
      {presets.length > 0 && (
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="secondary">Saved ({presets.length})</Button>
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent
              className="z-50 w-72 rounded-md border border-gray-200 bg-white p-2 shadow-lg"
              align="end"
              sideOffset={4}
            >
              <div className="max-h-64 overflow-y-auto">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="group flex items-center justify-between rounded px-2 py-1.5 hover:bg-gray-50"
                  >
                    <button
                      type="button"
                      onClick={() => handleApplyPreset(preset)}
                      className="flex-1 truncate text-left text-sm"
                      title={preset.name}
                    >
                      {preset.name}
                    </button>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => openRenameDialog(preset)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title="Rename"
                      >
                        <svg
                          className="h-3.5 w-3.5"
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
                          className="h-3.5 w-3.5"
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
      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
              <h2 className="mb-4 text-lg font-semibold">Save filter preset</h2>
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
                <Button
                  variant="secondary"
                  onClick={() => {
                    setIsSaveDialogOpen(false);
                    setPresetName("");
                  }}
                >
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
        onOpenChange={(open) => {
          if (!open) {
            setPresetBeingRenamed(null);
            setRenameValue("");
          }
        }}
      >
        <DialogPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
              <h2 className="mb-4 text-lg font-semibold">Rename preset</h2>
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
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPresetBeingRenamed(null);
                    setRenameValue("");
                  }}
                >
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
