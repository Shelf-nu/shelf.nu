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

  const createError = createFetcher.data?.error?.message;
  const renameError = renameFetcher.data?.error?.message;

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        icon="save"
        onClick={() => setIsSaveDialogOpen(true)}
        disabled={
          isLimitReached
            ? {
                reason: `You can store up to ${savedFilterPresetLimit} presets. Delete one before saving a new filter.`,
              }
            : createFetcher.state !== "idle"
        }
      >
        Save filters
      </Button>

      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            icon="list"
            disabled={presets.length === 0}
          >
            Saved filters
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="end"
            className="z-30 w-[320px] rounded-md border border-gray-200 bg-white p-3 shadow-lg"
          >
            {presets.length === 0 ? (
              <p className="text-sm text-gray-500">
                You have no saved filters yet. Use “Save filters” after
                adjusting the advanced filters to create one.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {presets.map((preset) => {
                  const applyUrl = `/assets?${preset.query}`;
                  const viewLabel =
                    preset.view === "availability"
                      ? "Availability view"
                      : "Table view";
                  return (
                    <div
                      key={preset.id}
                      className="flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <Button
                          to={applyUrl}
                          variant="link"
                          className="block truncate text-left font-medium text-gray-900"
                          onClick={() => setIsPopoverOpen(false)}
                        >
                          {preset.name}
                        </Button>
                        <p className="text-xs uppercase text-gray-500">
                          {viewLabel}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="link-gray"
                          size="xs"
                          onClick={() => {
                            setIsPopoverOpen(false);
                            setPresetBeingRenamed(preset);
                            setRenameValue(preset.name);
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          type="button"
                          variant="link-gray"
                          size="xs"
                          onClick={() => {
                            setIsPopoverOpen(false);
                            deleteFetcher.submit(
                              {
                                intent: "delete-preset",
                                presetId: preset.id,
                              },
                              { method: "post" }
                            );
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      <DialogPortal>
        <Dialog
          open={isSaveDialogOpen}
          onClose={() => {
            if (createFetcher.state !== "idle") return;
            setIsSaveDialogOpen(false);
          }}
          title="Save current filters"
        >
          <div className="flex flex-col gap-4 p-6">
            <createFetcher.Form method="post">
              <input type="hidden" name="intent" value="create-preset" />
              <input type="hidden" name="query" value={queryString} />
              <input type="hidden" name="view" value={currentView} />
              <Input
                label="Preset name"
                name="name"
                value={presetName}
                onChange={handlePresetNameChange}
                maxLength={60}
                required
              />
              <PresetNameFormError message={createError} />
              <div className="mt-6 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsSaveDialogOpen(false)}
                  disabled={createFetcher.state !== "idle"}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createFetcher.state !== "idle"}>
                  Save preset
                </Button>
              </div>
            </createFetcher.Form>
          </div>
        </Dialog>
      </DialogPortal>

      <DialogPortal>
        <Dialog
          open={!!presetBeingRenamed}
          onClose={() => {
            if (renameFetcher.state !== "idle") return;
            setPresetBeingRenamed(null);
          }}
          title="Rename preset"
        >
          <div className="flex flex-col gap-4 p-6">
            <renameFetcher.Form method="post">
              <input type="hidden" name="intent" value="rename-preset" />
              <input
                type="hidden"
                name="presetId"
                value={presetBeingRenamed?.id ?? ""}
              />
              <Input
                label="Preset name"
                name="name"
                value={renameValue}
                onChange={handleRenameChange}
                maxLength={60}
                required
              />
              <PresetNameFormError message={renameError} />
              <div className="mt-6 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPresetBeingRenamed(null)}
                  disabled={renameFetcher.state !== "idle"}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={renameFetcher.state !== "idle"}>
                  Update name
                </Button>
              </div>
            </renameFetcher.Form>
          </div>
        </Dialog>
      </DialogPortal>
    </div>
  );
}
