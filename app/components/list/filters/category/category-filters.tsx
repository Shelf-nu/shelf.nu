import { useAtom, useAtomValue } from "jotai";
import { Button } from "~/components/shared";
import { CategoryCheckboxDropdown } from "./category-checkbox-dropdown";
import { clearCategoryFiltersAtom, selectedCategoriesAtom } from "../atoms";

export const CategoryFilters = () => {
  const selectedCategories = useAtomValue(selectedCategoriesAtom);
  const [, clearFilters] = useAtom(clearCategoryFiltersAtom);

  return (
    <div className="inline-flex w-full shrink-0 justify-end gap-2 p-3 md:w-1/2 md:p-0 lg:gap-4 xl:w-1/4">
      {selectedCategories.items.length > 0 ? (
        <>
          <Button
            as="button"
            onClick={clearFilters}
            variant="link"
            className="block max-w-none text-xs font-normal  text-gray-500 hover:text-gray-600"
          >
            Clear filters
          </Button>
          <div className="text-gray-500"> | </div>
        </>
      ) : null}
      <div>
        <CategoryCheckboxDropdown />
      </div>
    </div>
  );
};
