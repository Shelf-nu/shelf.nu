import type { ReactNode } from "react";
import { tw } from "~/utils/tw";
import { SearchForm } from "./search-form";

type SlotKeys = {
  "left-of-search"?: ReactNode;
  "right-of-search"?: ReactNode;
};

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
  slots?: SlotKeys;
}) => (
  <div
    className={tw(
      "flex items-center justify-between bg-white py-2 md:rounded md:border md:border-gray-200 md:px-6 md:py-5",
      className
    )}
  >
    <div className="form-wrapper search-form w-full items-center justify-between gap-2 md:flex">
      <div className="flex w-full flex-col gap-2 md:flex-row md:items-center">
        {slots?.["left-of-search"] || null}
        <SearchForm />
        {slots?.["right-of-search"] || null}
      </div>
      <div className="flex flex-1 justify-end">{children}</div>
    </div>
  </div>
);
