import { NavLink } from "@remix-run/react";
import type { HorizontalTabsProps } from "./types";

export default function HorizontalTabs({ items }: HorizontalTabsProps) {
  return (
    <div className="mt-6 mb-9">
      {items.map((item, index) => (
        <NavLink
          to={item.to}
          key={item.content}
          className={({ isActive }) =>
            `${
              index === 0 ? "pl-1 pr-3" : "px-3"
            } pt-[1px] pb-[11px] text-text-sm font-semibold  ${
              isActive
                ? "border-b-2 border-b-primary-700 text-primary-700"
                : "border-b-[1px] border-b-gray-200 pb-[12px] text-gray-600"
            }`
          }
        >
          {item.content}
        </NavLink>
      ))}
    </div>
  );
}
