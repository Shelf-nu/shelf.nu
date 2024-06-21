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

  const status =
    searchParams.get("status") === "ALL"
      ? null
      : (searchParams.get("status") as InviteStatuses);

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 200;

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
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
        ],
      };

      /** Or search the input against input user/teamMember */
      inviteWhere.OR = [
        {
          inviteeTeamMember: {
            name: { contains: search, mode: "insensitive" },
          },
        },
        {
          inviteeUser: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    if (status) {
      Object.assign(userOrganizationWhere, {
        user: {
          receivedInvites: { some: { status } },
        },
      });
      inviteWhere.status = status;
    }

    /**
     * We have to get the items from two different data models, so have to
     * divide skip and take into two part to get equal items from each model
     */
    const finalSkip = skip / 2;
    const finalTake = take / 2;

    const [userMembers, invites, totalUserMembers, totalInvites] =
      await Promise.all([
        /** Get Users */
        db.userOrganization.findMany({
          where: userOrganizationWhere,
          skip: finalSkip,
          take: finalTake,
          select: { user: true, roles: true },
        }),
        /** Get the invites */
        db.invite.findMany({
          where: inviteWhere,
          distinct: ["inviteeEmail"],
          skip: finalSkip,
          take: finalTake,
          select: {
            id: true,
            teamMemberId: true,
            inviteeEmail: true,
            status: true,
            inviteeTeamMember: { select: { name: true } },
            roles: true,
          },
        }),
        db.userOrganization.count({ where: userOrganizationWhere }),

        db.invite.groupBy({
          by: ["inviteeEmail"],
          where: inviteWhere,
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

    const totalItems = totalUserMembers + totalInvites.length;
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
      message: "Something went wrong while getting registered users",
      additionalData: { organizationId },
      label,
    });
  }
}

export async function getPaginatedAndFilterableSettingTeamMembers({
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
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 200;

    /**
     * 1. Don't have any invites(userId:null)
     * 2. If they have invites, they should not be pending(userId!=null which mean invite is accepted so we only need to worry about pending ones)
     */
    const where: Prisma.TeamMemberWhereInput = {
      deletedAt: null,
      organizationId,
      userId: null,
      receivedInvites: {
        none: { status: InviteStatuses.PENDING },
      },
    };

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const [teamMembers, totalTeamMembers] = await Promise.all([
      db.teamMember.findMany({
        where,
        take,
        skip,
        include: {
          _count: { select: { custodies: true } },
        },
      }),
      db.teamMember.count({ where }),
    ]);

    const totalPages = Math.ceil(totalTeamMembers / perPage);

    return {
      page,
      perPage,
      totalPages,
      search,
      totalTeamMembers,
      teamMembers,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting team members",
      additionalData: { organizationId },
      label,
    });
  }
}
