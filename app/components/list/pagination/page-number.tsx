import { useMemo } from "react";
import { NavLink, useLoaderData, useSearchParams } from "@remix-run/react";
import type { IndexResponse } from "~/routes/_layout+/items._index";
import { mergeSearchParams, tw } from "~/utils";

export const PageNumber = ({ number }: { number: number }) => {
  const { page, search } = useLoaderData<IndexResponse>();

  /** This handles setting page 1 button to active when there are no url params for page */
  const isActive = (page === 0 && number === 1) || page === number;
  const [searchParams] = useSearchParams();

  const to = useMemo(
    () =>
      search
        ? mergeSearchParams(searchParams, { page: number })
        : `.?page=${number}`,
    [search, number, searchParams]
  );

  return (
    <li key={number}>
      <NavLink
        to={to}
        className={tw(
          "rounded-[8px] px-4 py-[10px] text-gray-600 hover:bg-gray-50 hover:text-gray-800",
          isActive ? "pointer-events-none bg-gray-50 text-gray-800" : ""
        )}
      >
        {number}
      </NavLink>
    </li>
  );
};
