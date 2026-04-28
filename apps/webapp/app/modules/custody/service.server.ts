import type { Asset } from "@prisma/client";
import { AssetStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import { ShelfError } from "~/utils/error";

/**
 * Releases custody of an asset.
 *
 * @param assetId - The ID of the asset to release custody from
 * @param organizationId - The organization ID
 * @param activityEvent - Optional activity event data for audit trail
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
    // Use transaction to ensure custody release and activity event are atomic
    return await db.$transaction(async (tx) => {
      const asset = await tx.asset.update({
        where: { id: assetId, organizationId },
        data: {
          status: AssetStatus.AVAILABLE,
          custody: {
            delete: true,
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

/**
 * Assigns custody of an asset to a team member.
 *
 * @param assetId - The ID of the asset
 * @param organizationId - The organization ID
 * @param custodianId - The team member ID to assign custody to
 * @param activityEvent - Activity event data for audit trail
 */
export async function assignCustody({
  assetId,
  organizationId,
  custodianId,
  activityEvent,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
  custodianId: string;
  /** Activity event data for recording CUSTODY_ASSIGNED event atomically */
  activityEvent: {
    actorUserId: string;
    targetUserId?: string;
  };
}) {
  try {
    // Use transaction to ensure custody assignment and activity event are atomic
    return await db.$transaction(async (tx) => {
      const asset = await tx.asset.update({
        where: { id: assetId, organizationId },
        data: {
          status: AssetStatus.IN_CUSTODY,
          custody: {
            create: {
              custodian: { connect: { id: custodianId } },
            },
          },
        },
        select: {
          id: true,
          title: true,
        },
      });

      // Record activity event
      await recordEvent(
        {
          organizationId,
          actorUserId: activityEvent.actorUserId,
          action: "CUSTODY_ASSIGNED",
          entityType: "ASSET",
          entityId: assetId,
          assetId,
          teamMemberId: custodianId,
          targetUserId: activityEvent.targetUserId,
        },
        tx
      );

      return asset;
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while assigning custody. Please try again or contact support.",
      additionalData: { assetId, custodianId },
      label: "Custody",
    });
  }
}
