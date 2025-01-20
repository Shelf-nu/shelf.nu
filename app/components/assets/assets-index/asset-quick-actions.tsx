import { CopyIcon, PencilIcon, QrCodeIcon, Trash2Icon } from "lucide-react";
import { Button } from "~/components/shared/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import When from "~/components/when/when";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { AssetsFromViewItem } from "~/modules/asset/types";
import { tw } from "~/utils/tw";
import { DeleteAsset } from "../delete-asset";
import { QrPreviewDialog } from "../qr-preview-dialog";

type AssetQuickActionsProps = {
  className?: string;
  style?: React.CSSProperties;
  asset: Pick<AssetsFromViewItem, "id" | "title" | "mainImage"> & {
    qrId: string;
  };
};

export default function AssetQuickActions({
  className,
  style,
  asset,
}: AssetQuickActionsProps) {
  const { isBaseOrSelfService } = useUserRoleHelper();

  return (
    <div className={tw("flex items-center gap-2", className)} style={style}>
      <When truthy={!isBaseOrSelfService}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className={"p-2"}
              to={`/assets/${asset.id}/edit`}
            >
              <PencilIcon className="size-4" />
            </Button>
          </TooltipTrigger>

          <TooltipContent align="center" side="top">
            Edit asset information
          </TooltipContent>
        </Tooltip>
      </When>

      <Tooltip>
        <QrPreviewDialog
          asset={{
            id: asset.id,
            title: asset.title,
            qrId: asset.qrId,
          }}
          trigger={
            <TooltipTrigger asChild>
              <Button size="sm" variant="secondary" className={"p-2"}>
                <QrCodeIcon className="size-4" />
              </Button>
            </TooltipTrigger>
          }
        />

        <TooltipContent align="center" side="top">
          Show asset label
        </TooltipContent>
      </Tooltip>

      <When truthy={!isBaseOrSelfService}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className={"p-2"}
              to={`/assets/${asset.id}/overview/duplicate`}
            >
              <CopyIcon className="size-4" />
            </Button>
          </TooltipTrigger>

          <TooltipContent align="center" side="top">
            Duplicate asset
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <DeleteAsset
            asset={asset}
            trigger={
              <TooltipTrigger asChild>
                <Button size="sm" variant="secondary" className={"p-2"}>
                  <Trash2Icon className="size-4" />
                </Button>
              </TooltipTrigger>
            }
          />

          <TooltipContent align="center" side="top">
            Delete asset
          </TooltipContent>
        </Tooltip>
      </When>
    </div>
  );
}
