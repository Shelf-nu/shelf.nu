/**
 * Who may open the asset page's Actions menu.
 *
 * Every row in the menu checks its own grant, so the menu shows for anyone
 * who holds at least one of them: an asset write (`asset: update` or
 * `asset: custody`) or `problemReport: create`, which is what reaches Base
 * and Self service members.
 *
 * @see {@link file://./actions-dropdown.tsx}
 * @see {@link file://../../routes/_layout+/assets.$assetId.tsx}
 */
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

/**
 * Whether a member with these roles is offered the asset page's Actions menu.
 *
 * @param roles - The member's roles in the current workspace
 * @returns `true` when at least one row of the menu is theirs to use
 */
export function canOpenAssetActionsMenu(
  roles: Parameters<typeof userHasPermission>[0]["roles"]
): boolean {
  return (
    userHasPermission({
      roles,
      entity: PermissionEntity.asset,
      action: [PermissionAction.update, PermissionAction.custody],
    }) ||
    userHasPermission({
      roles,
      entity: PermissionEntity.problemReport,
      action: PermissionAction.create,
    })
  );
}
