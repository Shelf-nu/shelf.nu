/**
 * Low-Stock Notification Utility
 *
 * Debounced, state-transition notifier for quantity-tracked assets. Instead
 * of firing on EVERY call while an asset sits at/below its minimum threshold
 * (`minQuantity`), it fires ONCE when the asset crosses INTO the low-stock
 * band and once more (a "back in stock" recovered notice) when it crosses
 * back OUT. The debounce state is a single nullable timestamp column,
 * `Asset.lowStockNotifiedAt`:
 *   - `null`     → the asset is NOT currently in a notified low-stock state.
 *   - non-null   → we have already alerted for the current low-stock episode.
 *
 * Transitions:
 *   - Enter low   (`isLow && lowStockNotifiedAt == null`): send the low-stock
 *     alert (in-app to the acting user + email to owner AND admins), then
 *     stamp `lowStockNotifiedAt`.
 *   - Recover     (`!isLow && lowStockNotifiedAt != null`): clear the stamp,
 *     then send the "back in stock" recovered notice (in-app + email).
 *   - Otherwise   → no-op (already-notified-and-still-low, or fine-and-was-fine).
 *
 * "Available" is computed as total quantity minus units currently in custody.
 *
 * THRESHOLD SEMANTICS: a threshold exists iff `minQuantity != null`, and the
 * asset is low iff `available <= minQuantity`. This intentionally treats
 * `minQuantity === 0` as a valid out-of-stock threshold (alert when nothing is
 * available). We do NOT adopt the `@shelf` package's `isLowStock` refinement
 * (`min <= 0 → not low`) here — that lives in the mobile lane where before/after
 * are computed in memory. Using it here would silently stop alerting for
 * assets configured with a `0` threshold.
 *
 * The debounce is BEST-EFFORT and non-transactional: two truly-concurrent
 * decrements could each read a `null` marker and double-fire the alert. That is
 * acceptable for a notification and not worth a distributed lock — the read +
 * stamp is deliberately kept outside any mutation transaction so a notification
 * failure can never roll back a committed stock change.
 *
 * @see {@link file://./service.server.ts} - adjustQuantity that triggers this check
 * @see {@link file://../organization/service.server.ts} - getOrganizationAdminsForNotification
 * @see {@link file://../../utils/emitter/send-notification.server.ts} - notification emitter
 * @see {@link file://../../emails/low-stock-alert.tsx} - low-stock alert email template
 * @see {@link file://../../emails/low-stock-recovered.tsx} - recovered email template
 */

import { db } from "~/database/db.server";
import { lowStockAlertHtml, lowStockAlertText } from "~/emails/low-stock-alert";
import {
  lowStockRecoveredHtml,
  lowStockRecoveredText,
} from "~/emails/low-stock-recovered";
import { sendEmail } from "~/emails/mail.server";
import { getOrganizationAdminsForNotification } from "~/modules/organization/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/** Which low-stock email to build and send. */
type LowStockEmailVariant = "alert" | "recovered";

/**
 * Sends the low-stock alert (or recovered notice) email to every OWNER and
 * ADMIN of the organization. Resilient by design:
 *   - the whole block is wrapped in try/catch so an email failure can never
 *     break the caller (which has already committed the stock change);
 *   - each per-recipient send is ALSO wrapped so one bad address can't abort
 *     the loop for the remaining recipients.
 *
 * @param params.variant - "alert" (crossed into low stock) or "recovered"
 * @param params.organizationId - Organization whose admins/owner receive the email
 * @param params.assetId - Asset the notice is about (used for the "View Asset" link)
 * @param params.assetTitle - Asset display title
 * @param params.available - Current available quantity (total minus in-custody)
 * @param params.minQuantity - The configured minimum-quantity threshold
 * @param params.unitOfMeasure - Unit label for the quantities in the email
 */
async function sendLowStockEmails({
  variant,
  organizationId,
  assetId,
  assetTitle,
  available,
  minQuantity,
  unitOfMeasure,
}: {
  variant: LowStockEmailVariant;
  organizationId: string;
  assetId: string;
  assetTitle: string;
  available: number;
  minQuantity: number;
  unitOfMeasure: string;
}): Promise<void> {
  try {
    /**
     * Recipients: owner + admins. `getOrganizationAdminsForNotification`
     * returns both OWNER and ADMIN role holders (the owner included), which
     * widens the previous owner-only alerting.
     */
    const [org, recipients] = await Promise.all([
      db.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      getOrganizationAdminsForNotification({ organizationId }),
    ]);

    const organizationName = org?.name ?? "your organization";
    const props = {
      assetTitle,
      available,
      minQuantity,
      unitOfMeasure,
      assetId,
      organizationName,
    };

    const html =
      variant === "alert"
        ? await lowStockAlertHtml(props)
        : await lowStockRecoveredHtml(props);
    const text =
      variant === "alert"
        ? lowStockAlertText(props)
        : lowStockRecoveredText(props);
    const subject =
      variant === "alert"
        ? `Low stock alert: ${assetTitle}`
        : `Back in stock: ${assetTitle}`;

    for (const recipient of recipients) {
      if (!recipient.email) {
        continue;
      }
      try {
        sendEmail({ to: recipient.email, subject, html, text });
      } catch (cause) {
        /** One bad recipient must not break the loop or the caller. */
        Logger.error(
          new ShelfError({
            cause,
            message: "Failed to send low-stock email to a recipient",
            additionalData: {
              assetId,
              organizationId,
              recipientId: recipient.id,
            },
            label: "Notification",
          })
        );
      }
    }
  } catch (cause) {
    /** Email failure should not break the (already-committed) operation. */
    Logger.error(
      new ShelfError({
        cause,
        message: `Failed to send low-stock ${variant} emails`,
        additionalData: { assetId, organizationId },
        label: "Notification",
      })
    );
  }
}

/**
 * Debounced, state-transition low-stock notifier for a quantity-tracked asset.
 *
 * Reads the asset's committed state, computes availability, and — depending on
 * whether it crossed INTO or OUT OF the low-stock band since the last
 * notification — fires the alert, fires the recovered notice, or does nothing.
 * Safe to call after ANY stock-changing mutation (adjustment, custody assign,
 * booking check-in decrement, asset-edit quantity drop). Must be called AFTER
 * the mutation transaction commits — it reads committed state and its own
 * marker write must never be able to roll back the mutation.
 *
 * Does nothing (beyond clearing a stale marker) if:
 * - The asset does not exist
 * - The asset is not QUANTITY_TRACKED
 * - No minQuantity threshold is configured
 *
 * @param params.assetId - The ID of the asset to check
 * @param params.userId - The user who performed the action; recipient of the
 *   in-app notification. Optional/nullable: some flows (e.g. a system-triggered
 *   booking check-in) have no acting user — the email still goes out, only the
 *   in-app sender is skipped.
 * @param params.organizationId - The organization owning the asset (org-scopes
 *   the lookup and resolves the email recipients)
 */
export async function checkAndNotifyLowStock({
  assetId,
  userId,
  organizationId,
}: {
  assetId: string;
  userId?: string | null;
  organizationId: string;
}): Promise<void> {
  const asset = await db.asset.findFirst({
    // org-scoped: scope the low-stock lookup to the caller's org
    // (cross-org IDOR guard).
    where: { id: assetId, organizationId },
    select: {
      id: true,
      title: true,
      quantity: true,
      minQuantity: true,
      unitOfMeasure: true,
      type: true,
      lowStockNotifiedAt: true,
    },
  });

  /** Bail out if the asset doesn't exist or isn't quantity-tracked */
  if (!asset || asset.type !== "QUANTITY_TRACKED") {
    return;
  }

  /**
   * No threshold configured. If a stale marker is set (the asset was
   * previously low, then had its threshold cleared), clear it silently — a
   * threshold-less asset can't be "low", so no recovered notice is warranted.
   */
  if (asset.minQuantity == null) {
    if (asset.lowStockNotifiedAt != null) {
      try {
        await db.asset.update({
          where: { id: assetId, organizationId },
          data: { lowStockNotifiedAt: null },
        });
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Failed to clear stale low-stock marker",
            additionalData: { assetId, organizationId },
            label: "Notification",
          })
        );
      }
    }
    return;
  }

  /** Compute available = total - inCustody */
  const custodySum = await db.custody.aggregate({
    where: { assetId },
    _sum: { quantity: true },
  });
  const available = (asset.quantity ?? 0) - (custodySum._sum.quantity ?? 0);

  /**
   * PRESERVED predicate: low iff available is at or below the threshold.
   * `minQuantity === 0` legitimately alerts at out-of-stock (available <= 0).
   */
  const isLow = available <= asset.minQuantity;
  const unitLabel = asset.unitOfMeasure ?? "units";

  if (isLow && asset.lowStockNotifiedAt == null) {
    /* ----------------------- Enter low: fire alert ----------------------- */

    /** In-app notification for the acting user (skipped when none). */
    if (userId) {
      sendNotification({
        title: "Low stock alert",
        message: `${asset.title} has ${available} ${unitLabel} available (threshold: ${asset.minQuantity})`,
        icon: { name: "coins", variant: "error" },
        senderId: userId,
      });
    }

    await sendLowStockEmails({
      variant: "alert",
      organizationId,
      assetId,
      assetTitle: asset.title,
      available,
      minQuantity: asset.minQuantity,
      unitOfMeasure: unitLabel,
    });

    /**
     * Stamp the debounce marker AFTER sending so a further decrement while the
     * asset stays low won't re-alert. Best-effort (see file header): a failed
     * stamp just means the next decrement re-fires — never a rollback.
     */
    try {
      await db.asset.update({
        where: { id: assetId, organizationId },
        data: { lowStockNotifiedAt: new Date() },
      });
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to set low-stock notified marker",
          additionalData: { assetId, organizationId },
          label: "Notification",
        })
      );
    }
  } else if (!isLow && asset.lowStockNotifiedAt != null) {
    /* ----------------- Recover: clear marker + send notice ---------------- */

    /**
     * Clear the marker FIRST so the next crossing back down can re-arm the
     * alert. Then dispatch the "back in stock" notice.
     */
    try {
      await db.asset.update({
        where: { id: assetId, organizationId },
        data: { lowStockNotifiedAt: null },
      });
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to clear low-stock notified marker",
          additionalData: { assetId, organizationId },
          label: "Notification",
        })
      );
    }

    /** In-app notification for the acting user (skipped when none). */
    if (userId) {
      sendNotification({
        title: "Back in stock",
        message: `${asset.title} is back above its threshold: ${available} ${unitLabel} available (threshold: ${asset.minQuantity})`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });
    }

    await sendLowStockEmails({
      variant: "recovered",
      organizationId,
      assetId,
      assetTitle: asset.title,
      available,
      minQuantity: asset.minQuantity,
      unitOfMeasure: unitLabel,
    });
  }
  /* else: no transition — already-notified-and-still-low, or fine-and-was-fine. */
}
