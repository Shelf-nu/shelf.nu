/**
 * Admin areas: the navigation entries that open an area of the app, and the
 * matrix grant each one needs. The sidebar and the command palette's quick
 * navigation read this one list, so they cannot disagree about who sees what.
 *
 * Settings and Team visibility come from `settings-tabs.ts`, which also knows
 * about personal workspaces.
 *
 * @see {@link file://../../hooks/use-sidebar-nav-items.tsx}
 * @see {@link file://../../components/layout/command-palette/command-palette.tsx}
 * @see {@link file://./settings-tabs.ts}
 */
import type { OrganizationRoles } from "@prisma/client";
import {
  PermissionAction,
  PermissionEntity,
  roleHasPermission,
} from "./permission.data";

/** The permission each admin area needs. */
export const ADMIN_AREA_GATES = {
  home: { entity: PermissionEntity.dashboard, action: PermissionAction.read },
  categories: {
    entity: PermissionEntity.category,
    action: PermissionAction.read,
  },
  tags: { entity: PermissionEntity.tag, action: PermissionAction.read },
  locations: {
    entity: PermissionEntity.location,
    action: PermissionAction.read,
  },
  audits: { entity: PermissionEntity.audit, action: PermissionAction.read },
  reminders: {
    entity: PermissionEntity.assetReminders,
    action: PermissionAction.read,
  },
  reports: { entity: PermissionEntity.reports, action: PermissionAction.read },
  createAsset: {
    entity: PermissionEntity.asset,
    action: PermissionAction.create,
  },
  createKit: { entity: PermissionEntity.kit, action: PermissionAction.create },
} as const satisfies Record<
  string,
  { entity: PermissionEntity; action: PermissionAction }
>;

/** An admin area name. */
export type AdminArea = keyof typeof ADMIN_AREA_GATES;

/**
 * Whether a member may see an admin area.
 *
 * @param args.roles - Every role on the membership
 * @param args.area - The area
 * @returns `true` when the membership holds the area's permission
 */
export function canSeeAdminArea({
  roles,
  area,
}: {
  roles: readonly OrganizationRoles[] | undefined;
  area: AdminArea;
}): boolean {
  return roleHasPermission({ roles, ...ADMIN_AREA_GATES[area] });
}
