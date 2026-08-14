import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { bookingDraftVisibilityClause } from "~/modules/booking/service.server";
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
 * Scoping mirrors `bookings.ts` exactly, because the same rules apply to a
 * per-asset slice of the same data:
 *   - organisation scoped
 *   - SELF_SERVICE / BASE see only bookings they are custodian of
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
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const perPage = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("perPage")) || 20)
    );

    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

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
      ...(isSelfServiceOrBase && { custodianUserId: user.id }),
      AND: [bookingDraftVisibilityClause(user.id)],
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
        // Soonest-first among upcoming, most-recent-first among past: ordering
        // by `from` descending puts the newest window at the top, which is what
        // the web tab does and what "when was this out last?" wants.
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
