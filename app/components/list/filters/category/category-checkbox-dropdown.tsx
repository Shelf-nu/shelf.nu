import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Category } from "@prisma/client";

import { useAtom, useAtomValue } from "jotai";

import { CategorySelectNoCategories } from "~/components/category/category-select-no-categories";

import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import type { WithDateFields } from "~/modules/types";
import { useCategorySearch } from "../../../category/useCategorySearch";
import Input from "../../../forms/input";
import { CheckIcon, ChevronRight } from "../../../icons/library";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../shared/dropdown";
import {
  addInitialSelectedCategoriesAtom,
  addOrRemoveSelectedCategoryIdAtom,
  clearCategoryFiltersAtom,
  selectedCategoriesAtom,
  toggleIsFilteringCategoriesAtom,
} from "../atoms/category";

export const CategoryCheckboxDropdown = () => {
  const [params] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>();
  const {
    categorySearch,
    refinedCategories,
    isSearchingCategories,
    handleCategorySearch,
    clearCategorySearch,
  } = useCategorySearch();

  const { items } = useAtomValue(selectedCategoriesAtom);
  const [, setInitialSelect] = useAtom(addInitialSelectedCategoriesAtom);
  const [, clearFilters] = useAtom(clearCategoryFiltersAtom);

  const uncategorizedItemObj: any = {
    id: "uncategorized",
    name: "uncategorized",
    color: "#808080",
  };

  const hasCategories = useMemo(
    () => refinedCategories.length > 0,
    [refinedCategories]
  );

  /** Sets the initial selected categories based on the url params. Runs on first load only */
  useEffect(() => {
    setInitialSelect(params.getAll("category"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full text-right">
      <div className="hidden">
        {items.map((cat) => (
          <input
            type="checkbox"
            checked
            value={cat}
            key={cat}
            name="category"
            readOnly
          />
        ))}
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className="inline-flex items-center gap-2 font-normal text-gray-500">
          Categories <ChevronRight className="hidden rotate-90 md:inline" />{" "}
          {items.length > 0 && (
            <div className="flex size-6 items-center justify-center rounded-full bg-gray-100 px-2 py-[2px] text-xs font-medium text-gray-700">
              {items.length}
            </div>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-[300px] w-[290px] overflow-y-auto md:w-[350px]"
        >
          {!hasCategories && !isSearchingCategories ? (
            <CategorySelectNoCategories />
          ) : (
            <>
              <div className="filters-form relative">
                <div className="mb-[6px] flex w-full justify-between text-xs text-gray-500">
                  <div>Filter by category</div>
                  {items.length > 0 ? (
                    <>
                      <Button
                        as="button"
                        onClick={clearFilters}
                        variant="link"
                        className="whitespace-nowrap text-xs font-normal text-gray-500 hover:text-gray-600"
                      >
                        Clear filter
                      </Button>
                    </>
                  ) : null}
                </div>
                <Input
                  type="text"
                  label="Search categories"
                  placeholder="Search categories"
                  hideLabel
                  className="mb-2 text-gray-500"
                  icon="category"
                  autoFocus
                  value={categorySearch}
                  onChange={handleCategorySearch}
                  ref={inputRef}
                />
                {isSearchingCategories && (
                  <Button
                    icon="x"
                    variant="tertiary"
                    disabled={isSearchingCategories}
                    onClick={clearCategorySearch}
                    className="z-100 pointer-events-auto absolute right-[14px] top-1/2 translate-y-1/2 border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                  />
                )}
              </div>
              <div className="">
                <CheckboxItem
                  key={uncategorizedItemObj.id}
                  category={uncategorizedItemObj}
                  selected={items}
                />
                {refinedCategories.map((c) => (
                  <CheckboxItem key={c.id} category={c} selected={items} />
                ))}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const CheckboxItem = ({
  category,
  selected,
}: {
  category: WithDateFields<Category, string>;
  selected: string[];
}) => {
  const [, toggleIsFiltering] = useAtom(toggleIsFilteringCategoriesAtom);
  const [, addOrRemoveSelectedId] = useAtom(addOrRemoveSelectedCategoryIdAtom);

  const handleOnSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      /** Mark the cateogry filter as touched */
      toggleIsFiltering();
      /** Update the selected state. */
      addOrRemoveSelectedId(e);
    },
    [addOrRemoveSelectedId, toggleIsFiltering]
  );

  return (
    <label
      key={category.id}
      htmlFor={category.name}
      className="relative flex cursor-default select-none items-center rounded px-2 py-1.5 text-sm font-medium outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100 "
    >
      <Badge color={category.color} withDot={false} noBg>
        {category.name}
      </Badge>
      <input
        id={category.name}
        type="checkbox"
        value={category.id}
        className="hidden"
        checked={selected.includes(category.id)}
        onChange={handleOnSelect}
      />
      {selected.includes(category.id) ? (
        <span className="absolute right-2 flex  items-center justify-center text-primary">
          <CheckIcon />
        </span>
      ) : null}
    </label>
  );
};
