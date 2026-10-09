import type { CSSProperties } from "react";
import type { Category } from "@prisma/client";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "~/components/shared/button";
import When from "~/components/when/when";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import type { CategoryUsage } from "./delete-category";
import { DeleteCategory } from "./delete-category";

type CategoryQuickActionsProps = {
  className?: string;
  style?: CSSProperties;
  /** `_count` lets the delete dialog ask for a typed name only when in use. */
  category: Pick<Category, "id" | "name"> & { _count?: CategoryUsage };
};

export default function CategoryQuickActions({
  className,
  style,
  category,
}: CategoryQuickActionsProps) {
  const roles = useOrganizationRoles();

  return (
    <div className={tw("flex items-center gap-2", className)} style={style}>
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.category,
          action: PermissionAction.update,
        })}
      >
        <Button
          size="sm"
          variant="secondary"
          className={"p-2"}
          to={`${category.id}/edit`}
          aria-label="Edit category"
          tooltip="Edit category"
        >
          <PencilIcon className="size-4" />
        </Button>
      </When>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.category,
          action: PermissionAction.delete,
        })}
      >
        <DeleteCategory
          category={category}
          trigger={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={"p-2"}
              aria-label="Delete category"
              tooltip="Delete category"
            >
              <Trash2Icon className="size-4" />
            </Button>
          }
        />
      </When>
    </div>
  );
}
