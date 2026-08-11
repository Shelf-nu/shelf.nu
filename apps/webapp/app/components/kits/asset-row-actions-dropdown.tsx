import type { Asset } from "@prisma/client";
import { tw } from "~/utils/tw";
import RemoveAssetFromKit from "./remove-asset-from-kit";
import type { ReservedBookingForNotice } from "./reserved-booking-removal-notice";
import { VerticalDotsIcon } from "../icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../shared/dropdown";

type AssetRowActionsDropdownProps = {
  asset: Pick<Asset, "id" | "title">;
  fullWidth?: boolean;
  /**
   * RESERVED bookings holding this asset through the kit being viewed. Passed
   * straight to the Remove dialog, which warns that confirming also removes
   * the asset from them. Defaults to none.
   */
  reservedBookings?: ReservedBookingForNotice[];
};

export default function AssetRowActionsDropdown({
  asset,
  fullWidth,
  reservedBookings,
}: AssetRowActionsDropdownProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label="Actions Trigger"
        className={tw("asset-actions", fullWidth ? "w-full" : "")}
      >
        <span className="flex items-center gap-2">
          <VerticalDotsIcon />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="order w-[180px] rounded-md bg-white p-1.5 text-right "
      >
        <RemoveAssetFromKit asset={asset} reservedBookings={reservedBookings} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
