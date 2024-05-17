import { NavLink } from "@remix-run/react";
import type { HorizontalTabsProps } from "./types";

export default function HorizontalTabs({ items }: HorizontalTabsProps) {
  return (
    // eslint-disable-next-line tailwindcss/enforces-negative-arbitrary-values
    <div className="horizontal-menu -mx-4 mb-5 flex overflow-scroll border-b border-b-gray-200 bg-white pl-4 ">
      {items.map((item, index) => (
        <NavLink
          to={item.to}
          key={item.content}
          data-test-id={`${item.to}Tab`}
          className={({ isActive }) =>
            `${
              index === 0 ? "pl-1 pr-3" : "px-3"
            } whitespace-nowrap py-[11px] text-text-sm font-semibold  ${
              isActive
                ? "border-b-2 border-b-primary-700 text-primary-700"
                : " pb-[12px] text-gray-500"
            }`
          }
        >
          {item.content}
        </NavLink>
      ))}
    </div>
  );
}
