import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Category } from "@prisma/client";
import { useSearchParams } from "@remix-run/react";
import { useAtom } from "jotai";

import { ClientOnly } from "remix-utils";
import { CategorySelectNoCategories } from "~/components/category/category-select-no-categories";
import {
  addInitialSelectedCategoriesAtom,
  addOrRemoveSelectedIdAtom,
  isFilteringCategoriesAtom,
  selectedCategoriesAtom,
} from "./atoms";

import { useFilter } from "../../category/useFilter";
import Input from "../../forms/input";
import { ChevronRight } from "../../icons";

import { Badge, Button } from "../../shared";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../shared/dropdown";

export const CategoryCheckboxDropdown = () => {
  const [params] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>();
  const {
    filter,
    filteredCategories,
    isFiltering,
    clearFilters,
    handleFilter,
  } = useFilter();

  const [selected] = useAtom(selectedCategoriesAtom);
  const [, addOrRemoveSelectedId] = useAtom(addOrRemoveSelectedIdAtom);
  const [, setInitialSelect] = useAtom(addInitialSelectedCategoriesAtom);
  const [, toggleIsFiltering] = useAtom(isFilteringCategoriesAtom);

  const handleOnSelect = useCallback(
    (e: Event) => {
      /** Mark the cateogry filter as touched */
      toggleIsFiltering(true);

      /** Update the selected state. */
      addOrRemoveSelectedId(e);
    },
    [addOrRemoveSelectedId, toggleIsFiltering]
  );

  const hasCategories = useMemo(
    () => filteredCategories.length > 0,
    [filteredCategories]
  );

  /** Sets the initial selected categories based on the url params. Runs on first load only */
  useEffect(() => {
    setInitialSelect(params.getAll("category"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ClientOnly>
      {() => (
        <div>
          <div className="relative w-full text-right">
            <div className="hidden">
              {selected.map((cat) => (
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
                Categories <ChevronRight className="rotate-90" />{" "}
                {selected.length > 0 && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 px-2 py-[2px] text-xs font-medium text-gray-700">
                    {selected.length}
                  </div>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className=" w-[350px]">
                {hasCategories ? (
                  <>
                    <div className="relative">
                      <Input
                        type="text"
                        label="Filter categories"
                        placeholder="Filter categories"
                        hideLabel
                        className="mb-2 text-gray-500"
                        icon="coins"
                        value={filter}
                        onChange={handleFilter}
                        ref={inputRef}
                      />
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
                    <div className="">
                      {filteredCategories.map((c: Category) => (
                        <DropdownMenuCheckboxItem
                          key={c.id}
                          checked={selected.includes(c.id)}
                          onSelect={handleOnSelect}
                          data-category-id={c.id}
                        >
                          <Badge color={c.color} noBg>
                            {c.name}
                          </Badge>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </div>
                  </>
                ) : (
                  <CategorySelectNoCategories />
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </ClientOnly>
  );
};
