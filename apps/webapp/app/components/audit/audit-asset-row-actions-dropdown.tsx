import { VerticalDotsIcon } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { tw } from "~/utils/tw";
import { RemoveAssetFromAudit } from "./remove-asset-from-audit";

interface Props {
  auditAssetId: string;
  assetTitle: string;
  fullWidth?: boolean;
}

export const AuditAssetRowActionsDropdown = ({
  auditAssetId,
  assetTitle,
  fullWidth,
}: Props) => (
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
      className="order w-[180px] rounded-md bg-white p-1.5 text-right "
    >
      <RemoveAssetFromAudit
        auditAssetId={auditAssetId}
        assetTitle={assetTitle}
      />
    </DropdownMenuContent>
  </DropdownMenu>
);
