import { CopyIcon, PencilIcon, QrCodeIcon, Trash2Icon } from "lucide-react";
import { Button } from "~/components/shared/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import type { AssetsFromViewItem } from "~/modules/asset/types";
import { tw } from "~/utils/tw";
import { DeleteAsset } from "../delete-asset";
import QrPreviewDialog from "../qr-preview-dialog";

type AssetQuickActionsProps = {
  className?: string;
  style?: React.CSSProperties;
  asset: AssetsFromViewItem;
};

export default function AssetQuickActions({
  className,
  style,
  asset,
}: AssetQuickActionsProps) {
  return (
    <div className={tw("flex items-center", className)} style={style}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="block-link-gray"
            to={`/assets/${asset.id}/edit`}
          >
            <PencilIcon className="size-4" />
          </Button>
        </TooltipTrigger>

        <TooltipContent align="center" side="top">
          Edit asset information
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <QrPreviewDialog
            asset={{
              id: asset.id,
              title: asset.title,
              qrId: asset.qrCodes[0].id,
            }}
            trigger={
              <Button size="sm" variant="block-link-gray">
                <QrCodeIcon className="size-4" />
              </Button>
            }
          />
        </TooltipTrigger>

        <TooltipContent>Show asset label</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="block-link-gray"
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
        <TooltipTrigger asChild>
          <DeleteAsset
            asset={asset}
            trigger={
              <Button size="sm" variant="block-link-gray">
                <Trash2Icon className="size-4" />
              </Button>
            }
          />
        </TooltipTrigger>

        <TooltipContent align="center" side="top">
          Delete asset
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
