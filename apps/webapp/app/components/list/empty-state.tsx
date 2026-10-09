import type { ComponentProps, ReactNode } from "react";
import { useLoaderData, useLocation } from "react-router";

import { useSearchParams } from "~/hooks/search-params";
import { useCanArchiveAssets } from "~/hooks/use-can-archive-assets";
import type { SearchableIndexResponse } from "~/modules/types";
import { NON_FILTER_PARAMS } from "~/utils/filter-params";
import { tw } from "~/utils/tw";
import { Button } from "../shared/button";

export interface CustomEmptyState {
  className?: string;
  customContent?: {
    title: string;
    text: ReactNode;
    newButtonRoute?: string;
    newButtonContent?: string;
    buttonProps?: Partial<ComponentProps<typeof Button>>;
  };
  modelName?: {
    singular: string;
    plural: string;
  };
}

/** Paths of the asset lists that offer the Active / Archived / All menu. */
const ARCHIVED_VIEW_LIST_PATH =
  /^\/(assets|kits\/[^/]+\/assets|locations\/[^/]+\/assets)\/?$/;

export const EmptyState = ({
  className,
  customContent,
  modelName,
}: CustomEmptyState) => {
  const {
    search,
    modelName: modelNameData,
    hasActiveFilters,
  } = useLoaderData<SearchableIndexResponse>();
  const [searchParams, setSearchParams] = useSearchParams();
  const singular = modelName?.singular || modelNameData.singular;
  const plural = modelName?.plural || modelNameData.plural;

  // When there's an active search OR filter, always show contextual "no results"
  // messaging — even if customContent is provided. customContent is only
  // used for the true zero-data state (nothing active, nothing in DB).
  const hasSearch = !!search;
  const isFiltered = hasSearch || !!hasActiveFilters;

  /**
   * "Did not match any assets in the database" can be untrue on a list that
   * hides archived assets: an archived asset IS in the database, just outside
   * the Active view. Say where it went instead.
   *
   * Limited to the lists that offer the Active / Archived / All menu (the asset
   * index, a kit's assets, a location's assets; pickers never offer archived
   * assets) and to the Active view, the only one that hides something.
   */
  const { pathname } = useLocation();
  const offersArchivedView = ARCHIVED_VIEW_LIST_PATH.test(pathname);
  const archivedParam = searchParams.get("archived");
  const viewHidesArchived =
    archivedParam !== "archived" && archivedParam !== "all";
  const searchMayBeHidingArchived =
    plural === "assets" && offersArchivedView && viewHidesArchived;

  /**
   * Only members who can archive get the view menu (see `useCanArchiveAssets`),
   * so only they can be sent to it. Pointing BASE / SELF_SERVICE at a control
   * their role does not render would be worse than the original wording, so
   * they get the same fact plus the action actually open to them.
   */
  const canArchiveAssets = useCanArchiveAssets();

  const filteredTexts = hasSearch
    ? {
        title: `No ${plural} found`,
        p: !searchMayBeHidingArchived
          ? `Your search for "${search}" did not match any ${plural} in the database.`
          : canArchiveAssets
          ? `No active ${plural} match "${search}". Archived ${plural} are hidden from this view. Pick Archived from the menu on the list title.`
          : `No active ${plural} match "${search}". Archived ${plural} are hidden from your view. Ask an admin to check.`,
      }
    : {
        title: `No ${plural} found`,
        p: `No ${plural} match the applied filters. Try adjusting or clearing your filters.`,
      };

  const zeroDataTexts = {
    title: `No ${plural} on database`,
    p: `What are you waiting for? Create your first ${singular} now!`,
  };

  /** Determine which "clear" button to show */
  const clearButton = (() => {
    if (!isFiltered) return null;

    if (hasSearch && hasActiveFilters) {
      // Both search and filters active — single "Clear All" button
      return (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setSearchParams(() => new URLSearchParams());
          }}
        >
          Clear All
        </Button>
      );
    }

    if (hasSearch) {
      return (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete("s");
              return next;
            });
          }}
        >
          Clear Search
        </Button>
      );
    }

    // Only filters active
    return (
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setSearchParams((prev) => {
            const next = new URLSearchParams();
            prev.forEach((value, key) => {
              if (NON_FILTER_PARAMS.has(key)) {
                next.append(key, value);
              }
            });
            return next;
          });
        }}
      >
        Clear Filters
      </Button>
    );
  })();

  return (
    <div
      className={tw(
        "flex h-full flex-col justify-center gap-[32px] px-4 py-[100px] text-center",
        className
      )}
    >
      <div className="flex flex-col items-center">
        <img
          src="/static/images/empty-state.svg"
          alt=""
          aria-hidden="true"
          className="h-auto w-[172px]"
        />
        {isFiltered ? (
          <div>
            <div className="text-text-lg font-semibold text-gray-900">
              {filteredTexts.title}
            </div>
            <p className="text-gray-600">{filteredTexts.p}</p>
          </div>
        ) : customContent ? (
          <div>
            <div className="text-text-lg font-semibold text-gray-900">
              {customContent.title}
            </div>
            <div className="text-gray-600">{customContent.text}</div>
          </div>
        ) : (
          <div>
            <div className="text-text-lg font-semibold text-gray-900">
              {zeroDataTexts.title}
            </div>
            <p className="text-gray-600">{zeroDataTexts.p}</p>
          </div>
        )}
      </div>
      <div className="flex justify-center gap-3">
        {isFiltered
          ? clearButton
          : customContent?.newButtonRoute && (
              <Button
                to={customContent.newButtonRoute}
                aria-label={`new ${singular}`}
                {...(customContent?.buttonProps || undefined)}
              >
                {customContent?.newButtonContent
                  ? customContent.newButtonContent
                  : `New ${singular}`}
              </Button>
            )}
      </div>
    </div>
  );
};
