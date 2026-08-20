import { BookingStatus, OrganizationRoles } from "@prisma/client";
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
 * Web has had this as a Bookings tab on the asset page
 * (`assets.$assetId.bookings.tsx`) since long before the companion existed;
 * the app had no way to ask the question at all, because even the bookings
 * list endpoint cannot filter by asset.
 *
 * Scoping mirrors `bookings.ts`, because the same rules apply to a per-asset
 * slice of the same data:
 *   - organisation scoped
 *   - SELF_SERVICE / BASE see only bookings they are custodian of, matched
 *     through `resolveCustodianScope` + `custodianScopeClause` — the user link
 *     OR any of their team-member links, never the user link alone
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

    const page = positiveInt(url.searchParams.get("page"), 1);
    const perPage = Math.min(
      50,
      positiveInt(url.searchParams.get("perPage"), 20)
    );

    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    /**
     * Custodian scope (web parity). Web matches a self-service or base user's
     * bookings through their user link OR any of their team-member links.
     * Matching only the user link hides a booking whose custodian was assigned
     * by picking a TEAM MEMBER rather than a user — it shows on the website and
     * vanishes on the phone, for the very user it belongs to. On this screen
     * that misfires worse than on a list: the section states "This asset has
     * never been booked", which is a claim, not an empty list.
     *
     * Same helpers the bookings list and the calendar use. When you touch one
     * of the three, check the other two.
     */
    const custodianScope = isSelfServiceOrBase
      ? await resolveCustodianScope({ userId: user.id, organizationId })
      : null;

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
            select: { firstName: true, lastName: true, profilePicture: true },
          },
          custodianTeamMember: { select: { name: true } },
        },
        /**
         * Newest start date first, and deliberately NOT web's order.
         *
         * The previous comment here claimed two things that cannot both be
         * true of one sort, and a web parity that does not exist: web's asset
         * bookings tab defaults to `from` ASCENDING. Ascending is wrong for
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
        custodianName:
          b.custodianTeamMember?.name ||
          [b.custodianUser?.firstName, b.custodianUser?.lastName]
            .filter(Boolean)
            .join(" ") ||
          null,
        custodianImage: b.custodianUser?.profilePicture || null,
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
