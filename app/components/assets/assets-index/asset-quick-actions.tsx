import type { CSSProperties } from "react";
import { CopyIcon, PencilIcon, QrCodeIcon, Trash2Icon } from "lucide-react";
import { Button } from "~/components/shared/button";
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
  style?: CSSProperties;
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
        <Button
          size="sm"
          variant="secondary"
          className={"p-2"}
          to={`/assets/${asset.id}/edit`}
          aria-label="Edit asset information"
          tooltip="Edit asset information"
        >
          <PencilIcon className="size-4" />
        </Button>
      </When>

      <CodePreviewDialog
        item={{
          id: asset.id,
          title: asset.title,
          qrId: asset.qrId,
          type: "asset",
          sequentialId: asset.sequentialId,
        }}
        trigger={
          <Button
            size="sm"
            variant="secondary"
            className={"p-2"}
            aria-label="Show asset label"
            tooltip="Show asset label"
          >
            <QrCodeIcon className="size-4" />
          </Button>
        }
      />

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.asset,
          action: PermissionAction.update,
        })}
      >
        <Button
          size="sm"
          variant="secondary"
          className={"p-2"}
          to={`/assets/${asset.id}/overview/duplicate`}
          aria-label="Duplicate asset"
          tooltip="Duplicate asset"
        >
          <CopyIcon className="size-4" />
        </Button>
      </When>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.asset,
          action: PermissionAction.delete,
        })}
      >
        <DeleteAsset
          asset={asset}
          trigger={
            <Button
              size="sm"
              variant="secondary"
              className={"p-2"}
              aria-label="Delete asset"
              tooltip="Delete asset"
            >
              <Trash2Icon className="size-4" />
            </Button>
          }
        />
      </When>
    </div>
  );
}
