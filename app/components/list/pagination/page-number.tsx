import { useMemo } from "react";
import { NavLink } from "@remix-run/react";
import { useSearchParams } from "~/hooks/search-params";

import { getParamsValues } from "~/utils/list";
import { mergeSearchParams } from "~/utils/merge-search-params";
import { tw } from "~/utils/tw";

export const PageNumber = ({ number }: { number: number }) => {
  const [searchParams] = useSearchParams();
  const { page, search, categoriesIds } = getParamsValues(searchParams);
  const isFiltering = search || categoriesIds;

  /** This handles setting page 1 button to active when there are no url params for page */
  const isActive = useMemo(
    () => (page === 0 && number === 1) || page === number,
    [page, number]
  );

  const to = useMemo(
    () =>
      isFiltering
        ? mergeSearchParams(searchParams, { page: number })
        : `.?page=${number}`,
    [isFiltering, number, searchParams]
  );

  return (
    <li key={number}>
      <NavLink
        to={to}
        className={tw(
          "hover:text-color-800 rounded-[8px] px-4 py-[10px] text-color-600 hover:bg-color-50",
          isActive ? "text-color-800 pointer-events-none bg-color-50" : ""
        )}
      >
        {number}
      </NavLink>
    </li>
  );
};
