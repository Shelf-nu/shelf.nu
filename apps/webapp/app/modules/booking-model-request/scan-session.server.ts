/**
 * Shared loader derivation for the two booking scanner routes: Scan to
 * Assign (`bookings.$bookingId.overview.scan-assets.tsx`) and Fulfil
 * Reservations & Check Out (`bookings.$bookingId.overview.fulfil-and-checkout.tsx`).
 *
 * Both screens show the same two things from a booking's model reservations:
 * how many units of each reserved model are still outstanding, and which
 * concrete assets already on the booking a scan could still claim toward one.
 * A booking's reservations must read the same on both screens, so the
 * derivation lives here once rather than as two independently maintained
 * copies that can drift.
 *
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.scan-assets.tsx}
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.fulfil-and-checkout.tsx}
 * @see {@link file://./claimable.ts} for `resolveClaimableAssetIds`, the rule
 *   this derivation uses to decide which already-included assets are
 *   claimable.
 */
import type {
  AlreadyIncludedRow,
  ExpectedModelRequest,
} from "~/atoms/qr-scanner";
import { db } from "~/database/db.server";
import type { CountableModelRequest } from "~/utils/booking-model-requests";
import { getOutstandingModelRequests } from "~/utils/booking-model-requests";
import type { BookingAssetRowForClaim } from "./claimable";
import { resolveClaimableAssetIds } from "./claimable";

/**
 * One `BookingModelRequest` row, reduced to what this derivation needs.
 *
 * Declared structurally, not as a Prisma type, so both routes' `getBooking`
 * includes can pass their `modelRequests` rows straight through.
 */
export type ModelRequestRowForScanSession = CountableModelRequest & {
  assetModelId: string;
  assetModel: { name: string };
};

/**
 * One `BookingAsset` row, reduced to what this derivation needs: claimability
 * (via `resolveClaimableAssetIds`) plus the display fields the "already
 * included" list renders.
 */
export type BookingAssetRowForScanSession = BookingAssetRowForClaim & {
  quantity: number;
  asset: BookingAssetRowForClaim["asset"] & {
    title: string;
    mainImage: string | null;
    thumbnailImage: string | null;
    assetKits: Array<{ kitId: string }>;
  };
};

/**
 * Derives a booking's outstanding model reservations and its
 * already-included assets, in the shape both scanner drawers consume.
 *
 * Issues one extra query (asset → model id, for assets already on the
 * booking) beyond what `getBooking` already fetched: `BOOKING_WITH_ASSETS_INCLUDE`
 * is shared by many routes and doesn't select the nested asset's
 * `assetModelId`, so a wider include there would bloat every other caller.
 *
 * @param args.modelRequests - The booking's `modelRequests`, as `getBooking`
 *   returns them.
 * @param args.bookingAssets - The booking's `bookingAssets`, as `getBooking`
 *   returns them.
 * @param args.organizationId - Scopes the supplementary asset lookup to the
 *   caller's org, matching every other query in these loaders.
 * @returns `expectedModelRequests` (one entry per outstanding model, `booked`
 *   vs `remaining`) and `alreadyIncluded` (one entry per `BookingAsset` row,
 *   flagged `claimable` where a scan could still answer a reservation).
 */
export async function deriveBookingScanSession({
  modelRequests,
  bookingAssets,
  organizationId,
}: {
  modelRequests: ModelRequestRowForScanSession[];
  bookingAssets: BookingAssetRowForScanSession[];
  organizationId: string;
}): Promise<{
  expectedModelRequests: ExpectedModelRequest[];
  alreadyIncluded: AlreadyIncludedRow[];
}> {
  const expectedModelRequests: ExpectedModelRequest[] =
    getOutstandingModelRequests(modelRequests).map((modelRequest) => ({
      assetModelId: modelRequest.assetModelId,
      assetModelName: modelRequest.assetModel.name,
      booked: modelRequest.quantity,
      remaining: modelRequest.quantity - modelRequest.fulfilledQuantity,
    }));

  // Model ids for the assets already on the booking. A second read rather
  // than a wider booking include, for the reason in the JSDoc above.
  const alreadyIncludedAssetIds = bookingAssets.map((row) => row.asset.id);
  const assetModelIdByAssetId = new Map<string, string | null>();
  if (alreadyIncludedAssetIds.length > 0) {
    const rows = await db.asset.findMany({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: model lookup for assets already on the booking, archived ones included
      where: { id: { in: alreadyIncludedAssetIds }, organizationId },
      select: { id: true, assetModelId: true },
    });
    for (const row of rows) {
      assetModelIdByAssetId.set(row.id, row.assetModelId);
    }
  }

  const claimableAssetIds = resolveClaimableAssetIds(bookingAssets);

  const alreadyIncluded: AlreadyIncludedRow[] = bookingAssets.map((row) => ({
    id: row.asset.id,
    title: row.asset.title,
    mainImage: row.asset.mainImage,
    thumbnailImage: row.asset.thumbnailImage,
    assetModelId: assetModelIdByAssetId.get(row.asset.id) ?? null,
    claimable: claimableAssetIds.has(row.asset.id),
    kitId: row.asset.assetKits[0]?.kitId ?? null,
    bookedQuantity: row.quantity,
    type: row.asset.type as "INDIVIDUAL" | "QUANTITY_TRACKED",
  }));

  return { expectedModelRequests, alreadyIncluded };
}
