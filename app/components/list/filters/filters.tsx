import { useRef, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { Form, useLoaderData, useSearchParams } from "@remix-run/react";

import type { SearchableIndexResponse } from "~/modules/types";
import { tw } from "~/utils";

import { SearchForm } from "./search-form";

export const Filters = ({
  children,
  className,
  slots,
}: {
  children?: ReactNode;
  className?: string;
  /** Slots to render nodes within this component.
   * Available options are:
   * - left-of-search
   * - right-of-search
   */
  slots?: Record<string, ReactNode>;
}) => {
  const { search } = useLoaderData<SearchableIndexResponse>();
  const [searchParams] = useSearchParams();

  const formRef = useRef<HTMLFormElement>(null);

  const existingParamInputs = useMemo(() => {
    const params: Record<string, string[]> = {};

    for (const key of searchParams.keys()) {
      if (key === "s") continue;
      params[key] = searchParams.getAll(key);
    }

    return Object.entries(params)
      .map(([key, value]) =>
        value.map((_value) => (
          <input key={_value} type="hidden" name={key} value={_value} />
        ))
      )
      .flat();
  }, [searchParams]);

  useEffect(() => {
    /** If no search, clear the form and focus on the search field */
    if (!search) {
      formRef?.current?.reset();
    }
  }, [search]);

  return (
    <div
      className={tw(
        "flex items-center justify-between bg-white py-2 md:rounded md:border md:border-gray-200 md:px-6 md:py-5",
        className
      )}
    >
      <Form ref={formRef} className="w-full">
        {existingParamInputs}
        <div className="form-wrapper search-form w-full items-center justify-between gap-2 md:flex">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            {slots?.["left-of-search"] || null}
            <SearchForm />
            {slots?.["right-of-search"] || null}
          </div>
          <div className="flex flex-1 justify-end">{children}</div>
        </div>
      </Form>
    </div>
  );
};
