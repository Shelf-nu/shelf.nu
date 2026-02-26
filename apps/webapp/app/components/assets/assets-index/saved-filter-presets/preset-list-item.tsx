import type { ReactElement } from "react";
import { Pencil, Trash2, Check } from "lucide-react";
import { useFetcher } from "react-router";
import { Spinner } from "~/components/shared/spinner";
import type { Column } from "~/modules/asset-index-settings/helpers";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { StarButton } from "./star-button";

/** Normalized preset without view field */
export type NormalizedPreset = {
  id: string;
  name: string;
  query: string;
  starred: boolean;
};

/**
 * Individual preset list item with apply, rename, and delete actions.
 *
 * @param id - DOM id for keyboard navigation
 * @param preset - The preset data to display
 * @param isActive - Whether this preset is currently active
 * @param isSelected - Whether this preset is selected via keyboard navigation
 * @param columns - Column definitions for formatting filter summary
 * @param formatPreview - Function to format and render filter preview
 * @param onApply - Callback when preset should be applied
 * @param onRename - Callback when rename button is clicked
 */
export function PresetListItem({
  id,
  preset,
  isActive,
  isSelected = false,
  isApplying = false,
  columns,
  formatPreview,
  onApply,
  onRename,
}: {
  id?: string;
  preset: NormalizedPreset;
  isActive: boolean;
  isSelected?: boolean;
  isApplying?: boolean;
  columns: Column[];
  formatPreview: (query: string, columns: Column[]) => ReactElement;
  onApply: (preset: NormalizedPreset) => void;
  onRename: (preset: NormalizedPreset) => void;
}) {
  // Use unique fetcher key per preset to allow concurrent delete requests
  const deleteFetcher = useFetcher({ key: `delete-preset-${preset.id}` });

  // Check if this preset is being deleted
  const isDeleting =
    isFormProcessing(deleteFetcher.state) &&
    deleteFetcher.formData?.get("presetId") === preset.id;

  // Hide the preset optimistically when being deleted
  if (isDeleting) {
    return null;
  }

  return (
    <div
      id={id}
      className={tw(
        "group flex items-start gap-2 rounded p-2 hover:bg-gray-50",
        isSelected && "bg-gray-50"
      )}
    >
      {/* Star button */}
      <StarButton preset={preset} />

      {/* Preset info - name and filter summary */}
      <button
        type="button"
        onClick={() => onApply(preset)}
        className="flex-1 overflow-hidden text-left"
        title={preset.name}
      >
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
          <span className="truncate">{preset.name}</span>
          {/* Loading indicator when applying preset */}
          {isApplying && (
            <div className="shrink-0" title="Applying preset...">
              <Spinner className="size-4" />
            </div>
          )}
          {/* Active indicator - checkmark (only show if not currently applying) */}
          {isActive && !isApplying && (
            <div
              className="flex size-4 shrink-0 items-center justify-center rounded-full bg-gray-100"
              title="Currently active"
            >
              <Check className="size-3 text-gray-600" />
            </div>
          )}
        </div>
        {formatPreview(preset.query, columns)}
      </button>

      {/* Rename and delete action buttons */}
      <div
        className={tw(
          "mt-0.5 flex gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100"
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRename(preset);
          }}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Rename"
        >
          <Pencil className="size-3.5" />
        </button>
        <deleteFetcher.Form method="post" className="inline">
          <input type="hidden" name="intent" value="delete-preset" />
          <input type="hidden" name="presetId" value={preset.id} />
          <button
            type="submit"
            onClick={(e) => {
              e.stopPropagation();
              if (!confirm("Delete this preset?")) {
                e.preventDefault();
              }
            }}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
            title="Delete"
          >
            <Trash2 className="size-3.5" />
          </button>
        </deleteFetcher.Form>
      </div>
    </div>
  );
}
