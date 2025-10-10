import type { Tag } from "@prisma/client";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "~/components/shared/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import When from "~/components/when/when";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { DeleteTag } from "./delete-tag";

type TagQuickActionsProps = {
  className?: string;
  style?: React.CSSProperties;
  tag: Pick<Tag, "id" | "name">;
};

export default function TagQuickActions({
  className,
  style,
  tag,
}: TagQuickActionsProps) {
  const { roles } = useUserRoleHelper();

  return (
    <div className={tw("flex items-center gap-2", className)} style={style}>
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.tag,
          action: PermissionAction.update,
        })}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className={"p-2"}
              to={`${tag.id}/edit`}
              aria-label="Edit tag"
            >
              <PencilIcon className="size-4" />
            </Button>
          </TooltipTrigger>

          <TooltipContent align="center" side="top">
            Edit tag
          </TooltipContent>
        </Tooltip>
      </When>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.tag,
          action: PermissionAction.delete,
        })}
      >
        <Tooltip>
          <DeleteTag
            tag={tag}
            trigger={
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  className={"p-2"}
                  aria-label="Delete tag"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </TooltipTrigger>
            }
          />

          <TooltipContent align="center" side="top">
            Delete tag
          </TooltipContent>
        </Tooltip>
      </When>
    </div>
  );
}
