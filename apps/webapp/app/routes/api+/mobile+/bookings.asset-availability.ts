import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { getAssetAvailabilityBatch } from "~/modules/asset/availability.server";
import { makeShelfError, ShelfError } from "~/utils/error";

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
 * Asset ids outside the workspace are dropped, not reported.
 *
 * Query: ?orgId & bookingId & assetIds=<id>,<id>,...
 * Response: { availability: Array<{ assetId, total, bookable, reserved, inCustody }> }
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
    const organizationId = await requireOrganizationAccess(request, user.id);
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

    // Org-scoped booking lookup — a foreign-org booking id 404s here.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { id: true, from: true, to: true },
    });
    if (!booking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    // Only this workspace's quantity-tracked assets are answered. INDIVIDUAL
    // assets have no pool to measure, and a foreign id must not leak counts.
    const ownedQtyAssets = await db.asset.findMany({
      where: { id: { in: assetIds }, organizationId, type: "QUANTITY_TRACKED" },
      select: { id: true },
    });
    const ownedIds = ownedQtyAssets.map((a) => a.id);

    const availabilityByAsset = await getAssetAvailabilityBatch(ownedIds, {
      organizationId,
      window:
        booking.from && booking.to
          ? { from: booking.from, to: booking.to }
          : null,
      excludeBookingId: booking.id,
    });

    return data({
      availability: ownedIds.map((assetId) => {
        const a = availabilityByAsset.get(assetId);
        return {
          assetId,
          total: a?.total ?? 0,
          bookable: a?.bookable ?? 0,
          reserved: a?.reserved ?? 0,
          inCustody: a?.inCustody ?? 0,
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
