import type { Organization, Prisma, TeamMember } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { ALL_SELECTED_KEY, getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Team Member";
type TeamMemberWithUserData = Prisma.TeamMemberGetPayload<{
  include: {
    user: {
      select: {
        firstName: true;
        lastName: true;
        email: true;
      };
    };
  };
}>;

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

    // Process each team member with case-insensitive matching
    for (const [teamMember, _] of teamMembers) {
      const existingTeamMember = await db.teamMember.findFirst({
        where: {
          deletedAt: null,
          organizationId,
          // Use case-insensitive comparison via Prisma's mode option
          name: {
            equals: teamMember as string,
            mode: "insensitive",
          },
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
  where?: Prisma.TeamMemberWhereInput;
}) {
  const { organizationId, page = 1, perPage = 8, search } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

    /** Default value of where. Takes the assets belonging to current user */
    let where: Prisma.TeamMemberWhereInput = {
      deletedAt: null,
      organizationId,
      ...params.where,
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
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
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
  where,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
  where?: Prisma.TeamMemberWhereInput;
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
      where,
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
  isSelfService,
  userId,
}: {
  organizationId: Organization["id"];
  selectedTeamMembers?: TeamMember["id"][];
  getAll?: boolean;
  isSelfService?: boolean;
  userId?: string;
}) {
  try {
    const [teamMemberExcludedSelected, teamMembersSelected, totalTeamMembers] =
      await Promise.all([
        db.teamMember.findMany({
          where: {
            organizationId,
            id: { notIn: selectedTeamMembers },
            deletedAt: null,
            userId: isSelfService && userId ? userId : undefined,
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
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        }),
        db.teamMember.count({ where: { organizationId, deletedAt: null } }),
      ]);

    const teamMembers = [
      ...teamMembersSelected,
      ...teamMemberExcludedSelected,
    ].sort((a, b) => {
      // First sort by whether they have a userId
      if (a.userId && !b.userId) return -1;
      if (!a.userId && b.userId) return 1;

      // Then sort alphabetically by name
      const aName = a?.user
        ? `${a.user.firstName} ${a.user.lastName}`.toLowerCase()
        : a.name.toLowerCase();
      const bName = b.user
        ? `${b.user.firstName} ${b.user.lastName}`.toLowerCase()
        : b.name.toLowerCase();

      return aName.localeCompare(bName);
    });

    /** Checks and fixes teamMember names if they are broken */
    await fixTeamMembersNames(teamMembers);

    return {
      teamMembers,
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

export async function getTeamMember({
  id,
  organizationId,
}: {
  id: TeamMember["id"];
  organizationId: Organization["id"];
}) {
  try {
    return await db.teamMember.findUniqueOrThrow({
      where: { id, organizationId },
    });
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

/**
 * Checks if the team member name is empty. If it is, it is considered invalid and the team member id is returned
 * @param teamMember Contains the team member data
 * @returns teamMember.id if the name is empty
 */
function validateTeamMemberName(teamMember: TeamMemberWithUserData) {
  if (!teamMember.name || teamMember.name.trim() === "") {
    return teamMember.id;
  }
}

/**
 * Fixes team members with invalid names. THis runs as void on the background so it doenst block the main thread
 * @param teamMembers  Array of team members with user data
 */
async function fixTeamMembersNames(teamMembers: TeamMemberWithUserData[]) {
  try {
    const teamMembersWithEmptyNames = teamMembers.filter(
      validateTeamMemberName
    );

    /** If there are none, just return */
    if (teamMembersWithEmptyNames.length === 0) return;

    /**
     * Updates team member names by:
     * 1. Using first + last name if both exist
     * 2. Using just first or last name if one exists
     * 3. Falling back to email username if no name exists
     * 4. Using "Unknown" as last resort if no email exists
     */
    await Promise.all(
      teamMembersWithEmptyNames.map((teamMember) => {
        let name: string;

        if (teamMember.user) {
          const { firstName, lastName, email } = teamMember.user;

          if (firstName?.trim() || lastName?.trim()) {
            // At least one name exists - concatenate available names
            name = [firstName?.trim(), lastName?.trim()]
              .filter(Boolean)
              .join(" ");
          } else {
            // No names but email exists - use email username
            name = email.split("@")[0];
            // Optionally improve email username readability
            name = name
              .replace(/[._]/g, " ") // Replace dots/underscores with spaces
              .replace(/\b\w/g, (c) => c.toUpperCase()); // Capitalize words
          }

          return db.teamMember.update({
            where: { id: teamMember.id },
            data: { name },
          });
        }
        return null;
      })
    );

    /** If there are broken ones, log them so we know what is going on. If this keeps on appearing in the logs that means its an ongoing issue and the cause should be found. */
    Logger.error(
      new ShelfError({
        cause: null,
        message: "Team members with empty names found",
        additionalData: { teamMembersWithEmptyNames },
        label,
      })
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fix team members names",
      label,
    });
  }
}
