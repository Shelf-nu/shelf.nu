import {
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";

import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";

export const SearchForm = () => {
  const [params] = useSearchParams();
  const { search, modelName } = useLoaderData();
  const { singular } = modelName;
  const state = useNavigation().state;
  const isSearching =
    state === "loading" && (params.has("s") || params.has("category"));

  return (
    <div className="relative flex w-full md:w-auto">
      <Input
        type="text"
        name="s"
        label={`Search by ${singular} name`}
        aria-label={`Search by ${singular} name`}
        placeholder={`Search by ${singular} name`}
        defaultValue={search}
        disabled={isSearching}
        hideLabel
        hasAttachedButton
        className="w-full md:w-auto"
      />
      <Button
        icon={isSearching ? "spinner" : "search"}
        type="submit"
        variant="secondary"
        title="Search"
        disabled={isSearching}
        attachToInput
      />
      {search && (
        <Button
          to="/"
          icon="x"
          variant="tertiary"
          disabled={isSearching}
          name="intent"
          value="clearSearch"
          title="Clear search"
          className=" absolute right-[63px] top-[50%] z-10 h-full translate-y-[-50%] border-0 p-0 text-center text-gray-400 hover:text-gray-900"
        />
      )}
    </div>
  );
};
