/**
 * Archived View Toggle
 *
 * A three-way segmented control (Active / Archived / All) for the asset index
 * that drives the `?archived=` search param. This is the global "view
 * dimension" agreed in issue #382 — deliberately SEPARATE from the per-status
 * (Available / In custody / Checked out) StatusFilter, since archiving is
 * orthogonal to an asset's live status.
 *
 * Default (no param) = Active, so archived assets stay hidden unless the user
 * explicitly switches to Archived/All (e.g. to reinstate one).
 *
 * ## Why this doesn't use `ButtonGroup`
 *
 * The shared `ButtonGroup` marks the current option `disabled` and paints it
 * `bg-gray-50 text-gray-500`, which renders the SELECTED item at LOWER contrast
 * than the ones you are not on — it recedes instead of standing out — and
 * `disabled` makes screen readers announce the current view as "unavailable"
 * rather than "pressed".
 *
 * That reads acceptably on the two-way icon toggles next to it, but not on a
 * three-way text control that sits beside the status filter's own "All"
 * dropdown: three loose buttons and two "All" labels in a row are hard to tell
 * apart. So this renders the standard segmented-control idiom instead — one
 * recessed track binding the three options together, with the current one
 * lifted out of it in white — which also makes the group read as a single
 * control rather than three buttons that happen to be adjacent.
 *
 * @see {@link file://./../../../modules/asset/utils.server.ts} (getArchivedFilterFromParams)
 */

import { useSearchParams } from "~/hooks/search-params";
import { tw } from "~/utils/tw";

const ARCHIVED_VIEW_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
] as const;

/**
 * Renders the Active/Archived/All segmented control.
 */
export function ArchivedViewToggle() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("archived");
  const current =
    raw === "archived" || raw === "all" ? raw : ("active" as const);

  return (
    <div
      role="group"
      aria-label="Show archived assets"
      /* p-0.5 + the buttons' py-2 lands on the same 42px as the sibling
         filter controls, so the row's baseline stays even. */
      className="inline-flex items-center rounded border border-gray-300 bg-gray-50 p-0.5"
    >
      {ARCHIVED_VIEW_OPTIONS.map((option) => {
        const isSelected = current === option.value;
        return (
          <button
            key={option.value}
            type="button"
            /**
             * `aria-pressed` rather than `disabled`: the current option stays
             * focusable, so a keyboard user can tab onto it and hear which view
             * they are in. Re-selecting is a no-op below.
             */
            aria-pressed={isSelected}
            className={tw(
              "rounded-sm px-3 py-2 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
              isSelected
                ? "shadow-xs bg-white font-semibold text-gray-900"
                : "font-normal text-gray-600 hover:text-gray-900"
            )}
            onClick={() => {
              if (isSelected) return;

              setSearchParams((prev) => {
                const newParams = new URLSearchParams(prev);
                if (option.value === "active") {
                  newParams.delete("archived");
                } else {
                  newParams.set("archived", option.value);
                }
                // Reset pagination when the view changes so we don't land on an
                // out-of-range page.
                newParams.delete("page");
                return newParams;
              });
            }}
            title={`Show ${option.label.toLowerCase()} assets`}
            aria-label={`Show ${option.label.toLowerCase()} assets`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
