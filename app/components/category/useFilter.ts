import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { Category } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";

export const useFilter = () => {
  const [filter, setFilter] = useState("");
  const data = useLoaderData();

  const filteredCategories = useMemo(
    () =>
      data.categories.filter((cat: Category) =>
        cat.name.toLowerCase().includes(filter.toLowerCase())
      ),
    [filter, data.categories]
  );

  const isFiltering = filter !== "";

  const handleFilter = (e: ChangeEvent<HTMLInputElement>) => {
    setFilter(() => e.target.value);
  };

  const clearFilters = () => {
    setFilter(() => "");
  };

  return {
    filter,
    filteredCategories,
    isFiltering,
    handleFilter,
    clearFilters,
  };
};
