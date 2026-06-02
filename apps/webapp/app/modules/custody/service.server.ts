import type { Asset, User } from "@prisma/client";
import { AssetStatus, OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import { ShelfError } from "~/utils/error";

/**
 * Releases custody of an asset.
 *
 * @param assetId - The ID of the asset to release custody from
 * @param organizationId - The organization ID
 * @param userId - The caller's user ID (for the SELF_SERVICE self-restriction)
 * @param role - The caller's role; SELF_SERVICE may only release their own custody
 * @param activityEvent - Optional activity event data for audit trail
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
