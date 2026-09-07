import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { tw } from "~/utils/tw";
import type { TeamMemberNameFields } from "~/utils/user";
import { resolveTeamMemberName } from "~/utils/user";
import { GrayBadge } from "../shared/gray-badge";

/**
 * The shape this badge needs from a custodian row.
 *
 * Extends {@link TeamMemberNameFields}, so `user.displayName` is required here
 * too and a loader that forgets to select it fails to compile. `user.id` is
 * additionally required because the permission check compares it against the
 * viewer.
 */
export interface TeamMemberForBadge extends TeamMemberNameFields {
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
  const { roles } = useUserRoleHelper();
  const organization = useCurrentOrganization();
  const user = useUserData();

  const userCanViewBadge = userCanViewSpecificCustody({
    roles,
    custodianUserId: teamMember?.user?.id,
    organization: organization as OrganizationPermissionSettings, // Here we can be sure as TeamMemberBadge is only used in the context of an organization/logged in route
    currentUserId: user?.id,
  });

  return teamMember ? (
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
        "private"
      ) : null}
    </GrayBadge>
  ) : null;
}
