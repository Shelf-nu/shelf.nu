import { useRef, type ReactNode, useEffect } from "react";
import {
  Form,
  useLoaderData,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import { useAtom } from "jotai";

import type { SearchableIndexResponse } from "~/modules/types";
import { tw } from "~/utils";
import {
  toggleIsFilteringCategoriesAtom,
  toggleIsFilteringTagsAtom,
} from "./atoms";
import { SearchForm } from "./search-form";

export const Filters = ({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) => {
  const { search } = useLoaderData<SearchableIndexResponse>();
  const [searchParams] = useSearchParams();
  const perPageParam = searchParams.get("per_page");

  const [isFilteringCategories, toggleIsFilteringCategories] = useAtom(
    toggleIsFilteringCategoriesAtom
  );
  const [isFilteringTags, toggleIsFilteringTags] = useAtom(
    toggleIsFilteringTagsAtom
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
      toggleIsFilteringCategories();
    }
  }, [submit, isFilteringCategories, toggleIsFilteringCategories]);

  useEffect(() => {
    /** check the flag and if its true, submit the form. */
    if (isFilteringTags) {
      submit(formRef.current);
      toggleIsFilteringTags();
    }
  }, [submit, isFilteringTags, toggleIsFilteringTags]);

  return (
    <div
      className={tw(
        "flex items-center justify-between bg-white md:rounded-[12px] md:border md:border-gray-200 md:px-6 md:py-5",
        className
      )}
    >
      <Form ref={formRef} className="w-full">
        {perPageParam ? (
          <input type="hidden" name="per_page" value={perPageParam} />
        ) : null}
        <div className="form-wrapper search-form w-full items-center justify-between gap-2 md:flex">
          <div className="flex items-center gap-5">
            <SearchForm />
          </div>
          <div className="flex-1">{children}</div>
        </div>
      </Form>
    </div>
  );
};
