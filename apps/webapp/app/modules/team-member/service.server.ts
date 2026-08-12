import type { Organization, Prisma, TeamMember } from "@prisma/client";
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import { withBackgroundWriteSlot } from "~/utils/background-write-limiter.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import type { ErrorLabel } from "~/utils/error";
import { isNotFoundError, ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import { resolveUserDisplayName } from "~/utils/user";
import { getNrmSelectionWhere } from "./nrm-scope";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Team Member";
type TeamMemberWithUserData = Prisma.TeamMemberGetPayload<{
  include: {
    user: {
      select: {
        firstName: true;
        lastName: true;
        displayName: true;
        email: true;
      };
    };
  };
}>;

type TeamMemberWithSelect<T extends Prisma.TeamMemberSelect | undefined> =
  T extends Prisma.TeamMemberSelect
    ? Prisma.TeamMemberGetPayload<{ select: T }>
    : TeamMember;

type TeamMemberWithInclude<T extends Prisma.TeamMemberInclude | undefined> =
  T extends Prisma.TeamMemberInclude
    ? Prisma.TeamMemberGetPayload<{ include: T }>
    : TeamMember;

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
    const where: Prisma.TeamMemberWhereInput = {
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

/** What a custodian picker is being used for. */
export type CustodianPickerPurpose =
  | "custody-filter"
  | "custody-assignment"
  | "booking-custodian";

/** Resolved scope for a custodian picker. */
export type CustodianPickerScope =
  | { mode: "all" }
  | { mode: "self"; userId: string }
  | { mode: "none" };

/**
 * The scope one custodian picker should apply.
 *
 * Custodian pickers serve two different questions and a single rule cannot
 * answer both:
 *
 * - `custody-filter` — "whose custody may I look at?" A read-visibility
 *   question, so the workspace overrides (`selfServiceCanSeeCustody` /
 *   `baseUserCanSeeCustody`, already resolved into `canSeeAllCustody`) govern.
 * - `custody-assignment` — "who may I hand this ASSET to?" A business rule the
 *   overrides never widen: SELF_SERVICE assigns only to itself and BASE may
 *   not assign at all. The setting is about SEEING custody, not granting it.
 * - `booking-custodian` — "who may this BOOKING be assigned to?" Distinct from
 *   asset custody: BASE holds `booking:create`, so it must be able to put
 *   itself on a booking even though it may never take custody of an asset.
 *   Restricted roles get themselves; ADMIN / OWNER get everyone.
 *
 * Every custodian picker — seed and search alike — resolves through here, so
 * the seeded list and the typed list cannot disagree. They previously did:
 * the search applied no scope at all, so a restricted user saw only themselves
 * until they typed, at which point the whole roster appeared.
 *
 * @param args.purpose - Which question this picker is asking.
 * @param args.role - Effective role from `resolveEffectiveRole`.
 * @param args.canSeeAllCustody - Resolved via `resolveCanSeeAllCustody`.
 * @param args.userId - The caller, for the `self` mode.
 * @returns `all` (unrestricted), `self` (own team-member rows), or `none`.
 */
export function resolveCustodianPickerScope({
  purpose,
  role,
  canSeeAllCustody,
  userId,
}: {
  purpose: CustodianPickerPurpose;
  role: OrganizationRoles;
  canSeeAllCustody: boolean;
  userId: string;
}): CustodianPickerScope {
  if (purpose === "custody-assignment") {
    // BASE may never take custody of an asset, whatever the override says.
    if (role === OrganizationRoles.BASE) {
      return { mode: "none" };
    }
    if (role === OrganizationRoles.SELF_SERVICE) {
      return { mode: "self", userId };
    }
    return { mode: "all" };
  }

  if (purpose === "booking-custodian") {
    // Restricted roles book for themselves. Unlike asset custody this includes
    // BASE, which holds `booking:create` and would otherwise be unable to name
    // a custodian at all. Mirrors `getTeamMemberForForm`'s seed.
    return role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE
      ? { mode: "self", userId }
      : { mode: "all" };
  }

  return canSeeAllCustody ? { mode: "all" } : { mode: "self", userId };
}

export async function getTeamMemberForCustodianFilter({
  organizationId,
  selectedTeamMembers = [],
  trustedSelectedTeamMembers = [],
  getAll,
  filterByUserId,
  returnNone,
  userId,
  usersOnly,
}: {
  organizationId: Organization["id"];
  /**
   * Ids the picker already has selected, as supplied by the CALLER — in
   * practice `searchParams.getAll("teamMember")` at almost every call site.
   *
   * Treated as untrusted: the custody scope is applied to them exactly as it
   * is to every other row. Anything else lets a restricted caller read a
   * colleague's row, `user.email` included, by putting an arbitrary id in the
   * query string.
   */
  selectedTeamMembers?: TeamMember["id"][];
  /**
   * Ids the SERVER derived, which must render even though they sit outside the
   * caller's custody scope — today only a booking's own custodian.
   *
   * HAZARD — never pass request input here. These skip the custody scope, so a
   * caller-controlled value would be precisely the disclosure
   * {@link selectedTeamMembers} exists to prevent. The organization scope still
   * applies and is not optional.
   *
   * Needed because a booking's custodian may be someone the viewer cannot
   * otherwise see, or an NRM under `usersOnly` — scoping those away drops the
   * custodian chip from the form.
   */
  trustedSelectedTeamMembers?: TeamMember["id"][];
  getAll?: boolean;
  /**
   * IF set to true and userId is set, it will only return the teamMembers where the userId is equal to the one passed
   * This is used for self service users to only show their own team members
   */
  filterByUserId?: boolean;
  /**
   * Return no team members at all.
   *
   * Used for the BASE assignment case, which `filterByUserId` cannot express:
   * BASE may never assign custody, so an empty list is the correct answer
   * rather than "their own row". Resolved via `resolveCustodianPickerScope`.
   */
  returnNone?: boolean;
  userId?: string;
  /**
   * If set to true, only return team members with users (exclude NRMs)
   */
  usersOnly?: boolean;
}) {
  try {
    if (returnNone) {
      return { teamMembers: [], totalTeamMembers: 0 };
    }

    /**
     * The custody scope, applied to the rows AND the total alike.
     *
     * Counting unscoped while the rows are scoped puts the workspace's
     * team-member total into a restricted user's loader payload, and makes the
     * picker's "showing N out of M" footer disagree with what the search
     * endpoint returns for the same caller.
     */
    const scopedWhere = {
      organizationId,
      deletedAt: null,
      userId: filterByUserId && userId ? userId : undefined,
      ...(usersOnly ? { user: { isNot: null } } : {}),
    };

    const [teamMemberExcludedSelected, teamMembersSelected, totalTeamMembers] =
      await Promise.all([
        db.teamMember.findMany({
          where: {
            ...scopedWhere,
            id: { notIn: selectedTeamMembers },
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                email: true,
              },
            },
          },
          take: getAll ? undefined : 12,
        }),
        db.teamMember.findMany({
          where: {
            organizationId,
            OR: [
              // Caller-supplied ids get the SAME scope as every other row.
              // Fetching them org-scoped only handed a restricted caller any
              // same-org member's row — including `user.email` — for any id
              // they put in `?teamMember=`.
              { ...scopedWhere, id: { in: selectedTeamMembers } },
              // Server-derived ids are exempt from the custody scope but never
              // from the org scope, which stays AND-ed above.
              { id: { in: trustedSelectedTeamMembers } },
            ],
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                email: true,
              },
            },
          },
        }),
        db.teamMember.count({ where: scopedWhere }),
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
        ? resolveUserDisplayName(a.user).toLowerCase()
        : a.name.toLowerCase();
      const bName = b.user
        ? resolveUserDisplayName(b.user).toLowerCase()
        : b.name.toLowerCase();

      return aName.localeCompare(bName);
    });

    /**
     * Checks and fixes teamMember names if they are broken. Fire-and-forget:
     * it only writes DB rows (never mutates `teamMembers`) so it must not block
     * the loader or hold a write-connection on this read path.
     */
    void fixTeamMembersNames(teamMembers);
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
  bookingStatus?: BookingStatus;
  /**
   * If set to true, only return team members with users (exclude NRMs)
   */
  usersOnly?: boolean;
}) {
  try {
    // BASE/SELF_SERVICE users can only see their own bookings, so always return only their team member.
    //
    // This is the `booking-custodian` rule in `resolveCustodianPickerScope`,
    // which the search endpoint resolves for the same picker. The two must stay
    // in step: if this branch changes, change that purpose too, or the list
    // will differ before and after the user types.
    if (isSelfServiceOrBase) {
      const teamMember = await db.teamMember.findFirst({
        where: {
          organizationId,
          userId,
          deletedAt: null,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
              email: true,
            },
          },
        },
      });

      // Fire-and-forget background cleanup — must not block this loader.
      void fixTeamMembersNames(teamMember ? [teamMember] : []);

      return {
        teamMembers: teamMember ? [teamMember] : [],
        totalTeamMembers: teamMember ? 1 : 0,
      };
    }

    // For ADMIN users with locked booking statuses, only return the current custodian
    const lockedStatuses: BookingStatus[] = [
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
        ? await db.teamMember.findFirst({
            where: {
              id: custodianTeamMemberId,
              organizationId,
              deletedAt: null,
            },
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  displayName: true,
                  email: true,
                },
              },
            },
          })
        : custodianUserId
        ? await db.teamMember.findFirst({
            where: {
              userId: custodianUserId,
              organizationId,
              deletedAt: null,
            },
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  displayName: true,
                  email: true,
                },
              },
            },
          })
        : null;

      // Fire-and-forget background cleanup — must not block this loader.
      void fixTeamMembersNames(
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
        const custodian = await db.teamMember.findFirst({
          where: {
            userId: custodianUserId,
            organizationId,
            deletedAt: null,
          },
          select: { id: true },
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
      // Server-derived: the DRAFT booking's own custodian, resolved above from
      // the booking rather than from request input. Passed as trusted because
      // an NRM custodian would otherwise be dropped by `usersOnly`.
      trustedSelectedTeamMembers: selectedTeamMembers,
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
 * Supports flexible data fetching with select/include options.
 *
 * @param args - Base arguments containing team member ID and organization ID
 * @returns Promise resolving to the complete TeamMember object
 * @throws ShelfError if team member not found or doesn't belong to organization
 *
 * @example
 * ```typescript
 * const member = await getTeamMember({
 *   id: "member-123",
 *   organizationId: "org-456"
 * });
 * ```
 */
export async function getTeamMember(
  args: GetTeamMemberArgsBase
): Promise<TeamMember>;

/**
 * Retrieves a team member with specific field selection.
 *
 * @param args - Arguments with select object to specify which fields to return
 * @returns Promise resolving to TeamMember with only selected fields
 * @throws ShelfError if team member not found or doesn't belong to organization
 *
 * @example
 * ```typescript
 * const member = await getTeamMember({
 *   id: "member-123",
 *   organizationId: "org-456",
 *   select: { id: true, userId: true }
 * });
 * ```
 */
export async function getTeamMember<T extends Prisma.TeamMemberSelect>(
  args: GetTeamMemberArgsBase & { select: T; include?: never }
): Promise<TeamMemberWithSelect<T>>;

/**
 * Retrieves a team member with related data included.
 *
 * @param args - Arguments with include object to specify which relations to include
 * @returns Promise resolving to TeamMember with included relations
 * @throws ShelfError if team member not found or doesn't belong to organization
 *
 * @example
 * ```typescript
 * const member = await getTeamMember({
 *   id: "member-123",
 *   organizationId: "org-456",
 *   include: { user: true }
 * });
 * ```
 */
export async function getTeamMember<T extends Prisma.TeamMemberInclude>(
  args: GetTeamMemberArgsBase & { include: T; select?: never }
): Promise<TeamMemberWithInclude<T>>;
export async function getTeamMember({
  id,
  organizationId,
  select,
  include,
}: GetTeamMemberArgsBase & {
  select?: Prisma.TeamMemberSelect;
  include?: Prisma.TeamMemberInclude;
}) {
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
      return teamMember as TeamMemberWithSelect<typeof select>;
    }

    if (include) {
      return teamMember as TeamMemberWithInclude<typeof include>;
    }

    return teamMember as TeamMember;
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
      // Suppress only true Prisma not-found (P2025); let DB / connectivity
      // failures bubble up to Sentry.
      shouldBeCaptured: !isNotFoundError(cause),
    });
  }
}

/**
 * Soft-deletes the selected NRMs, refusing the whole batch if any of them
 * still holds custody.
 *
 * @param params.nrmIds - Selected ids, or a list containing ALL_SELECTED_KEY
 * @param params.organizationId - The active organization
 * @param params.search - The index's active search, forwarded on select-all so
 *   the delete matches exactly the rows the user had in front of them
 * @returns The Prisma batch payload for the soft-delete
 * @throws {ShelfError} If any selected member holds custody, or the write fails
 */
export async function bulkDeleteNRMs({
  nrmIds,
  organizationId,
  search,
}: {
  nrmIds: TeamMember["id"][];
  organizationId: TeamMember["organizationId"];
  search?: string | null;
}) {
  try {
    // Derived from the shared NRM scope. A bare `{ organizationId }` here would
    // soft-delete EVERY TeamMember row in the org on select-all — including the
    // rows backing registered users, which are not NRMs and are not listed on
    // this index.
    const where = getNrmSelectionWhere({ nrmIds, organizationId, search });

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

    // The write re-asserts the full read predicate rather than trusting the ids
    // alone. Selection and write are two round trips, so a row can stop being a
    // deletable NRM in between — accept an invite, be soft-deleted by someone
    // else, or acquire custody after the guard above ran. Restating the scope
    // (plus the custody check, which the read could only evaluate in JS) makes
    // those rows fall out of the write instead of being soft-deleted on stale
    // ids. Rows that changed are skipped, not fatal: `updateMany` simply matches
    // fewer rows.
    return await db.teamMember.updateMany({
      where: {
        ...getNrmSelectionWhere({
          nrmIds: teamMembers.map((tm) => tm.id),
          organizationId,
        }),
        custodies: { none: {} },
      },
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
 * Fixes team members that have a blank/whitespace-only `name` by deriving one
 * from their linked user (first/last name, else the email username).
 *
 * This is a best-effort DB cleanup — it updates rows only and never mutates the
 * in-memory `teamMembers` array. User-linked members display via
 * `resolveUserDisplayName(user)` regardless of the stored `name`, so the result
 * is invisible to the response. It is therefore invoked **fire-and-forget**
 * (`void fixTeamMembersNames(...)`) so it never blocks a loader or holds a
 * write-connection on the critical read path (part of the P2024 pool-exhaustion
 * fix). All errors are caught and logged here so the returned promise never
 * rejects — callers can safely `void` it without a `.catch`.
 *
 * Only members that are BOTH blank-named AND user-linked are considered: NRMs
 * (`user === null`) have no user record to derive a name from, so they are
 * excluded up front — otherwise a blank-named NRM would defeat the early-return
 * and make this run (and log) for nothing.
 *
 * @param teamMembers Array of team members with user data
 */
export async function fixTeamMembersNames(
  teamMembers: TeamMemberWithUserData[]
) {
  try {
    // Only user-linked blank-named members are fixable — exclude NRMs
    // (user === null) up front so the early-return below isn't defeated by a
    // blank-named NRM that can never be fixed anyway.
    const teamMembersToFix = teamMembers.filter(
      (teamMember) =>
        teamMember.user !== null && validateTeamMemberName(teamMember)
    );

    /** If there are none, just return */
    if (teamMembersToFix.length === 0) return;

    /**
     * Updates team member names by:
     * 1. Using first + last name if both exist
     * 2. Using just first or last name if one exists
     * 3. Falling back to email username if no name exists
     * 4. Using "Unknown" as last resort if no email exists
     *
     * Each write runs through the shared, process-wide background-write limiter
     * so this repair (callers may pass getAll:true) can't fire an unbounded
     * burst of updates, and shares one connection budget with the other
     * deferred-write paths (e.g. the asset-image flush) rather than adding a
     * second independent cap.
     */
    await Promise.all(
      teamMembersToFix.map((teamMember) => {
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

        return withBackgroundWriteSlot(() =>
          db.teamMember.update({
            where: {
              id: teamMember.id,
              organizationId: teamMember.organizationId,
            },
            data: { name },
          })
        );
      })
    );

    /** Log auto-fixed empty names as a warning (not error) since the fix is
     * applied successfully. Using Logger.warn avoids sending to Sentry. */
    Logger.warn(
      new ShelfError({
        cause: null,
        message: "Team members with empty names found and auto-fixed",
        // Log identifiers only — the full records carry user email/first/last
        // name (PII). shouldBeCaptured:false stops Sentry capture but not
        // local/log-aggregator retention, so never log the whole array.
        additionalData: {
          teamMemberIds: teamMembersToFix.map((tm) => tm.id),
          count: teamMembersToFix.length,
        },
        label,
        shouldBeCaptured: false,
      })
    );
  } catch (cause) {
    // Runs fire-and-forget in the background, so log instead of rethrowing —
    // rethrowing here would become an unhandled rejection at the `void` call
    // sites, and the cleanup is non-critical (next load will retry).
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to fix team members names",
        label,
      })
    );
  }
}

/**
 * Fetches team members eligible for the notification recipients picker.
 * Returns only admins/owners with linked user accounts (no NRMs).
 *
 * Used by booking form loaders to provide initial data for the
 * `DynamicDropdown` component's `initialDataKey`.
 */
export async function getTeamMembersForNotify({
  organizationId,
  excludeTeamMemberIds,
}: {
  organizationId: string;
  /** Team member IDs to exclude from results. Defaults to an empty
   *  array when not provided — no automatic fetching occurs. Callers
   *  must pass any IDs to exclude explicitly (e.g. always-notify
   *  members or the custodian's team member ID). */
  excludeTeamMemberIds?: string[];
}) {
  try {
    const idsToExclude = excludeTeamMemberIds ?? [];

    // Single query using a nested relation filter to find team members
    // whose linked user has an admin/owner role in this organization.
    const teamMembersForNotify = await db.teamMember.findMany({
      where: {
        organizationId,
        deletedAt: null,
        user: {
          userOrganizations: {
            some: {
              organizationId,
              roles: {
                hasSome: [OrganizationRoles.ADMIN, OrganizationRoles.OWNER],
              },
            },
          },
        },
        ...(idsToExclude?.length ? { id: { notIn: idsToExclude } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
            profilePicture: true,
          },
        },
      },
      orderBy: [{ user: { firstName: "asc" } }, { name: "asc" }],
    });

    return {
      teamMembersForNotify,
      totalTeamMembersForNotify: teamMembersForNotify.length,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch team members for notification picker",
      additionalData: { organizationId },
      label,
    });
  }
}

/**
 * Fetches team members for the quantity custody dialog's DynamicSelect.
 *
 * Returns the first page (12 items) by default, or all items when
 * `getAll=teamMember` is present in the search params. Self-service
 * users are scoped to only their own team member record.
 *
 * @param args - Organization, request, user ID, and role
 * @returns Object with `teamMembers` array and `totalTeamMembers` count
 */
export async function getTeamMembersForQuantityCustody({
  organizationId,
  request,
  userId,
  isSelfService,
}: {
  organizationId: string;
  request: Request;
  userId: string;
  isSelfService: boolean;
}) {
  try {
    const searchParams = getCurrentSearchParams(request);
    const where = {
      deletedAt: null,
      organizationId,
      userId: isSelfService ? userId : undefined,
    };

    const [teamMembers, totalTeamMembers] = await Promise.all([
      db.teamMember.findMany({
        where,
        include: { user: true },
        orderBy: { userId: "asc" },
        take: searchParams.get("getAll") === "teamMember" ? undefined : 12,
      }),
      db.teamMember.count({ where }),
    ]);

    return { teamMembers, totalTeamMembers };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch team members for quantity custody",
      additionalData: { organizationId, userId },
      label,
    });
  }
}
