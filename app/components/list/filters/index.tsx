import type { ReactNode } from "react";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
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
  searchClassName,
  innerWrapperClassName,
}: {
  children?: ReactNode;
  className?: string;
  /** Slots to render nodes within this component.
   * Available options are:
   * - left-of-search
   * - right-of-search
   */
  slots?: SlotKeys;
  searchClassName?: string;
  innerWrapperClassName?: string;
}) => {
  const { modeIsAdvanced } = useAssetIndexViewState();
  return (
    <div
      className={tw(
        modeIsAdvanced ? "md:p-3" : "md:px-6 md:py-5",
        "flex items-center justify-between bg-white py-2 md:rounded md:border md:border-gray-200 ",
        className
      )}
    >
      <div className="form-wrapper search-form w-full items-center justify-between gap-2 md:flex">
        <div
          className={tw(
            "flex w-full flex-col gap-2 md:flex-row md:items-center",
            innerWrapperClassName
          )}
        >
          {slots?.["left-of-search"] || null}
          <SearchForm className={searchClassName} />
          {slots?.["right-of-search"] || null}
        </div>
        {children ? (
          <div className="flex flex-1 justify-end">{children}</div>
        ) : null}
      </div>
    </div>
  );
};
