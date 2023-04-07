import { useRef, type ReactNode, useEffect } from "react";
import {
  Form,
  useLoaderData,
  // useSubmit
} from "@remix-run/react";

// import { useAtom } from "jotai";
// import { selectedCategoriesAtom } from "~/components/category/category-checkbox-dropdown";
import { SearchForm } from "./search-form";

export const Filters = ({ children }: { children?: ReactNode }) => {
  const { search } = useLoaderData();
  // const [selected] = useAtom(selectedCategoriesAtom);
  // const submit = useSubmit();

  // const isProcessing = isFormProcessing(navigation.state);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    /** If no search, clear the form and focus on the search field */
    if (!search) {
      formRef?.current?.reset();
    }
  }, [search]);

  /**
   * @TODO this needs to be imporved. I dont like submitting in a useEffect with the delay
   * Submit the form when the selected array changes
   * Delay the submit with 500ms to prevent the user spamming multiple requests
   * This should be solved better with fetcher. There is a remix-single about this
   * ERROR: This doesnt actually work as it run even on search and breaks the searching ux
   */
  // useEffect(() => {
  //   const t = setTimeout(() => submit(formRef.current), 300);

  //   return () => clearTimeout(t);
  // }, [selected, submit]);

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
