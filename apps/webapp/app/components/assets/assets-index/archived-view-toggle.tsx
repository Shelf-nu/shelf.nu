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
 * @see {@link file://./../../../modules/asset/utils.server.ts} (getArchivedFilterFromParams)
 * @see {@link file://./view-toggle.tsx} (sibling AvailabilityViewToggle pattern)
 */

import { Button } from "~/components/shared/button";
import { ButtonGroup } from "~/components/shared/button-group";
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

  const selectedStyles =
    "cursor-not-allowed pointer-events-none bg-gray-50 text-gray-800";

  return (
    <ButtonGroup>
      {ARCHIVED_VIEW_OPTIONS.map((option) => {
        const isSelected = current === option.value;
        return (
          <Button
            key={option.value}
            variant="secondary"
            type="button"
            className={tw(
              "px-[14px] py-[10px] font-normal text-gray-600",
              isSelected ? selectedStyles : ""
            )}
            disabled={isSelected}
            onClick={() => {
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
          </Button>
        );
      })}
    </ButtonGroup>
  );
}
