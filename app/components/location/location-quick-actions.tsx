import type { CSSProperties } from "react";
import type { Location } from "@prisma/client";
import { MapIcon, PencilIcon, QrCodeIcon, Trash2Icon } from "lucide-react";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { DeleteLocation } from "./delete-location";
import { Button } from "../shared/button";
import When from "../when/when";

type LocationQuickActionsProps = {
  className?: string;
  style?: CSSProperties;
  location: Pick<Location, "id" | "name"> & { childCount?: number };
};

export default function LocationQuickActions({
  className,
  style,
  location,
}: LocationQuickActionsProps) {
  const { roles } = useUserRoleHelper();

  const canUpdate = userHasPermission({
    roles,
    entity: PermissionEntity.location,
    action: PermissionAction.update,
  });

  const canDelete = userHasPermission({
    roles,
    entity: PermissionEntity.location,
    action: PermissionAction.delete,
  });

  const canReadBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.read,
  });

  const canManageAssets = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });

  return (
    <div className={tw("flex items-center gap-2", className)} style={style}>
      <When truthy={canUpdate}>
        <Button
          size="sm"
          variant="secondary"
          className="p-2"
          to={`/locations/${location.id}/edit`}
          aria-label="Edit location"
          tooltip="Edit location"
        >
          <PencilIcon className="size-4" />
        </Button>
      </When>

      <When truthy={canManageAssets}>
        <Button
          size="sm"
          variant="secondary"
          className="p-2"
          to={`/locations/${location.id}/assets/manage-assets`}
          aria-label="Manage location assets"
          tooltip="Manage location assets"
        >
          <MapIcon className="size-4" />
        </Button>
      </When>

      <When truthy={canReadBooking}>
        <Button
          size="sm"
          variant="secondary"
          className="p-2"
          to={`/locations/${location.id}/scan-assets-kits`}
          aria-label="Scan assets or kits"
          tooltip="Scan assets or kits"
        >
          <QrCodeIcon className="size-4" />
        </Button>
      </When>

      <When truthy={canDelete}>
        <DeleteLocation
          location={{
            ...location,
            childCount: location.childCount,
          }}
          trigger={
            <Button
              size="sm"
              variant="secondary"
              className="p-2"
              aria-label="Delete location"
              tooltip="Delete location"
            >
              <Trash2Icon className="size-4" />
            </Button>
          }
        />
      </When>
    </div>
  );
}
