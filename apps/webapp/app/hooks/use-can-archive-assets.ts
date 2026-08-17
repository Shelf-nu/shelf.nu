/**
 * Whether the current user can archive and reinstate assets.
 *
 * Gates the Active/Archived/All view toggle on the asset index (issue #382),
 * and the wording of the "nothing matched your search" empty state, so the two
 * never disagree about whether an Archived tab exists.
 *
 * ## Why this is a role gate and not just a permission check
 *
 * BASE and SELF_SERVICE exist to consume the AVAILABLE inventory: BASE plans
 * bookings and runs audits (it holds no `checkout`/`checkin`), SELF_SERVICE
 * runs a booking end to end and takes custody. Both are asking "what can I
 * book / take right now?".
 *
 * An archived asset is never the answer to that question — it is out of
 * service, and neither role can reinstate it. Showing them a tab full of
 * things they can neither use nor fix works against the point of archiving,
 * which is to clear exactly that clutter out of their way.
 *
 * `asset: update` is the permission archiving and reinstating are gated on
 * (see the asset actions dropdown and the bulk actions dropdown), so keying
 * the toggle off the same one keeps the view and the actions in step: you see
 * the tab if and only if you can act on what is in it.
 *
 * @returns `true` for ADMIN / OWNER, `false` for BASE / SELF_SERVICE.
 */

import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

export function useCanArchiveAssets(): boolean {
  const { roles } = useUserRoleHelper();

  return userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });
}
