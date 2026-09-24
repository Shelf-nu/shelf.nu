import { BookingStatus, TagUseFor } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  bookingDraftVisibilityClause,
  custodianScopeClause,
  resolveCustodianScope,
} from "~/modules/booking/service.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { resolveCustodianPickerScope } from "~/modules/team-member/service.server";
import { bookingWriteScopeClause } from "~/utils/booking-authorization.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  getModelFilterConfig,
  isSearchableKey,
} from "~/utils/model-filters-registry.server";
import {
  resolveCanSeeAllBookings,
  resolveCanSeeAllCustody,
  resolveEffectiveRole,
} from "~/utils/roles.server";

/**
 * Booking statuses a booking search returns when the caller does not ask for a
 * specific set. Matches the historical behaviour of this endpoint: "upcoming"
 * bookings only, which is what the asset-index advanced filter means by
 * "Has upcoming bookings".
 */
/**
 * Ceiling on rows one picker search returns. Without it a single request pulls
 * every row of a model for the whole workspace.
 *
 * The cap is offset by the number of already-selected ids because those ride
 * in the same top-level `OR` — a flat limit could evict the very rows the
 * picker needs in order to render its current selection.
 */
const SEARCH_TAKE_LIMIT = 100;

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
    /**
     * Which question this custodian picker is asking — see
     * `resolveCustodianPickerScope`. Selects a server-side rule; it supplies no
     * ids and cannot widen one, because both rules are resolved from the
     * session.
     *
     * Optional rather than `.default()`: a zod default makes the field
     * REQUIRED in the inferred output type, which is what every call site's
     * `model` prop is typed against. The fallback is applied in the loader
     * instead, where it is also easier to see that it fails closed.
     */
    custodyPurpose: z
      .enum(["custody-filter", "custody-assignment", "booking-custodian"])
      .optional(),
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
  }),
  BasicModelFilters.extend({
    name: z.literal("assetModel"),
  }),
  // No `asset` member: `Asset` has no `name` column (it has `title`), no call
  // site ever passed `name: "asset"`, and any such call would have thrown at
  // the `where`. Registering it would only widen the surface.
]);

export type AllowedModelNames = z.infer<typeof ModelFiltersSchema>["name"];
export type ModelFilters = z.infer<typeof ModelFiltersSchema>;
export type ModelFiltersLoader = typeof loader;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, userOrganizations, currentOrganization } =
      await getSelectedOrganization({ userId, request });

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

    /**
     * `queryKey` is interpolated straight into the Prisma `where`, so an
     * unvalidated value is a blind-search oracle over columns no picker ever
     * displays. Every call site passes `name`; anything else is rejected.
     */
    if (!isSearchableKey(name, queryKey)) {
      throw new ShelfError({
        cause: null,
        message: `Cannot search "${name}" by "${queryKey}".`,
        label: "Request validation",
        status: 400,
        // User-supplied input, not a server fault — keep it out of Sentry.
        shouldBeCaptured: false,
      });
    }

    const selectedIds = (selectedValues ?? "")
      .split(",")
      .filter((id) => id !== "");

    /**
     * Scoping shared by BOTH queries below — organization, status, and every
     * permission clause pushed into `AND`. It deliberately carries no `OR`:
     * the search predicate and the already-selected ids are issued as two
     * separate queries, so the result cap cannot evict a selection.
     *
     * Both queries MUST be composed from this same object. A selected-ids
     * query that skipped the custody scope, the draft-visibility clause or the
     * booking write scope would return rows the search deliberately hides —
     * turning a display bug into an IDOR, since `selectedValues` is
     * caller-supplied.
     */
    const where: Record<string, any> = { organizationId };

    /** Branches matching what the user typed. Never includes selected ids. */
    const searchBranches: Record<string, any>[] = [];

    /**
     * When searching for teamMember, we have to search for
     * - teamMember's name
     * - teamMember's user firstName, lastName, displayName and email
     */
    if (modelFilters.name === "teamMember") {
      searchBranches.push(
        { name: { contains: queryValue, mode: "insensitive" } },
        { user: { firstName: { contains: queryValue, mode: "insensitive" } } },
        { user: { lastName: { contains: queryValue, mode: "insensitive" } } },
        // `displayName` replaces first/last name in the UI for users who set
        // one, so it is the name a searcher can actually see in the option.
        {
          user: { displayName: { contains: queryValue, mode: "insensitive" } },
        },
        // Matched but never RETURNED — see the registry's `teamMember` select.
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

      /**
       * Custody scoping, resolved from the session — never from the request.
       * Every seeding loader restricts this picker; without the same rule here
       * the list grew from "just me" to the entire roster the moment the user
       * typed.
       */
      const role = resolveEffectiveRole({ userOrganizations, organizationId });
      const custodyScope = resolveCustodianPickerScope({
        // Fail closed: an unmigrated call site gets the NARROWER assignment
        // rule, so it shows too few names rather than too many.
        purpose: modelFilters.custodyPurpose ?? "custody-assignment",
        role,
        canSeeAllCustody: resolveCanSeeAllCustody({
          role,
          currentOrganization,
        }),
        userId,
      });

      // BASE may never assign custody, so there is nothing to offer and no
      // reason to hit the database.
      if (custodyScope.mode === "none") {
        return data(payload({ filters: [] }));
      }

      if (custodyScope.mode === "self") {
        where.userId = custodyScope.userId;
      }
    } else {
      searchBranches.push({
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

      const role = resolveEffectiveRole({ userOrganizations, organizationId });

      /**
       * Standard booking READ visibility: SELF_SERVICE / BASE users only see
       * bookings they are custodian of, unless the workspace has switched the
       * setting on.
       *
       * Resolved from the session role plus the organization's settings, never
       * from a request param, and AND-ed so the search `OR` cannot widen it.
       * The restriction used to be opt-in via a `scopeToCustodian` query param,
       * which a caller could simply omit — every booking row in the workspace
       * came back to a restricted user with the setting off.
       *
       * Shares `custodianScopeClause` with `getBookings` so the shape matches
       * the loader that seeded the picker; matching only `custodianUserId` here
       * dropped bookings custodied through a legacy team-member row as soon as
       * the user typed.
       */
      if (!resolveCanSeeAllBookings({ role, currentOrganization })) {
        where.AND.push(
          custodianScopeClause(
            await resolveCustodianScope({ userId, organizationId })
          )
        );
      }

      /**
       * Standard booking WRITE authorization, AND-ed on top.
       *
       * Every reachable consumer of a booking search for a restricted role is a
       * mutation-target picker — the two "Add to existing booking" dialogs. The
       * asset-index advanced filter is the only read-only consumer, and
       * `assets._index.tsx` refuses ADVANCED mode to SELF_SERVICE / BASE
       * outright, so this never narrows a list they can otherwise reach.
       *
       * Independent of the visibility toggle on purpose: it mirrors
       * `validateBookingOwnership`, which ignores that toggle. Offering rows the
       * action rejects turns the picker into a 403 dead end. A future read-only
       * booking search for these roles needs a purpose distinction here.
       */
      const writeScope = bookingWriteScopeClause({ userId, role });

      if (writeScope) {
        where.AND.push(writeScope);
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

    // The registry — not this call site — decides what leaves the server.
    // Narrowing `item` here is what makes the `...item` / `metadata` / `user`
    // spread below safe, instead of having to sanitise three separate paths.
    const select = getModelFilterConfig(name).select;

    /**
     * Two queries rather than one capped `OR`.
     *
     * Sharing a single LIMIT across "what you typed" and "what you already
     * picked" makes inclusion probabilistic: with more matches than the cap and
     * no ordering, Postgres may fill every slot with search hits and drop the
     * selected rows, so the picker cannot render or deselect them. Widening the
     * cap by the selected count buys capacity, not inclusion.
     *
     * Both queries are composed from the same scoped `where`, so the
     * caller-supplied `selectedValues` cannot reach past the permission clauses.
     */
    const [selectedRows, searchRows] = (await Promise.all([
      selectedIds.length
        ? db[name].dynamicFindMany({
            where: { ...where, id: { in: selectedIds } },
            select,
            take: selectedIds.length,
          })
        : Promise.resolve([]),
      db[name].dynamicFindMany({
        where: { ...where, OR: searchBranches },
        select,
        take: SEARCH_TAKE_LIMIT,
        // Without this the cap is nondeterministic — which N of M rows come
        // back could differ between identical requests.
        orderBy: { [queryKey]: "asc" },
      }),
    ])) as Array<Array<Record<string, string>>>;

    // Selected first, then search hits, de-duplicated: a selected row can also
    // match what the user typed.
    const seenIds = new Set<string>();
    const queryData = [...selectedRows, ...searchRows].filter((item) => {
      if (seenIds.has(item.id)) {
        return false;
      }
      seenIds.add(item.id);
      return true;
    });

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
