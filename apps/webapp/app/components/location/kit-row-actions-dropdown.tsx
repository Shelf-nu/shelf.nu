import type { Kit } from "@prisma/client";
import { tw } from "~/utils/tw";
import RemoveKitFromLocation from "./remove-kit-from-location";
import { VerticalDotsIcon } from "../icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../shared/dropdown";

type KitRowActionsDropdownProps = {
  kit: Pick<Kit, "id" | "name">;
  fullWidth?: boolean;
};

export default function KitRowActionsDropdown({
  kit,
  fullWidth,
}: KitRowActionsDropdownProps) {
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
        <RemoveKitFromLocation kit={kit} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
