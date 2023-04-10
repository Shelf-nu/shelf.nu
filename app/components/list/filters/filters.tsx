import { useRef, type ReactNode, useEffect } from "react";
import { Form, useLoaderData, useSubmit } from "@remix-run/react";
import { useAtom } from "jotai";

import { isFilteringCategoriesAtom } from "./atoms";
import { SearchForm } from "./search-form";

export const Filters = ({ children }: { children?: ReactNode }) => {
  const { search } = useLoaderData();
  const [isFiltering, toggleIsFiltering] = useAtom(isFilteringCategoriesAtom);

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
   * Doing fast checking will cancel the previous request triggered by submit().
   * This is fine however, as we only want the data from the latest request.
   */
  useEffect(() => {
    /** check the flag and if its true, submit the form. */
    if (isFiltering) {
      submit(formRef.current);

      return () => {
        /** Clean up the flag */
        toggleIsFiltering(false);
      };
    }
  }, [submit, isFiltering, toggleIsFiltering]);

  return (
    <div className="flex items-center justify-between rounded-[12px] border border-gray-200 bg-white px-6 py-5">
      <Form ref={formRef} className="w-full">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-5">
            <SearchForm />
          </div>
          <div className="inline-flex w-1/4 justify-end">{children}</div>
        </div>
      </Form>
    </div>
  );
};
