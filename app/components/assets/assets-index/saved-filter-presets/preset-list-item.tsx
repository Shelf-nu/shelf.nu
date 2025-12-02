import { Pencil, Trash2 } from "lucide-react";
import { Form } from "react-router";

/** Normalized preset without view field */
export type NormalizedPreset = {
  id: string;
  name: string;
  query: string;
};

/**
 * Individual preset list item with apply, rename, and delete actions.
 *
 * @param preset - The preset data to display
 * @param isActive - Whether this preset is currently active
 * @param onApply - Callback when preset should be applied
 * @param onRename - Callback when rename button is clicked
 */
export function PresetListItem({
  preset,
  isActive,
  onApply,
  onRename,
}: {
  preset: NormalizedPreset;
  isActive: boolean;
  onApply: (preset: NormalizedPreset) => void;
  onRename: (preset: NormalizedPreset) => void;
}) {
  return (
    <div className="group flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
      {/* Apply preset button */}
      <button
        type="button"
        onClick={() => onApply(preset)}
        className={
          "flex-1 truncate text-left text-sm " +
          (isActive ? "font-semibold text-primary" : "text-gray-700")
        }
        title={preset.name}
      >
        {preset.name}
      </button>

      {/* Rename and delete action buttons */}
      <div className="flex gap-1 opacity-0 group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onRename(preset)}
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
