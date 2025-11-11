import { useMemo } from "react";
import type { ChangeEvent } from "react";
import type { Category } from "@prisma/client";
import { useLoaderData } from "react-router";
import { atom, useAtom, useAtomValue } from "jotai";

const searchAtom = atom("");
const isSearchingAtom = atom((get) => get(searchAtom) !== "");

export const useCategorySearch = () => {
  const [categorySearch, setCategorySearch] = useAtom(searchAtom);
  const isSearchingCategories = useAtomValue(isSearchingAtom);

  /** Get the categories from the loader */
  const { categories } = useLoaderData<{
    categories: Category[];
  }>();

  const refinedCategories = useMemo(
    () =>
      atom(
        categories.filter((cat) =>
          cat.name.toLowerCase().includes(categorySearch.toLowerCase())
        )
      ),
    [categorySearch, categories]
  ).init;

  const handleCategorySearch = (e: ChangeEvent<HTMLInputElement>) => {
    setCategorySearch(e.target.value);
  };

  const clearCategorySearch = () => {
    setCategorySearch("");
  };

  return {
    categorySearch,
    refinedCategories,
    isSearchingCategories,
    handleCategorySearch,
    clearCategorySearch,
  };
};
