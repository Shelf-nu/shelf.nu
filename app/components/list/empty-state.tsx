import type { ReactNode } from "react";
import { useLoaderData } from "react-router";

import { useSearchParams } from "~/hooks/search-params";
import type { SearchableIndexResponse } from "~/modules/types";
import { tw } from "~/utils/tw";
import { ClearSearch } from "./filters/clear-search";
import { Button } from "../shared/button";
export interface CustomEmptyState {
  className?: string;
  customContent?: {
    title: string;
    text: ReactNode;
    newButtonRoute?: string;
    newButtonContent?: string;
    buttonProps?: any;
  };
  modelName?: {
    singular: string;
    plural: string;
  };
}

/** Params that are NOT user-applied filters */
const NON_FILTER_PARAMS = new Set([
  "s",
  "page",
  "getAll",
  "scanId",
  "redirectTo",
  "sortBy",
  "orderBy",
  "orderDirection",
  "index",
]);

export const EmptyState = ({
  className,
  customContent,
  modelName,
}: CustomEmptyState) => {
  const { search, modelName: modelNameData } =
    useLoaderData<SearchableIndexResponse>();
  const [searchParams, setSearchParams] = useSearchParams();
  const singular = modelName?.singular || modelNameData.singular;
  const plural = modelName?.plural || modelNameData.plural;

  // Detect column/advanced filters (URL params that aren't search, pagination, or sorting)
  const hasColumnFilters = Array.from(searchParams.keys()).some(
    (key) => !NON_FILTER_PARAMS.has(key)
  );

  // When there's an active search OR filter, always show contextual "no results"
  // messaging — even if customContent is provided. customContent is only
  // used for the true zero-data state (nothing active, nothing in DB).
  const hasSearch = !!search;
  const isFiltered = hasSearch || hasColumnFilters;

  const filteredTexts = hasSearch
    ? {
        title: `No ${plural} found`,
        p: `Your search for "${search}" did not match any ${plural} in the database.`,
      }
    : {
        title: `No ${plural} found`,
        p: `No ${plural} match the applied filters. Try adjusting or clearing your filters.`,
      };

  const zeroDataTexts = customContent
    ? null
    : {
        title: `No ${plural} on database`,
        p: `What are you waiting for? Create your first ${singular} now!`,
      };

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
          alt="Empty state"
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
              {zeroDataTexts!.title}
            </div>
            <p className="text-gray-600">{zeroDataTexts!.p}</p>
          </div>
        )}
      </div>
      <div className="flex justify-center gap-3">
        {isFiltered ? (
          hasSearch ? (
            <ClearSearch
              buttonProps={{
                variant: "secondary",
              }}
            >
              Clear Search
            </ClearSearch>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setSearchParams((prev) => {
                  const keysToDelete: string[] = [];
                  prev.forEach((_value, key) => {
                    if (!NON_FILTER_PARAMS.has(key)) {
                      keysToDelete.push(key);
                    }
                  });
                  keysToDelete.forEach((key) => prev.delete(key));
                  return prev;
                });
              }}
            >
              Clear Filters
            </Button>
          )
        ) : (
          customContent?.newButtonRoute && (
            <Button
              to={customContent.newButtonRoute}
              aria-label={`new ${singular}`}
              {...(customContent?.buttonProps || undefined)}
            >
              {customContent?.newButtonContent
                ? customContent.newButtonContent
                : `New ${singular}`}
            </Button>
          )
        )}
      </div>
    </div>
  );
};
