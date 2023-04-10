import { useMemo } from "react";
import type { ChangeEvent } from "react";
import type { Category } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { atom, useAtom, useAtomValue } from "jotai";

const filterAtom = atom("");
const isFilteringAtom = atom((get) => get(filterAtom) !== "");

export const useFilter = () => {
  const [filter, setFilter] = useAtom(filterAtom);
  const isFiltering = useAtomValue(isFilteringAtom);

  /** Get the categories from the loader */
  const categories = useLoaderData().categories;

  const filteredCategories = useMemo(
    () =>
      atom(
        categories.filter((cat: Category) =>
          cat.name.toLowerCase().includes(filter.toLowerCase())
        )
      ),
    [filter, categories]
  ).init;

  const handleFilter = (e: ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value);
  };

  const clearFilters = () => {
    setFilter("");
  };

  return {
    filter,
    filteredCategories,
    isFiltering,
    handleFilter,
    clearFilters,
  };
};
