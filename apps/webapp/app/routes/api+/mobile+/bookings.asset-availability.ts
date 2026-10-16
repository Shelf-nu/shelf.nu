import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { getAssetAvailabilityBatch } from "~/modules/asset/availability.server";
import { canSeeBooking } from "~/utils/booking-authorization.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * GET /api/mobile/bookings/asset-availability
 *
 * How many units of each given quantity-tracked asset a booking may still
 * book, over that booking's own `[from, to]` window. The mobile twin of the
 * `pickerMeta.maxAllowed` the web scan drawer reads for every scanned
 * quantity-tracked asset, and of the `maxQuantity` the web "Adjust quantity"
 * dialog is capped at.
 *
 * The companion asks this in two places: the scanner, the moment a
 * quantity-tracked asset is scanned into a booking (so the quantity sheet can
 * cap at what is really free), and the booking screen when a booked quantity
 * is edited. The picker does not need it — `available-assets` ships
 * `availableQuantity` on every row.
 *
 * `bookable` is computed by the shared `getAssetAvailabilityBatch` with the
 * booking itself excluded, so a booking that already holds units of the asset
 * is offered those units back rather than seeing them as taken by itself.
 * `bookedQuantity` is what the booking's standalone slice already holds of the
 * asset (null when it holds none), so a re-scan can open the quantity sheet on
 * the current total instead of on 1.
 *
 * Asset ids outside the workspace are dropped, not reported. A booking the
 * caller may not see answers 404, exactly like one in another workspace.
 *
 * Query: ?orgId & bookingId & assetIds=<id>,<id>,...
 * Response: { availability: Array<{ assetId, total, bookable, reserved, inCustody, bookedQuantity }> }
 *
 * @see {@link file://./../bookings.$bookingId.adjust-asset-quantity.ts} the web cap
 * @see {@link file://./bookings.available-assets.ts} the picker's per-row counterpart
 */

const QuerySchema = z.object({
  bookingId: z.string().min(1),
  assetIds: z
    .string()
    .min(1)
    .transform((raw) =>
      Array.from(
        new Set(
          raw
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        )
      )
    ),
});

/** Hard cap on ids per call: the scanner asks for one, the booking screen for one. */
const MAX_ASSET_IDS = 100;

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    await enforceUserRateLimit(user.id, "bulk");
    const organizationId = await requireOrganizationAccess(request, user.id);
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });
    await assertMobileCanUseBookings(organizationId);

    const url = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      bookingId: url.searchParams.get("bookingId") ?? "",
      assetIds: url.searchParams.get("assetIds") ?? "",
    });
    if (!parsed.success) {
      throw new ShelfError({
        cause: null,
        message: "bookingId and at least one assetId are required.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }
    const { bookingId } = parsed.data;
    const assetIds = parsed.data.assetIds.slice(0, MAX_ASSET_IDS);

    // Org-scoped booking lookup: a foreign-org booking id 404s here, and so
    // does one the caller may not see, so its holdings cannot be probed.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        from: true,
        to: true,
        custodianUserId: true,
        custodianTeamMember: { select: { userId: true } },
      },
    });
    const { access } = await getMobileUserContext(user.id, organizationId);
    if (!booking || !canSeeBooking({ access, booking, userId: user.id })) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    // Only this workspace's active quantity-tracked assets are answered.
    // INDIVIDUAL assets have no pool to measure, an archived asset takes no
    // new units, and a foreign id must not leak counts.
    const ownedQtyAssets = await db.asset.findMany({
      where: {
        id: { in: assetIds },
        organizationId,
        type: "QUANTITY_TRACKED",
        archivedAt: null,
      },
      select: { id: true },
    });
    const ownedIds = ownedQtyAssets.map((a) => a.id);

    const [availabilityByAsset, bookedRows] = await Promise.all([
      getAssetAvailabilityBatch(ownedIds, {
        organizationId,
        window:
          booking.from && booking.to
            ? { from: booking.from, to: booking.to }
            : null,
        excludeBookingId: booking.id,
      }),
      ownedIds.length > 0
        ? db.bookingAsset.findMany({
            where: {
              bookingId: booking.id,
              assetKitId: null,
              assetId: { in: ownedIds },
            },
            select: { assetId: true, quantity: true },
          })
        : Promise.resolve([]),
    ]);
    const bookedByAssetId = new Map(
      bookedRows.map((row) => [row.assetId, row.quantity])
    );

    return data({
      availability: ownedIds.map((assetId) => {
        const a = availabilityByAsset.get(assetId);
        return {
          assetId,
          total: a?.total ?? 0,
          bookable: a?.bookable ?? 0,
          reserved: a?.reserved ?? 0,
          inCustody: a?.inCustody ?? 0,
          bookedQuantity: bookedByAssetId.get(assetId) ?? null,
        };
      }),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
