import { useRef, type ReactNode, useEffect } from "react";
import { Form, useLoaderData, useSubmit } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";

import { Button } from "~/components/shared";
import {
  clearFiltersAtom,
  selectedCategoriesAtom,
  toggleIsFilteringAtom,
} from "./atoms";
import { SearchForm } from "./search-form";

export const Filters = ({ children }: { children?: ReactNode }) => {
  const { search } = useLoaderData();

  const [isFilteringCategories, toggleIsFiltering] = useAtom(
    toggleIsFilteringAtom
  );

  const selectedCategories = useAtomValue(selectedCategoriesAtom);
  const [, clearFilters] = useAtom(clearFiltersAtom);

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

      return () => {
        /** Clean up the flag */
        toggleIsFiltering();
      };
    }
  }, [submit, isFilteringCategories, toggleIsFiltering]);

  return (
    <div className="flex items-center justify-between rounded-[12px] border border-gray-200 bg-white px-6 py-5">
      <Form ref={formRef} className="w-full">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-5">
            <SearchForm />
          </div>
          <div className="inline-flex w-1/4 justify-end gap-4">
            {selectedCategories.items.length > 0 ? (
              <>
                <Button
                  as="button"
                  onClick={clearFilters}
                  variant="link"
                  className="block max-w-none text-xs font-normal  text-gray-500 hover:text-gray-600"
                >
                  Clear filters
                </Button>
                <div className="text-gray-500"> | </div>
              </>
            ) : null}
            <div>{children}</div>
          </div>
        </div>
      </Form>
    </div>
  );
};
