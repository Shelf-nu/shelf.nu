import type { Organization, TeamMember } from "@shelf/database";
import { BookingStatus } from "@shelf/database";
import type { LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  count,
  create,
  findFirst,
  findMany,
  findUniqueOrThrow,
  update,
  updateMany,
} from "~/database/query-helpers.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { ALL_SELECTED_KEY, getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Team Member";
type TeamMemberWithUserData = TeamMember & {
  user: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
};

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
    return await create(db, "TeamMember", {
      name,
      organizationId,
      userId: userId || null,
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
}): Promise<Record<string, TeamMember>> {
  try {
    // first we get all the teamMembers from the assets and make then into an object where the category is the key and the value is an empty string
    /**
     * Important note: The field in the csv is called "custodian" for making it easy for the user
     * However in the app it works a bit different due to how the relationships are
     */
    // Normalize custodian names so whitespace-only or padded values don't create phantom keys.
    const teamMemberNames = Array.from(
      new Set(
        data
          .map((asset) => asset.custodian?.trim())
          .filter((custodian): custodian is string => !!custodian)
      )
    );

    // Handle the case where there are no teamMembers
    if (teamMemberNames.length === 0) {
      return {};
    }

    // Process each team member with case-insensitive matching
    const teamMembers = new Map<string, TeamMember>();
    for (const teamMember of teamMemberNames) {
      const existingTeamMember = await findFirst(db, "TeamMember", {
        where: {
          deletedAt: null,
          organizationId,
          // Use case-insensitive comparison
          name: {
            equals: teamMember as string,
            mode: "insensitive",
          },
        },
      });

      if (!existingTeamMember) {
        // if the teamMember doesn't exist, we create a new one
        const newTeamMember = await createTeamMember({
          name: teamMember,
          organizationId,
        });
        teamMembers.set(teamMember, newTeamMember as unknown as TeamMember);
      } else {
        // if the teamMember exists, we just update the id
        teamMembers.set(
          teamMember,
          existingTeamMember as unknown as TeamMember
        );
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
  where?: Record<string, unknown>;
}) {
  const { organizationId, page = 1, perPage = 8, search } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

    /** Default value of where. Takes the assets belonging to current user */
    const where: Record<string, unknown> = {
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
      findMany(db, "TeamMember", {
        skip,
        take,
        where,
        orderBy: { createdAt: "desc" },
        select: "*, custodies:Custody(*)",
      }),

      /** Count them */
      count(db, "TeamMember", where),
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
  where?: Record<string, unknown>;
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
  filterByUserId,
  userId,
  usersOnly,
}: {
  organizationId: Organization["id"];
  selectedTeamMembers?: TeamMember["id"][];
  getAll?: boolean;
  /**
   * IF set to true and userId is set, it will only return the teamMembers where the userId is equal to the one passed
   * This is used for self service users to only show their own team members
   */
  filterByUserId?: boolean;
  userId?: string;
  /**
   * If set to true, only return team members with users (exclude NRMs)
   */
  usersOnly?: boolean;
}) {
  try {
    const excludeWhere: Record<string, unknown> = {
      organizationId,
      deletedAt: null,
    };

    if (selectedTeamMembers.length > 0) {
      excludeWhere.id = { notIn: selectedTeamMembers };
    }

    if (filterByUserId && userId) {
      excludeWhere.userId = userId;
    }

    if (usersOnly) {
      excludeWhere.userId = { not: null };
    }

    const userSelect = "*, user:User(id, firstName, lastName, email)";

    const [teamMemberExcludedSelected, teamMembersSelected, totalTeamMembers] =
      await Promise.all([
        findMany(db, "TeamMember", {
          where: excludeWhere,
          select: userSelect,
          take: getAll ? undefined : 12,
        }),
        findMany(db, "TeamMember", {
          where: {
            organizationId,
            id: { in: selectedTeamMembers },
          },
          select: userSelect,
        }),
        count(db, "TeamMember", {
          organizationId,
          deletedAt: null,
          ...(usersOnly ? { userId: { not: null } } : {}),
        }),
      ]);

    const teamMembers = [
      ...teamMembersSelected,
      ...teamMemberExcludedSelected,
    ].sort((a: any, b: any) => {
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
    await fixTeamMembersNames(
      teamMembers as unknown as TeamMemberWithUserData[]
    );
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

/**
 * Fetches team member(s) for use in booking form custodian select.
 *
 * Behavior based on booking status:
 * 1. Ongoing/Overdue/Complete/Cancelled/Archived/Reserved: Only fetch current custodian
 * 2. Draft: Fetch team members list, always including current custodian
 * 3. New booking (no status): Standard fetch without custodian guarantee
 *
 * For BASE/SELF_SERVICE users: Returns only their team member (optimized single query)
 * For ADMIN users: Returns paginated list with conditional custodian inclusion
 *
 * This is separate from getTeamMemberForCustodianFilter to avoid mixing concerns:
 * - Filter: needs paginated list for sidebar filters
 * - Form: Needs conditional fetching based on booking state
 */
export async function getTeamMemberForForm({
  organizationId,
  userId,
  isSelfServiceOrBase,
  getAll,
  custodianUserId,
  custodianTeamMemberId,
  bookingStatus,
  usersOnly,
}: {
  organizationId: Organization["id"];
  userId: string;
  isSelfServiceOrBase: boolean;
  getAll?: boolean;
  custodianUserId?: string;
  custodianTeamMemberId?: string;
  bookingStatus?: (typeof BookingStatus)[keyof typeof BookingStatus];
  /**
   * If set to true, only return team members with users (exclude NRMs)
   */
  usersOnly?: boolean;
}) {
  try {
    const userSelect = "*, user:User(id, firstName, lastName, email)";

    // BASE/SELF_SERVICE users can only see their own bookings, so always return only their team member
    if (isSelfServiceOrBase) {
      const teamMember = await findFirst(db, "TeamMember", {
        where: {
          organizationId,
          userId,
          deletedAt: null,
        },
        select: userSelect,
      });

      await fixTeamMembersNames(
        teamMember ? [teamMember as unknown as TeamMemberWithUserData] : []
      );

      return {
        teamMembers: teamMember ? [teamMember] : [],
        totalTeamMembers: teamMember ? 1 : 0,
      };
    }

    // For ADMIN users with locked booking statuses, only return the current custodian
    const lockedStatuses = [
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
      BookingStatus.COMPLETE,
      BookingStatus.CANCELLED,
      BookingStatus.ARCHIVED,
    ];
    const isLockedStatus =
      bookingStatus && lockedStatuses.includes(bookingStatus);

    if (isLockedStatus) {
      // Find the custodian's team member (try by team member id first, then by user id)
      const custodianTeamMember = custodianTeamMemberId
        ? await findFirst(db, "TeamMember", {
            where: {
              id: custodianTeamMemberId,
              organizationId,
              deletedAt: null,
            },
            select: userSelect,
          })
        : custodianUserId
        ? await findFirst(db, "TeamMember", {
            where: {
              userId: custodianUserId,
              organizationId,
              deletedAt: null,
            },
            select: userSelect,
          })
        : null;

      await fixTeamMembersNames(
        custodianTeamMember
          ? [custodianTeamMember as unknown as TeamMemberWithUserData]
          : []
      );

      return {
        teamMembers: custodianTeamMember ? [custodianTeamMember] : [],
        totalTeamMembers: custodianTeamMember ? 1 : 0,
      };
    }

    // ADMIN users get paginated list
    // For DRAFT bookings, ensure custodian is included in selectedTeamMembers
    const selectedTeamMembers: string[] = [];

    if (bookingStatus === "DRAFT") {
      // Find custodian team member id if we have custodianUserId but no custodianTeamMemberId
      if (custodianUserId && !custodianTeamMemberId) {
        const custodian = await findFirst(db, "TeamMember", {
          where: {
            userId: custodianUserId,
            organizationId,
            deletedAt: null,
          },
          select: "id",
        });
        if (custodian) {
          selectedTeamMembers.push(custodian.id);
        }
      } else if (custodianTeamMemberId) {
        selectedTeamMembers.push(custodianTeamMemberId);
      }
    }

    return await getTeamMemberForCustodianFilter({
      organizationId,
      selectedTeamMembers,
      getAll,
      userId,
      filterByUserId: false,
      usersOnly,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch team member for form",
      additionalData: { organizationId, userId, isSelfServiceOrBase },
      label,
    });
  }
}

type GetTeamMemberArgsBase = {
  id: TeamMember["id"];
  organizationId: Organization["id"];
};

/**
 * Retrieves a team member by ID with organization validation.
 * Supports flexible data fetching with a Supabase select string.
 *
 * @param args - Arguments containing team member ID, organization ID, and optional select
 * @returns Promise resolving to the TeamMember object (with optional joined data)
 * @throws ShelfError if team member not found or doesn't belong to organization
 */
export async function getTeamMember({
  id,
  organizationId,
  select,
}: GetTeamMemberArgsBase & {
  select?: string;
}) {
  try {
    return await findUniqueOrThrow(db, "TeamMember", {
      where: { id, organizationId },
      ...(select ? { select } : {}),
    });
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      title: "Team member not found",
      message: "The selected team member could not be found.",
      additionalData: { id, organizationId },
      label,
      status: 404,
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
    const where: Record<string, unknown> = nrmIds.includes(ALL_SELECTED_KEY)
      ? { organizationId }
      : { id: { in: nrmIds }, organizationId };

    const teamMembers = await findMany(db, "TeamMember", {
      where,
      select: "id, custodies:Custody(count)",
    });

    /** If some team members have custody, then delete is not allowed */
    const someTeamMemberHasCustodies = (teamMembers as any[]).some(
      (tm) => tm.custodies && tm.custodies.length > 0
    );

    if (someTeamMemberHasCustodies) {
      throw new ShelfError({
        cause: null,
        message:
          "Some team members has custody over some assets. Please release custody or check-in those assets before deleting the user.",
        label,
      });
    }

    return await updateMany(db, "TeamMember", {
      where: { id: { in: teamMembers.map((tm: any) => tm.id) } },
      data: { deletedAt: new Date().toISOString() },
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
      teamMembersWithEmptyNames
        .filter((teamMember) => teamMember.user !== null)
        .map((teamMember) => {
          let name: string;
          const { firstName, lastName, email } = teamMember.user!;

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

          return update(db, "TeamMember", {
            where: { id: teamMember.id },
            data: { name },
          });
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
