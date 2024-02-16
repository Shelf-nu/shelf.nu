import type { ChangeEvent } from "react";
import { useCallback, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import type { AllowedModelNames } from "~/routes/api+/model-filters";
import { resetFetcher } from "~/utils/fetcher";

export type ModelFilterItem = {
  id: string;
  name: string;
  color?: string;
  metadata: Record<string, any>;
};

export type ModelFilterProps = {
  /** name of key in loader which is used to pass initial data */
  initialDataKey: string;
  /** name of key in loader which passing the total count */
  countKey: string;
  model: {
    /** name of the model for which the query has to run */
    name: AllowedModelNames;
    /** name of key for which we have to search the value */
    key: string;
  };
  selectionMode?: "append" | "set";
};

export function useModelFilters({
  model,
  countKey,
  initialDataKey,
  selectionMode = "append",
}: ModelFilterProps) {
  const initialData = useLoaderData<any>();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedItems = searchParams.getAll(model.name);
  const totalItems = initialData[countKey];
  const fetcher = useFetcher<Array<ModelFilterItem>>();

  const items = useMemo(() => {
    if (fetcher.data) {
      return fetcher.data;
    }

    return (initialData[initialDataKey] ?? []) as Array<ModelFilterItem>;
  }, [fetcher.data, initialData, initialDataKey]);

  const handleSelectItemChange = useCallback(
    (value: string) => {
      /** If item is already there in search params then remove it */
      if (selectedItems.includes(value)) {
        setSearchParams((prev) => {
          prev.delete(model.name, value);
          return prev;
        });
      } else {
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
    },
    [selectedItems, model.name, setSearchParams, selectionMode]
  );

  const handleSearchQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.currentTarget.value);
    if (e.currentTarget.value) {
      fetcher.submit(
        {
          model: model.name,
          queryKey: model.key as string,
          queryValue: e.currentTarget.value,
          selectedValues: selectedItems,
        },
        { method: "GET", action: "/api/model-filters" }
      );
    }
  };

  const resetModelFiltersFetcher = () => {
    resetFetcher(fetcher);
  };

  const clearFilters = () => {
    resetModelFiltersFetcher();
    setSearchParams((prev) => {
      prev.delete(model.name);
      return prev;
    });
  };

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
  };
}
