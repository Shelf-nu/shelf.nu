import type { Asset } from "@prisma/client";
import { tw } from "~/utils/tw";
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
};

export default function AssetRowActionsDropdown({
  asset,
  fullWidth,
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
        className="order w-[180px] rounded-md bg-surface p-1.5 text-right "
      >
        <RemoveAssetFromKit asset={asset} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
