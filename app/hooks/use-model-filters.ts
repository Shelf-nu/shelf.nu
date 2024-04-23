import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SerializeFrom } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  ModelFiltersSchema,
  type loader,
  type ModelFilters,
} from "~/routes/api+/model-filters";
import { itemsWithExtractedValue } from "~/utils/model-filters";
import useFetcherWithReset from "./use-fetcher-with-reset";

export type ModelFilterItem = {
  id: string;
  name: string;
  color?: string;
  metadata: Record<string, any>;
};

export type ModelFilterProps = {
  defaultValues?: string[];
  /** name of key in loader which is used to pass initial data */
  initialDataKey: string;
  /** name of key in loader which passing the total count */
  countKey: string;

  model: ModelFilters;

  /** If none is passed then values will not be added in query params */
  selectionMode?: "append" | "set" | "none";

  /**
   *
   * A function to extract value/id of item on basis of item data
   *
   * @example
   * (item) => JSON.stringify({ id: item.id, name: item.name })
   */
  valueExtractor?: (item: ModelFilterItem) => string;
};

const GET_ALL_KEY = "getAll";

export function useModelFilters({
  defaultValues,
  model,
  countKey,
  initialDataKey,
  selectionMode = "append",
  valueExtractor,
}: ModelFilterProps) {
  const initialData = useLoaderData<any>();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedItems, setSelectedItems] = useState<string[]>(
    defaultValues ?? []
  );

  const totalItems = initialData[countKey];

  const fetcher = useFetcherWithReset<SerializeFrom<typeof loader>>();

  const items = useMemo(() => {
    if (searchQuery && fetcher.data && !fetcher.data.error) {
      return itemsWithExtractedValue(fetcher.data.filters, valueExtractor);
    }

    return itemsWithExtractedValue(initialData[initialDataKey], valueExtractor);
  }, [fetcher.data, initialData, initialDataKey, searchQuery, valueExtractor]);

  const handleSelectItemChange = useCallback(
    (value: string) => {
      /**
       * If item selection mode is none then values are not added in
       * search params instead they are just updated in state only
       * */
      if (selectionMode === "none") {
        setSelectedItems((prev) => [...prev, value]);
      } else {
        /** If item is already there in search params then remove it */
        if (selectedItems.includes(value)) {
          /** Using Optimistic UI approach */
          setSelectedItems((prev) => prev.filter((item) => item !== value));

          setSearchParams((prev) => {
            prev.delete(model.name, value);
            return prev;
          });
        } else {
          setSelectedItems((prev) => [...prev, value]);
          /** Otherwise, add the item in search params */
          setSearchParams((prev) => {
            if (selectionMode === "append") {
              prev.append(model.name, value);
            } else {
              prev.set(model.name, value);
            }
            return prev;
          });
        }
      }
    },
    [selectedItems, model.name, setSearchParams, selectionMode]
  );

  const handleSearchQueryChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (!e.currentTarget.value) {
      clearFilters();
    } else {
      setSearchQuery(e.currentTarget.value);

      fetcher.submit(
        {
          ...model,
          queryValue: e.currentTarget.value,
          selectedValues: selectedItems,
        },
        {
          method: "GET",
          action: "/api/model-filters",
        }
      );
    }
  };

  useEffect(
    function updateSelectedValuesWhenParamsChange() {
      setSelectedItems(searchParams.getAll(model.name));
    },
    [model.name, searchParams]
  );

  const resetModelFiltersFetcher = () => {
    setSearchQuery("");
    fetcher.reset();
  };

  const clearFilters = () => {
    setSelectedItems([]);
    resetModelFiltersFetcher();

    if (selectionMode !== "none") {
      setSearchParams((prev) => {
        prev.delete(model.name);
        return prev;
      });
    }
  };

  function getAllEntries() {
    const value = model.name;

    /** Remove in case if the value already exists */
    if (searchParams.has(GET_ALL_KEY, value)) {
      setSearchParams((prev) => {
        prev.delete(GET_ALL_KEY, value);
        return prev;
      });
    } else {
      setSearchParams((prev) => {
        prev.append(GET_ALL_KEY, value);
        return prev;
      });
    }
  }

  return {
    searchQuery,
    setSearchQuery,
    totalItems,
    items,
    selectedItems,
    handleSelectItemChange,
    handleSearchQueryChange,
    resetModelFiltersFetcher,
    clearFilters,
    getAllEntries,
  };
}
