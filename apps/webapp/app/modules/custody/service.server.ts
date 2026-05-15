import type { Asset } from "@prisma/client";
import { AssetStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import { ShelfError } from "~/utils/error";

/**
 * Releases all custody for an asset, setting its status to AVAILABLE.
 *
 * For INDIVIDUAL assets this deletes the single custody record. For
 * QUANTITY_TRACKED assets use `releaseQuantity()` in the asset service
 * instead — this function releases ALL custodians at once via
 * `deleteMany`.
 *
 * @param assetId - The ID of the asset to release custody from
 * @param organizationId - The organization ID
 * @param activityEvent - Optional activity event data for audit trail
 *   (records `CUSTODY_RELEASED` atomically when provided)
 */
export async function releaseCustody({
  assetId,
  organizationId,
  activityEvent,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
  /** Optional activity event data - if provided, records CUSTODY_RELEASED event atomically */
  activityEvent?: {
    actorUserId: string;
    teamMemberId?: string;
    targetUserId?: string;
  };
}) {
  try {
    // Wrap in a transaction so the custody release + activity event
    // commit atomically (main's pattern). Use `deleteMany` (not
    // `delete`) so QUANTITY_TRACKED assets release ALL custodians
    // at once — Phase 2 changed `Asset.custody` from `Custody?` to
    // `Custody[]`, so `delete: true` no longer compiles.
    return await db.$transaction(async (tx) => {
      const asset = await tx.asset.update({
        where: { id: assetId, organizationId },
        data: {
          status: AssetStatus.AVAILABLE,
          custody: {
            deleteMany: {},
          },
        },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
          custody: true,
        },
      });

      // Record activity event if actor data is provided
      if (activityEvent) {
        await recordEvent(
          {
            organizationId,
            actorUserId: activityEvent.actorUserId,
            action: "CUSTODY_RELEASED",
            entityType: "ASSET",
            entityId: assetId,
            assetId,
            teamMemberId: activityEvent.teamMemberId,
            targetUserId: activityEvent.targetUserId,
          },
          tx
        );
      }

      return asset;
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while releasing the custody. Please try again or contact support.",
      additionalData: { assetId },
      label: "Custody",
    });
  }
}
