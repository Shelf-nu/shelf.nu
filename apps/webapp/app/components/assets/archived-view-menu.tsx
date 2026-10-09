/**
 * Archived View Menu
 *
 * The title of an asset list, turned into a small menu that picks which set it
 * shows: Active (the default), Archived or All. It drives the `?archived=`
 * search param, which the list's loader resolves through
 * `resolveArchivedViewForMember`, so the server decides what the member may
 * actually see; this control only asks.
 *
 * It lives on the title because it changes WHICH assets the list holds, which
 * is what the title and the count under it describe. Archiving is orthogonal
 * to an asset's status, so it is not one of the filters.
 *
 * Render it only for members holding `asset: archive` (`useCanArchiveAssets`).
 * Everyone else gets the plain title and the Active set.
 *
 * @see {@link file://./../../modules/asset/data.server.ts} `resolveArchivedViewForMember`
 * @see {@link file://./../list/index.tsx} the `titleContent` slot
 */

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { useSearchParams } from "~/hooks/search-params";
import { tw } from "~/utils/tw";

/**
 * The Active / Archived / All view. Same values as the server's
 * `ArchivedFilter` (`~/modules/asset/types`), declared here so this client
 * component does not pull the asset types module, and with it Prisma's types,
 * into the checker's path.
 */
type ArchivedFilter = "active" | "archived" | "all";

/** The views in menu order, with the word each adds to the title. */
const ARCHIVED_VIEWS: { value: ArchivedFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

/**
 * Reads the view from the URL. Anything unrecognised is Active, matching how
 * the server reads the same param.
 *
 * @param raw - The `archived` search param
 * @returns The view the list is showing
 */
function toArchivedView(raw: string | null): ArchivedFilter {
  return raw === "archived" || raw === "all" ? raw : "active";
}

/**
 * The view an asset list is showing: the `?archived=` choice when the member
 * can archive, Active otherwise. Mirrors the loader's
 * `resolveArchivedViewForMember`, so copy written for a view (an empty state)
 * matches the rows the server returned.
 *
 * @param canArchiveAssets - From `useCanArchiveAssets()`
 * @returns The view the list is showing
 */
export function useArchivedView(canArchiveAssets: boolean): ArchivedFilter {
  const [searchParams] = useSearchParams();
  return canArchiveAssets
    ? toArchivedView(searchParams.get("archived"))
    : "active";
}

/**
 * The list title for a view: the plain plural for Active, so the default looks
 * exactly like a list without the menu, and a qualified one otherwise.
 *
 * @param view - The selected view
 * @param plural - The list's noun, lower case ("assets")
 * @returns e.g. "Assets", "Archived assets", "All assets"
 */
export function archivedViewTitle(view: ArchivedFilter, plural: string) {
  if (view === "archived") return `Archived ${plural}`;
  if (view === "all") return `All ${plural}`;
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}

/**
 * Renders the list title as a menu trigger for the Active / Archived / All
 * view.
 *
 * @param props.plural - The list's noun in lower case, e.g. "assets"
 */
export function ArchivedViewMenu({ plural }: { plural: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const current = toArchivedView(searchParams.get("archived"));

  function selectView(view: ArchivedFilter) {
    setOpen(false);
    if (view === current) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (view === "active") {
        next.delete("archived");
      } else {
        next.set("archived", view);
      }
      // A page offset from the previous set can be out of range in this one.
      next.delete("page");
      return next;
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Showing ${archivedViewTitle(
            current,
            plural
          ).toLowerCase()}. Change view`}
          className="-mx-1 inline-flex items-center gap-1 rounded px-1 text-left font-semibold normal-case text-gray-900 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        >
          {archivedViewTitle(current, plural)}
          <ChevronDown
            aria-hidden="true"
            className={tw(
              "size-4 text-gray-600 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="z-[999999] w-48 rounded border border-gray-200 bg-white py-1 shadow-lg"
        >
          <div role="group" aria-label="Asset view">
            {ARCHIVED_VIEWS.map((view) => {
              const isSelected = view.value === current;
              return (
                <button
                  key={view.value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectView(view.value)}
                  className={tw(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none",
                    isSelected && "bg-gray-50 font-medium text-gray-900"
                  )}
                >
                  {view.label}
                  {isSelected ? (
                    <Check
                      aria-hidden="true"
                      className="size-4 text-primary-500"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
