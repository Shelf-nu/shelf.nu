import { OrganizationType } from "@prisma/client";
import type { Prisma, Organization, User } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database";
import {
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import { updateCookieWithPerPage } from "~/utils/cookies.server";

export const getUserPersonalOrganizationData = async ({
  userId,
}: {
  userId: string;
}) => {
  const where = {
    userId,
  };
  const [organization, totalAssets, totalLocations] = await db.$transaction([
    /** Get the assets */
    db.organization.findFirst({
      where: {
        userId,
        type: OrganizationType.PERSONAL,
      },
      include: {
        members: {
          include: {
            custodies: true,
          },
        },
      },
    }),

    /** Count the assets
     * Because we currently have only personal organizations, we just directly get the user's asset count
     */
    db.asset.count({
      where,
    }),

    /** Count the locations.
     * Same logic as with assets
     */
    db.location.count({
      where,
    }),
  ]);

  return {
    organization,
    totalAssets,
    totalLocations,
  };
};

export const getOrganization = async ({ id }: { id: Organization["id"] }) =>
  db.organization.findUnique({
    where: { id },
  });

export const getPaginatedAndFilterableTeamMembers = async ({
  request,
  organizationId,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
}) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  const { teamMembers, totalTeamMembers } = await getTeamMembers({
    organizationId,
    page,
    perPage,
    search,
  });
  const totalPages = Math.ceil(totalTeamMembers / perPage);

  return {
    page,
    perPage,
    search,
    prev,
    next,
    teamMembers,
    totalPages,
    totalTeamMembers,
    cookie,
  };
};

export async function getTeamMembers({
  organizationId,
  page = 1,
  perPage = 8,
  search,
}: {
  organizationId: Organization["id"];

  /** Page number. Starts at 1 */
  page: number;

  /** Assets to be loaded per page */
  perPage?: number;

  search?: string | null;
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

  /** Default value of where. Takes the assetss belonging to current user */
  let where: Prisma.TeamMemberWhereInput = {
    organizations: { some: { id: organizationId } },
  };

  /** If the search string exists, add it to the where object */
  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  const [teamMembers, totalTeamMembers] = await db.$transaction([
    /** Get the assets */
    db.teamMember.findMany({
      skip,
      take,
      where,
      orderBy: { createdAt: "desc" },
      include: {
        custodies: true,
      },
    }),

    /** Count them */
    db.teamMember.count({ where }),
  ]);

  return { teamMembers, totalTeamMembers };
}

export const getOrganizationByUserId = async ({
  userId,
  orgType,
}: {
  userId: User["id"];
  orgType: OrganizationType;
}) =>
  await db.organization.findFirst({
    where: {
      owner: {
        is: {
          id: userId,
        },
      },
      type: orgType,
    },
    select: {
      id: true,
      name: true,
      type: true,
      currency: true,
    },
  });
