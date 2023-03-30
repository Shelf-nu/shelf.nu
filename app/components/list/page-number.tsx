import { NavLink } from "@remix-run/react";
import { tw } from "~/utils";

export const PageNumber = ({
  number,
  page,
}: {
  number: number;
  page: number;
}) => {
  /** This handles setting page 1 button to active when there are no url params for page */
  const isActive = (page === 0 && number === 1) || page === number;
  return (
    <li key={number}>
      <NavLink
        to={`.?page=${number}`}
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
