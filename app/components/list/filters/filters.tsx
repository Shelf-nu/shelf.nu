import { useRef, type ReactNode, useEffect, useMemo } from "react";
import { Form, useLoaderData, useSearchParams } from "@remix-run/react";

import type { SearchableIndexResponse } from "~/modules/types";
import { tw } from "~/utils";

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
        "flex items-center justify-between bg-white md:rounded-[12px] md:border md:border-gray-200 md:px-6 md:py-5",
        className
      )}
    >
      <Form ref={formRef} className="w-full">
        {existingParamInputs}
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
