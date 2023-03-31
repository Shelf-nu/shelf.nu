import { useEffect, useRef } from "react";

import { Form, useLoaderData, useNavigation } from "@remix-run/react";

import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { ClearSearch } from "./clear-search";

export const SearchForm = () => {
  const { search } = useLoaderData();
  const formRef = useRef<HTMLFormElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const state = useNavigation().state;
  const isSearching = state === "loading";

  useEffect(() => {
    /** If no search, clear the form and focus on the search field */
    if (!search) {
      formRef?.current?.reset();
      searchInputRef?.current?.focus();
    }
  }, [search]);

  return (
    <div className="relative">
      <Form className="relative flex" ref={formRef}>
        <Input
          type="text"
          name="s"
          label={"Search by item name"}
          aria-label="Search by item name"
          placeholder="Search by item name"
          defaultValue={search}
          disabled={isSearching}
          ref={searchInputRef}
          autoFocus={true}
          hideLabel
          hasAttachedButton
        />
        <Button
          icon={"search"}
          type="submit"
          variant="secondary"
          disabled={isSearching}
          attachToInput
        />
      </Form>
      {search && (
        <ClearSearch
          buttonProps={{
            icon: "x",
            type: "submit",
            variant: "tertiary",
            disabled: isSearching,
            name: "intent",
            value: "clearSearch",
            className:
              " absolute right-[46px] top-[50%] translate-y-[-50%] z-10 h-full border-0 text-center text-gray-400 hover:text-gray-900",
          }}
        />
      )}
    </div>
  );
};
