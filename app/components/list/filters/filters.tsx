import { useRef, type ReactNode, useEffect } from "react";
import { Form, useLoaderData, useSubmit } from "@remix-run/react";
import { useAtom } from "jotai";

import { toggleIsFilteringCategoriesAtom } from "./atoms";
import { SearchForm } from "./search-form";

export const Filters = ({ children }: { children?: ReactNode }) => {
  const { search } = useLoaderData();

  const [isFilteringCategories, toggleIsFiltering] = useAtom(
    toggleIsFilteringCategoriesAtom
  );

  const submit = useSubmit();

  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    /** If no search, clear the form and focus on the search field */
    if (!search) {
      formRef?.current?.reset();
    }
  }, [search]);

  /**
   * Submit the form when the selected array changes
   */
  useEffect(() => {
    /** check the flag and if its true, submit the form. */
    if (isFilteringCategories) {
      submit(formRef.current);
      toggleIsFiltering();
    }
  }, [submit, isFilteringCategories, toggleIsFiltering]);

  return (
    <div className="flex items-center justify-between bg-white md:rounded-[12px] md:border md:border-gray-200 md:px-6 md:py-5">
      <Form ref={formRef} className="w-full">
        <div className="w-full items-center justify-between md:flex">
          <div className="flex items-center gap-5">
            <SearchForm />
          </div>
          <div className="flex-1">{children}</div>
        </div>
      </Form>
    </div>
  );
};
