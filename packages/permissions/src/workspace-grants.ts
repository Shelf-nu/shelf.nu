/**
 * `@shelf/permissions`, permissions a workspace switch adds to a role.
 *
 * The matrix (`./matrix`) is what every workspace grants a role. This table is
 * what an owner can add on top, one switch at a time: setting -> role ->
 * entity -> extra actions. `roleHasPermission` unions the rows of the switches
 * that are on with the matrix, so a switch only ever widens a role and a
 * switched-off workspace answers exactly as the matrix does.
 *
 * Data only, like the matrix. Read it through `roleHasPermission`.
 */
import type { OrganizationRole } from "./roles";
import { PermissionAction, PermissionEntity } from "./vocabulary";

/**
 * The workspace switches that add permissions to a role, value-identical to
 * the `Organization` columns of the same name. Every switch defaults to off.
 */
export type WorkspaceGrantSettings = {
  /** Managers may add and edit assets and kits, update locations and link codes. */
  managersCanEditAssets: boolean;
};

/** One workspace switch. */
export type WorkspaceGrantSetting = keyof WorkspaceGrantSettings;

/** The extra actions one switch adds, per role and entity. */
type GrantRow = Partial<
  Record<
    OrganizationRole,
    Partial<Record<PermissionEntity, readonly PermissionAction[]>>
  >
>;

/**
 * Every workspace switch and what it adds when on.
 *
 * `managersCanEditAssets` opens exactly the asset and kit editing paths:
 * - `asset: create, update` covers the new, duplicate and edit forms, single
 *   and bulk location updates, quantity settings and placements, the image,
 *   barcodes and QR relink on an asset.
 * - `kit: create, update` covers the kit forms and adding or removing kit assets.
 * - `qr: update` covers linking and claiming QR codes on assets and kits.
 *
 * Routes that share one of these pairs but stay closed to a Manager (the bulk
 * edits other than location, bulk create from a model, the sequential id
 * migration) opt out with `workspaceGrants: false`. Delete,
 * archive, import and every create on categories, tags, locations, custom
 * fields and asset models use pairs this row never grants.
 */
export const WORKSPACE_GRANTS: Readonly<
  Record<WorkspaceGrantSetting, GrantRow>
> = {
  managersCanEditAssets: {
    MANAGER: {
      [PermissionEntity.asset]: [
        PermissionAction.create,
        PermissionAction.update,
      ],
      [PermissionEntity.kit]: [
        PermissionAction.create,
        PermissionAction.update,
      ],
      [PermissionEntity.qr]: [PermissionAction.update],
    },
  },
};

/** Every switch off: the matrix answer, and the safe default while loading. */
export const NO_WORKSPACE_GRANTS: WorkspaceGrantSettings = {
  managersCanEditAssets: false,
};

/**
 * The extra actions the workspace's switched-on settings add to a role on an
 * entity.
 *
 * @param args.role - One role name; unknown names get nothing
 * @param args.entity - The entity being checked
 * @param args.workspace - The workspace's switches; `null`/`undefined` means all off
 * @returns The added actions, empty when nothing is switched on for this role
 */
export function workspaceGrantedActions({
  role,
  entity,
  workspace,
}: {
  role: string;
  entity: string;
  workspace: WorkspaceGrantSettings | null | undefined;
}): readonly string[] {
  if (!workspace) return [];
  const added: string[] = [];
  for (const setting of Object.keys(
    WORKSPACE_GRANTS
  ) as WorkspaceGrantSetting[]) {
    // why: strict `=== true` so an organization row that never selected the
    // column (undefined) reads as off, never as on.
    if (workspace[setting] !== true) continue;
    // why: index by plain string; unknown roles and entities fall through to
    // undefined and add nothing.
    const row = (
      WORKSPACE_GRANTS[setting] as Partial<
        Record<string, Partial<Record<string, readonly string[]>>>
      >
    )[role];
    added.push(...(row?.[entity] ?? []));
  }
  return added;
}

/**
 * Picks the switches out of a wider organization row, so `RoleAccess` and the
 * layout loader carry the switches and nothing else from the row.
 *
 * @param workspace - Any object holding the switch columns
 * @returns Exactly the switches
 */
export function pickWorkspaceGrants(
  workspace: WorkspaceGrantSettings
): WorkspaceGrantSettings {
  return { managersCanEditAssets: workspace.managersCanEditAssets === true };
}
