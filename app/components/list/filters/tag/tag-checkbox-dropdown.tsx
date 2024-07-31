import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Category } from "@prisma/client";

import { useAtom, useAtomValue } from "jotai";

import { useTagSearch } from "~/components/category/useTagSearch";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import type { WithDateFields } from "~/modules/types";
import Input from "../../../forms/input";
import { CheckIcon, ChevronRight } from "../../../icons/library";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../shared/dropdown";
import {
  addInitialSelectedTagsAtom,
  addOrRemoveSelectedTagIdAtom,
  clearTagFiltersAtom,
  selectedTagsAtom,
  toggleIsFilteringTagsAtom,
} from "../atoms/tag";

export const TagCheckboxDropdown = () => {
  const [params] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>();
  const {
    tagSearch,
    refinedTags,
    isSearchingTags,
    handleTagSearch,
    clearTagSearch,
  } = useTagSearch();

  const { items } = useAtomValue(selectedTagsAtom);
  const [, setInitialSelect] = useAtom(addInitialSelectedTagsAtom);

  const [, clearFilters] = useAtom(clearTagFiltersAtom);

  const hasTags = useMemo(() => refinedTags.length > 0, [refinedTags]);

  /** Sets the initial selected categories based on the url params. Runs on first load only */
  useEffect(() => {
    setInitialSelect(params.getAll("tag"));
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
            name="tag"
            readOnly
          />
        ))}
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className="inline-flex items-center gap-2 text-gray-500">
          Tags <ChevronRight className="hidden rotate-90 md:inline" />{" "}
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
          {!hasTags && !isSearchingTags ? (
            <div>
              You don't seem to have any tags yet.{" "}
              <Button to={"/tags/new"} variant="link" className="">
                Create your first tag
              </Button>
            </div>
          ) : (
            <>
              <div className="filters-form relative">
                <div className="mb-[6px] flex w-full justify-between text-xs text-gray-500">
                  <div>Filter by tag</div>
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
                  label="Search tags"
                  placeholder="Search tags"
                  hideLabel
                  className="mb-2 text-gray-500"
                  icon="tag"
                  autoFocus
                  value={tagSearch}
                  onChange={handleTagSearch}
                  ref={inputRef}
                />
                {isSearchingTags && (
                  <Button
                    icon="x"
                    variant="tertiary"
                    disabled={isSearchingTags}
                    onClick={clearTagSearch}
                    className="z-100 pointer-events-auto absolute right-[14px] top-0 h-full border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                  />
                )}
              </div>
              <div className="">
                {refinedTags.map((c) => (
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
      className="relative flex cursor-default select-none items-center rounded px-2 py-1.5 text-sm font-medium outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100 "
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
