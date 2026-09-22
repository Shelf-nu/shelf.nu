import type { ReactElement } from "react";
import { Pencil, Trash2, Check } from "lucide-react";
import { useFetcher } from "react-router";
import { Spinner } from "~/components/shared/spinner";
import type { Column } from "~/modules/asset-index-settings/helpers";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { ShareButton } from "./share-button";
import { StarButton } from "./star-button";

/** One row of the saved-filters list, as the server hands it to the client. */
export type NormalizedPreset = {
  id: string;
  name: string;
  query: string;
  starred: boolean;
  /** Published to the workspace: everyone who can open this list may apply it. */
  shared: boolean;
  /** True when the viewer owns it — the only rows carrying a star and a rename. */
  isOwn: boolean;
  /** Owner's name for the "Shared by …" line. Null on the viewer's own rows. */
  sharedByName: string | null;
};

/**
 * Individual preset list item with apply, rename, and delete actions.
 *
 * A row the viewer does not own is read-only: apply it, and nothing else — a
 * shared view belongs to the person who saved it. The exception is a viewer who
 * may manage the workspace's shared views (`assetIndexSettings:update`), who can
 * also retire or delete one, so a view does not outlive its owner's membership.
 *
 * @param id - DOM id for keyboard navigation
 * @param preset - The preset data to display
 * @param isActive - Whether this preset is currently active
 * @param isSelected - Whether this preset is selected via keyboard navigation
 * @param isApplying - Whether this preset's apply navigation is in flight
 * @param canManageSharing - Whether the viewer holds `assetIndexSettings:update`
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
  canManageSharing = false,
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
  canManageSharing?: boolean;
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

  // The owner may always delete their own; managing the workspace's shared
  // views extends that to a shared row, never to someone's private preset.
  const canDelete = preset.isOwn || canManageSharing;

  return (
    <div
      id={id}
      className={tw(
        "group flex items-start gap-2 rounded p-2 hover:bg-gray-50",
        isSelected && "bg-gray-50"
      )}
    >
      {/* Star: the owner's own shortcut, so only their rows carry one. The
          empty slot keeps a shared row aligned with the viewer's own. */}
      {preset.isOwn ? (
        <StarButton preset={preset} />
      ) : (
        <span className="mt-0.5 size-4" />
      )}

      {/* Share toggle. A viewer who may not share reads the state off the
          "Shared by …" line instead, so the slot is theirs to skip. */}
      {canManageSharing ? <ShareButton preset={preset} /> : null}

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
        {preset.sharedByName ? (
          <div className="truncate text-xs text-gray-500">
            Shared by {preset.sharedByName}
          </div>
        ) : null}
        {formatPreview(preset.query, columns)}
      </button>

      {/* Rename and delete action buttons */}
      <div
        className={tw(
          "mt-0.5 flex gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100"
        )}
      >
        {/* Rename stays with the owner: the name is theirs to choose */}
        {preset.isOwn ? (
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
        ) : null}
        {canDelete ? (
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
        ) : null}
      </div>
    </div>
  );
}
