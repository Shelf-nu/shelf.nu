/**
 * Server-side permission validation.
 *
 * Resolves the caller's roles and the workspace's permission switches (from
 * the caller, or from the database in one query) and delegates the actual
 * decision to the shared `roleHasPermission` resolver in `@shelf/permissions`,
 * the same logic the companion app uses for UI gating, so web and mobile can
 * never disagree about what a role may do. This module keeps the
 * webapp-specific concerns: the UserOrganization lookup and ShelfError
 * semantics.
 *
 * @see {@link file://../../../../../packages/permissions/src/index.ts}
 */
import type { OrganizationRoles } from "@prisma/client";
import { pickWorkspaceGrants, roleHasPermission } from "@shelf/permissions";
import { db } from "~/database/db.server";

import type { PermissionAction, PermissionEntity } from "./permission.data";
import type { WorkspaceGrantSettings } from "./role-access";
import { ShelfError } from "../error";

/**
 * Whose permissions a check reads. Roles and the workspace's permission
 * switches travel together: pass both (the caller already holds the
 * membership) or neither (they are loaded in one query). A caller holding
 * roles but not the switches passes `workspace: null`, which answers from the
 * matrix alone.
 */
export type PermissionSubject =
  | { roles?: undefined; workspace?: undefined }
  | {
      roles: OrganizationRoles[] | undefined;
      workspace: WorkspaceGrantSettings | null;
    };

/** What a permission check needs: the subject, the target and the action. */
export type PermissionCheckProps = {
  organizationId: string;
  userId: string;
  action: PermissionAction;
  entity: PermissionEntity;
  /**
   * `false` answers from the matrix alone, ignoring the workspace's
   * switches. For routes that share an entity/action pair with a path a
   * switch opens but must stay closed to the role it opens it for.
   */
  workspaceGrants?: boolean;
} & PermissionSubject;

/**
 * The check, as it may appear in an error's `additionalData`. Callers often
 * pass the whole organization row as `workspace` (it holds the switches), and
 * that data reaches the response body of a refused request, so only the
 * switches themselves are kept.
 */
function describeCheck(params: PermissionCheckProps) {
  return {
    ...params,
    workspace: params.workspace
      ? pickWorkspaceGrants(params.workspace)
      : params.workspace,
  };
}

/**
 * Checks whether a user holds a role granting `action` on `entity` within
 * the organization, counting the permissions the workspace's switches add.
 * Loads the user's roles and the switches from the database when the roles
 * are not supplied by the caller.
 *
 * @returns `true` when permitted, `false` otherwise.
 * @throws {ShelfError} 403 when the user does not belong to the
 *   organization, or a wrapped error if the roles lookup fails.
 */
export async function hasPermission(
  params: PermissionCheckProps
): Promise<boolean> {
  const { userId, entity, action, organizationId, workspaceGrants } = params;
  let { roles, workspace } = params;

  try {
    if (!roles || !Array.isArray(roles)) {
      const userOrg = await db.userOrganization.findFirst({
        where: { userId, organizationId },
        select: {
          roles: true,
          organization: { select: { managersCanEditAssets: true } },
        },
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
      workspace = userOrg.organization;
    }

    // Shared resolver: ADMIN/OWNER allow-all short-circuit, matrix lookup and
    // the workspace's switched-on grants.
    return roleHasPermission({
      roles,
      entity,
      action,
      workspace,
      workspaceGrants,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Error while checking permission",
      additionalData: describeCheck(params),
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
      additionalData: describeCheck(props),
      status: 403,
      label: "Permission",
      shouldBeCaptured: false,
    });
  }
  return true;
};
