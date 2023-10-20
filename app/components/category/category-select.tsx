import { useMemo } from "react";
import { CategorySelectNoCategories } from "./category-select-no-categories";
import { FilterInput } from "./filter-input";
import { useCategorySearch } from "./useCategorySearch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";

export const CategorySelect = ({ defaultValue }: { defaultValue?: string }) => {
  /** This takes care of the search bar inside the dropdown */
  const {
    categorySearch,
    refinedCategories,
    isSearchingCategories,
    handleCategorySearch,
    clearCategorySearch,
  } = useCategorySearch();

  const hasCategories = useMemo(
    () => refinedCategories.length > 0,
    [refinedCategories]
  );

  return (
    <div className="relative w-full">
      <Select name="category" defaultValue={defaultValue || undefined}>
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
            {!hasCategories && !isSearchingCategories ? (
              <CategorySelectNoCategories />
            ) : (
              <>
                <div className="relative">
                  <FilterInput
                    filter={categorySearch}
                    handleFilter={handleCategorySearch}
                  />
                  {isSearchingCategories && (
                    <Button
                      icon="x"
                      variant="tertiary"
                      disabled={isSearchingCategories}
                      onClick={clearCategorySearch}
                      className="z-100 pointer-events-auto absolute  right-[14px] top-0  h-full  border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                    />
                  )}
                </div>

                <div className="border-b border-b-gray-300 py-2 ">
                  <SelectItem value={"uncategorized"} key={"uncategorized"}>
                    <Badge color={"#808080"} noBg withDot={false}>
                      Uncategorized
                    </Badge>
                  </SelectItem>
                  {refinedCategories.map((c) => (
                    <SelectItem value={c.id} key={c.id}>
                      <Badge color={c.color} noBg withDot={false}>
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
