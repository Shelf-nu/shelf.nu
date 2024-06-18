import type { Organization, Prisma, TeamMember } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Team Member";

export async function createTeamMember({
  name,
  organizationId,
  userId,
}: {
  name: TeamMember["name"];
  organizationId: Organization["id"];
  userId?: TeamMember["userId"];
}) {
  try {
    return await db.teamMember.create({
      data: {
        name,
        organization: {
          connect: {
            id: organizationId,
          },
        },
        user: userId
          ? {
              connect: {
                id: userId,
              },
            }
          : undefined,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating the team member",
      additionalData: { name, organizationId },
      label,
    });
  }
}

export async function createTeamMemberIfNotExists({
  data,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  organizationId: Organization["id"];
}): Promise<Record<string, TeamMember["id"]>> {
  try {
    // first we get all the teamMembers from the assets and make then into an object where the category is the key and the value is an empty string
    /**
     * Important note: The field in the csv is called "custodian" for making it easy for the user
     * However in the app it works a bit different due to how the relationships are
     */
    const teamMembers = new Map(
      data
        .filter((asset) => asset.custodian !== "")
        .map((asset) => [asset.custodian, ""])
    );

    // Handle the case where there are no teamMembers
    if (teamMembers.has(undefined)) {
      return {};
    }

    // now we loop through the categories and check if they exist
    for (const [teamMember, _] of teamMembers) {
      const existingTeamMember = await db.teamMember.findFirst({
        where: {
          deletedAt: null,
          name: teamMember,
          organizationId,
        },
      });

      if (!existingTeamMember) {
        // if the teamMember doesn't exist, we create a new one
        const newTeamMember = await createTeamMember({
          name: teamMember as string,
          organizationId,
        });
        teamMembers.set(teamMember, newTeamMember.id);
      } else {
        // if the teamMember exists, we just update the id
        teamMembers.set(teamMember, existingTeamMember.id);
      }
    }

    return Object.fromEntries(Array.from(teamMembers));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating the team member. Please try again or contact support.",
      additionalData: { organizationId },
      label,
    });
  }
}

export async function getTeamMembers(params: {
  organizationId: Organization["id"];
  /** Page number. Starts at 1 */
  page: number;
  /** Assets to be loaded per page */
  perPage?: number;
  search?: string | null;
}) {
  const { organizationId, page = 1, perPage = 8, search } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

    /** Default value of where. Takes the assets belonging to current user */
    let where: Prisma.TeamMemberWhereInput = {
      deletedAt: null,
      organizationId,
    };

    /** If the search string exists, add it to the where object */
    if (search) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [teamMembers, totalTeamMembers] = await Promise.all([
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
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the team members",
      additionalData: { ...params },
      label,
    });
  }
}

export const getPaginatedAndFilterableTeamMembers = async ({
  request,
  organizationId,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
}) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
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
      teamMembers,
      totalPages,
      totalTeamMembers,
      cookie,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the team members",
      additionalData: { organizationId, page, perPageParam, search },
      label,
    });
  }
};

export async function getTeamMemberForCustodianFilter({
  organizationId,
  selectedTeamMembers = [],
  getAll,
}: {
  organizationId: Organization["id"];
  selectedTeamMembers?: TeamMember["id"][];
  getAll?: boolean;
}) {
  try {
    const [
      teamMemberExcludedSelected,
      teamMembersSelected,
      totalTeamMembers,
      org,
    ] = await Promise.all([
      db.teamMember.findMany({
        where: {
          organizationId,
          id: { notIn: selectedTeamMembers },
          deletedAt: null,
        },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        take: getAll ? undefined : 12,
      }),
      db.teamMember.findMany({
        where: { organizationId, id: { in: selectedTeamMembers } },
      }),
      db.teamMember.count({ where: { organizationId, deletedAt: null } }),
      db.organization.findUnique({
        where: { id: organizationId },
        select: { owner: true },
      }),
    ]);

    const allTeamMembers = [
      ...teamMembersSelected,
      ...teamMemberExcludedSelected,
    ];

    /**
     * Owners can be assigned in bookings so have to add it to the list
     */
    if (org?.owner && typeof org.owner.id === "string") {
      allTeamMembers.push({
        id: "owner",
        name: `${org.owner.firstName} ${org.owner.lastName} (Owner)`,
        userId: org.owner.id,
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
    }

    /**
     * If teamMember has a user associated then we have to use that user's id
     * otherwise we have to use teamMember's id
     */
    const combinedTeamMembers = allTeamMembers.map((teamMember) => ({
      ...teamMember,
      id: teamMember.userId ? teamMember.userId : teamMember.id,
    }));

    return {
      teamMembers: combinedTeamMembers,
      totalTeamMembers,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch team members",
      additionalData: { organizationId },
      label,
    });
  }
}
