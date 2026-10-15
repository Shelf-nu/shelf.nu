/**
 * Whether the current user can archive and reinstate assets.
 *
 * Gates the archive ACTIONS on the client (issue #382): the Archive /
 * Reinstate item in the asset Actions menu, the two bulk-menu items and their
 * dialogs, and the "reinstate it" hints on frozen menus. Seeing archived
 * assets is a separate question, answered by `useCanViewArchivedAssets`: a
 * Manager sees the Archived view but cannot archive or reinstate.
 *
 * The grant is `asset: archive`, the same one the server enforces on the detail
 * action and on `POST /api/assets/bulk-archive`. ADMIN and OWNER hold it through
 * the allow-all short-circuit; MANAGER, SELF_SERVICE and BASE do not. Taking
 * an asset out of service is a catalogue decision, which those roles do not
 * make.
 *
 * @returns `true` when the member holds `asset: archive`, `false` otherwise
 *   (including while the layout data is still loading).
 */

import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

export function useCanArchiveAssets(): boolean {
  const roles = useOrganizationRoles();

  return userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.archive,
  });
}
