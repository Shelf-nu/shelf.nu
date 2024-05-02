import { useRef } from "react";
import {
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";

import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import type { SearchableIndexResponse } from "~/modules/types";
import { isFormProcessing } from "~/utils/form";
import { SearchFieldTooltip } from "./search-field-tooltip";

export const SearchForm = () => {
  const [_searchParams, setSearchParams] = useSearchParams();
  const { search, modelName, searchFieldLabel } =
    useLoaderData<SearchableIndexResponse>();
  const { singular } = modelName;

  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const label = searchFieldLabel ? searchFieldLabel : `Search by ${singular}`;

  function clearSearch() {
    setSearchParams((prev) => {
      prev.delete("s");

      return prev;
    });
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
  }

  const debouncedHandleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const searchQuery = e.target.value;
    if (!searchQuery) {
      clearSearch();
    } else {
      setSearchParams((prev) => {
        prev.set("s", searchQuery);
        return prev;
      });
    }
  };

  return (
    <div className="flex w-full md:w-auto">
      <div className="relative flex-1">
        <Input
          type="text"
          name="s"
          label={label}
          aria-label={label}
          placeholder={label}
          defaultValue={search || ""}
          hideLabel
          className="w-full md:w-auto"
          inputClassName="pr-9"
          ref={searchInputRef}
          onChange={debouncedHandleChange}
        />
        {search || isSearching ? (
          <Button
            icon={isSearching ? "spinner" : "x"}
            variant="tertiary"
            disabled={isSearching}
            title="Clear search"
            className="absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer border-0 p-0 text-gray-400 hover:text-gray-700"
            onClick={clearSearch}
          />
        ) : (
          <SearchFieldTooltip />
        )}
      </div>
    </div>
  );
};
