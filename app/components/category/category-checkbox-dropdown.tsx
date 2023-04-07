import { useEffect, useRef } from "react";
import type { Category } from "@prisma/client";
import { useSearchParams } from "@remix-run/react";
import { atom, useAtom } from "jotai";

import { ClientOnly } from "remix-utils";
import { useFilter } from "./useFilter";
import Input from "../forms/input";
import { ChevronRight } from "../icons";

import { Badge, Button } from "../shared";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../shared/dropdown";

export const selectedCategoriesAtom = atom<string[]>([]);
const addInitialSelectedCategoriesAtom = atom(
  null,
  (_get, set, selected: string[]) => {
    set(selectedCategoriesAtom, selected);
  }
);

const addOrRemoveSelectedIdAtom = atom(null, (_get, set, event: Event) => {
  set(selectedCategoriesAtom, (prev) => {
    event.preventDefault();
    const node = event.target as HTMLDivElement;
    const id = node.dataset.categoryId as string;
    const newSelected = prev.includes(id)
      ? prev.filter((string) => string !== id)
      : [...prev, id];
    return newSelected;
  });
});

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
              <DropdownMenuContent align="end">
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
                      onSelect={addOrRemoveSelectedId}
                      data-category-id={c.id}
                    >
                      <Badge color={c.color} noBg>
                        {c.name}
                      </Badge>
                    </DropdownMenuCheckboxItem>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </ClientOnly>
  );
};
