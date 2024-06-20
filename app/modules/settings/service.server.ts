import { InviteStatuses } from "@prisma/client";
import type { Prisma, Organization } from "@prisma/client";

import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import {
  organizationRolesMap,
  type UserFriendlyRoles,
} from "~/routes/_layout+/settings.team";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";

const label = "Settings";

export interface TeamMembersWithUserOrInvite {
  name: string;
  img: string;
  email: string;
  status: InviteStatuses;
  role: UserFriendlyRoles;
  userId: string | null;
}

export async function getPaginatedAndFilterableSettingUsers({
  organizationId,
  request,
}: {
  organizationId: Organization["id"];
  request: LoaderFunctionArgs["request"];
}) {
  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);

  const { page, perPageParam, search } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    // const skip = page > 1 ? (page - 1) * perPage : 0;
    // const take = perPage >= 1 && perPage <= 100 ? perPage : 200;

    const userOrganizationWhere: Prisma.UserOrganizationWhereInput = {
      organizationId,
    };

    const inviteWhere: Prisma.InviteWhereInput = {
      organizationId,
      status: InviteStatuses.PENDING,
      inviteeEmail: { not: "" },
    };

    if (search) {
      /** Either search the input against organization's user */
      userOrganizationWhere.user = {
        OR: [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
        ],
      };

      /** Or search the input against input user/teamMember */
      inviteWhere.OR = [
        { inviteeTeamMember: { name: { contains: search } } },
        {
          inviteeUser: {
            OR: [
              { firstName: { contains: search } },
              { lastName: { contains: search } },
            ],
          },
        },
      ];
    }

    const [userMembers, invites, totalUserMembers, totalInvites] =
      await Promise.all([
        /** Get Users */
        db.userOrganization.findMany({
          where: userOrganizationWhere,
          select: { user: true, roles: true },
        }),
        /** Get the invites */
        db.invite.findMany({
          where: inviteWhere,
          distinct: ["inviteeEmail"],
          select: {
            id: true,
            teamMemberId: true,
            inviteeEmail: true,
            status: true,
            inviteeTeamMember: { select: { name: true } },
            roles: true,
          },
        }),
        db.userOrganization.count({ where: { organizationId } }),
        db.invite.count({
          where: {
            organizationId,
            status: InviteStatuses.PENDING,
            inviteeEmail: { not: "" },
          },
        }),
      ]);

    /**
     * Create a structure for the users org members and merge it with invites
     */
    const teamMembersWithUserOrInvite: TeamMembersWithUserOrInvite[] =
      userMembers.map((um) => ({
        name: `${um.user.firstName ? um.user.firstName : ""} ${
          um.user.lastName ? um.user.lastName : ""
        }`,
        img: um.user.profilePicture ?? "/static/images/default_pfp.jpg",
        email: um.user.email,
        status: "ACCEPTED",
        role: organizationRolesMap[um.roles[0]],
        userId: um.user.id,
      }));

    /**
     * Create the same structure for the invites
     */
    for (const invite of invites) {
      teamMembersWithUserOrInvite.push({
        name: invite.inviteeTeamMember.name,
        img: "/static/images/default_pfp.jpg",
        email: invite.inviteeEmail,
        status: invite.status,
        role: organizationRolesMap[invite?.roles[0]],
        userId: null,
      });
    }

    const totalItems = totalUserMembers + totalInvites;
    const totalPages = Math.ceil(totalItems / perPage);

    return {
      page,
      perPage,
      totalPages,
      search,
      items: teamMembersWithUserOrInvite,
      totalItems,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while getting team members with user or invite",
      additionalData: { organizationId },
      label,
    });
  }
}
