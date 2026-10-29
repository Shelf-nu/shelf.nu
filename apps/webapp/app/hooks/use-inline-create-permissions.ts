/**
 * useInlineCreatePermissions: which "create new" shortcuts the member may see
 * inside the asset and kit forms and the pickers they use (inline create
 * dialogs and "Create categories / tags / locations / ..." links).
 *
 * Each shortcut follows its entity's own `create` grant, the same one the
 * route it opens checks. No workspace switch opens those grants, so a Manager
 * editing assets picks from existing values only.
 *
 * @see {@link file://../components/inline-entity-creation-dialog/inline-entity-creation-dialog.tsx}
 */
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

/** Whether the member may create each picker entity inline. */
export type InlineCreatePermissions = {
  category: boolean;
  tag: boolean;
  location: boolean;
  customField: boolean;
  assetModel: boolean;
};

/**
 * Returns which picker entities the member may create from inside a form.
 *
 * @returns One flag per entity; all `false` while the layout data loads
 */
export function useInlineCreatePermissions(): InlineCreatePermissions {
  const roles = useOrganizationRoles();
  const canCreate = (entity: PermissionEntity) =>
    userHasPermission({ roles, entity, action: PermissionAction.create });

  return {
    category: canCreate(PermissionEntity.category),
    tag: canCreate(PermissionEntity.tag),
    location: canCreate(PermissionEntity.location),
    customField: canCreate(PermissionEntity.customField),
    assetModel: canCreate(PermissionEntity.assetModel),
  };
}
