import type { Organization, Prisma, TeamMember } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { ALL_SELECTED_KEY, getParamsValues } from "~/utils/list";
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
        "Something went wrong while creating the team member. Seems like some of the team member data in your import file is invalid. Please check and try again.",
      additionalData: { organizationId },
      label,
      /** No need to capture those. They are mostly related to malformed CSV data */
      shouldBeCaptured: false,
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
    const [teamMemberExcludedSelected, teamMembersSelected, totalTeamMembers] =
      await Promise.all([
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
      ]);

    const allTeamMembers = [
      ...teamMembersSelected,
      ...teamMemberExcludedSelected,
    ];

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
      rawTeamMembers: allTeamMembers,
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

export async function getTeamMember({ id }: { id: TeamMember["id"] }) {
  try {
    return await db.teamMember.findUniqueOrThrow({ where: { id } });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Team member not found",
      additionalData: { id },
      label,
    });
  }
}

export async function bulkDeleteNRMs({
  nrmIds,
  organizationId,
}: {
  nrmIds: TeamMember["id"][];
  organizationId: TeamMember["organizationId"];
}) {
  try {
    const where: Prisma.TeamMemberWhereInput = nrmIds.includes(ALL_SELECTED_KEY)
      ? { organizationId }
      : { id: { in: nrmIds }, organizationId };

    const teamMembers = await db.teamMember.findMany({
      where,
      select: { id: true, _count: { select: { custodies: true } } },
    });

    /** If some team members have custody, then delete is not allowed */
    const someTeamMemberHasCustodies = teamMembers.some(
      (tm) => tm._count.custodies > 0
    );

    if (someTeamMemberHasCustodies) {
      throw new ShelfError({
        cause: null,
        message:
          "Some team members has custody over some assets. Please release custody or check-in those assets before deleting the user.",
        label,
      });
    }

    return await db.teamMember.updateMany({
      where: { id: { in: teamMembers.map((tm) => tm.id) } },
      data: { deletedAt: new Date() },
    });
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk deleting non-registered members";

    throw new ShelfError({
      cause,
      message,
      label,
    });
  }
}
