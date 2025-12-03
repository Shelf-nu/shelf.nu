import { useMemo } from "react";
import { NavLink } from "react-router";
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
          "rounded-[8px] px-4 py-[10px] text-gray-600 hover:bg-gray-50 hover:text-gray-800",
          isActive ? "pointer-events-none bg-gray-50 text-gray-800" : ""
        )}
      >
        {number}
      </NavLink>
    </li>
  );
};
