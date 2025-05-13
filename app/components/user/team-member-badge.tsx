import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { resolveTeamMemberName } from "~/utils/user";
import { GrayBadge } from "../shared/gray-badge";

interface TeamMemberForBadge {
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
}: {
  teamMember: TeamMemberForBadge | undefined | null;
}) {
  const { roles } = useUserRoleHelper();
  const organization = useCurrentOrganization();
  const user = useUserData();

  const userCanViewBadge = userHasCustodyViewPermission({
    roles,
    custodianUser: teamMember?.user,
    organization,
    currentUserId: user?.id,
  });

  return teamMember ? (
    <GrayBadge>
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
      ) : (
        "private"
      )}
    </GrayBadge>
  ) : null;
}
