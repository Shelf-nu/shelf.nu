import type { ComponentProps, ReactNode } from "react";
import { useLoaderData } from "react-router";

import { useSearchParams } from "~/hooks/search-params";
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
  const [, setSearchParams] = useSearchParams();
  const singular = modelName?.singular || modelNameData.singular;
  const plural = modelName?.plural || modelNameData.plural;

  // When there's an active search OR filter, always show contextual "no results"
  // messaging — even if customContent is provided. customContent is only
  // used for the true zero-data state (nothing active, nothing in DB).
  const hasSearch = !!search;
  const isFiltered = hasSearch || !!hasActiveFilters;

  const filteredTexts = hasSearch
    ? {
        title: `No ${plural} found`,
        p: `Your search for "${search}" did not match any ${plural} in the database.`,
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
            <div className="text-text-lg font-semibold text-color-900">
              {filteredTexts.title}
            </div>
            <p className="text-color-600">{filteredTexts.p}</p>
          </div>
        ) : customContent ? (
          <div>
            <div className="text-text-lg font-semibold text-color-900">
              {customContent.title}
            </div>
            <div className="text-color-600">{customContent.text}</div>
          </div>
        ) : (
          <div>
            <div className="text-text-lg font-semibold text-color-900">
              {zeroDataTexts.title}
            </div>
            <p className="text-color-600">{zeroDataTexts.p}</p>
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
