import type { Asset } from "@prisma/client";

import { VerticalDotsIcon } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { tw } from "~/utils";
import { RemoveAssetFromBooking } from "./remove-asset-from-booking";

interface Props {
  asset: Asset;
  fullWidth?: boolean;
}

export const AssetRowActionsDropdown = ({ asset, fullWidth }: Props) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger
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
      <RemoveAssetFromBooking asset={asset} />
    </DropdownMenuContent>
  </DropdownMenu>
);
