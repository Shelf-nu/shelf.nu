import { NavLink, useLocation } from "@remix-run/react";
import { tw } from "~/utils/tw";
import type { HorizontalTabsProps } from "./types";

export default function HorizontalTabs({
  items,
  className,
}: HorizontalTabsProps) {
  const location = useLocation();
  return (
    // eslint-disable-next-line tailwindcss/enforces-negative-arbitrary-values
    <div
      className={tw(
        "horizontal-menu -mx-4 mb-5 flex overflow-scroll border-b border-b-gray-200 bg-white pl-4 ",
        className
      )}
    >
      {items.map((item, index) => (
        <NavLink
          to={item.to}
          key={item.content}
          className={({ isActive }) =>
            `${
              index === 0 ? "pl-1 pr-3" : "px-3"
            } whitespace-nowrap py-[11px] text-text-sm font-semibold  ${
              isActive || item?.isActive?.(location?.pathname || "")
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
