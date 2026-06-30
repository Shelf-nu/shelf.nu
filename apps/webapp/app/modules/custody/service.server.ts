import type { Asset, User } from "@prisma/client";
import { AssetStatus, OrganizationRoles } from "@prisma/client";
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
 * @param userId - The caller's user ID (for the SELF_SERVICE self-restriction)
 * @param role - The caller's role; SELF_SERVICE may only release their own custody
 * @param activityEvent - Optional activity event data for audit trail
 *   (records `CUSTODY_RELEASED` atomically when provided)
 */
export async function releaseCustody({
  assetId,
  organizationId,
  userId,
  role,
  activityEvent,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
  userId: User["id"];
  /**
   * Caller's role. Required so the SELF_SERVICE self-restriction is enforced
   * here for EVERY caller (web + mobile), not duplicated in each route.
   */
  role: OrganizationRoles;
  /** Optional activity event data - if provided, records CUSTODY_RELEASED event atomically */
  activityEvent?: {
    actorUserId: string;
    teamMemberId?: string;
    targetUserId?: string;
  };
}) {
  // Self-service users may only release custody of assets assigned to them.
  // Checked BEFORE the transaction so the 403 is returned cleanly — a throw
  // inside the tx below would be re-wrapped by the catch as a generic error.
  if (role === OrganizationRoles.SELF_SERVICE) {
    const current = await db.custody.findFirst({
      where: { assetId, asset: { organizationId } },
      select: { custodian: { select: { userId: true } } },
    });
    if (current?.custodian?.userId !== userId) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message:
          "Self service user can only release custody of assets assigned to their user.",
        additionalData: { userId, assetId },
        label: "Custody",
        status: 403,
        shouldBeCaptured: false,
      });
    }
  }

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
