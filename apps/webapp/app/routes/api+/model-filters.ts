import type { Prisma } from "@prisma/client";
import { BookingStatus, TagUseFor } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  bookingDraftVisibilityClause,
  resolveCustodianScope,
} from "~/modules/booking/service.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  isSelfServiceOrBaseRole,
  resolveEffectiveRole,
} from "~/utils/roles.server";

/**
 * Booking statuses a booking search returns when the caller does not ask for a
 * specific set. Matches the historical behaviour of this endpoint: "upcoming"
 * bookings only, which is what the asset-index advanced filter means by
 * "Has upcoming bookings".
 */
const DEFAULT_BOOKING_SEARCH_STATUSES: BookingStatus[] = [
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

const BasicModelFilters = z.object({
  /** key of field for which we have to filter values */
  queryKey: z.string(),

  /** Actual value */
  queryValue: z.string().optional(),

  /** What user have already selected, so that we can exclude them */
  selectedValues: z.string().optional(),
});

/**
 * The schema used for each different model.
 * To allow filtersing and searching on different models update the schema for the relevant model
 */
export const ModelFiltersSchema = z.discriminatedUnion("name", [
  BasicModelFilters.extend({
    name: z.literal("asset"),
  }),
  BasicModelFilters.extend({
    name: z.literal("tag"),
    useFor: z.nativeEnum(TagUseFor).optional(),
  }),
  BasicModelFilters.extend({
    name: z.literal("category"),
  }),
  BasicModelFilters.extend({
    name: z.literal("location"),
  }),
  BasicModelFilters.extend({
    name: z.literal("kit"),
  }),
  BasicModelFilters.extend({
    name: z.literal("teamMember"),
    deletedAt: z.string().nullable().optional(),
    userWithAdminAndOwnerOnly: z.coerce.boolean().optional(), // To get only the teamMembers which are admin or owner
    usersOnly: z.coerce.boolean().optional(), // To get only the teamMembers with users (exclude NRMs)
  }),
  BasicModelFilters.extend({
    name: z.literal("booking"),
    /**
     * Comma-separated `BookingStatus` values the caller wants to search across.
     *
     * Different surfaces need different sets: the asset/kit "Add to existing
     * booking" dialogs also offer DRAFT bookings, while the asset-index
     * advanced filter is about *upcoming* bookings and deliberately excludes
     * them. Defaults to the upcoming-only set so existing callers are
     * unaffected.
     */
    status: z
      .string()
      .optional()
      .refine(
        (val) =>
          val === undefined ||
          val
            .split(",")
            .every((s) =>
              Object.values(BookingStatus).includes(s.trim() as BookingStatus)
            ),
        { message: "Invalid booking status" }
      ),

    /**
     * Opt in to the same custodian restriction the seeding loader applies.
     *
     * Set by the "Add to existing booking" dialogs, whose loader runs
     * `loadBookingsData` → `getBookings({ custodianScope })` for SELF_SERVICE /
     * BASE callers. Without it, typing replaces their custodian-scoped list with
     * bookings they do not own, which `validateBookingOwnership` then rejects on
     * submit — a dead end.
     *
     * The asset-index advanced filter does NOT set it, so that surface keeps
     * seeing the same rows before and after typing.
     *
     * This is a request-controlled *toggle*, never a request-controlled *value*:
     * the ids it restricts to are resolved server-side from the session user, so
     * it cannot be used to widen or retarget the scope (the hazard documented on
     * `getMinimalBookings`). It is also a no-op for ADMIN / OWNER.
     */
    scopeToCustodian: z.coerce.boolean().optional(),
  }),
  BasicModelFilters.extend({
    name: z.literal("assetModel"),
  }),
]);

export type AllowedModelNames = z.infer<typeof ModelFiltersSchema>["name"];
export type ModelFilters = z.infer<typeof ModelFiltersSchema>;
export type ModelFiltersLoader = typeof loader;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, userOrganizations } = await getSelectedOrganization(
      { userId, request }
    );

    /** Getting all the query parameters from url */
    const url = new URL(request.url);
    const searchParams: Record<string, any> = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (value === "null") {
        searchParams[key] = null;
      } else {
        searchParams[key] = value;
      }
    }

    /** Validating parameters */
    const modelFilters = parseData(searchParams, ModelFiltersSchema);
    const { name, queryKey, queryValue, selectedValues } = modelFilters;

    const where: Record<string, any> = {
      organizationId,
      OR: [{ id: { in: (selectedValues ?? "").split(",") } }],
    };
    /**
     * When searching for teamMember, we have to search for
     * - teamMember's name
     * - teamMember's user firstName, lastName and email
     */
    if (modelFilters.name === "teamMember") {
      where.OR.push(
        { name: { contains: queryValue, mode: "insensitive" } },
        { user: { firstName: { contains: queryValue, mode: "insensitive" } } },
        { user: { firstName: { contains: queryValue, mode: "insensitive" } } },
        { user: { email: { contains: queryValue, mode: "insensitive" } } }
      );

      where.deletedAt = modelFilters.deletedAt;
      if (modelFilters.userWithAdminAndOwnerOnly) {
        where.AND = [
          { user: { isNot: null } },
          {
            user: {
              userOrganizations: {
                some: {
                  AND: [
                    { organizationId },
                    { roles: { hasSome: ["ADMIN", "OWNER"] } },
                  ],
                },
              },
            },
          },
        ];
      } else if (modelFilters.usersOnly) {
        // Filter to show only team members with users (exclude NRMs)
        where.user = { isNot: null };
      }
    } else {
      where.OR.push({
        [queryKey]: { contains: queryValue, mode: "insensitive" },
      });
    }

    if (modelFilters.name === "booking") {
      where.status = {
        in: modelFilters.status
          ? (modelFilters.status
              .split(",")
              .map((s) => s.trim()) as BookingStatus[])
          : DEFAULT_BOOKING_SEARCH_STATUSES,
      };

      /**
       * A DRAFT booking is visible only to its creator. Every other booking
       * read path enforces this — `getBookings`, `getMinimalBookings`, the CSV
       * export and the mobile booking APIs all AND in the same clause — so a
       * search that can now return DRAFT rows has to enforce it too, or typing
       * would surface drafts the seeding loader deliberately hides.
       *
       * Server-derived from the session `userId`, never from a request param,
       * and nested in a single AND member so the search `OR` above cannot widen
       * it back open.
       */
      where.AND = [...(where.AND ?? []), bookingDraftVisibilityClause(userId)];

      /**
       * Callers that opted in get the seeding loader's custodian restriction,
       * resolved here from the session — see the `scopeToCustodian` docs above.
       */
      if (
        modelFilters.scopeToCustodian &&
        isSelfServiceOrBaseRole(
          resolveEffectiveRole({ userOrganizations, organizationId })
        )
      ) {
        const custodianScope = await resolveCustodianScope({
          userId,
          organizationId,
        });

        const selfBranches: Prisma.BookingWhereInput[] = [
          { custodianUserId: custodianScope.userId },
        ];

        if (custodianScope.teamMemberIds.length) {
          selfBranches.push({
            custodianTeamMemberId: { in: custodianScope.teamMemberIds },
          });
        }

        where.AND.push(
          selfBranches.length === 1 ? selfBranches[0] : { OR: selfBranches }
        );
      }
    }

    if (modelFilters.name === "tag" && modelFilters.useFor) {
      // Tags with "All" selected are stored with an empty useFor array, so filtering only by `has`
      // would hide those tags in bulk/tag pickers even though they are intended to be available.
      // This keeps tag searches consistent with create/edit flows that also include "All" tags.
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { useFor: { isEmpty: true } },
            { useFor: { has: modelFilters.useFor } },
          ],
        },
      ];
    }

    const queryData = (await db[name].dynamicFindMany({
      where,
      include:
        /** We need user's information to resolve teamMember's name */
        name === "teamMember"
          ? {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  displayName: true,
                  email: true,
                },
              },
            }
          : undefined,
    })) as Array<Record<string, string>>;

    return data(
      payload({
        /**
         * Search results must carry the SAME top-level fields as the records a
         * route loader seeds the picker with, because `DynamicSelect` /
         * `DynamicDropdown` hand whichever list is active to the very same
         * `renderItem`.
         *
         * Spreading the raw record first is what keeps those two shapes in
         * agreement: without it a `renderItem` reading a plain column — e.g.
         * `item.status` in the booking pickers — silently got `undefined` the
         * moment the user typed, and the row rendered as nothing at all. The
         * explicit keys below still win, so the `id` / `name` / `color` /
         * `metadata` / `user` contract is unchanged.
         *
         * No new data is exposed: `metadata` already carried the whole record.
         */
        filters: queryData.map((item) => ({
          ...item,
          id: item.id,
          name: item[queryKey],
          color: item?.color,
          metadata: item,
          user: item?.user,
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
