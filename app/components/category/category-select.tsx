import { useMemo } from "react";
import type { Category } from "@prisma/client";
import { CategorySelectNoCategories } from "./category-select-no-categories";
import { FilterInput } from "./filter-input";
import { useFilter } from "./useFilter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";

export const CategorySelect = () => {
  const {
    filter,
    filteredCategories,
    isFiltering,
    clearFilters,
    handleFilter,
  } = useFilter();

  const hasCategories = useMemo(
    () => filteredCategories.length > 0,
    [filteredCategories]
  );

  return (
    <div className="relative w-full">
      <Select name="category">
        <SelectTrigger className="">
          <SelectValue placeholder="Select category" />
        </SelectTrigger>

        <div>
          <SelectContent
            className=" w-[350px]"
            position="popper"
            align="end"
            sideOffset={4}
          >
            {!hasCategories && !isFiltering ? (
              <CategorySelectNoCategories />
            ) : (
              <>
                <div className="relative">
                  <FilterInput filter={filter} handleFilter={handleFilter} />
                  {isFiltering && (
                    <Button
                      icon="x"
                      variant="tertiary"
                      disabled={isFiltering}
                      onClick={clearFilters}
                      className="z-100 pointer-events-auto absolute  right-[14px] top-0  h-full  border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                    />
                  )}
                </div>

                <div className="border-b border-b-gray-300 py-2 ">
                  {filteredCategories.map((c: Category) => (
                    <SelectItem value={c.id} key={c.id}>
                      <Badge color={c.color} noBg>
                        {c.name}
                      </Badge>
                    </SelectItem>
                  ))}
                </div>

                <Button
                  to={"/categories/new"}
                  variant="link"
                  icon="plus"
                  className="w-full justify-start pt-4"
                >
                  Create new category
                </Button>
              </>
            )}
          </SelectContent>
        </div>
      </Select>
    </div>
  );
};
