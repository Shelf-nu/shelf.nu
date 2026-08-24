import type { Asset } from "@prisma/client";
import { tw } from "~/utils/tw";
import type { KitRemovalBookingImpact } from "./booking-removal-notice";
import RemoveAssetFromKit from "./remove-asset-from-kit";
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
   * Bookings holding this asset through the kit being viewed, split into the
   * ones that lose it (RESERVED) and the ones that keep it flagged as removed
   * from the kit (ONGOING/OVERDUE). Passed straight to the Remove dialog,
   * which names both before the user confirms. Defaults to none.
   */
  bookingImpact?: KitRemovalBookingImpact;
};

export default function AssetRowActionsDropdown({
  asset,
  fullWidth,
  bookingImpact,
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
        <RemoveAssetFromKit asset={asset} bookingImpact={bookingImpact} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
