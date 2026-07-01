import type { CSSProperties } from "react";
import type { AssetModel } from "@prisma/client";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "~/components/shared/button";
import When from "~/components/when/when";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { DeleteAssetModel } from "./delete-asset-model";

type AssetModelQuickActionsProps = {
  className?: string;
  style?: CSSProperties;
  assetModel: Pick<AssetModel, "id" | "name">;
};

export default function AssetModelQuickActions({
  className,
  style,
  assetModel,
}: AssetModelQuickActionsProps) {
  const { roles } = useUserRoleHelper();

  return (
    <div className={tw("flex items-center gap-2", className)} style={style}>
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.assetModel,
          action: PermissionAction.update,
        })}
      >
        <Button
          size="sm"
          variant="secondary"
          className={"p-2"}
          to={`${assetModel.id}/edit`}
          aria-label="Edit asset model"
          tooltip="Edit asset model"
        >
          <PencilIcon className="size-4" />
        </Button>
      </When>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.assetModel,
          action: PermissionAction.delete,
        })}
      >
        <DeleteAssetModel
          assetModel={assetModel}
          trigger={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={"p-2"}
              aria-label="Delete asset model"
              tooltip="Delete asset model"
            >
              <Trash2Icon className="size-4" />
            </Button>
          }
        />
      </When>
    </div>
  );
}
