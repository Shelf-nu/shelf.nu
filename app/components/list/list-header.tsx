import { useEffect, useMemo, useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { useFetcher } from "@remix-run/react";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexShowImage } from "~/hooks/use-asset-index-show-image";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { tw } from "~/utils/tw";
import type { ListProps } from ".";
import BulkListHeader from "./bulk-actions/bulk-list-header";
import { freezeColumnClassNames } from "../assets/assets-index/freeze-column-classes";
import { useStickyHeaderPortal } from "../assets/assets-index/use-advanced-sticky-header";
import { ChevronRight, LockIcon } from "../icons/library";
import { Button } from "../shared/button";
import { Th } from "../table";

type ListHeaderProps = {
  children: React.ReactNode;
  hideFirstColumn?: boolean;
  bulkActions?: ListProps["bulkActions"];
  title?: string;
  className?: string;
};

export const ListHeader = ({
  children,
  hideFirstColumn = false,
  bulkActions,
  className,
}: ListHeaderProps) => {
  const { modeIsAdvanced } = useAssetIndexViewState();
  const freezeColumn = useAssetIndexFreezeColumn();
  const { originalHeaderRef } = useStickyHeaderPortal();

  const headerContent = useMemo(
    () => (
      <tr>
        {bulkActions ? <BulkListHeader /> : null}
        {hideFirstColumn ? null : (
          <Th
            className={tw(
              "!border-b-0 border-r border-r-transparent text-left font-normal text-color-600",
              modeIsAdvanced ? "bg-color-25" : "",
              bulkActions ? "!pl-0" : "",

              modeIsAdvanced && freezeColumn
                ? freezeColumnClassNames.nameHeader
                : ""
            )}
            colSpan={children ? 1 : 100}
            data-column-name="name"
          >
            <div
              className={tw(
                modeIsAdvanced && "flex items-center justify-between"
              )}
            >
              <div className="flex items-center gap-1">
                Name{" "}
                {modeIsAdvanced && freezeColumn ? (
                  <span className=" size-4 text-color-400">
                    <LockIcon />
                  </span>
                ) : null}
              </div>
              {modeIsAdvanced && <AdvancedModeDropdown />}
            </div>
          </Th>
        )}
        {children}
      </tr>
    ),
    [bulkActions, children, hideFirstColumn, modeIsAdvanced, freezeColumn]
  );

  return (
    <>
      <thead
        className={tw(
          "border-b",
          modeIsAdvanced
            ? tw(
                "sticky top-0 z-10 border-b bg-surface",
                "before:absolute before:inset-x-0 before:bottom-0 before:border-b before:border-color-200 before:content-['']" // creates a border at the bottom of the header
              )
            : "",
          className
        )}
        ref={originalHeaderRef}
      >
        {headerContent}
      </thead>
    </>
  );
};

function AdvancedModeDropdown() {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const freezeFetcher = useFetcher({
    key: "asset-index-settings-freeze-column",
  });
  const showImageFetcher = useFetcher({
    key: "asset-index-settings-show-image",
  });

  const freezeColumn = useAssetIndexFreezeColumn();
  const showAssetImage = useAssetIndexShowImage();

  useEffect(() => {
    setIsPopoverOpen(false);
  }, [freezeColumn, showAssetImage]);

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger>
        <ChevronRight className="rotate-90" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="end"
          className={tw(
            "z-20 mt-2 w-[200px] rounded-md border border-color-300 bg-surface p-0"
          )}
        >
          <freezeFetcher.Form action="/api/asset-index-settings" method="post">
            <input
              type="hidden"
              name="freezeColumn"
              value={freezeColumn ? "no" : "yes"}
            />
            <Button
              className=" justify-start whitespace-nowrap p-4 text-color-700 hover:bg-color-50 hover:text-color-700 "
              variant="link"
              icon="lock"
              type="submit"
              width="full"
              name="intent"
              value="changeFreeze"
            >
              {freezeColumn ? "Unfreeze column" : "Freeze column"}
            </Button>
          </freezeFetcher.Form>

          <showImageFetcher.Form
            action="/api/asset-index-settings"
            method="post"
          >
            <input
              type="hidden"
              name="showAssetImage"
              value={showAssetImage ? "no" : "yes"}
            />
            <Button
              className=" justify-start whitespace-nowrap p-4 text-color-700 hover:bg-color-50 hover:text-color-700  "
              variant="link"
              icon="image"
              type="submit"
              width="full"
              name="intent"
              value="changeShowImage"
            >
              {showAssetImage ? "Hide asset image" : "Show asset image"}
            </Button>
          </showImageFetcher.Form>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
