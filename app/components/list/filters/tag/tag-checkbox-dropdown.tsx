import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Category } from "@prisma/client";
import { useSearchParams } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";

import { CategorySelectNoCategories } from "~/components/category/category-select-no-categories";

import { useCategorySearch } from "../../../category/useCategorySearch";
import Input from "../../../forms/input";
import { CheckIcon, ChevronRight } from "../../../icons";

import { Badge, Button } from "../../../shared";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../shared/dropdown";
import {
  addInitialSelectedTagsAtom,
  addOrRemoveSelectedTagIdAtom,
  selectedTagsAtom,
  toggleIsFilteringTagsAtom,
} from "../atoms";

export const TagCheckboxDropdown = () => {
  const [params] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>();
  const {
    categorySearch,
    refinedCategories,
    isSearchingCategories,
    handleCategorySearch,
    clearCategorySearch,
  } = useCategorySearch();

  const { items } = useAtomValue(selectedTagsAtom);
  const [, setInitialSelect] = useAtom(addInitialSelectedTagsAtom);

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
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center gap-2 text-gray-500">
          Tags <ChevronRight className="rotate-90" />{" "}
          {items.length > 0 && (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 px-2 py-[2px] text-xs font-medium text-gray-700">
              {items.length}
            </div>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[290px] md:w-[350px]">
          {!hasCategories && !isSearchingCategories ? (
            <CategorySelectNoCategories />
          ) : (
            <>
              <div className="relative">
                <Input
                  type="text"
                  label="Search categories"
                  placeholder="Search categories"
                  hideLabel
                  className="mb-2 text-gray-500"
                  icon="coins"
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
                    className="z-100 pointer-events-auto absolute  right-[14px] top-0  h-full  border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                  />
                )}
              </div>
              <div className="">
                {refinedCategories.map((c: Category) => (
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
  category: Category;
  selected: string[];
}) => {
  const [, toggleIsFiltering] = useAtom(toggleIsFilteringTagsAtom);
  const [, addOrRemoveSelectedId] = useAtom(addOrRemoveSelectedTagIdAtom);

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
      className="relative flex cursor-default select-none items-center rounded-lg px-2 py-1.5 text-sm font-medium outline-none focus:bg-gray-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 "
    >
      <Badge color={category.color} noBg>
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
