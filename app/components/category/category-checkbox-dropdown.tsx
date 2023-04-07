import { useRef } from "react";
import type { Category } from "@prisma/client";
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

export const CategoryCheckboxDropdown = () => {
  const inputRef = useRef<HTMLInputElement>();
  const {
    filter,
    filteredCategories,
    isFiltering,
    clearFilters,
    handleFilter,
  } = useFilter();

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
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 text-gray-500">
              Categories <ChevronRight className="rotate-90" />
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
                  <DropdownMenuCheckboxItem key={c.id}>
                    <Badge color={c.color} noBg>
                      {c.name}
                    </Badge>
                  </DropdownMenuCheckboxItem>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </ClientOnly>
  );
};
