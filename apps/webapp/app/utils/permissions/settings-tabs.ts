/**
 * Settings tabs: the tabs of `/settings` and `/settings/team`, as data.
 *
 * Each tab names the permission of the page it opens, using the page's EDIT
 * permission where the page is an editor, so a member who can only read
 * (BASE holds `assetModel:read` and `workingHours:read`) gets no tab for an
 * editor they cannot use. The Settings layout, its index redirect, the Team
 * layout, the sidebar and the command palette all read this one list.
 *
 * Hiding a tab is never the gate: every settings page keeps its own loader
 * permission check.
 *
 * @see {@link file://../../routes/_layout+/settings.tsx}
 * @see {@link file://../../routes/_layout+/settings.team.tsx}
 */
import type { OrganizationRoles } from "@prisma/client";
import {
  PermissionAction,
  PermissionEntity,
  roleHasPermission,
} from "./permission.data";

/** One permission a tab may be opened with. */
export type TabGate = { entity: PermissionEntity; action: PermissionAction };

/** A settings tab. */
export type SettingsTab = {
  /** Path relative to the parent layout. */
  to: string;
  /** Tab label. */
  content: string;
  /** Visible when ANY of these is held. */
  gates: readonly TabGate[];
  /** Hidden in personal workspaces. */
  teamWorkspaceOnly: boolean;
};

const gate = (entity: PermissionEntity, action: PermissionAction): TabGate => ({
  entity,
  action,
});

/** `/settings/*` tabs, in display order. The first visible one is the default. */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  {
    to: "general",
    content: "General",
    gates: [gate(PermissionEntity.generalSettings, PermissionAction.read)],
    teamWorkspaceOnly: false,
  },
  {
    to: "bookings",
    content: "Bookings",
    gates: [gate(PermissionEntity.workingHours, PermissionAction.update)],
    teamWorkspaceOnly: true,
  },
  {
    to: "emails",
    content: "Emails",
    gates: [gate(PermissionEntity.emailSettings, PermissionAction.read)],
    teamWorkspaceOnly: true,
  },
  {
    to: "custom-fields",
    content: "Custom fields",
    gates: [gate(PermissionEntity.customField, PermissionAction.update)],
    teamWorkspaceOnly: false,
  },
  {
    to: "asset-models",
    content: "Asset models",
    gates: [gate(PermissionEntity.assetModel, PermissionAction.update)],
    teamWorkspaceOnly: false,
  },
  {
    to: "team",
    content: "Team",
    gates: [
      gate(PermissionEntity.teamMember, PermissionAction.read),
      gate(PermissionEntity.nonRegisteredMember, PermissionAction.read),
    ],
    teamWorkspaceOnly: false,
  },
];

/** `/settings/team/*` tabs, in display order. */
export const TEAM_TABS: readonly SettingsTab[] = [
  {
    to: "users",
    content: "Users",
    gates: [gate(PermissionEntity.teamMember, PermissionAction.read)],
    teamWorkspaceOnly: true,
  },
  {
    to: "invites",
    content: "Invites",
    gates: [gate(PermissionEntity.teamMember, PermissionAction.create)],
    teamWorkspaceOnly: true,
  },
  {
    to: "nrm",
    content: "Non-registered members",
    gates: [gate(PermissionEntity.nonRegisteredMember, PermissionAction.read)],
    teamWorkspaceOnly: false,
  },
];

/** Every permission that makes some settings tab visible: the Settings layout's gate. */
export const SETTINGS_LAYOUT_GATES: readonly TabGate[] = SETTINGS_TABS.flatMap(
  (t) => t.gates
);

/** Every permission that makes some Team tab visible: the Team layout's gate. */
export const TEAM_LAYOUT_GATES: readonly TabGate[] = TEAM_TABS.flatMap(
  (t) => t.gates
);

/**
 * Filters a tab list down to the tabs a membership may see in this workspace.
 * A tab shows when any of its gates is held, and never in a personal
 * workspace when it is marked team-only.
 */
function visible(
  tabs: readonly SettingsTab[],
  {
    roles,
    isPersonalOrg,
  }: { roles: readonly OrganizationRoles[] | undefined; isPersonalOrg: boolean }
): SettingsTab[] {
  return tabs.filter(
    (tab) =>
      !(tab.teamWorkspaceOnly && isPersonalOrg) &&
      tab.gates.some(({ entity, action }) =>
        roleHasPermission({ roles, entity, action })
      )
  );
}

/**
 * The settings tabs a member may see.
 *
 * @param args.roles - Every role on the membership
 * @param args.isPersonalOrg - The workspace is a personal one
 * @returns Visible tabs, in display order
 */
export function visibleSettingsTabs(args: {
  roles: readonly OrganizationRoles[] | undefined;
  isPersonalOrg: boolean;
}): SettingsTab[] {
  return visible(SETTINGS_TABS, args);
}

/**
 * The Team tabs a member may see.
 *
 * @param args.roles - Every role on the membership
 * @param args.isPersonalOrg - The workspace is a personal one
 * @returns Visible tabs, in display order
 */
export function visibleTeamTabs(args: {
  roles: readonly OrganizationRoles[] | undefined;
  isPersonalOrg: boolean;
}): SettingsTab[] {
  return visible(TEAM_TABS, args);
}
