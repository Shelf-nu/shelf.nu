/**
 * Archived-Asset Refusals on the Mobile API
 *
 * Archived assets are read-only and cannot be booked (issue #382). The asset
 * and booking services refuse them with `assertAssetsAreNotArchived` or an
 * inline check, but those refuse the whole request and name no asset, and a
 * service's catch block replaces `additionalData` before the route sees it.
 * The companion's Scan tab needs to know WHICH scanned rows are archived, so it
 * can mark those rows and leave the others clean.
 *
 * So the mobile routes that take a list of scanned assets ask this module
 * first, before calling the service. When some of the ids are archived they
 * answer with the archived subset in the error envelope:
 *
 * ```json
 * { "error": { "message": "…", "reason": "archived", "archivedAssetIds": ["…"] } }
 * ```
 *
 * `reason` is the machine-readable discriminator the companion branches on
 * (as `"unclaimed"` is on the QR routes); `message` is human copy, which the
 * current app replaces with its own row-level wording and older builds show
 * as is. For a change (custody, location) it is the shared guard's wording,
 * so the phone and the web word the refusal the same way; for a booking it is
 * the booking service's scan refusal. The services keep their own guards; this
 * check only answers earlier and more precisely.
 *
 * @see {@link file://./../../utils/org-validation.server.ts} assertAssetsAreNotArchived, ARCHIVED_ASSETS_MESSAGE
 * @see apps/companion/lib/archived-assets.ts the client reader (`archivedIdsFromError`)
 */

import { db } from "~/database/db.server";
import { ARCHIVED_ASSETS_MESSAGE } from "~/utils/org-validation.server";

/** The `reason` the companion branches on for an archived refusal. */
export const MOBILE_ARCHIVED_ERROR_REASON = "archived";

/**
 * The refusal for archived assets scanned into a booking. Same words as the
 * booking service's own scan refusal (`addScannedAssetsToBookingWithinTx`),
 * which older app builds already show; change both together.
 */
const ARCHIVED_BOOKING_MESSAGE =
  "Some scanned assets are archived and can't be added to a booking. Reinstate them first.";

/**
 * What the request does with the assets: change them (custody, location) or
 * put them in a booking. Only the wording differs.
 */
export type MobileArchivedPurpose = "change" | "booking";

/** The error body a mobile route returns for an archived refusal. */
export type MobileArchivedRefusal = {
  message: string;
  reason: typeof MOBILE_ARCHIVED_ERROR_REASON;
  /** The archived subset of the requested ids, in request order. */
  archivedAssetIds: string[];
};

/**
 * Finds the archived assets among the ids a mobile request names.
 *
 * @param args.assetIds - Asset ids from the request body (deduplicated here)
 * @param args.organizationId - The caller's validated workspace; ids outside it
 *   are ignored, as the service's own org guard refuses them separately
 * @param args.purpose - Whether the request changes the assets or books them
 * @returns The refusal to send, or `null` when none of the assets is archived
 */
export async function findMobileArchivedRefusal({
  assetIds,
  organizationId,
  purpose,
}: {
  assetIds: string[];
  organizationId: string;
  purpose: MobileArchivedPurpose;
}): Promise<MobileArchivedRefusal | null> {
  const requested = [...new Set(assetIds)];
  if (requested.length === 0) return null;

  const archived = await db.asset.findMany({
    where: {
      id: { in: requested },
      organizationId,
      archivedAt: { not: null },
    },
    select: { id: true },
  });
  if (archived.length === 0) return null;

  const archivedIds = new Set(archived.map((a) => a.id));
  const archivedAssetIds = requested.filter((id) => archivedIds.has(id));

  return {
    message:
      purpose === "booking"
        ? ARCHIVED_BOOKING_MESSAGE
        : ARCHIVED_ASSETS_MESSAGE,
    reason: MOBILE_ARCHIVED_ERROR_REASON,
    archivedAssetIds,
  };
}
