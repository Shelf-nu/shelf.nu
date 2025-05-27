import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { GrayBadge } from "../shared/gray-badge";

export interface TeamMemberForBadge {
  name: string;
  user: {
    id: string;
    firstName: string | null;
    lastName?: string | null;
    email?: string | null;
    profilePicture?: string | null;
  } | null;
}

/**
 * A badge to display a team member's name and profile picture
 *
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
                teamMember?.user?.profilePicture ||
                "/static/images/default_pfp.jpg"
              }
              className="mr-1 size-4 rounded-full"
              alt={"Team member profile"}
            />
          ) : null}
          <span className="mt-px">
            {resolveTeamMemberName({
              name: teamMember.name,
              user: teamMember?.user
                ? {
                    firstName: teamMember?.user?.firstName || null,
                    lastName: teamMember?.user?.lastName || null,
                    email: teamMember?.user?.email || "",
                  }
                : undefined,
            })}
          </span>
        </>
      ) : !hidePrivate ? (
        "private"
      ) : null}
    </GrayBadge>
  ) : null;
}
