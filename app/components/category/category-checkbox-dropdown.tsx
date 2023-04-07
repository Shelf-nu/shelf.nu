import { useRef } from "react";
import type { Category } from "@prisma/client";
import { Provider, atom, useAtom } from "jotai";

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

const selectedCategories = atom<string[]>([]);

export const CategoryCheckboxDropdown = () => {
  const inputRef = useRef<HTMLInputElement>();
  const {
    filter,
    filteredCategories,
    isFiltering,
    clearFilters,
    handleFilter,
  } = useFilter();

  const [selected, setSelected] = useAtom(selectedCategories);

  const addOrRemoveSelectedId = (id: string) => {
    if (selected.includes(id)) {
      setSelected((prev) => prev.filter((string) => string !== id));
    } else {
      setSelected((prev) => [...prev, id]);
    }
  };

  const onSelect = (e: Event) => {
    e.preventDefault();
    const node = e.target as HTMLDivElement;
    const id = node.dataset.categoryId as string;
    addOrRemoveSelectedId(id);
  };

  return (
    <ClientOnly
    // fallback={
    //   <Input
    //     defaultValue="Select category"
    //     label=""
    //     className="w-full rounded-md border border-gray-300 bg-transparent text-sm   disabled:opacity-50 "
    //     disabled
    //   />
    // }
    >
      {() => (
        <div className="relative w-full text-right">
          <Provider>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-2 text-gray-500">
                Categories <ChevronRight className="rotate-90" />{" "}
                <div>{selected.length > 0 && selected.length}</div>
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
                      onSelect={onSelect}
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
          </Provider>
        </div>
      )}
    </ClientOnly>
  );
};
