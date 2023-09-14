import { NavLink } from "@remix-run/react";
import type { HorizontalTabsProps } from "./types";

export default function HorizontalTabs({ items }: HorizontalTabsProps) {
  return (
    <div className="horizontal-menu -mr-4 mb-9 mt-6 flex overflow-scroll lg:mr-0">
      {items.map((item, index) => (
        <NavLink
          to={item.to}
          key={item.content}
          className={({ isActive }) =>
            `${
              index === 0 ? "pl-1 pr-3" : "px-3"
            } whitespace-nowrap pb-[11px] pt-[1px] text-text-sm font-semibold  ${
              isActive
                ? "border-b-2 border-b-primary-700 text-primary-700"
                : "border-b border-b-gray-200 pb-[12px] text-gray-500"
            }`
          }
        >
          {item.content}
        </NavLink>
      ))}
    </div>
  );
}
