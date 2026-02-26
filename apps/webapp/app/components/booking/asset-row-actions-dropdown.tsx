import type { Asset } from "@prisma/client";

import { VerticalDotsIcon } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { tw } from "~/utils/tw";
import { RemoveAssetFromBooking } from "./remove-asset-from-booking";

interface Props {
  asset: Asset;
  fullWidth?: boolean;
}

export const AssetRowActionsDropdown = ({ asset, fullWidth }: Props) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger
      className={tw("asset-actions", fullWidth ? "w-full" : "")}
      aria-label="Actions Trigger"
    >
      <span className="flex size-6 items-center justify-center gap-2 text-center">
        <VerticalDotsIcon />
      </span>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      className="order w-[180px] rounded-md bg-surface p-1.5 text-right "
    >
      <RemoveAssetFromBooking asset={asset} />
    </DropdownMenuContent>
  </DropdownMenu>
);
