import { Pencil, Trash2 } from "lucide-react";
import { Form } from "react-router";
import { formatFilterSummary } from "~/modules/asset-filter-presets/format-filter-summary";
import type { Column } from "~/modules/asset-index-settings/helpers";
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
 * @param onApply - Callback when preset should be applied
 * @param onRename - Callback when rename button is clicked
 */
export function PresetListItem({
  id,
  preset,
  isActive,
  isSelected = false,
  columns,
  onApply,
  onRename,
}: {
  id?: string;
  preset: NormalizedPreset;
  isActive: boolean;
  isSelected?: boolean;
  columns: Column[];
  onApply: (preset: NormalizedPreset) => void;
  onRename: (preset: NormalizedPreset) => void;
}) {
  const filterSummary = formatFilterSummary(preset.query, columns);

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
        <div
          className={
            "truncate text-sm " +
            (isActive
              ? "font-semibold text-primary"
              : "font-medium text-gray-900")
          }
        >
          {preset.name}
        </div>
        <div className="truncate text-xs text-gray-500">{filterSummary}</div>
      </button>

      {/* Rename and delete action buttons */}
      <div className="mt-0.5 flex gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
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
        <Form method="post" className="inline">
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
        </Form>
      </div>
    </div>
  );
}
