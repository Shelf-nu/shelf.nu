import { useEffect, useRef } from "react";

import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { ClearSearchForm } from "./clear-search-form";

export const SearchForm = () => {
  const { search, clearSearch } = useLoaderData();
  const formRef = useRef<HTMLFormElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigation = useNavigation();
  const isSearching = navigation.state === "loading";

  useEffect(() => {
    if (clearSearch) {
      formRef?.current?.reset();
      searchInputRef?.current?.focus();
    }
  }, [clearSearch]);

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
          autoFocus
          hideLabel
          hasAttachedButton
        />
        <Button
          icon={"search"}
          type="submit"
          variant="secondary"
          disabled={isSearching}
          name="intent"
          value="search"
          attachToInput
        />
      </Form>
      {search && (
        <ClearSearchForm
          buttonContent={""}
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
