import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Category } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { ClientOnly } from "remix-utils";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms";
import Input from "../forms/input";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";

export const CategorySelect = () => {
  const data = useLoaderData();
  const inputRef = useRef<HTMLInputElement>();
  const [filter, setFilter] = useState("");

  const filteredCategories = useMemo(
    () =>
      data?.categories.filter((cat: Category) =>
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
        <div className="relative w-full">
          <Select
            name="category"
            onOpenChange={() => inputRef.current?.focus()}
          >
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
              </SelectContent>
            </div>
          </Select>
        </div>
      )}
    </ClientOnly>
  );
};
