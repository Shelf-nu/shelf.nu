import type { Prisma } from "@prisma/client";
import type { Sb } from "@shelf/database";
import type { LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import { sbDb } from "~/database/supabase.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { ALL_SELECTED_KEY, getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Team Member";

type TeamMemberWithUserData = Sb.TeamMemberRow & {
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
  name: string;
  organizationId: string;
  userId?: string | null;
}) {
  try {
    const insertData: Record<string, unknown> = {
      name,
      organizationId,
    };

    if (userId) {
      insertData.userId = userId;
    }

    const { data, error } = await sbDb
      .from("TeamMember")
      .insert(insertData as Sb.TeamMemberInsert)
      .select()
      .single();

    if (error) throw error;
    return data;
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
  organizationId: string;
}): Promise<Record<string, Sb.TeamMemberRow>> {
  try {
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
    const teamMembers = new Map<string, Sb.TeamMemberRow>();
    for (const teamMember of teamMemberNames) {
      const { data: existingTeamMember, error } = await sbDb
        .from("TeamMember")
        .select("*")
        .is("deletedAt", null)
        .eq("organizationId", organizationId)
        .ilike("name", teamMember)
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!existingTeamMember) {
        // if the teamMember doesn't exist, we create a new one
        const newTeamMember = await createTeamMember({
          name: teamMember,
          organizationId,
        });
        teamMembers.set(teamMember, newTeamMember);
      } else {
        // if the teamMember exists, we just update the id
        teamMembers.set(teamMember, existingTeamMember);
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
  organizationId: string;
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

    let query = sbDb
      .from("TeamMember")
      .select("*, custodies:Custody(*)", { count: "exact" })
      .is("deletedAt", null)
      .eq("organizationId", organizationId);

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    const {
      data: teamMembers,
      count,
      error,
    } = await query
      .order("createdAt", { ascending: false })
      .range(skip, skip + take - 1);

    if (error) throw error;
    return { teamMembers: teamMembers ?? [], totalTeamMembers: count ?? 0 };
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
  organizationId: string;
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

const TEAM_MEMBER_USER_SELECT =
  "*, user:User(id, firstName, lastName, email)" as const;

export async function getTeamMemberForCustodianFilter({
  organizationId,
  selectedTeamMembers = [],
  getAll,
  filterByUserId,
  userId,
  usersOnly,
}: {
  organizationId: string;
  selectedTeamMembers?: string[];
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
    // Query 1: Team members excluding selected
    let excludedQuery = sbDb
      .from("TeamMember")
      .select(TEAM_MEMBER_USER_SELECT)
      .eq("organizationId", organizationId)
      .is("deletedAt", null);

    if (selectedTeamMembers.length > 0) {
      excludedQuery = excludedQuery.not(
        "id",
        "in",
        `(${selectedTeamMembers.join(",")})`
      );
    }

    if (filterByUserId && userId) {
      excludedQuery = excludedQuery.eq("userId", userId);
    }

    if (usersOnly) {
      excludedQuery = excludedQuery.not("userId", "is", null);
    }

    if (!getAll) {
      excludedQuery = excludedQuery.limit(12);
    }

    // Query 2: Selected team members
    let selectedQuery = sbDb
      .from("TeamMember")
      .select(TEAM_MEMBER_USER_SELECT)
      .eq("organizationId", organizationId);

    if (selectedTeamMembers.length > 0) {
      selectedQuery = selectedQuery.in("id", selectedTeamMembers);
    } else {
      // No selected members, return empty
      selectedQuery = selectedQuery.eq("id", "NONE_SELECTED_PLACEHOLDER");
    }

    // Query 3: Total count
    let countQuery = sbDb
      .from("TeamMember")
      .select("*", { count: "exact", head: true })
      .eq("organizationId", organizationId)
      .is("deletedAt", null);

    if (usersOnly) {
      countQuery = countQuery.not("userId", "is", null);
    }

    const [excludedResult, selectedResult, countResult] = await Promise.all([
      excludedQuery,
      selectedQuery,
      countQuery,
    ]);

    if (excludedResult.error) throw excludedResult.error;
    if (selectedResult.error) throw selectedResult.error;
    if (countResult.error) throw countResult.error;

    const teamMemberExcludedSelected = excludedResult.data ?? [];
    const teamMembersSelected =
      selectedTeamMembers.length > 0 ? selectedResult.data ?? [] : [];

    const teamMembers = (
      [
        ...teamMembersSelected,
        ...teamMemberExcludedSelected,
      ] as unknown as TeamMemberWithUserData[]
    ).sort((a, b) => {
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
      totalTeamMembers: countResult.count ?? 0,
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
  organizationId: string;
  userId: string;
  isSelfServiceOrBase: boolean;
  getAll?: boolean;
  custodianUserId?: string;
  custodianTeamMemberId?: string;
  bookingStatus?: Sb.BookingStatus;
  /**
   * If set to true, only return team members with users (exclude NRMs)
   */
  usersOnly?: boolean;
}) {
  try {
    // BASE/SELF_SERVICE users can only see their own bookings, so always return only their team member
    if (isSelfServiceOrBase) {
      const { data: teamMember, error } = await sbDb
        .from("TeamMember")
        .select(TEAM_MEMBER_USER_SELECT)
        .eq("organizationId", organizationId)
        .eq("userId", userId)
        .is("deletedAt", null)
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      const typedTeamMember =
        teamMember as unknown as TeamMemberWithUserData | null;
      await fixTeamMembersNames(typedTeamMember ? [typedTeamMember] : []);

      return {
        teamMembers: typedTeamMember ? [typedTeamMember] : [],
        totalTeamMembers: typedTeamMember ? 1 : 0,
      };
    }

    // For ADMIN users with locked booking statuses, only return the current custodian
    const lockedStatuses: Sb.BookingStatus[] = [
      "RESERVED",
      "ONGOING",
      "OVERDUE",
      "COMPLETE",
      "CANCELLED",
      "ARCHIVED",
    ];
    const isLockedStatus =
      bookingStatus && lockedStatuses.includes(bookingStatus);

    if (isLockedStatus) {
      // Find the custodian's team member (try by team member id first, then by user id)
      let custodianTeamMember: TeamMemberWithUserData | null = null;

      if (custodianTeamMemberId) {
        const { data, error } = await sbDb
          .from("TeamMember")
          .select(TEAM_MEMBER_USER_SELECT)
          .eq("id", custodianTeamMemberId)
          .eq("organizationId", organizationId)
          .is("deletedAt", null)
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        custodianTeamMember = data as unknown as TeamMemberWithUserData | null;
      } else if (custodianUserId) {
        const { data, error } = await sbDb
          .from("TeamMember")
          .select(TEAM_MEMBER_USER_SELECT)
          .eq("userId", custodianUserId)
          .eq("organizationId", organizationId)
          .is("deletedAt", null)
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        custodianTeamMember = data as unknown as TeamMemberWithUserData | null;
      }

      await fixTeamMembersNames(
        custodianTeamMember ? [custodianTeamMember] : []
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
        const { data: custodian, error } = await sbDb
          .from("TeamMember")
          .select("id")
          .eq("userId", custodianUserId)
          .eq("organizationId", organizationId)
          .is("deletedAt", null)
          .limit(1)
          .maybeSingle();

        if (error) throw error;
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
  id: string;
  organizationId: string;
};

type TeamMemberWithSelect<T extends Prisma.TeamMemberSelect | undefined> =
  T extends Prisma.TeamMemberSelect
    ? Prisma.TeamMemberGetPayload<{ select: T }>
    : Sb.TeamMemberRow;

type TeamMemberWithInclude<T extends Prisma.TeamMemberInclude | undefined> =
  T extends Prisma.TeamMemberInclude
    ? Prisma.TeamMemberGetPayload<{ include: T }>
    : Sb.TeamMemberRow;

/**
 * Retrieves a team member by ID with organization validation.
 * Supports flexible data fetching with select/include options.
 *
 * TODO: Remove Prisma dependency once all callers are migrated to Supabase select strings.
 */
export async function getTeamMember(
  args: GetTeamMemberArgsBase
): Promise<Sb.TeamMemberRow>;

export async function getTeamMember<T extends Prisma.TeamMemberSelect>(
  args: GetTeamMemberArgsBase & { select: T; include?: never }
): Promise<TeamMemberWithSelect<T>>;

export async function getTeamMember<T extends Prisma.TeamMemberInclude>(
  args: GetTeamMemberArgsBase & { include: T; select?: never }
): Promise<TeamMemberWithInclude<T>>;

export async function getTeamMember<
  S extends Prisma.TeamMemberSelect | undefined = undefined,
  I extends Prisma.TeamMemberInclude | undefined = undefined,
>({
  id,
  organizationId,
  select,
  include,
}: GetTeamMemberArgsBase & {
  select?: S;
  include?: I;
}): Promise<
  Sb.TeamMemberRow | TeamMemberWithSelect<S> | TeamMemberWithInclude<I>
> {
  try {
    if (select && include) {
      throw new ShelfError({
        cause: null,
        message:
          "Cannot use both select and include when fetching a team member.",
        additionalData: { id, organizationId },
        label,
        shouldBeCaptured: false,
      });
    }

    const queryOptions: Prisma.TeamMemberFindUniqueOrThrowArgs = {
      where: { id, organizationId },
    };
    if (select) {
      queryOptions.select = select;
    } else if (include) {
      queryOptions.include = include;
    }
    const teamMember = await db.teamMember.findUniqueOrThrow(queryOptions);

    if (select) {
      return teamMember as TeamMemberWithSelect<S>;
    }

    if (include) {
      return teamMember as TeamMemberWithInclude<I>;
    }

    return teamMember as unknown as Sb.TeamMemberRow;
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
  nrmIds: string[];
  organizationId: string;
}) {
  try {
    // Build query based on whether all are selected or specific ids
    let query = sbDb
      .from("TeamMember")
      .select("id, Custody(count)")
      .eq("organizationId", organizationId);

    if (!nrmIds.includes(ALL_SELECTED_KEY)) {
      query = query.in("id", nrmIds);
    }

    const { data: teamMembers, error: fetchError } = await query;

    if (fetchError) throw fetchError;
    if (!teamMembers) {
      return { count: 0 };
    }

    /** If some team members have custody, then delete is not allowed */
    const someTeamMemberHasCustodies = teamMembers.some(
      (tm) => (tm.Custody as unknown as { count: number }[])?.[0]?.count > 0
    );

    if (someTeamMemberHasCustodies) {
      throw new ShelfError({
        cause: null,
        message:
          "Some team members has custody over some assets. Please release custody or check-in those assets before deleting the user.",
        label,
      });
    }

    const idsToDelete = teamMembers.map((tm) => tm.id);
    const { error: updateError, count } = await sbDb
      .from("TeamMember")
      .update({ deletedAt: new Date().toISOString() })
      .in("id", idsToDelete);

    if (updateError) throw updateError;
    return { count: count ?? 0 };
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

          return sbDb
            .from("TeamMember")
            .update({ name })
            .eq("id", teamMember.id);
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
