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
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { CodePreviewDialog } from "../../code-preview/code-preview-dialog";
import { DeleteAsset } from "../delete-asset";

type AssetQuickActionsProps = {
  className?: string;
  style?: React.CSSProperties;
  asset: Pick<AssetsFromViewItem, "id" | "title" | "mainImage"> & {
    qrId: string;
    sequentialId?: string | null;
  };
};

export default function AssetQuickActions({
  className,
  style,
  asset,
}: AssetQuickActionsProps) {
  const { roles } = useUserRoleHelper();

  return (
    <div className={tw("flex items-center gap-2", className)} style={style}>
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.asset,
          action: PermissionAction.update,
        })}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className={"p-2"}
              to={`/assets/${asset.id}/edit`}
              aria-label="Edit asset information"
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
        <CodePreviewDialog
          item={{
            id: asset.id,
            title: asset.title,
            qrId: asset.qrId,
            type: "asset",
            sequentialId: asset.sequentialId,
          }}
          trigger={
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                className={"p-2"}
                aria-label="Show asset label"
              >
                <QrCodeIcon className="size-4" />
              </Button>
            </TooltipTrigger>
          }
        />

        <TooltipContent align="center" side="top">
          Show asset label
        </TooltipContent>
      </Tooltip>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.asset,
          action: PermissionAction.update,
        })}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className={"p-2"}
              to={`/assets/${asset.id}/overview/duplicate`}
              aria-label="Duplicate asset"
            >
              <CopyIcon className="size-4" />
            </Button>
          </TooltipTrigger>

          <TooltipContent align="center" side="top">
            Duplicate asset
          </TooltipContent>
        </Tooltip>
      </When>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.asset,
          action: PermissionAction.delete,
        })}
      >
        <Tooltip>
          <DeleteAsset
            asset={asset}
            trigger={
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  className={"p-2"}
                  aria-label="Delete asset"
                >
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
