import type { Kit } from "@prisma/client";
import { PencilIcon, QrCodeIcon, Trash2Icon } from "lucide-react";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import DeleteKit from "./delete-kit";
import { CodePreviewDialog } from "../code-preview/code-preview-dialog";
import { Button } from "../shared/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../shared/tooltip";
import When from "../when/when";

type KitQuickActionsProps = {
  className?: string;
  style?: React.CSSProperties;
  kit: Kit & { qrId: string };
};

export default function KitQuickActions({
  className,
  style,
  kit,
}: KitQuickActionsProps) {
  const { roles } = useUserRoleHelper();

  return (
    <div className={tw("flex items-center gap-2", className)} style={style}>
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.kit,
          action: PermissionAction.update,
        })}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className={"p-2"}
              to={`/kits/${kit.id}/edit`}
            >
              <PencilIcon className="size-4" />
            </Button>
          </TooltipTrigger>

          <TooltipContent align="center" side="top">
            Edit kit information
          </TooltipContent>
        </Tooltip>
      </When>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.qr,
          action: PermissionAction.read,
        })}
      >
        <Tooltip>
          <CodePreviewDialog
            item={{
              id: kit.id,
              name: kit.name,
              qrId: kit.qrId,
              type: "kit",
            }}
            trigger={
              <TooltipTrigger asChild>
                <Button size="sm" variant="secondary" className="p-2">
                  <QrCodeIcon className="size-4" />
                </Button>
              </TooltipTrigger>
            }
          />

          <TooltipContent align="center" side="top">
            Show kit codes
          </TooltipContent>
        </Tooltip>
      </When>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.kit,
          action: PermissionAction.delete,
        })}
      >
        <Tooltip>
          <DeleteKit
            kit={kit}
            trigger={
              <TooltipTrigger asChild>
                <Button size="sm" variant="secondary" className={"p-2"}>
                  <Trash2Icon className="size-4" />
                </Button>
              </TooltipTrigger>
            }
          />

          <TooltipContent align="center" side="top">
            Delete kit
          </TooltipContent>
        </Tooltip>
      </When>
    </div>
  );
}
