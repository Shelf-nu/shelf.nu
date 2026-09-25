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
 * The emails carry the facts an owner needs without opening the app (what
 * took the stock down, where the rest sits, what else is low). This module
 * loads those facts; `emails/low-stock-copy.ts` words them.
 *
 * THRESHOLD SEMANTICS: a threshold exists iff `minQuantity != null`, and the
 * asset is low iff `available <= minQuantity`. This intentionally treats
 * `minQuantity === 0` as a valid out-of-stock threshold (alert when nothing is
 * available). The shared `@shelf/quantity-control` `isLowStock` predicate uses
 * the same rule (only `null` disables the threshold), so this server path and
 * the package agree, and the companion app can adopt the package predicate
 * without diverging from these alerts.
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
 * @see {@link file://../../emails/low-stock-copy.ts} - email wording
 */

import type { Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import type { StockLevelEmailProps } from "~/emails/components/stock-level-email";
import { lowStockAlertHtml, lowStockAlertText } from "~/emails/low-stock-alert";
import {
  describePlacements,
  describeStockMovement,
  isFreshMovement,
  type MinimumChange,
  lowStockSubject,
  recoveredSubject,
} from "~/emails/low-stock-copy";
import {
  lowStockRecoveredHtml,
  lowStockRecoveredText,
} from "~/emails/low-stock-recovered";
import { sendEmail } from "~/emails/mail.server";
import { buildLowStockWhere } from "~/modules/asset/utils.server";
import { getOrganizationAdminsForNotification } from "~/modules/organization/service.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { resolveFormatPrefs } from "~/utils/date-format";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { SERVER_URL } from "~/utils/env";
import { ShelfError, type AdditionalData } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { resolveUserGreetingName, type UserNameFields } from "~/utils/user";

/** Which low-stock email to build and send. */
type LowStockEmailVariant = "alert" | "recovered";

/**
 * How many of the asset's newest log rows to read. One operation can write
 * several (a booking check-in writes one per disposition and booking slice),
 * and the copy module groups them; this bound only has to cover one operation.
 */
const MOVEMENT_LOG_ROWS = 50;

/**
 * Runs a read the mail can do without. A failure is logged and answers `null`,
 * so the mail still goes out with the row-less wording instead of not at all.
 *
 * Takes a thunk so a read that throws before returning its promise is caught
 * too.
 *
 * @param read - Starts the read
 * @param fact - What the read loads, for the log message
 * @param additionalData - Ids for the log entry
 */
function optionalRead<T>(
  read: () => Promise<T>,
  fact: string,
  additionalData: AdditionalData
): Promise<T | null> {
  return Promise.resolve()
    .then(read)
    .catch((cause: unknown) => {
      Logger.error(
        new ShelfError({
          cause,
          message: `Failed to load the ${fact} for a low-stock email`,
          additionalData,
          label: "Notification",
        })
      );
      return null;
    });
}

/**
 * Reads the name fields out of an activity event's actor snapshot, which is
 * JSON and so untyped at runtime.
 *
 * @param snapshot - `ActivityEvent.actorSnapshot`
 * @returns The actor's name fields, or null when the event has no actor
 */
function actorFromSnapshot(
  snapshot: Prisma.JsonValue | null
): UserNameFields | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const text = (value: Prisma.JsonValue | undefined) =>
    typeof value === "string" ? value : null;
  return {
    firstName: text(snapshot.firstName),
    lastName: text(snapshot.lastName),
    displayName: text(snapshot.displayName),
  };
}

/**
 * Turns the newest `ASSET_MIN_QUANTITY_CHANGED` event into a
 * {@link MinimumChange}. `fromValue` and `toValue` are JSON: a number, or null
 * when the asset had no minimum. An event without a numeric new minimum cannot
 * have triggered a low-stock check, so it is ignored.
 *
 * @param event - The event row, or null when there is none or the read failed
 */
function toMinimumChange(
  event: {
    occurredAt: Date;
    fromValue: Prisma.JsonValue | null;
    toValue: Prisma.JsonValue | null;
    actorSnapshot: Prisma.JsonValue | null;
  } | null
): MinimumChange | null {
  if (!event || typeof event.toValue !== "number") {
    return null;
  }
  return {
    from: typeof event.fromValue === "number" ? event.fromValue : null,
    to: event.toValue,
    createdAt: event.occurredAt,
    by: actorFromSnapshot(event.actorSnapshot),
  };
}

/**
 * Sends the low-stock alert (or back-in-stock notice) to every OWNER and ADMIN
 * of the organization, rendered once per recipient so each copy greets them,
 * names their address in the footer and prints dates in their format.
 *
 * Besides the organization and the recipients it loads the facts the mail
 * prints: the newest `ConsumptionLog` rows and the newest minimum change (what
 * happened), the asset's placements (where it is), and how many other items
 * are low. Each of those is
 * optional: a failed read is logged and the mail goes out without the fact it
 * could not load, never with a guess. When no fresh record explains the
 * change, the acting user is loaded so the mail can still say who made it.
 *
 * Resilient by design:
 *   - the whole block is wrapped in try/catch so an email failure can never
 *     break the caller (which has already committed the stock change);
 *   - each recipient's render and send is ALSO wrapped so one bad address
 *     can't abort the loop for the remaining recipients.
 *
 * @param params.variant - "alert" (crossed into low stock) or "recovered"
 * @param params.organizationId - Organization whose owner and admins receive the email
 * @param params.assetId - Asset the notice is about
 * @param params.assetTitle - Asset display title
 * @param params.available - Current available quantity (total minus in-custody)
 * @param params.minQuantity - The configured minimum-quantity threshold
 * @param params.unitOfMeasure - `Asset.unitOfMeasure`; `null` and `""` mean no unit
 * @param params.inCustody - Units of the asset held in custody
 * @param params.userId - The user whose action triggered the check, if any
 */
async function sendLowStockEmails({
  variant,
  organizationId,
  assetId,
  assetTitle,
  available,
  minQuantity,
  unitOfMeasure,
  inCustody,
  userId,
}: {
  variant: LowStockEmailVariant;
  organizationId: string;
  assetId: string;
  assetTitle: string;
  available: number;
  minQuantity: number;
  unitOfMeasure: string | null;
  inCustody: number;
  userId?: string | null;
}): Promise<void> {
  try {
    const ids = { assetId, organizationId };
    const [
      org,
      recipients,
      logRows,
      placementRows,
      otherLowCount,
      minimumEvent,
    ] = await Promise.all([
      db.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, customEmailFooter: true },
      }),
      getOrganizationAdminsForNotification({ organizationId }),
      optionalRead(
        () =>
          db.consumptionLog.findMany({
            where: { assetId },
            // `id` breaks ties between rows written in the same instant.
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: MOVEMENT_LOG_ROWS,
            select: {
              category: true,
              quantity: true,
              note: true,
              createdAt: true,
              userId: true,
              performedBy: { select: USER_NAME_SELECT },
              custodianId: true,
              custodian: {
                select: { name: true, user: { select: USER_NAME_SELECT } },
              },
              booking: { select: { id: true, name: true } },
            },
          }),
        "newest consumption log rows",
        ids
      ),
      optionalRead(
        () =>
          db.assetLocation.findMany({
            where: { assetId, organizationId },
            select: { quantity: true, location: { select: { name: true } } },
          }),
        "placements",
        ids
      ),
      optionalRead(
        () =>
          db.asset.count({
            // The `lowStockOnly` list filter the mail links to, so the
            // count matches what the link shows.
            where: {
              organizationId,
              id: { not: assetId },
              ...buildLowStockWhere(),
            },
          }),
        "count of other low-stock items",
        ids
      ),
      optionalRead(
        () =>
          db.activityEvent.findFirst({
            // A minimum change writes no log row; this event is its record.
            where: {
              organizationId,
              assetId,
              action: "ASSET_MIN_QUANTITY_CHANGED",
            },
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            select: {
              occurredAt: true,
              fromValue: true,
              toValue: true,
              actorSnapshot: true,
            },
          }),
        "newest minimum change",
        ids
      ),
    ]);

    /**
     * The acting user names the change only when neither the log nor a
     * minimum change can: an old record belongs to an earlier change.
     */
    const now = new Date();
    const logs = logRows ?? [];
    const minimumChange = toMinimumChange(minimumEvent);
    const actingUser =
      userId &&
      !isFreshMovement(logs[0], now) &&
      !isFreshMovement(minimumChange, now)
        ? await optionalRead(
            () =>
              db.user.findUnique({
                where: { id: userId },
                select: USER_NAME_SELECT,
              }),
            "acting user",
            { ...ids, userId }
          )
        : null;

    const organizationName = org?.name ?? "your organization";
    /** A failed read is unknown, not "not placed": the row is left out. */
    const placements = placementRows ? describePlacements(placementRows) : null;
    const numbers = { assetTitle, available, minQuantity, unitOfMeasure };
    const subject =
      variant === "alert"
        ? lowStockSubject(numbers)
        : recoveredSubject(numbers);

    for (const recipient of recipients) {
      if (!recipient.email) {
        continue;
      }
      try {
        const prefs = resolveFormatPrefs(recipient, null);
        const props: StockLevelEmailProps = {
          ...numbers,
          recipient: {
            greetingName: resolveUserGreetingName(recipient),
            email: recipient.email,
          },
          assetId,
          organizationName,
          customEmailFooter: org?.customEmailFooter ?? null,
          movement: describeStockMovement({
            logs,
            minimumChange,
            actingUser,
            prefs,
            unitOfMeasure,
            now,
          }),
          placements,
          inCustody,
          otherLowCount: otherLowCount ?? 0,
          serverUrl: SERVER_URL,
        };
        const html =
          variant === "alert"
            ? await lowStockAlertHtml(props)
            : await lowStockRecoveredHtml(props);
        const text =
          variant === "alert"
            ? lowStockAlertText(props)
            : lowStockRecoveredText(props);

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
 * Best-effort in-app notification for the low-stock notifier.
 *
 * `sendNotification` re-throws SSE-emitter failures as a `ShelfError`. Since
 * {@link checkAndNotifyLowStock} runs AFTER a committed stock mutation and
 * several callers invoke it WITHOUT their own try/catch (e.g.
 * `api+/assets.adjust-quantity`), a notification failure must never bubble up
 * and turn a successful mutation into an error response. Mirrors the
 * already-best-effort email path in {@link sendLowStockEmails}.
 */
function notifyInAppBestEffort(
  notification: Parameters<typeof sendNotification>[0]
) {
  try {
    sendNotification(notification);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to send low-stock in-app notification",
        additionalData: { title: notification.title },
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
async function runLowStockCheck({
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
  const inCustody = custodySum._sum.quantity ?? 0;
  const available = (asset.quantity ?? 0) - inCustody;

  /**
   * PRESERVED predicate: low iff available is at or below the threshold.
   * `minQuantity === 0` legitimately alerts at out-of-stock (available <= 0).
   */
  const isLow = available <= asset.minQuantity;
  /** In-app toast wording only; the emails format units via `formatQuantity`. */
  const unitLabel = asset.unitOfMeasure ?? "units";

  if (isLow && asset.lowStockNotifiedAt == null) {
    /* ----------------------- Enter low: fire alert ----------------------- */

    /** In-app notification for the acting user (skipped when none). */
    if (userId) {
      notifyInAppBestEffort({
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
      unitOfMeasure: asset.unitOfMeasure,
      inCustody,
      userId,
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
      /**
       * The marker is still set. Skip the recovered notice: a later call will
       * retry the clear and notify once. Sending it now would re-send on every
       * subsequent mutation (each sees `!isLow && marker != null`) until a write
       * succeeds — the exact unbounded repeat the debounce marker exists to
       * prevent. A single delayed notice is safer than an email storm.
       */
      return;
    }

    /** In-app notification for the acting user (skipped when none). */
    if (userId) {
      notifyInAppBestEffort({
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
      unitOfMeasure: asset.unitOfMeasure,
      inCustody,
      userId,
    });
  }
  /* else: no transition — already-notified-and-still-low, or fine-and-was-fine. */
}

/**
 * Best-effort entry point: runs the check above and never rejects.
 *
 * Every caller invokes this AFTER its mutation has committed, so a failure
 * here cannot roll anything back — but an escaping rejection still reaches
 * the route's error handler and answers 500 for a request whose write
 * succeeded. Clients retry a 500, and the mutations behind these calls
 * (quantity check-out, adjustment, release) are not idempotent, so the retry
 * allocates a second time. A missed stock notification is recoverable; a
 * double allocation is not.
 *
 * This is the single place that guarantee lives, so call sites need no
 * try/catch of their own — and adding one back per site is how a site gets
 * missed.
 *
 * @param params - See {@link runLowStockCheck}
 */
export async function checkAndNotifyLowStock(
  params: Parameters<typeof runLowStockCheck>[0]
): Promise<void> {
  try {
    await runLowStockCheck(params);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to run the low-stock check",
        label: "Assets",
        additionalData: {
          assetId: params.assetId,
          organizationId: params.organizationId,
        },
      })
    );
  }
}
