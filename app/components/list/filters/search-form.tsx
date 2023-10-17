import {
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";

import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import type { SearchableIndexResponse } from "~/modules/types";
import { SearchFieldTooltip } from "./search-field-tooltip";

export const SearchForm = () => {
  const [params] = useSearchParams();

  const { search, modelName, searchFieldLabel } =
    useLoaderData<SearchableIndexResponse>();
  const { singular } = modelName;
  const state = useNavigation().state;
  const isSearching =
    state === "loading" && (params.has("s") || params.has("category"));

  const label = searchFieldLabel
    ? searchFieldLabel
    : `Search by ${singular} name`;

  return (
    <div className="flex w-full md:w-auto">
      <div className="relative">
        <Input
          type="text"
          name="s"
          label={label}
          aria-label={label}
          placeholder={label}
          defaultValue={search}
          disabled={isSearching}
          hideLabel
          hasAttachedButton
          className="w-full md:w-auto"
          inputClassName="pr-9"
        />
        {search ? (
          <Button
            to="#"
            icon="x"
            variant="tertiary"
            disabled={isSearching}
            name="intent"
            value="clearSearch"
            title="Clear search"
            className="absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer border-0 p-0 text-gray-400 hover:text-gray-700"
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
      />
    </div>
  );
};
