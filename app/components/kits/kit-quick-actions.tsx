import type { Kit } from "@prisma/client";
import { PencilIcon } from "lucide-react";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { Button } from "../shared/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../shared/tooltip";
import When from "../when/when";

type KitQuickActionsProps = {
  className?: string;
  style?: React.CSSProperties;
  kit: Kit;
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
              to={`/kits/${kit.id}/edit`}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <PencilIcon className="size-4" />
            </Button>
          </TooltipTrigger>

          <TooltipContent align="center" side="top">
            Edit asset information
          </TooltipContent>
        </Tooltip>
      </When>
    </div>
  );
}
