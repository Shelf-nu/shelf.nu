import { useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { useFetcher } from "@remix-run/react";
import { useAssetIndexMode } from "~/hooks/use-asset-index-mode";
import { tw } from "~/utils/tw";
import type { ListProps } from ".";
import BulkListHeader from "./bulk-actions/bulk-list-header";
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
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <thead className={tw("border-b", className)}>
      <tr className="">
        {bulkActions ? (
          <BulkListHeader
            isHovered={isHovered}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
        ) : null}
        {hideFirstColumn ? null : (
          <Th
            className={tw(
              "!border-b-0 border-r border-r-transparent text-left font-normal text-gray-600",
              bulkActions ? "!pl-0" : "",
              modeIsAdvanced && "flex items-center justify-between",
              modeIsAdvanced && isHovered
                ? "border-r-initial border-r bg-gray-50"
                : ""
            )}
            colSpan={children ? 1 : 100}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            Name
            {modeIsAdvanced && <AdvancedModeDropdown />}
          </Th>
        )}
        {children}
      </tr>
    </thead>
  );
};

function AdvancedModeDropdown() {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const fetcher = useFetcher({
    key: "asset-index-settings-first-column",
  });

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
          <fetcher.Form action="/api/asset-index-settings" method="post">
            <input
              type="hidden"
              name="intent"
              value="changeFirstColumnSettings"
            />

            <Button
              className=" justify-start whitespace-nowrap p-4 text-gray-700 hover:bg-gray-100 hover:text-gray-700 focus:bg-gray-100"
              variant="link"
              icon="lock"
              type="submit"
              width="full"
            >
              Freeze column
            </Button>

            <Button
              className=" justify-start whitespace-nowrap p-4 text-gray-700 hover:bg-gray-100 hover:text-gray-700 focus:bg-gray-100 "
              variant="link"
              icon="image"
              type="submit"
              width="full"
            >
              Show asset image
            </Button>
          </fetcher.Form>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
