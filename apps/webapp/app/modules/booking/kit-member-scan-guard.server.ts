/**
 * Kit-member scan guard
 *
 * Refuses a loose scan of an INDIVIDUAL asset that belongs to a kit. Every
 * scan path that can write a standalone `BookingAsset` row runs it: the
 * scan-to-add flow and the fulfil-and-check-out flow, from both the web drawer
 * and the mobile app. The drawer blocks the same scan, but the server cannot
 * trust the client to have sent a kit's members as kit slices.
 *
 * Lives in its own module so both flows import it without importing each
 * other.
 *
 * @see {@link file://./service.server.ts} `addScannedAssetsToBooking`
 * @see {@link file://./fulfil-and-checkout.server.ts} `fulfilAndCheckOut`
 * @see {@link file://./../../../../../.claude/rules/kit-members-via-kit-slices.md}
 */
import { AssetType } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

/** Arguments for {@link assertScannedUnitsAreNotKitMembers}. */
type AssertScannedUnitsAreNotKitMembersArgs = {
  /** The booking the scan is for. */
  bookingId: string;
  /** The caller's workspace. Scopes the lookup. */
  organizationId: string;
  /** Assets the scan would add as standalone rows. */
  looseAssetIds: string[];
  /**
   * Kits scanned in the same batch. A member of one of these is going out with
   * its kit, so it is not refused. Pass `[]` when the kits' members travel as
   * kit slices and never reach `looseAssetIds`.
   */
  exemptKitIds: string[];
};

/**
 * Refuses a loose scan of a unit that belongs to a kit.
 *
 * An INDIVIDUAL asset committed to a kit is not a free unit. Booking it on its
 * own leaves the kit split: one item in the field, the rest on the shelf, and
 * the kit reading as checked out with nothing on the booking saying why.
 *
 * Only a scan that would genuinely take the unit out alone is refused. A member
 * of a kit in `exemptKitIds` goes out with its kit, and a member already on
 * this booking is not being taken anywhere new: it is already committed
 * through the row it has. QUANTITY_TRACKED members are never refused, since
 * their free-pool units are bookable on their own.
 *
 * @param args - The booking, the caller's workspace, the loose scans and the
 *   kits scanned alongside them
 * @throws {ShelfError} 400 naming the units that belong to a kit
 */
export async function assertScannedUnitsAreNotKitMembers({
  bookingId,
  organizationId,
  looseAssetIds,
  exemptKitIds,
}: AssertScannedUnitsAreNotKitMembersArgs): Promise<void> {
  if (looseAssetIds.length === 0) return;

  const exempt = new Set(exemptKitIds);
  const kitMembers = await db.asset.findMany({
    // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: guard read by id; must see every scanned unit, archived or not
    where: {
      id: { in: looseAssetIds },
      organizationId,
      type: AssetType.INDIVIDUAL,
      assetKits: { some: {} },
    },
    select: {
      title: true,
      assetKits: { select: { kitId: true } },
      // Empty when this scan would be the unit's first arrival on the booking,
      // which is the only case that can split a kit.
      bookingAssets: { where: { bookingId }, select: { id: true } },
    },
  });

  const refused = kitMembers.filter(
    (asset) =>
      asset.bookingAssets.length === 0 &&
      !asset.assetKits.some((membership) => exempt.has(membership.kitId))
  );
  if (refused.length === 0) return;

  const names = refused.map((asset) => `"${asset.title}"`).join(", ");
  throw new ShelfError({
    cause: null,
    status: 400,
    label: "Booking",
    message: `${names} belongs to a kit, so it can't go out on its own. Scan the kit to take all of it, or scan another unit of the same model.`,
    shouldBeCaptured: false,
    additionalData: { bookingId, organizationId },
  });
}
