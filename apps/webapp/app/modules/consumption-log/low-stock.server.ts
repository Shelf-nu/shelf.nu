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
 * @see {@link file://./service.server.ts} - adjustQuantity that triggers this check
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
  const asset = await db.asset.findUnique({
    where: { id: assetId },
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
