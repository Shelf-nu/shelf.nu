import { useRef } from "react";
import {
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";

import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import type { SearchableIndexResponse } from "~/modules/types";
import { isFormProcessing } from "~/utils";
import { SearchFieldTooltip } from "./search-field-tooltip";

export const SearchForm = () => {
  const [_searchParams, setSearchParams] = useSearchParams();
  const { search, modelName, searchFieldLabel } =
    useLoaderData<SearchableIndexResponse>();
  const { singular } = modelName;

  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const label = searchFieldLabel
    ? searchFieldLabel
    : `Search by ${singular} name`;

  function clearSearch() {
    setSearchParams((prev) => {
      prev.delete("s");

      return prev;
    });
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
  }

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
          disabled={isSearching}
          hideLabel
          hasAttachedButton
          className="w-full md:w-auto"
          inputClassName="pr-9"
          ref={searchInputRef}
          onKeyDown={(e) => {
            if (e.key == "Enter") {
              submitButtonRef.current?.click();
            }
          }}
        />
        {search ? (
          <Button
            icon="x"
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
      <Button
        icon={isSearching ? "spinner" : "search"}
        type="submit"
        variant="secondary"
        title="Search"
        disabled={isSearching}
        attachToInput
        ref={submitButtonRef}
      />
    </div>
  );
};
