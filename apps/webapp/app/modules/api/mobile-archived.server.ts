/**
 * Archived-Asset Refusals on the Mobile API
 *
 * Archived assets are read-only and cannot be booked (issue #382). The asset
 * and booking services refuse them with `assertAssetsAreNotArchived`, but a
 * service's catch block replaces `additionalData` before the route sees it, so
 * the archived ids never reach the response.
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
 * as is. It is built by `archivedAssetsRefusal`, as the shared guard builds
 * its own, with the fix a scanned list always has: remove the archived rows,
 * which works for every role. The services keep their own guards; this check
 * only answers earlier and more precisely.
 *
 * @see {@link file://./../../utils/org-validation.server.ts} assertAssetsAreNotArchived
 * @see apps/companion/lib/archived-assets.ts the client reader (`archivedIdsFromError`)
 */

import { archivedAssetsRefusal } from "@shelf/labels";
import { db } from "~/database/db.server";

/** The `reason` the companion branches on for an archived refusal. */
export const MOBILE_ARCHIVED_ERROR_REASON = "archived";

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
 * @returns The refusal to send, or `null` when none of the assets is archived
 */
export async function findMobileArchivedRefusal({
  assetIds,
  organizationId,
}: {
  assetIds: string[];
  organizationId: string;
}): Promise<MobileArchivedRefusal | null> {
  const requested = [...new Set(assetIds)];
  if (requested.length === 0) return null;

  const archived = await db.asset.findMany({
    where: {
      id: { in: requested },
      organizationId,
      archivedAt: { not: null },
    },
    select: { id: true, title: true },
  });
  if (archived.length === 0) return null;

  const titleById = new Map(archived.map((a) => [a.id, a.title ?? ""]));
  const archivedAssetIds = requested.filter((id) => titleById.has(id));

  return {
    message: archivedAssetsRefusal({
      titles: archivedAssetIds.map((id) => titleById.get(id) ?? ""),
      fix: "remove-from-list",
      // Unused by "remove-from-list": dropping the rows needs no permission.
      canReinstate: false,
    }),
    reason: MOBILE_ARCHIVED_ERROR_REASON,
    archivedAssetIds,
  };
}
