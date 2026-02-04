import { InviteStatuses } from "@prisma/client";
import type { Prisma, Organization } from "@prisma/client";

import type { LoaderFunctionArgs } from "react-router";
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
  id: string;
  name: string;
  img: string;
  email: string;
  status: InviteStatuses;
  role: UserFriendlyRoles;
  userId: string | null;
  sso: boolean;
  custodies?: number;
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
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 200;

    const userOrganizationWhere: Prisma.UserOrganizationWhereInput = {
      organizationId,
    };

    if (search) {
      /** Either search the input against organization's user */
      userOrganizationWhere.user = {
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      };
    }

    const [userMembers, totalItems] = await Promise.all([
      /** Get Users */
      db.userOrganization.findMany({
        where: userOrganizationWhere,
        skip,
        take,
        select: {
          user: {
            include: {
              teamMembers: {
                where: { organizationId },
                include: {
                  _count: {
                    select: { custodies: true },
                  },
                },
              },
            },
          },
          roles: true,
        },
      }),

      db.userOrganization.count({ where: userOrganizationWhere }),
    ]);

    /**
     * Create a structure for the users org members and merge it with invites
     */
    const teamMembersWithUserOrInvite: TeamMembersWithUserOrInvite[] =
      userMembers.map((um) => ({
        id: um.user.id,
        name: `${um.user.firstName ? um.user.firstName : ""} ${
          um.user.lastName ? um.user.lastName : ""
        }`,
        img: um.user.profilePicture ?? "/static/images/default_pfp.jpg",
        email: um.user.email,
        status: "ACCEPTED",
        role: organizationRolesMap[um.roles[0]],
        userId: um.user.id,
        sso: um.user.sso,
        custodies: um?.user?.teamMembers?.[0]?._count?.custodies || 0,
      }));

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
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { user: { firstName: { contains: search, mode: "insensitive" } } },
        { user: { lastName: { contains: search, mode: "insensitive" } } },
      ];
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
