import { useEffect, useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { useFetcher } from "@remix-run/react";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexMode } from "~/hooks/use-asset-index-mode";
import { useAssetIndexShowImage } from "~/hooks/use-asset-index-show-image";
import { tw } from "~/utils/tw";
import type { ListProps } from ".";
import BulkListHeader from "./bulk-actions/bulk-list-header";
import { freezeColumnClassNames } from "../assets/assets-index/freeze-column-classes";
import { ChevronRight } from "../icons/library";
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
  const { modeIsAdvanced } = useAssetIndexMode();
  const freezeColumn = useAssetIndexFreezeColumn();

  return (
    <thead
      className={tw(
        "border-b",
        modeIsAdvanced ? "sticky top-0 z-10 bg-white" : "",
        className
      )}
    >
      <tr className="">
        {bulkActions ? <BulkListHeader /> : null}
        {hideFirstColumn ? null : (
          <Th
            className={tw(
              "!border-b-0 border-r border-r-transparent text-left font-normal text-gray-600",
              bulkActions ? "!pl-0" : "",

              modeIsAdvanced && freezeColumn
                ? freezeColumnClassNames.nameHeader
                : "" //48px is the width of the checkbox
            )}
            colSpan={children ? 1 : 100}
          >
            <div
              className={tw(
                modeIsAdvanced && "flex items-center justify-between"
              )}
            >
              Name
              {modeIsAdvanced && <AdvancedModeDropdown />}
            </div>
          </Th>
        )}
        {children}
      </tr>
    </thead>
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
            "mt-2  w-[200px] rounded-md border border-gray-300 bg-white p-0"
          )}
        >
          <freezeFetcher.Form action="/api/asset-index-settings" method="post">
            <input
              type="hidden"
              name="freezeColumn"
              value={freezeColumn ? "no" : "yes"}
            />
            <Button
              className=" justify-start whitespace-nowrap p-4 text-gray-700 hover:bg-gray-50 hover:text-gray-700 "
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
              className=" justify-start whitespace-nowrap p-4 text-gray-700 hover:bg-gray-50 hover:text-gray-700  "
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
