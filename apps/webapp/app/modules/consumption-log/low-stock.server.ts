/**
 * Low-Stock Notification Utility
 *
 * Checks whether a quantity-tracked asset's available quantity has dropped
 * to or below its configured minimum threshold (minQuantity). When the
 * threshold is breached, an in-app notification is sent to the acting user
 * and an email alert is sent to the organization owner so they can take
 * corrective action (e.g., restock).
 *
 * "Available" is computed as total quantity minus units currently in custody.
 *
 * CUSTODY FAMILY / bookings-blind by design (#2677 discussion): this check
 * uses the custody-availability formula (`total − Σ Custody.quantity`), NOT
 * the canonical booking-pool module (`~/modules/asset/availability.server`).
 * Units reserved on bookings are still physically on the shelf, so they do
 * not count as "gone" for restock purposes. Trigger COVERAGE is broader than
 * the formula: booking check-in CONSUME/LOSS/DAMAGE dispositions and asset
 * edits/CSV imports that reduce `Asset.quantity` also fire this check (they
 * decrement the pool total), but the availability math stays bookings-blind.
 *
 * @see {@link file://./service.server.ts} - adjustQuantity that triggers this check
 * @see {@link file://../asset/availability.server.ts} - booking family (NOT used here, on purpose)
 * @see {@link file://../../utils/emitter/send-notification.server.ts} - notification emitter
 * @see {@link file://../../emails/low-stock-alert.tsx} - email template
 */

import { db } from "~/database/db.server";
import { lowStockAlertHtml, lowStockAlertText } from "~/emails/low-stock-alert";
import { sendEmail } from "~/emails/mail.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/**
 * Checks if an asset's available quantity has dropped to or below
 * its minimum threshold, and sends both an in-app notification
 * and an email alert to the organization owner if so.
 *
 * Does nothing if:
 * - The asset does not exist
 * - The asset is not QUANTITY_TRACKED
 * - No minQuantity threshold is configured
 * - Available quantity is still above the threshold
 *
 * @param params.assetId - The ID of the asset to check
 * @param params.userId - The user who performed the action (notification recipient)
 * @param params.organizationId - The organization owning the asset (used to find admin recipients)
 */
export async function checkAndNotifyLowStock({
  assetId,
  userId,
  organizationId,
}: {
  assetId: string;
  userId: string;
  organizationId: string;
}): Promise<void> {
  const asset = await db.asset.findFirst({
    // org-scoped: scope the low-stock lookup to the caller's org
    // (cross-org IDOR guard).
    where: { id: assetId, organizationId },
    select: {
      title: true,
      quantity: true,
      minQuantity: true,
      unitOfMeasure: true,
      type: true,
    },
  });

  /** Bail out if the asset doesn't exist or isn't quantity-tracked */
  if (
    !asset ||
    asset.type !== "QUANTITY_TRACKED" ||
    asset.minQuantity == null
  ) {
    return;
  }

  /** Compute available = total - inCustody */
  const custodySum = await db.custody.aggregate({
    where: { assetId },
    _sum: { quantity: true },
  });
  const available = (asset.quantity ?? 0) - (custodySum._sum.quantity ?? 0);

  /** Only notify when available quantity is at or below the threshold */
  if (available <= asset.minQuantity) {
    const unitLabel = asset.unitOfMeasure ?? "units";

    /** In-app notification for the acting user */
    sendNotification({
      title: "Low stock alert",
      message: `${asset.title} has ${available} ${unitLabel} available (threshold: ${asset.minQuantity})`,
      icon: { name: "coins", variant: "error" },
      senderId: userId,
    });

    /** Email notification to the organization owner */
    try {
      const org = await db.organization.findUnique({
        where: { id: organizationId },
        select: {
          name: true,
          owner: { select: { email: true, firstName: true } },
        },
      });

      if (org?.owner?.email) {
        const html = await lowStockAlertHtml({
          assetTitle: asset.title,
          available,
          minQuantity: asset.minQuantity,
          unitOfMeasure: unitLabel,
          assetId,
          organizationName: org.name,
        });

        const text = lowStockAlertText({
          assetTitle: asset.title,
          available,
          minQuantity: asset.minQuantity,
          unitOfMeasure: unitLabel,
          assetId,
          organizationName: org.name,
        });

        sendEmail({
          to: org.owner.email,
          subject: `Low stock alert: ${asset.title}`,
          html,
          text,
        });
      }
    } catch (cause) {
      /** Email failure should not break the operation */
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to send low-stock alert email to organization owner",
          additionalData: { assetId, organizationId },
          label: "Notification",
        })
      );
    }
  }
}

/**
 * Fire-and-forget low-stock fan-out for stock-DECREASING flows that touch
 * several assets at once (booking check-in CONSUME/LOSS/DAMAGE dispositions,
 * CSV-driven quantity reductions).
 *
 * Deduplicates asset ids (one check — and therefore at most one alert — per
 * asset per request), runs the checks via `Promise.allSettled` so one
 * failing asset can't suppress the others, and logs failures instead of
 * throwing: low-stock alerting must never fail or delay the mutation that
 * triggered it (mirrors the advisory posture of the note writers in the
 * check-in flows). Callers should invoke this AFTER their transaction has
 * committed and must NOT await it on the request path (`void notifyLowStock…`).
 *
 * Recipients are unchanged from {@link checkAndNotifyLowStock} (acting user
 * in-app + org owner email) — recipient fan-out is explicitly out of scope.
 *
 * @param params.assetIds - Assets whose stock decreased (dupes tolerated)
 * @param params.userId - The acting user (in-app notification recipient)
 * @param params.organizationId - The org owning the assets
 */
export async function notifyLowStockForAssets({
  assetIds,
  userId,
  organizationId,
}: {
  assetIds: string[];
  userId: string;
  organizationId: string;
}): Promise<void> {
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    uniqueAssetIds.map((assetId) =>
      checkAndNotifyLowStock({ assetId, userId, organizationId })
    )
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      Logger.error(
        new ShelfError({
          cause: result.reason,
          message: "Failed to run low-stock check after stock decrement",
          additionalData: {
            assetId: uniqueAssetIds[index],
            organizationId,
            userId,
          },
          label: "Notification",
        })
      );
    }
  });
}
