import type { Category } from "@prisma/client";
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
import { DeleteCategory } from "./delete-category";

type CategoryQuickActionsProps = {
  className?: string;
  style?: React.CSSProperties;
  category: Pick<Category, "id" | "name">;
};

export default function CategoryQuickActions({
  className,
  style,
  category,
}: CategoryQuickActionsProps) {
  const { roles } = useUserRoleHelper();

  return (
    <div className={tw("flex items-center gap-2", className)} style={style}>
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.category,
          action: PermissionAction.update,
        })}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className={"p-2"}
              to={`${category.id}/edit`}
              aria-label="Edit category"
            >
              <PencilIcon className="size-4" />
            </Button>
          </TooltipTrigger>

          <TooltipContent align="center" side="top">
            Edit category
          </TooltipContent>
        </Tooltip>
      </When>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.category,
          action: PermissionAction.delete,
        })}
      >
        <Tooltip>
          <DeleteCategory
            category={category}
            trigger={
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  className={"p-2"}
                  aria-label="Delete category"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </TooltipTrigger>
            }
          />

          <TooltipContent align="center" side="top">
            Delete category
          </TooltipContent>
        </Tooltip>
      </When>
    </div>
  );
}
