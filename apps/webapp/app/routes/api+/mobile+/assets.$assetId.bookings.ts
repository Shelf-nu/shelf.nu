import { BookingStatus } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import {
  bookingDraftVisibilityClause,
  custodianScopeClause,
  resolveCustodianScope,
} from "~/modules/booking/service.server";
import {
  canSeeBookingCustodian,
  resolveBookingCustodianName,
} from "~/utils/booking-authorization.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * GET /api/mobile/assets/:assetId/bookings
 *
 * The bookings this ONE asset appears in — the phone answer to "when is this
 * thing out, and where has it been?", asked while standing in front of it.
 * Mirrors the Bookings tab on the web asset page
 * (`assets.$assetId.bookings.tsx`); the bookings list endpoint cannot filter
 * by asset, so this is the phone's only way to ask.
 *
 * Scoping mirrors `bookings.ts`, because the same rules apply to a per-asset
 * slice of the same data:
 *   - organisation scoped
 *   - members without `access.bookings.seeAll` see only bookings they are
 *     custodian of, matched through `resolveCustodianScope` +
 *     `custodianScopeClause`: the user link OR any of their team-member links,
 *     never the user link alone
 *   - the custodian's name and face follow `access.custody.seeAll`, a separate
 *     workspace override from the booking scope
 *   - DRAFT bookings stay private to their creator
 *
 * Statuses match the web tab's `BOOKING_STATUS_TO_SHOW`: everything except
 * CANCELLED and ARCHIVED, so COMPLETE is included. Past bookings are half of
 * what the tab is for.
 *
 * Query params:
 *   - orgId (required): organization ID
 *   - page (optional): page number (default 1)
 *   - perPage (optional): items per page (default 20, max 50)
 *
 * @see {@link file://./bookings.ts} the workspace-wide list this mirrors
 * @see {@link file://./../../_layout+/assets.$assetId.bookings.tsx} web's tab
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Reading an asset's bookings is a booking read, gated like the list.
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    const assetId = params.assetId;
    if (!assetId) {
      throw new ShelfError({
        cause: null,
        message: "Asset id is required.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    // Prove the asset is in this workspace before reporting anything about it,
    // so a guessed id from another org cannot be probed through this route.
    const asset = await db.asset.findFirst({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: the asset's own screen shows archived assets, and their booking history with them
      where: { id: assetId, organizationId },
      select: { id: true },
    });

    if (!asset) {
      return data(
        { error: { message: "Asset not found in this workspace." } },
        { status: 404 }
      );
    }

    const url = new URL(request.url);

    /**
     * Pagination is caller-supplied, so it has to survive nonsense.
     * `Number("1.5")` is 1.5 and `Number("Infinity")` is Infinity; both reach
     * Prisma as a fractional or non-finite `skip`/`take`, which it rejects with
     * a 500. Floor to a finite integer and fall back to the default rather than
     * failing the request over a bad query string.
     */
    const positiveInt = (raw: string | null, fallback: number): number => {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return fallback;
      const floored = Math.floor(parsed);
      return floored >= 1 ? floored : fallback;
    };

    const perPage = Math.min(
      50,
      positiveInt(url.searchParams.get("perPage"), 20)
    );
    const requestedPage = positiveInt(url.searchParams.get("page"), 1);

    /**
     * Validating the inputs is not enough: `skip` is a product, and a page like
     * 1.79e308 is a perfectly finite integer that overflows to Infinity once
     * multiplied by perPage. Prisma rejects that exactly as it rejects a
     * fraction, so the product has to be checked, not only its operands.
     */
    const page = Number.isSafeInteger((requestedPage - 1) * perPage)
      ? requestedPage
      : 1;

    /**
     * Two independent questions, two independent workspace overrides, the same
     * pair the bookings list reads: `access.bookings.seeAll` decides WHICH ROWS
     * exist for this caller, `access.custody.seeAll` whether the custodian's
     * name may be shown on a row that does.
     */
    const { access } = await getMobileUserContext(user.id, organizationId);

    /**
     * Custodian scope (web parity): a restricted member's bookings match
     * through their user link OR any of their team-member links. Matching the
     * user link alone hides a booking whose custodian was picked as a team
     * member, and this section would then state "This asset has never been
     * booked", which is a claim rather than an empty list.
     *
     * Same helpers the bookings list and the calendar use. When you touch one
     * of the three, check the other two.
     */
    const custodianScope = access.bookings.seeAll
      ? null
      : await resolveCustodianScope({ userId: user.id, organizationId });

    const where = {
      organizationId,
      // Web's BOOKING_STATUS_TO_SHOW for this tab.
      status: {
        in: [
          BookingStatus.DRAFT,
          BookingStatus.RESERVED,
          BookingStatus.ONGOING,
          BookingStatus.OVERDUE,
          BookingStatus.COMPLETE,
        ],
      },
      // The whole point of the route: bookings containing THIS asset. Covers
      // both standalone rows and kit-driven slices, since both are BookingAsset
      // rows pointing at the asset.
      bookingAssets: { some: { assetId } },
      AND: [
        bookingDraftVisibilityClause(user.id),
        ...(custodianScope ? [custodianScopeClause(custodianScope)] : []),
      ],
    };

    const [bookings, totalCount] = await Promise.all([
      db.booking.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          from: true,
          to: true,
          custodianUser: {
            select: {
              // `id` here and `userId` on the team member answer "is the
              // custodian the caller?", which keeps a restricted user's own
              // name visible to them.
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
              profilePicture: true,
            },
          },
          custodianTeamMember: { select: { name: true, userId: true } },
        },
        /**
         * Newest start date first, and deliberately NOT web's order: web's
         * asset bookings tab defaults to `from` ASCENDING. Ascending is wrong for
         * this surface though, because the phone previews only the first three
         * rows — an asset with any history would show three old bookings and
         * hide the one it is out on today. Descending puts today's booking in
         * the visible three for every asset whose future is not already full
         * of reservations.
         *
         * A true relevance order (out-now, then next-out, then history) needs
         * a computed discriminator this query cannot express. If the preview
         * ever grows past three rows, revisit.
         */
        orderBy: [{ from: "desc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      db.booking.count({ where }),
    ]);

    return data({
      bookings: bookings.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        from: b.from,
        to: b.to,
        // Shared with the bookings list and the calendar: a name, null for
        // "no custodian", or the withheld sentinel.
        custodianName: resolveBookingCustodianName({
          canSeeAllCustody: access.custody.seeAll,
          booking: b,
          userId: user.id,
        }),
        // The face is as identifying as the name, so it follows the same gate.
        custodianImage: canSeeBookingCustodian({
          canSeeAllCustody: access.custody.seeAll,
          booking: b,
          userId: user.id,
        })
          ? b.custodianUser?.profilePicture || null
          : null,
      })),
      page,
      perPage,
      totalCount,
      totalPages: Math.ceil(totalCount / perPage),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
