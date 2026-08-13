/**
 * Server-side permission validation.
 *
 * Resolves the caller's roles (from the passed array or the database) and
 * delegates the actual (roles, entity, action) decision to the shared
 * `roleHasPermission` resolver in `@shelf/permissions` — the same logic the
 * companion app uses for UI gating, so web and mobile can never disagree
 * about what a role may do. This module keeps the webapp-specific concerns:
 * the UserOrganization lookup and ShelfError semantics.
 *
 * @see {@link file://../../../../../packages/permissions/src/index.ts}
 */
import type { OrganizationRoles } from "@prisma/client";
import { roleHasPermission } from "@shelf/permissions";
import { db } from "~/database/db.server";

import type { PermissionAction, PermissionEntity } from "./permission.data";
import { ShelfError } from "../error";

export interface PermissionCheckProps {
  organizationId: string;
  roles?: OrganizationRoles[];
  userId: string;
  action: PermissionAction;
  entity: PermissionEntity;
}

/**
 * Checks whether a user holds a role granting `action` on `entity` within
 * the organization. Loads the user's roles from the database when they are
 * not supplied by the caller.
 *
 * @returns `true` when permitted, `false` otherwise.
 * @throws {ShelfError} 403 when the user does not belong to the
 *   organization, or a wrapped error if the roles lookup fails.
 */
export async function hasPermission(
  params: PermissionCheckProps
): Promise<boolean> {
  let { userId, entity, action, organizationId, roles } = params;

  try {
    if (!roles || !Array.isArray(roles)) {
      const userOrg = await db.userOrganization.findFirst({
        where: { userId, organizationId },
      });

      if (!userOrg) {
        throw new ShelfError({
          cause: null,
          message: `User doesn't belong to organization`,
          status: 403,
          additionalData: { userId, organizationId },
          label: "Permission",
        });
      }

      roles = userOrg.roles;
    }

    // Shared resolver: ADMIN/OWNER allow-all short-circuit + matrix lookup.
    return roleHasPermission({ roles, entity, action });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Error while checking permission",
      additionalData: { ...params },
      label: "Permission",
    });
  }
}

/**
 * Asserts the permission, throwing a 403 ShelfError when denied.
 *
 * @returns `true` when the permission check passes.
 * @throws {ShelfError} 403 when the user lacks the permission.
 */
export const validatePermission = async (props: PermissionCheckProps) => {
  const res = await hasPermission(props);

  if (!res) {
    throw new ShelfError({
      cause: null,
      title: "Unauthorized",
      message: `You have no permission to perform this action`,
      additionalData: { ...props },
      status: 403,
      label: "Permission",
      shouldBeCaptured: false,
    });
  }
  return true;
};
