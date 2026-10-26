import { WITHHELD_CUSTODIAN_NAME } from "@shelf/labels";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { useUserData } from "~/hooks/use-user-data";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import type { TeamMemberNameFields } from "~/utils/user";
import { resolveTeamMemberName } from "~/utils/user";
import { Button } from "../shared/button";
import { GrayBadge } from "../shared/gray-badge";

/**
 * The shape this badge needs from a custodian row.
 *
 * Extends {@link TeamMemberNameFields}, so `user.displayName` is required here
 * too and a loader that forgets to select it fails to compile. `user.id` is
 * additionally required because the permission check compares it against the
 * viewer, and `id` because the badge links to the member's custody.
 */
export interface TeamMemberForBadge extends TeamMemberNameFields {
  /**
   * The team member's id, for the asset index custody filter. `null` when the
   * row names a person with no team member (e.g. a booking's creator).
   */
  id: string | null;
  user:
    | (NonNullable<TeamMemberNameFields["user"]> & {
        id: string;
        profilePicture?: string | null;
      })
    | null;
}

/**
 * A badge showing a team member's name and profile picture.
 *
 * The whole `teamMember` is handed to `resolveTeamMemberName` rather than
 * rebuilt field by field: a re-projection here silently drops `displayName`
 * and, because a resolved user name outranks the stored `TeamMember.name`,
 * would override a correct name supplied by the caller.
 *
 * A visible badge links to what the person holds, choosing the first target
 * the viewer may open:
 * 1. their team member page (`teamMemberProfile: read`, registered users only)
 * 2. the asset index filtered to their custody (`asset: read`, needs `id`)
 *
 * The custody filter is narrowed to the viewer's own custody unless they may
 * see everyone's, the same rule that decides whether the badge shows the name,
 * so a badge the viewer can read never links to a refused filter.
 *
 * @param props.teamMember - The custodian to name; renders nothing when absent
 * @param props.hidePrivate - Hide the badge entirely, rather than showing
 *   "private", when the viewer may not see this custodian
 */
export function TeamMemberBadge({
  teamMember,
  /** Hide the "private" badge in case the user cannot see custodian */
  hidePrivate = false,
}: {
  teamMember: TeamMemberForBadge | undefined | null;
  hidePrivate?: boolean;
}) {
  const roles = useOrganizationRoles();
  const organization = useCurrentOrganization();
  const user = useUserData();

  const userCanViewBadge = userCanViewSpecificCustody({
    roles,
    custodianUserId: teamMember?.user?.id,
    organization: organization as OrganizationPermissionSettings, // Here we can be sure as TeamMemberBadge is only used in the context of an organization/logged in route
    currentUserId: user?.id,
  });

  const canViewTeamMemberProfile = userHasPermission({
    roles,
    entity: PermissionEntity.teamMemberProfile,
    action: PermissionAction.read,
  });
  const canReadAssets = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.read,
  });

  /** Where the badge links, or `null` to render it plain */
  const href = !userCanViewBadge
    ? null
    : canViewTeamMemberProfile && teamMember?.user?.id
    ? `/settings/team/users/${teamMember.user.id}/assets`
    : canReadAssets && teamMember?.id
    ? `/assets?${new URLSearchParams({ teamMember: teamMember.id })}`
    : null;

  if (!teamMember) {
    return null;
  }

  const badge = (
    <GrayBadge className={tw(!userCanViewBadge && hidePrivate && "hidden")}>
      {userCanViewBadge ? (
        <>
          {teamMember?.user ? (
            <img
              src={
                teamMember.user.profilePicture ||
                "/static/images/default_pfp.jpg"
              }
              className="mr-1 size-4 rounded-full"
              alt={"Team member profile"}
            />
          ) : null}
          <span className="mt-px">{resolveTeamMemberName(teamMember)}</span>
        </>
      ) : !hidePrivate ? (
        WITHHELD_CUSTODIAN_NAME
      ) : null}
    </GrayBadge>
  );

  return href ? (
    <Button
      to={href}
      variant="inherit"
      className="hover:no-underline"
      title={`View assets held by ${resolveTeamMemberName(teamMember)}`}
    >
      {badge}
    </Button>
  ) : (
    badge
  );
}
