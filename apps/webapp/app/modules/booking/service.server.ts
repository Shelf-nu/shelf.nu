/**
 * Booking Service
 *
 * The booking domain's server-side business logic — every mutation and read a
 * booking goes through, from DRAFT to ARCHIVED.
 *
 * Responsibilities:
 * - Lifecycle transitions: create, edit, reserve, check out, check in, extend,
 *   cancel, revert to draft, archive, duplicate, and their bulk counterparts.
 * - Partial check-out / check-in, including per-asset quantity dispositions for
 *   `QUANTITY_TRACKED` assets and the "how much is left" computations.
 * - Membership: standalone assets and kit-driven slices on the `BookingAsset`
 *   pivot (see `.claude/rules/kit-members-via-kit-slices.md`).
 * - The audit trail every transition leaves: system notes, `ActivityEvent`
 *   records, notification emails, and the expiry/reminder scheduler jobs.
 *
 * Two invariants worth knowing before editing:
 * - `originalFrom`/`originalTo` are the PLANNED period and are frozen once a
 *   booking starts; `from`/`to` are the live one. See
 *   `.claude/rules/booking-planned-period-is-frozen.md`.
 * - Any id that arrives from request input is org-scoped before use, per
 *   `.claude/rules/org-scope-user-supplied-ids.md`.
 *
 * @see {@link file://./lateness.ts}
 * @see {@link file://./../reports/helpers.server.ts}
 */

import {
  BookingStatus,
  AssetStatus,
  KitStatus,
  AssetType,
} from "@prisma/client";
import type {
  Booking,
  Prisma,
  Organization,
  Asset,
  Kit,
  User,
  UserOrganization,
  Tag,
  OrganizationRoles,
} from "@prisma/client";
import {
  BOOKING_EMPTY_RESERVED_MESSAGE,
  BOOKING_RESERVE_BLOCKED_LABELS,
} from "@shelf/labels";
import { isBefore } from "date-fns";
import { DateTime } from "luxon";
import { redirect } from "react-router";
import z from "zod";
import type { AuthSession } from "@server/session";
import { CheckinIntentEnum } from "~/components/booking/checkin-dialog";
import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";
import type { HeaderData } from "~/components/layout/header/types";
import type { SortingDirection } from "~/components/list/filters/sort-by";
import { partialCheckinAssetsSchema } from "~/components/scanner/drawer/uses/partial-checkin-drawer";
import { partialCheckoutAssetsSchema } from "~/components/scanner/drawer/uses/partial-checkout-drawer";
import { db, type ExtendedPrismaClient } from "~/database/db.server";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import type { BookingForEmail } from "~/emails/types";
import {
  ACTIVE_BOOKING_STATUSES,
  assertAssetQuantitiesAvailable,
  getAssetAvailability,
} from "~/modules/asset/availability.server";
import { ASSET_MODEL_IMAGE_SELECT } from "~/modules/asset/image-select";
import {
  reconcileManualPlacementsForStockDecrease,
  reportAmbiguousPlacementReconcile,
} from "~/modules/asset/placement-reconcile.server";
import {
  isDirectBookingBlockedByKit,
  isQuantityTracked,
} from "~/modules/asset/utils";
import { stripMarkdocDelimiters } from "~/modules/audit/note-content.server";
import { fulfilModelRequestsForAssets } from "~/modules/booking-model-request/service.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createConsumptionLog } from "~/modules/consumption-log/service.server";
import { assetQtyMeta, formatUnitCount } from "~/utils/asset-quantity";
import {
  bookingWriteScopeClause,
  validateBookingOwnership,
} from "~/utils/booking-authorization.server";
import { getOutstandingModelRequests } from "~/utils/booking-model-requests";
import { canUserRemoveBookingAssets } from "~/utils/bookings";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import {
  getFiltersFromRequest,
  updateCookieWithPerPage,
} from "~/utils/cookies.server";
import { calcTimeDifference } from "~/utils/date-fns";
import {
  formatDate,
  resolveFormatPrefs,
  type ResolvedFormatPrefs,
} from "~/utils/date-format";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import { getRedirectUrlFromRequest } from "~/utils/http";
import {
  payload,
  getCurrentSearchParams,
  parseData,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import {
  wrapAssetWithCountForNote,
  wrapDateForNote,
  wrapKitsForNote,
  wrapKitsWithDataForNote,
  wrapAssetsWithDataForNote,
  wrapUserLinkForNote,
  wrapLinkForNote,
  wrapBookingStatusForNote,
  wrapCustodianForNote,
  wrapDescriptionForNote,
} from "~/utils/markdoc-wrappers";
import {
  assertAssetsBelongToOrg,
  assertAssetKitsBelongToOrg,
  assertKitsBelongToOrg,
  assertTagsBelongToOrg,
  assertTeamMemberBelongsToOrg,
  assertUserBelongsToOrg,
} from "~/utils/org-validation.server";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { resolveUserDisplayName } from "~/utils/user";
import type { MergeInclude } from "~/utils/utils";
import {
  attributeDispositionsByBookingAsset,
  attributeSessionCheckoutToSlices,
  checkoutSessionsToLogsByAsset,
  compareSlicesForGreedyFill,
  computeDispatchedUnitsByAsset,
} from "./checkout-attribution";
import {
  ADDABLE_BOOKING_STATUSES,
  BOOKING_COMMON_INCLUDE,
  BOOKING_INCLUDE_FOR_EMAIL,
  BOOKING_INCLUDE_FOR_RESERVATION_EMAIL,
  BOOKING_SCHEDULER_EVENTS_ENUM,
  BOOKING_WITH_ASSETS_INCLUDE,
  BOOKINGS_LIST_ASSETS_INCLUDE,
} from "./constants";
import type {
  ReservationEmailAsset,
  ReservationEmailModelRequest,
} from "./constants";
import {
  assetReservedEmailContent,
  cancelledBookingEmailContent,
  completedBookingEmailContent,
  deletedBookingEmailContent,
  extendBookingEmailContent,
  revertedToDraftEmailContent,
  sendBookingUpdatedEmail,
  sendCheckinReminder,
} from "./email-helpers";
import {
  hasAssetBookingConflicts,
  isBookingArchivable,
  isBookingEarlyCheckin,
  isBookingEarlyCheckout,
  outranksReservations,
} from "./helpers";
import { getBookingNotificationRecipients } from "./notification-recipients.server";
import type { NotificationRecipient } from "./notification-recipients.server";
import type {
  BookingLoaderResponse,
  BookingWithExtraInclude,
  ClashingBooking,
  SchedulerData,
} from "./types";
import {
  assertBookingIsCheckinable,
  assertBookingIsOpen,
  createBookingConflictConditions,
  lockBookingForStatusCheck,
  getBulkBookingsWhereInput,
  isBookingExpired,
} from "./utils.server";
import { recordEvent, recordEvents } from "../activity-event/service.server";
import type { ActivityEventInput } from "../activity-event/types";
import {
  createSystemBookingNote,
  createSystemBookingNotes,
} from "../booking-note/service.server";
import { createNotes } from "../note/service.server";

import { TAG_WITH_COLOR_SELECT } from "../tag/constants";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Booking";

/**
 * Sends a booking email to all resolved notification recipients.
 * Each recipient gets an individual email with personalized footer.
 */
/**
 * Sends an individual personalized email to each resolved notification
 * recipient. Each email includes a per-recipient footer that explains
 * why the person received the notification (e.g., "you are the custodian",
 * "you are an admin"), driven by `recipient.reason`.
 *
 * Emails are fired concurrently (non-awaited `sendEmail` calls) to avoid
 * blocking the booking flow on slow SMTP delivery.
 *
 * Each recipient's date/time formatting is resolved from their already-loaded
 * row (the four raw pref fields on `NotificationRecipient`) via the pure
 * `resolveFormatPrefs` — no per-recipient DB fetch (avoids an N+1). The
 * `buildText`/`buildHeading` callbacks receive those resolved prefs so the
 * plain-text body and heading dates honor each recipient.
 *
 * @param recipients - Pre-resolved list from `getBookingNotificationRecipients()`
 * @param booking - The booking data used to render the email template
 * @param subject - Email subject line
 * @param buildText - Builds the plain-text body from a recipient's resolved prefs
 * @param buildHeading - Builds the HTML heading from a recipient's resolved prefs
 * @param hints - Acting user's hints — only the null-field fallback for recipients
 * @param templateProps - Additional props forwarded to the email template
 */
async function sendBookingEmailToAllRecipients({
  recipients,
  booking,
  subject,
  buildText,
  buildHeading,
  hints,
  templateProps,
}: {
  recipients: NotificationRecipient[];
  booking: BookingForEmail;
  subject: string;
  /** Built per recipient with their resolved prefs. */
  buildText: (prefs: ResolvedFormatPrefs) => string;
  /** Built per recipient with their resolved prefs. */
  buildHeading: (prefs: ResolvedFormatPrefs) => string;
  /** Acting user's hints — only the null-field fallback for recipients. */
  hints: ClientHint;
  templateProps?: {
    hideViewButton?: boolean;
    cancellationReason?: string;
    changes?: string[];
    assets?: ReservationEmailAsset[];
    modelRequests?: ReservationEmailModelRequest[];
  };
}) {
  for (const recipient of recipients) {
    // Recipient prefs resolved from the ALREADY-LOADED row (raw pref fields on
    // NotificationRecipient); hints is the null-field fallback only. Pure —
    // no per-recipient DB fetch (avoids an N+1 in the fan-out).
    const recipientPrefs = resolveFormatPrefs(recipient, hints);

    const html = await bookingUpdatesTemplateString({
      booking,
      heading: buildHeading(recipientPrefs),
      assetCount: booking._count.bookingAssets,
      prefs: recipientPrefs,
      recipientReason: recipient.reason,
      recipientEmail: recipient.email,
      ...templateProps,
    });

    sendEmail({
      to: recipient.email,
      subject,
      text: buildText(recipientPrefs),
      html,
    });
  }
}

async function cancelScheduler(
  booking: Pick<Booking, "id" | "activeSchedulerReference">
) {
  try {
    if (!booking.activeSchedulerReference) {
      Logger.error(
        `Skipping scheduler cancellation for booking ${booking.id} because no activeSchedulerReference was found.`
      );
      return;
    }

    await scheduler.cancel(booking.activeSchedulerReference);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to cancel the scheduler for booking",
        additionalData: { booking },
        label,
      })
    );
  }
}

/**
 * The value to write to `originalTo` when a flow is about to rewrite `to`.
 *
 * A booking's planned period (`originalFrom`/`originalTo`) is written while it
 * is still being planned — create, DRAFT edit, reserve — and frozen once it
 * starts. `from`/`to` are what move afterwards: extension pushes `to` out, and
 * check-in rewrites it to the actual return moment. So this only ever SEEDS
 * the column for rows created before it existed; on every other row it returns
 * `undefined`, which Prisma reads as "leave unchanged".
 *
 * Overwriting instead would discard the deadline the custodian agreed to
 * whenever a booking was extended before check-in, and Booking Compliance
 * would then measure the return against the extension rather than the plan.
 *
 * @param booking - The booking as it is BEFORE the rewrite.
 * @returns The date to seed, or `undefined` to leave `originalTo` alone.
 */
function plannedEndToPreserve(booking: {
  to: Date | null;
  originalTo: Date | null;
}): Date | undefined {
  return booking.originalTo ? undefined : booking.to ?? undefined;
}

/**
 * The value to write to `originalFrom` when a flow is about to rewrite `from`.
 *
 * The mirror of {@link plannedEndToPreserve}, for the early-check-out
 * adjust-date path. Same rule: seed only, never overwrite.
 *
 * @param booking - The booking as it is BEFORE the rewrite.
 * @returns The date to seed, or `undefined` to leave `originalFrom` alone.
 */
function plannedStartToPreserve(booking: {
  from: Date | null;
  originalFrom: Date | null;
}): Date | undefined {
  return booking.originalFrom ? undefined : booking.from ?? undefined;
}

/**
 * Records the canonical `BOOKING_STATUS_CHANGED` activity event.
 *
 * Best-effort by design, and the single implementation for every caller: the
 * status change is already committed by the time this runs, so a failed
 * analytics insert can never roll back a check-out or check-in that physically
 * happened. `resolveCheckInAt` carries the matching fallback for the rare miss
 * (COMPLETE bookings fall back to `updatedAt`).
 *
 * @param args.organizationId - Workspace the booking belongs to.
 * @param args.bookingId - Booking whose status changed.
 * @param args.userId - Actor, or null/undefined for system transitions.
 * @param args.fromStatus - Status before the change.
 * @param args.toStatus - Status after the change.
 */
async function recordBookingStatusChangedEvent({
  organizationId,
  bookingId,
  userId,
  fromStatus,
  toStatus,
}: {
  organizationId: string;
  bookingId: string;
  userId?: string | null;
  fromStatus: BookingStatus;
  toStatus: BookingStatus;
}): Promise<void> {
  try {
    await recordEvent({
      organizationId,
      actorUserId: userId ?? null,
      action: "BOOKING_STATUS_CHANGED",
      entityType: "BOOKING",
      entityId: bookingId,
      bookingId,
      field: "status",
      fromValue: fromStatus,
      toValue: toStatus,
    });
  } catch (err) {
    Logger.error(
      new ShelfError({
        cause: err,
        message: "Failed to record BOOKING_STATUS_CHANGED event",
        additionalData: { bookingId, fromStatus, toStatus },
        label,
      })
    );
  }
}

/**
 * Creates a consistent status transition note for booking activity logs
 *
 * @param bookingId - The booking ID to add the note to
 * @param organizationId - Organization the booking belongs to (enforced at note-service layer)
 * @param fromStatus - The previous booking status
 * @param toStatus - The new booking status
 * @param userId - ID of the user who performed the action (if manual)
 * @param action - Optional custom action description (e.g., "checked-out", "checked-in")
 * @param custodianUserId - Optional custodian user ID for status badge extra info
 */
export async function createStatusTransitionNote({
  bookingId,
  organizationId,
  fromStatus,
  toStatus,
  userId,
  action,
  custodianUserId,
}: {
  bookingId: string;
  organizationId: string;
  fromStatus: BookingStatus;
  toStatus: BookingStatus;
  userId?: string;
  action?: string;
  custodianUserId?: string;
}) {
  const fromStatusBadge = wrapBookingStatusForNote(fromStatus, custodianUserId);
  const toStatusBadge = wrapBookingStatusForNote(toStatus, custodianUserId);

  let content: string;

  if (userId) {
    // User-initiated transition
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    const userLink = wrapUserLinkForNote({ ...user, id: userId });

    const actionText =
      action || getActionTextFromTransition(fromStatus, toStatus);
    content = `${userLink} ${actionText}. Status changed from ${fromStatusBadge} to ${toStatusBadge}`;
  } else {
    // System-initiated transition
    const actionText = getSystemActionText(fromStatus, toStatus);
    content = `${actionText}. Status changed from ${fromStatusBadge} to ${toStatusBadge}`;
  }

  await createSystemBookingNote({
    bookingId,
    organizationId,
    content,
  });

  // Activity event — records the canonical status transition for reports.
  await recordBookingStatusChangedEvent({
    organizationId,
    bookingId,
    userId,
    fromStatus,
    toStatus,
  });
}

/**
 * Gets appropriate action text for user-initiated status transitions
 */
export function getActionTextFromTransition(
  from: BookingStatus,
  to: BookingStatus
): string {
  const transition = `${from}->${to}`;

  switch (transition) {
    case "DRAFT->RESERVED":
      return "reserved the booking";
    case "RESERVED->DRAFT":
      return "reverted booking to draft";
    case "RESERVED->CANCELLED":
    case "ONGOING->CANCELLED":
    case "OVERDUE->CANCELLED":
      return "cancelled the booking";
    case "RESERVED->ONGOING":
      return "checked-out the booking";
    case "ONGOING->COMPLETE":
    case "OVERDUE->COMPLETE":
      return "checked-in the booking";
    case "COMPLETE->ARCHIVED":
    case "RESERVED->ARCHIVED":
      return "archived the booking";
    default:
      return "changed the booking status";
  }
}

/**
 * Gets appropriate action text for system-initiated status transitions
 */
export function getSystemActionText(
  from: BookingStatus,
  to: BookingStatus
): string {
  const transition = `${from}->${to}`;

  switch (transition) {
    case "ONGOING->OVERDUE":
      return "Booking became overdue";
    case "COMPLETE->ARCHIVED":
      return "Booking was automatically archived";
    case "RESERVED->ARCHIVED":
      return "Booking was archived";
    default:
      return "Booking status changed";
  }
}

export async function scheduleNextBookingJob({
  data,
  when,
}: {
  data: SchedulerData;
  when: Date;
}) {
  try {
    const id = await scheduler.sendAfter(
      QueueNames.bookingQueue,
      data,
      {},
      when
    );
    await db.booking.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: internal scheduler bookkeeping; data.id always comes from a booking already org-validated by every caller (e.g. checkoutBooking L1265, reserveBooking L1020) and SchedulerData carries no organizationId; this only writes activeSchedulerReference, not a data read
      where: { id: data.id },
      data: { activeSchedulerReference: id },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while scheduling the next booking job.",
      additionalData: { ...data, when },
      label,
    });
  }
}

/**
 * Schedules the one-shot "auto-archive expired reservation" job for a single
 * booking, to fire `autoArchiveDays` after its end date.
 *
 * Unlike {@link scheduleNextBookingJob} this deliberately does NOT touch
 * `activeSchedulerReference` — it runs independently of the checkout / overdue /
 * auto-archive chain, so it can coexist with a booking's checkout reminder. The
 * handler self-validates at fire time, so this job is never cancelled; a stale
 * one simply no-ops.
 *
 * @see {@link file://./worker.server.ts} `autoArchiveExpiredHandler`
 */
export async function scheduleExpiryArchiveJob({
  bookingId,
  to,
  autoArchiveDays,
  hints,
  dedupe = true,
}: {
  bookingId: Booking["id"];
  to: NonNullable<Booking["to"]>;
  autoArchiveDays: number;
  hints: ClientHint;
  /**
   * Whether to attach the per-booking `singletonKey` (pg-boss keeps at most one
   * pending job per booking). Defaults to `true` for the external hooks
   * (reserve + on-enable backlog sweep) that could otherwise queue duplicates.
   *
   * The handler's own not-yet-due reschedule MUST pass `false`: it runs while
   * its job is still `active` and thus already holds that singletonKey, so a
   * keyed re-queue collides with pg-boss's unique-incomplete-job index and is
   * silently dropped — which would leave the booking never auto-archived. An
   * unkeyed enqueue can't be suppressed, and the handler's idempotent
   * re-validation bounds this to at most one extra no-op fire.
   */
  dedupe?: boolean;
}) {
  // Fire `autoArchiveDays` after the end date. A `when` in the past makes
  // pg-boss run the job on the next tick — exactly what we want when enabling
  // the setting for already-expired reservations.
  const when = new Date(to);
  when.setDate(when.getDate() + autoArchiveDays);

  await scheduler.sendAfter(
    QueueNames.bookingQueue,
    {
      id: bookingId,
      hints,
      eventType: BOOKING_SCHEDULER_EVENTS_ENUM.autoArchiveExpiredHandler,
    },
    // Per-booking singleton (external hooks only): the reserve hook and the
    // on-enable backlog sweep can both target the same booking; without this
    // they'd pile up duplicate pending jobs (queue bloat + repeated no-op
    // fires). The handler's self-reschedule opts out via `dedupe: false` —
    // it can't key against its own still-active job (see `dedupe` above).
    dedupe ? { singletonKey: `booking-auto-archive-expired:${bookingId}` } : {},
    when
  );
}

/**
 * When an org enables "auto-archive expired reservations", schedule the expiry
 * job for every currently-RESERVED booking — so the existing backlog of
 * past-due reservations is cleaned up too, not just future ones.
 */
export async function scheduleExpiryArchiveForExistingReservations({
  organizationId,
  autoArchiveDays,
  hints,
}: {
  organizationId: Organization["id"];
  autoArchiveDays: number;
  hints: ClientHint;
}) {
  const reserved = await db.booking.findMany({
    where: { organizationId, status: BookingStatus.RESERVED },
    select: { id: true, to: true },
  });

  await Promise.all(
    reserved.map((b) =>
      scheduleExpiryArchiveJob({
        bookingId: b.id,
        to: b.to,
        autoArchiveDays,
        hints,
      })
    )
  );
}

/**
 * Per-asset terminal-status reconciliation when an asset is **exiting** a
 * booking (cancel / remove-from-booking / delete-booking).
 *
 * The naive `updateMany({ status: AVAILABLE })` previously used in
 * {@link cancelBooking}, {@link removeAssets} and {@link deleteBooking} was
 * unsafe in multi-tenant inventory: an asset can simultaneously sit on a
 * different ongoing booking, OR be held by a custody record, OR both. Flipping
 * it to `AVAILABLE` from the source booking's exit silently stripped those
 * other commitments — the asset showed free on /assets even though another
 * booking still had it checked out, or a team member still had custody. Bugs
 * #96 and #99 both trace back to this leak.
 *
 * This helper mirrors the safe per-asset reconciliation already used inside
 * {@link checkinBooking} (see L3791-L3815): for the given asset, query — under
 * the SAME `tx` snapshot as the booking mutation — every OTHER booking the
 * asset is currently `ONGOING`/`OVERDUE` on, and every `Custody` row that
 * holds it. The correct terminal status is then:
 *
 *   - **`CHECKED_OUT`** — another `ONGOING`/`OVERDUE` booking still references
 *     the asset. Leave it checked out for that booking. (We do NOT downgrade
 *     to `IN_CUSTODY` here even if a custody row also exists — `CHECKED_OUT`
 *     is the stronger "asset is off-premises for a booking" signal, and the
 *     custody record is preserved independently.)
 *   - **`IN_CUSTODY`** — no other active booking, but a `Custody` row exists.
 *     The asset is held by a team member outside of any booking.
 *   - **`AVAILABLE`** — no other active booking, no custody. Safe to release
 *     back onto the shelf.
 *
 * `excludeBookingIds` is REQUIRED so the exiting bookings' own
 * about-to-be-removed `BookingAsset` rows (cancel / remove / delete) do not
 * count themselves as "another active booking" and pin the asset to
 * `CHECKED_OUT` forever. Pass EVERY booking leaving in this operation: a bulk
 * exit can drop several bookings that share an asset, and if they are not all
 * excluded, two bookings on their way out vouch for each other. Callers should
 * invoke this BEFORE deleting the exiting bookings' pivot rows so the
 * `bookingId: { notIn: excludeBookingIds }` filter does the work — OR
 * (equivalently) call it AFTER the deletes, in which case the filter is
 * redundant but harmless.
 *
 * Use this helper on every IN-flow exit path, single or bulk (cancel / remove /
 * delete). Blanket-writing `AVAILABLE` across a selection is never correct: it
 * frees assets that another live booking or a custody row still holds. The
 * RESERVED → ONGOING OUT-flow uses its own targeted `tx.asset.updateMany`
 * inline because every asset is unambiguously transitioning to `CHECKED_OUT`
 * there and no per-asset reconciliation is needed.
 *
 * @param tx - Active Prisma transaction client. Must be the same tx that
 *             writes the booking-status change / pivot deletions so the read
 *             and the status flip commit atomically.
 * @param args.assetIds - Assets exiting the booking. Each is reconciled
 *             independently; ordering does not matter.
 * @param args.excludeBookingIds - Every exiting booking's id. Excluded from
 *             the "other active bookings" count so those bookings' own rows
 *             neither block release nor vouch for one another.
 * @param args.organizationId - Active org. Used to org-scope the asset write
 *             (defence-in-depth against cross-org IDOR — see
 *             `~/utils/org-validation.server`).
 * @returns A `Map<assetId, AssetStatus>` of the status each asset was flipped
 *          to. Useful for callers that need to emit per-asset activity events
 *          or build a summary note. Assets whose computed status equals their
 *          current status are still included (the write is a no-op `update`).
 * @throws {ShelfError} If any underlying Prisma call fails.
 *
 * @see {@link checkinBooking} for the existing safe pattern this generalises
 *      (apps/webapp/app/modules/booking/service.server.ts, L3791-L3815).
 * @see {@link cancelBooking}, {@link removeAssets}, {@link deleteBooking} for
 *      the call sites that should adopt this helper.
 */
async function reconcileAssetStatusForBookingExit({
  tx,
  assetIds,
  excludeBookingIds,
  organizationId,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  assetIds: Asset["id"][];
  /**
   * Every booking leaving in this operation, not just one. A bulk exit can
   * cancel or delete several bookings that share an asset, and each of them
   * must be invisible to the others' reconciliation — otherwise two bookings
   * on their way out vouch for each other and the asset stays checked out
   * against nothing.
   */
  excludeBookingIds: Booking["id"][];
  organizationId: Organization["id"];
}): Promise<Map<Asset["id"], AssetStatus>> {
  // De-dupe up front: an asset can appear on the booking through both a kit
  // and a standalone slice, but each asset needs exactly one reconciliation.
  const uniqueAssetIds = [...new Set(assetIds)];
  const resolvedStatuses = new Map<Asset["id"], AssetStatus>();

  if (uniqueAssetIds.length === 0) return resolvedStatuses;

  try {
    /**
     * Two set-based reads for the whole batch, not two per asset. A bulk exit
     * runs inside an interactive transaction and its selection is uncapped —
     * select-all spans every page — so per-asset round trips would hold locks
     * long enough to hit the transaction timeout and roll the booking mutation
     * back with it.
     *
     * Scoped to the active tx snapshot so a concurrent booking write cannot
     * race the decision.
     */
    const [slicesStillOut, custodies] = await Promise.all([
      tx.bookingAsset.findMany({
        where: {
          assetId: { in: uniqueAssetIds },
          // Exclude the exiting bookings' own rows so they cannot pin the
          // asset, or each other.
          bookingId: { notIn: excludeBookingIds },
          booking: {
            status: {
              in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
            },
          },
          // A live booking is not by itself evidence that it holds this asset.
          // Only the slice's own markers say that: one added after checkout has
          // never left, and one already reconciled has come back. Counting
          // either would pin the asset to CHECKED_OUT with nothing in the
          // field, and no later exit could clear it. Partially returned
          // QUANTITY_TRACKED slices keep a null `checkedInAt` and so still
          // count, which is correct — some of their units are still out.
          checkedOutAt: { not: null },
          checkedInAt: null,
        },
        select: { assetId: true },
        distinct: ["assetId"],
      }),
      tx.custody.findMany({
        where: { assetId: { in: uniqueAssetIds } },
        select: { assetId: true },
        distinct: ["assetId"],
      }),
    ]);

    const heldByAnotherBooking = new Set(
      (slicesStillOut as Array<{ assetId: string }>).map((row) => row.assetId)
    );
    const heldInCustody = new Set(
      (custodies as Array<{ assetId: string }>).map((row) => row.assetId)
    );

    // Pick the strongest commitment first: CHECKED_OUT beats IN_CUSTODY beats
    // AVAILABLE. See JSDoc above for the rationale on not downgrading to
    // IN_CUSTODY when both a booking and a custody coexist.
    const assetIdsByStatus = new Map<AssetStatus, Asset["id"][]>();
    for (const assetId of uniqueAssetIds) {
      const nextStatus = heldByAnotherBooking.has(assetId)
        ? AssetStatus.CHECKED_OUT
        : heldInCustody.has(assetId)
        ? AssetStatus.IN_CUSTODY
        : AssetStatus.AVAILABLE;
      const bucket = assetIdsByStatus.get(nextStatus);
      if (bucket) {
        bucket.push(assetId);
      } else {
        assetIdsByStatus.set(nextStatus, [assetId]);
      }
      resolvedStatuses.set(assetId, nextStatus);
    }

    // One write per distinct status, so the whole batch costs at most three.
    // `updateMany` compounds `id` + `organizationId` without depending on a
    // `@@unique` constraint. Org-scope is defence-in-depth: even though the
    // asset ids originated from a booking already loaded org-scoped by every
    // caller, this filter makes the IDOR impossible to (re)introduce by a
    // future refactor. The `require-org-scope-on-id-queries` lint rule is
    // exactly what this satisfies.
    for (const [nextStatus, idsForStatus] of assetIdsByStatus) {
      await tx.asset.updateMany({
        where: { id: { in: idsForStatus }, organizationId },
        data: { status: nextStatus },
      });
    }

    return resolvedStatuses;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while reconciling asset statuses after a booking exit.",
      additionalData: {
        assetIds: uniqueAssetIds,
        excludeBookingIds,
        organizationId,
      },
      label,
    });
  }
}

async function updateBookingKitStates({
  kitIds,
  status,
  organizationId,
}: {
  kitIds: string[];
  status: KitStatus;
  /** Org that owns the booking — scopes the update so we never touch another org's kits */
  organizationId: string;
}) {
  try {
    return await db.kit.updateMany({
      where: { id: { in: kitIds }, organizationId },
      data: { status },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating the booking kit states.",
      additionalData: { kitIds, status },
      label,
    });
  }
}

export async function createBooking({
  booking,
  assetIds,
  kitSlices,
  hints,
}: {
  /**
   * Booking object that contains all the required fields to create a booking
   */
  booking: Pick<
    Booking,
    | "name"
    | "description"
    | "creatorId"
    | "custodianUserId"
    | "organizationId"
    | "from"
    | "to"
  > & { custodianTeamMemberId: string; tags: { id: string }[] };

  /**
   * Standalone asset IDs that are connected to the booking (no kit
   * attribution — these become `BookingAsset` rows with `assetKitId` NULL).
   *
   * This can happen when:
   * - Booking is created from assets bulk actions
   * - Booking is created from the asset page
   */
  assetIds: Asset["id"][];

  /**
   * Optional kit-driven slice specs — one element per `AssetKit` membership
   * to attach at creation. Each becomes a `BookingAsset` row carrying a
   * non-null `assetKitId` (the kit-source discriminator). Supplying these
   * lets a booking be created directly from a kit selection (e.g. "create
   * booking from kit"). Build them with {@link buildKitSlicesForBooking} so
   * the resolution stays org-scoped and consistent with the kit-add route.
   *
   * Carrying a LIST (not a 1:1 assetId → assetKitId map) is what lets the
   * same quantity-tracked asset belonging to multiple kits produce multiple
   * distinct kit-driven rows (the kit partial unique is on
   * `(bookingId, assetKitId)`).
   */
  kitSlices?: KitSliceSpec[];

  /**
   * Hints are used for setting the timezone of the booking
   */
  hints: ClientHint;
}) {
  try {
    const dataToCreate: Prisma.BookingCreateInput = {
      name: booking.name,
      from: booking.from,
      to: booking.to,
      description: booking.description,
      status: BookingStatus.DRAFT,
      creator: { connect: { id: booking.creatorId } },
      organization: { connect: { id: booking.organizationId } },
      /**
       * Updated original dates to user entered `from` and `to`
       * so that we can track of it later
       */
      originalFrom: booking.from,
      originalTo: booking.to,
      /**
       * Custodian team member will always be passed,
       * even if assigning to a user, so we directly connect it to the booking */
      custodianTeamMember: {
        connect: { id: booking.custodianTeamMemberId },
      },
    };

    // Normalize the optional kit-driven slices once so every downstream
    // step (create payload, org validation, events) reads the same list.
    const slices = kitSlices ?? [];

    // Dedupe the standalone ids up front. `BookingFormSchema` doesn't enforce
    // uniqueness and API / mobile payloads can repeat an id, which would
    // otherwise create duplicate standalone rows (violating the
    // `(bookingId, assetId) WHERE assetKitId IS NULL` partial unique) and
    // over-count the per-asset event qty meta below. Mirrors updateBookingAssets.
    const dedupedAssetIds = [...new Set(assetIds)];

    // Defensive INDIVIDUAL-overlap guard (mirror of updateBookingAssets): an
    // INDIVIDUAL asset is one physical unit, so it must never be written as BOTH
    // a standalone row AND a kit-driven row — that books it twice. When the same
    // INDIVIDUAL asset appears in both `assetIds` and `kitSlices`, drop it from
    // the standalone bucket and let the kit slice own it. The only current
    // caller (`bookings.new`) already subtracts kit members, so this just
    // hardens the service against future callers. QUANTITY_TRACKED is exempt (a
    // free-pool standalone slice may legitimately coexist with kit slices), so
    // we only pay for a type lookup when there is an actual overlap.
    const kitSliceAssetIds = new Set(slices.map((s) => s.assetId));
    const overlapAssetIds = dedupedAssetIds.filter((id) =>
      kitSliceAssetIds.has(id)
    );
    let individualOverlapAssetIds = new Set<string>();
    if (overlapAssetIds.length > 0) {
      const overlapTypes = await db.asset.findMany({
        where: {
          id: { in: overlapAssetIds },
          organizationId: booking.organizationId,
        },
        select: { id: true, type: true },
      });
      individualOverlapAssetIds = new Set(
        overlapTypes
          .filter((a) => a.type === AssetType.INDIVIDUAL)
          .map((a) => a.id)
      );
    }
    const standaloneCreateAssetIds = dedupedAssetIds.filter(
      (id) => !individualOverlapAssetIds.has(id)
    );

    /**
     * Standalone rows (`{ assetId }`) keep the historical shape exactly —
     * `quantity` defaults to 1 and `assetKitId` stays NULL via the schema
     * default, so the no-kit path is unchanged byte-for-byte.
     *
     * Kit-driven rows are assembled INSIDE the transaction below, because
     * their `sourceKitId` has to come from the org-scoped guard's lookup
     * rather than from the request payload — see the comment there.
     */
    const standaloneCreateRows = standaloneCreateAssetIds.map((id) => ({
      assetId: id,
    }));

    if (booking.custodianUserId) {
      dataToCreate.custodianUser = {
        connect: { id: booking.custodianUserId },
      };
    }

    if (booking.tags.length > 0) {
      dataToCreate.tags = {
        connect: booking.tags,
      };
    }

    // Use transaction to ensure booking creation and activity events are atomic
    const createdBooking = await db.$transaction(async (tx) => {
      // SECURITY (cross-org IDOR): the asset IDs, tag IDs and custodian team
      // member ID all originate from request/form input. Before connecting
      // them to the new booking we must prove they belong to the booking's
      // organization — otherwise an attacker in Org A could supply Org B's
      // IDs and link foreign-org entities into their own booking. Validation
      // runs with the active `tx` so it commits atomically with the create.
      if (dedupedAssetIds.length > 0) {
        await assertAssetsBelongToOrg(
          { assetIds: dedupedAssetIds, organizationId: booking.organizationId },
          tx
        );
      }

      // SECURITY (cross-org IDOR): kit-slice asset ids and their source
      // `AssetKit` ids also originate from request/form input and are written
      // straight onto `BookingAsset` rows. Prove both belong to the booking's
      // org before the create — otherwise an attacker could attach Org B's
      // assets/kit memberships to their own booking. Runs with the active `tx`
      // so it commits atomically with the create.
      let kitIdByAssetKitId = new Map<string, string>();
      if (slices.length > 0) {
        await assertAssetsBelongToOrg(
          {
            assetIds: slices.map((s) => s.assetId),
            organizationId: booking.organizationId,
          },
          tx
        );
        kitIdByAssetKitId = await assertAssetKitsBelongToOrg(
          {
            assetKitIds: slices.map((s) => s.assetKitId),
            organizationId: booking.organizationId,
          },
          tx
        );
      }

      /**
       * Kit-driven rows carry a non-null `assetKitId` (a plain scalar column,
       * settable directly in a nested create) plus `sourceKitId`, the durable
       * copy of the owning kit that outlives the `AssetKit` row.
       *
       * `sourceKitId` is taken from the guard's org-proven map, NEVER from
       * `slice.kitId`: that value is request input and the column's FK accepts
       * any `Kit` row in any organization, so trusting it would let a caller in
       * Org A stamp Org B's kit onto its own booking. Deriving it from the same
       * lookup that validated `assetKitId` also enforces the schema invariant
       * that the two AGREE. The map is total over the validated ids (the guard
       * throws otherwise), so `?? null` is unreachable — it only satisfies the
       * type.
       *
       * A QUANTITY_TRACKED asset may be both standalone AND a kit member (two
       * distinct rows under the two partial uniques); INDIVIDUAL overlaps were
       * already removed from the standalone bucket above.
       */
      const bookingAssetRows = [
        ...standaloneCreateRows,
        ...slices.map((s) => ({
          assetId: s.assetId,
          quantity: s.quantity,
          assetKitId: s.assetKitId,
          sourceKitId: kitIdByAssetKitId.get(s.assetKitId) ?? null,
        })),
      ];

      // Only set the nested create when there's at least one row — this covers
      // standalone-only, kit-only, and mixed inputs (and avoids an empty
      // `create: []` when neither is supplied).
      if (bookingAssetRows.length > 0) {
        dataToCreate.bookingAssets = { create: bookingAssetRows };
      }

      if (booking.tags.length > 0) {
        await assertTagsBelongToOrg(
          {
            tagIds: booking.tags.map((t) => t.id),
            organizationId: booking.organizationId,
          },
          tx
        );
      }

      await assertTeamMemberBelongsToOrg(
        {
          teamMemberId: booking.custodianTeamMemberId,
          organizationId: booking.organizationId,
        },
        tx
      );

      // SECURITY (cross-org IDOR): custodianUserId is also request input and a
      // valid team member does not prove the paired user belongs to the org.
      if (booking.custodianUserId) {
        await assertUserBelongsToOrg(
          {
            userId: booking.custodianUserId,
            organizationId: booking.organizationId,
          },
          tx
        );
      }

      const created = await tx.booking.create({
        data: dataToCreate,
        include: { ...BOOKING_COMMON_INCLUDE, organization: true },
      });

      // Activity event for booking creation - must be inside transaction
      await recordEvent(
        {
          organizationId: booking.organizationId,
          actorUserId: booking.creatorId,
          action: "BOOKING_CREATED",
          entityType: "BOOKING",
          entityId: created.id,
          bookingId: created.id,
          // Count the rows actually created (standalone + kit-driven). For the
          // no-kit path this equals `assetIds.length` (unchanged); mirrors
          // `duplicateBooking`, which counts its create payload.
          meta: { assetCount: bookingAssetRows.length },
        },
        tx
      );

      // One BOOKING_ASSETS_ADDED event per asset attached at creation —
      // standalone ids PLUS kit-member asset ids, deduped (an asset can be
      // both a standalone row and a kit member). Look up `type`/`unitOfMeasure`
      // so the event meta carries `quantity` for QUANTITY_TRACKED assets
      // (no-op for INDIVIDUAL).
      const eventAssetIds = [
        ...new Set([...dedupedAssetIds, ...slices.map((s) => s.assetId)]),
      ];
      if (eventAssetIds.length > 0) {
        const assetTypes = await tx.asset.findMany({
          where: {
            id: { in: eventAssetIds },
            organizationId: booking.organizationId,
          },
          select: { id: true, type: true, unitOfMeasure: true },
        });
        const assetTypeById = new Map(assetTypes.map((a) => [a.id, a]));

        // Sum the booked quantity per asset across every row this create is
        // responsible for: each standalone row contributes 1 (schema default —
        // `createBooking` takes no per-asset quantity input) plus each kit
        // slice's own quantity. Mirrors `updateBookingAssets` so the same
        // asset added both standalone and via N kits reports the true count.
        const addedQtyByAssetId = new Map<string, number>();
        for (const sid of dedupedAssetIds) {
          addedQtyByAssetId.set(sid, (addedQtyByAssetId.get(sid) ?? 0) + 1);
        }
        for (const slice of slices) {
          addedQtyByAssetId.set(
            slice.assetId,
            (addedQtyByAssetId.get(slice.assetId) ?? 0) + slice.quantity
          );
        }

        await recordEvents(
          eventAssetIds.map((assetId) => {
            const asset = assetTypeById.get(assetId);
            return {
              organizationId: booking.organizationId,
              actorUserId: booking.creatorId,
              action: "BOOKING_ASSETS_ADDED" as const,
              entityType: "BOOKING" as const,
              entityId: created.id,
              bookingId: created.id,
              assetId,
              meta: asset
                ? assetQtyMeta(asset, addedQtyByAssetId.get(assetId))
                : {},
            };
          }),
          tx
        );
      }

      return created;
    });

    return createdBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while trying to create or update the booking. Please try again or contact support.",
      additionalData: { booking, hints },
      label,
      shouldBeCaptured: isLikeShelfError(cause)
        ? cause.shouldBeCaptured
        : undefined,
    });
  }
}

/**
 * Used when the user clicks the save booking to simply update the booking information
 * It only updates dates & custodian if the booking is in DRAFT state
 * In other ongoing states, it just updates name and description
 */
export async function updateBasicBooking({
  id,
  name,
  from,
  to,
  custodianTeamMemberId,
  custodianUserId,
  description,
  organizationId,
  tags,
  userId,
  hints,
}: Partial<
  Pick<
    Booking,
    | "id"
    | "name"
    | "from"
    | "to"
    | "custodianTeamMemberId"
    | "custodianUserId"
    | "description"
    | "organizationId"
  >
> &
  Pick<Booking, "id" | "organizationId"> & {
    tags: { id: string }[];
    userId?: User["id"];
    hints?: ClientHint;
  }) {
  try {
    const booking = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          status: true,
          custodianUserId: true,
          custodianTeamMemberId: true,
          name: true,
          description: true,
          from: true,
          to: true,
          custodianTeamMember: {
            select: {
              id: true,
              name: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  displayName: true,
                },
              },
            },
          },
          custodianUser: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
          tags: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          status: 404,
          message:
            "Could not find booking or the booking exists in another workspace.",
          label,
        });
      });

    // Capture old custodian email before the update
    // (for custodian change scenarios)
    const oldCustodianEmail = booking.custodianUser?.email;

    // SECURITY (cross-org IDOR): tags come from form input and are connected
    // unconditionally below. Prove they belong to this organization before
    // connecting, mirroring the guard in createBooking.
    const tagIds = tags?.map((t) => t.id) ?? [];
    if (tagIds.length > 0) {
      await assertTagsBelongToOrg({ tagIds, organizationId });
    }

    const dataToUpdate: Prisma.BookingUpdateInput = {
      name,
      description,
      tags: {
        set: [],
        connect: tags,
      },
    };

    /** Booking update is not allowed for these type of status */
    const notAllowedStatus: BookingStatus[] = [
      "COMPLETE",
      "ARCHIVED",
      "CANCELLED",
    ];

    if (notAllowedStatus.includes(booking.status)) {
      throw new ShelfError({
        cause: null,
        title: "Update failed",
        message: "Booking update is not allowed at this state of booking",
        label,
      });
    }

    /**
     * Changing of booking dates and custodian is only allowed for DRAFT status
     */
    if (booking.status === BookingStatus.DRAFT) {
      dataToUpdate.from = from;
      dataToUpdate.to = to;

      // Also update the original dates to new ones
      if (from) {
        dataToUpdate.originalFrom = from;
      }

      if (to) {
        dataToUpdate.originalTo = to;
      }

      /**
       * Custodian team member should always be passed.
       * This is also validated by the schema `BookingFormSchema`.
       * However, just in case we need to check it. If its not passed, we need to throw an error to prevent silent failure and corrupted data
       */
      if (custodianTeamMemberId) {
        // SECURITY (cross-org IDOR): custodianTeamMemberId comes from form
        // input. Prove the team member belongs to this booking's
        // organization before connecting it, so an attacker cannot assign a
        // foreign-org team member as the custodian.
        await assertTeamMemberBelongsToOrg({
          teamMemberId: custodianTeamMemberId,
          organizationId,
        });

        dataToUpdate.custodianTeamMember = {
          connect: { id: custodianTeamMemberId },
        };

        /**
         * If a userId is passed, meaning the team member is connected to a user, we connct to it.
         * This will override the value if there were any previous custodians`
         */
        if (custodianUserId) {
          // SECURITY (cross-org IDOR): custodianUserId is request input; a
          // valid team member does not prove the paired user is in this org.
          await assertUserBelongsToOrg({
            userId: custodianUserId,
            organizationId,
          });
          dataToUpdate.custodianUser = {
            connect: { id: custodianUserId },
          };
        } else if (booking.custodianUserId) {
          /**
           * If previous booking custodian had a user, we need to remove it
           * because we are now connecting to an NRM. If we dont do this the teamMemberID and the userId will be connected to different entities
           */
          dataToUpdate.custodianUser = {
            disconnect: true,
          };
        }
      } else {
        throw new ShelfError({
          cause: null,
          title: "Update failed",
          message:
            "Custodian team member is required to update booking. This should not happen. Please refresh the page and try agian. If the issue persists, contact support",
          label,
        });
      }
    }

    const updatedBooking = await db.booking.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L619; this is the write on that same proven id
      where: { id: booking.id },
      data: dataToUpdate,
    });

    // BOOKING ACTIVITY LOG: Create separate notes for each change
    // This approach creates individual notes for each field change with proper user attribution

    // Get user data for attribution if userId is provided
    const user = userId
      ? await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        })
      : null;
    const userLink = user ? wrapUserLinkForNote(user) : "**System**";

    // Collect plain-text change descriptions for the email
    const changes: string[] = [];

    // Acting-user compromise: the embedded change list uses the editor's
    // resolved prefs (rebuilding the diff per recipient is disproportionate).
    const actingPrefs = userId
      ? await resolveUserFormatPrefsById(userId, hints ?? null)
      : null;

    // Helper to format dates for email change descriptions
    const formatDateForEmail = (date: Date) =>
      actingPrefs
        ? formatDate(date, actingPrefs, { includeTime: true })
        : date.toISOString();

    // Check and log name changes
    if (name && name !== booking.name) {
      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
        content: `${userLink} changed booking name from **${stripMarkdocDelimiters(
          booking.name
        )}** to **${stripMarkdocDelimiters(name)}**.`,
      });
      changes.push(`Booking name changed from "${booking.name}" to "${name}"`);
    }

    // Check and log description changes
    if (description !== undefined && description !== booking.description) {
      const oldDesc = booking.description || "(empty)";
      const newDesc = description || "(empty)";

      const descriptionChange = wrapDescriptionForNote(oldDesc, newDesc);

      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
        content: `${userLink} changed booking description from ${descriptionChange}.`,
      });
      changes.push("Booking description was updated");
    }

    // Check and log start date changes
    const fromDateChanged =
      !!from && !!booking.from && from.getTime() !== booking.from.getTime();
    if (fromDateChanged) {
      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
        content: `${userLink} changed booking start date from ${wrapDateForNote(
          booking.from!
        )} to ${wrapDateForNote(from!)}.`,
      });
      changes.push(
        `Start date changed from ${formatDateForEmail(
          booking.from!
        )} to ${formatDateForEmail(from!)}`
      );
    }

    // Check and log end date changes
    const toDateChanged =
      !!to && !!booking.to && to.getTime() !== booking.to.getTime();
    if (toDateChanged) {
      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
        content: `${userLink} changed booking end date from ${wrapDateForNote(
          booking.to!
        )} to ${wrapDateForNote(to!)}.`,
      });
      changes.push(
        `End date changed from ${formatDateForEmail(
          booking.to!
        )} to ${formatDateForEmail(to!)}`
      );
    }

    /**
     * Activity events for date changes — one event per field that
     * actually changed (per `record-event-payload-shapes.md`). Best-effort
     * post-tx: matches the surrounding note-write location and avoids
     * blocking the user's update on event persistence. The notes above
     * still ship even if the event write fails.
     */
    try {
      if (fromDateChanged) {
        await recordEvent({
          organizationId,
          actorUserId: userId ?? null,
          action: "BOOKING_DATES_CHANGED",
          entityType: "BOOKING",
          entityId: booking.id,
          bookingId: booking.id,
          field: "from",
          fromValue: booking.from!.toISOString(),
          toValue: from!.toISOString(),
        });
      }
      if (toDateChanged) {
        await recordEvent({
          organizationId,
          actorUserId: userId ?? null,
          action: "BOOKING_DATES_CHANGED",
          entityType: "BOOKING",
          entityId: booking.id,
          bookingId: booking.id,
          field: "to",
          fromValue: booking.to!.toISOString(),
          toValue: to!.toISOString(),
        });
      }
    } catch (err) {
      Logger.error(
        new ShelfError({
          cause: err,
          message: "Failed to record updateBasicBooking date events",
          additionalData: { bookingId: booking.id },
          label,
        })
      );
    }

    // Check and log custodian changes
    if (
      custodianTeamMemberId &&
      custodianTeamMemberId !== booking.custodianTeamMemberId
    ) {
      // Build custodian name helpers for the email change description
      const oldCustodianName = booking.custodianUser
        ? resolveUserDisplayName(booking.custodianUser)
        : booking.custodianTeamMember?.name ?? "Unknown";

      try {
        // Fetch new custodian details.
        // SECURITY (cross-org IDOR): scope the lookup to this booking's
        // organization so a foreign-org team member cannot be resolved and
        // surfaced in the activity note.
        const newCustodian = await db.teamMember.findFirst({
          where: { id: custodianTeamMemberId, organizationId },
          select: {
            id: true,
            name: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        });

        if (newCustodian) {
          let custodianChangeMessage = `${userLink} changed booking custodian`;

          // Format old custodian (if exists)
          if (booking.custodianTeamMember) {
            const oldCustodianFormatted = wrapCustodianForNote({
              teamMember: booking.custodianTeamMember,
            });
            custodianChangeMessage += ` from ${oldCustodianFormatted}`;
          }

          // Format new custodian
          const newCustodianFormatted = wrapCustodianForNote({
            teamMember: newCustodian,
          });
          custodianChangeMessage += ` to ${newCustodianFormatted}.`;

          await createSystemBookingNote({
            bookingId: booking.id,
            organizationId,
            content: custodianChangeMessage,
          });

          const newCustodianName = newCustodian.user
            ? resolveUserDisplayName(newCustodian.user)
            : newCustodian.name;
          changes.push(
            `Custodian changed from ${oldCustodianName} to ${newCustodianName}`
          );
        }
      } catch (_error) {
        // If we can't fetch custodian details (e.g., in tests), fall back to generic message
        await createSystemBookingNote({
          bookingId: booking.id,
          organizationId,
          content: `${userLink} changed booking custodian assignment.`,
        });
        changes.push("Custodian assignment was changed");
      }
    }

    // Check and log tag changes
    const oldTagIds = booking.tags.map((tag) => tag.id).sort();
    const newTagIds = tags.map((tag) => tag.id).sort();

    if (JSON.stringify(oldTagIds) !== JSON.stringify(newTagIds)) {
      // Get tag names for better readability
      // Tag names are free-form user input and land in Markdoc-rendered note
      // content as literal text, so strip tag delimiters from each.
      const oldTagNames =
        booking.tags
          .map((tag) => stripMarkdocDelimiters(tag.name))
          .join(", ") || "(none)";

      // Get new tag names - we need to fetch them since we only have IDs
      const newTags = await db.tag.findMany({
        where: { id: { in: newTagIds }, organizationId },
        select: { name: true },
      });
      const newTagNames =
        newTags.map((tag) => stripMarkdocDelimiters(tag.name)).join(", ") ||
        "(none)";

      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
        content: `${userLink} changed booking tags from **${oldTagNames}** to **${newTagNames}**.`,
      });
      changes.push(`Tags changed from "${oldTagNames}" to "${newTagNames}"`);
    }

    // Send email notification to custodian(s) about the changes
    if (changes.length > 0 && hints && userId) {
      const custodianChanged =
        custodianTeamMemberId &&
        custodianTeamMemberId !== booking.custodianTeamMemberId;

      void sendBookingUpdatedEmail({
        bookingId: booking.id,
        organizationId,
        userId,
        changes,
        hints,
        oldCustodianEmail: custodianChanged
          ? oldCustodianEmail ?? undefined
          : undefined,
      });
    }

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      title: "Update failed",
      message: isLikeShelfError(cause)
        ? cause.message
        : "Could not update the details of booking",
    });
  }
}

/**
 * Changes the status of a booking to RESERVED
 */
export async function reserveBooking({
  id,
  name,
  from,
  to,
  custodianTeamMemberId,
  custodianUserId,
  description,
  organizationId,
  hints,
  isSelfServiceOrBase,
  tags,
  userId,
}: Partial<
  Pick<
    Booking,
    | "id"
    | "name"
    | "from"
    | "to"
    | "custodianTeamMemberId"
    | "custodianUserId"
    | "description"
    | "organizationId"
  >
> &
  Pick<Booking, "id" | "organizationId"> & {
    hints: ClientHint;
    isSelfServiceOrBase: boolean;
    tags: { id: string }[];
    userId?: User["id"];
  }) {
  try {
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          ...BOOKING_INCLUDE_FOR_RESERVATION_EMAIL,
          bookingAssets: {
            include: {
              asset: {
                select: {
                  ...BOOKING_INCLUDE_FOR_RESERVATION_EMAIL.bookingAssets.include
                    .asset.select,
                  status: true,
                  // why: `availableToBook` is deliberately NOT selected here.
                  // The availability guard reads it through `tx` immediately
                  // before the status write (see the transaction below); this
                  // outer read happens before the working-hours and settings
                  // queries, so its copy would be stale at exactly the moment
                  // it mattered.
                  // Needed for the QUANTITY_TRACKED windowed-availability
                  // guard's shortfall message (see the DRAFT → RESERVED
                  // transaction below).
                  unitOfMeasure: true,
                  bookingAssets: {
                    ...createBookingConflictConditions({
                      currentBookingId: id,
                      fromDate: from,
                      toDate: to,
                    }),
                    select: {
                      id: true,
                      quantity: true,
                      booking: {
                        select: { id: true, status: true, name: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found. Are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    /**
     * Guard: reserveBooking is `DRAFT → RESERVED` only. Without this
     * check, clicking Reserve on an already-RESERVED booking (e.g.
     * from a stale tab) re-runs the entire action and writes a
     * spurious `"Reserved → Reserved"` status-transition note into
     * the activity log — plus sends another reservation email and
     * re-schedules jobs. Refuse the no-op up front.
     */
    if (bookingFound.status !== BookingStatus.DRAFT) {
      throw new ShelfError({
        cause: null,
        label,
        status: 400,
        shouldBeCaptured: false,
        message: `This booking is already ${bookingFound.status.toLowerCase()}. Only DRAFT bookings can be reserved.`,
      });
    }

    /** Server-side conflict validation to prevent race conditions */
    if (from && to && bookingFound.bookingAssets) {
      const conflictedAssets = bookingFound.bookingAssets
        .map((ba) => ba.asset)
        .filter((asset) => hasAssetBookingConflicts(asset, id));

      if (conflictedAssets.length > 0) {
        const conflictedAssetNames = conflictedAssets
          .slice(0, 3)
          .map((asset) => asset.title)
          .join(", ");
        const additionalCount =
          conflictedAssets.length > 3 ? conflictedAssets.length - 3 : 0;
        const additionalText =
          additionalCount > 0 ? ` and ${additionalCount} more` : "";

        throw new ShelfError({
          cause: null,
          label,
          title: "Booking conflict",
          message: `Cannot reserve booking. Some assets are already booked or checked out: ${conflictedAssetNames}${additionalText}. Please remove conflicted assets and try again.`,
          shouldBeCaptured: false,
        });
      }
    }

    /** Validate the booking dates */
    if (!from || !to) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking dates are missing.",
      });
    }

    /** Make sure that the start date is in future */
    if (from && isBefore(from, new Date())) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking start date should be in future.",
      });
    }

    /** Make sure that the end date is after startDate */
    if (to && isBefore(to, from)) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking end date should be after start date.",
      });
    }

    // SECURITY (cross-org IDOR): tags come from form input and are connected
    // below. Prove they belong to this organization before connecting,
    // mirroring createBooking / updateBasicBooking.
    const tagIds = tags?.map((t) => t.id) ?? [];
    if (tagIds.length > 0) {
      await assertTagsBelongToOrg({ tagIds, organizationId });
    }

    const dataToUpdate: Prisma.BookingUpdateInput = {
      status: BookingStatus.RESERVED,
      name,
      description,
      tags: {
        set: [],
        connect: tags,
      },
    };

    dataToUpdate.from = from;
    dataToUpdate.originalFrom = from;

    dataToUpdate.to = to;
    dataToUpdate.originalTo = to;

    /**
     * Custodian team member should always be passed.
     * This is also validated by the schema `BookingFormSchema`.
     * However, just in case we need to check it. If its not passed, we need to throw an error to prevent silent failure and corrupted data
     */
    if (custodianTeamMemberId) {
      // SECURITY (cross-org IDOR): custodianTeamMemberId comes from form input.
      // Prove the team member belongs to this booking's organization before
      // connecting it, mirroring updateBasicBooking / createBooking.
      await assertTeamMemberBelongsToOrg({
        teamMemberId: custodianTeamMemberId,
        organizationId,
      });

      dataToUpdate.custodianTeamMember = {
        connect: { id: custodianTeamMemberId },
      };

      /**
       * If a userId is passed, meaning the team member is connected to a user, we connct to it.
       * This will override the value if there were any previous custodians`
       */
      if (custodianUserId) {
        // SECURITY (cross-org IDOR): custodianUserId is request input; a valid
        // team member does not prove the paired user is in this org.
        await assertUserBelongsToOrg({
          userId: custodianUserId,
          organizationId,
        });
        dataToUpdate.custodianUser = {
          connect: { id: custodianUserId },
        };
      } else if (bookingFound.custodianUserId) {
        /**
         * If previous booking custodian had a user, we need to remove it
         * because we are now connecting to an NRM. If we dont do this the teamMemberID and the userId will be connected to different entities
         */
        dataToUpdate.custodianUser = {
          disconnect: true,
        };
      }
    } else {
      throw new ShelfError({
        cause: null,
        title: "Update failed",
        message:
          "Custodian team member is required to update booking. This should not happen. Please refresh the page and try agian. If the issue persists, contact support",
        label,
      });
    }

    /**
     * QUANTITY_TRACKED windowed-availability guard, run atomically with the
     * DRAFT → RESERVED status flip.
     *
     * The conflict check above (`hasAssetBookingConflicts`) only catches
     * INDIVIDUAL-asset date collisions — it always returns `false` for
     * QUANTITY_TRACKED rows (their whole premise is that several bookings
     * legitimately share the same asset's pool). Without this guard a
     * DRAFT booking whose QT asset already exceeds the windowed pool
     * (e.g. built before other bookings consumed the stock, or hand-typed
     * with too high a quantity) could commit straight to RESERVED
     * unchecked — the over-commit-on-create bug this wiring closes.
     *
     * Uses `bookingFound.bookingAssets` (already loaded above, outside the
     * tx) rather than a fresh read for WHICH assets/quantities to check —
     * mirrors `checkoutBooking`'s existing precedent (its own
     * `qtyTrackedBookingAssets`/`uniqueQtyTrackedAssetIds` are derived the
     * same way). Only the POOL read itself (`assertAssetQuantitiesAvailable`
     * → `getAssetAvailabilityBatch`) needs to be transaction-fresh and
     * lock-guarded — that's the number racing writers can change; this
     * booking's own composition cannot change concurrently through any
     * other code path while this request is in flight. Aggregates BOTH
     * standalone (`assetKitId: null`) and kit-driven `BookingAsset` rows per
     * unique asset id, since both compete for the same physical pool.
     *
     * Mirrors `checkoutBookingWritesWithinTx`'s pattern: lock every unique
     * QT asset via `lockAssetForQuantityUpdate` (serializing concurrent
     * writers on the same asset) before reading availability, all inside
     * the SAME transaction as the status write, so the read-then-decide
     * can't race a sibling reservation/checkout/quantity-adjustment.
     */
    // Only STANDALONE (free-pool) slices are validated against `bookable`.
    // Kit-driven slices (`assetKitId != null`) draw from their kit's own
    // allocation, which `getAssetAvailability` already subtracts from the pool
    // via `inKits` — validating them against the free pool too would
    // double-count and reject a booking whose kit legitimately owns those units
    // (e.g. an asset entirely allocated to a kit has `bookable = 0`, yet
    // reserving a booking that contains that kit must still succeed). Codex P1.
    const qtyTrackedBookingAssets = bookingFound.bookingAssets.filter(
      (ba) => isQuantityTracked(ba.asset) && ba.assetKitId == null
    );
    const uniqueQtyTrackedAssetIds = Array.from(
      new Set(qtyTrackedBookingAssets.map((ba) => ba.asset.id))
    );

    const updatedBooking = await db.$transaction(async (tx) => {
      /**
       * Eligibility, re-read through `tx` immediately before the status write.
       *
       * The callers check this earlier - the web overview disables its Reserve
       * button from loader flags, the mobile route refuses up front with a
       * better message - but both read the booking before the working-hours and
       * settings queries, so a concurrent edit could still land in RESERVED.
       * `availableToBook` is the one that really moves: it is an asset-level
       * flag toggled from the asset page, with nothing to do with this booking.
       *
       * This does not make the transition serializable on its own. Closing the
       * window completely would mean locking every asset in the booking, which
       * the QT path below already does for the assets whose pool is contested.
       * This narrows it to the width of the transaction.
       */
      // Constant-cost probes, not a materialised list. Both questions are
      // existence questions, and this runs inside the transaction that goes on
      // to take a per-asset advisory lock for every QT asset below — loading N
      // slices and their assets here would widen that lock window for nothing.
      const sliceCount = await tx.bookingAsset.count({
        where: { bookingId: id },
      });

      if (sliceCount === 0) {
        const modelRequestCount = await tx.bookingModelRequest.count({
          where: { bookingId: id },
        });

        if (modelRequestCount === 0) {
          throw new ShelfError({
            cause: null,
            label,
            title: "Nothing to reserve",
            message: BOOKING_RESERVE_BLOCKED_LABELS.NOTHING_TO_RESERVE,
            status: 400,
            shouldBeCaptured: false,
          });
        }
      }

      // Only worth asking when the booking actually holds assets.
      if (sliceCount > 0) {
        const unavailableSlice = await tx.bookingAsset.findFirst({
          where: { bookingId: id, asset: { availableToBook: false } },
          select: { id: true },
        });

        if (unavailableSlice) {
          throw new ShelfError({
            cause: null,
            label,
            title: "Unavailable assets",
            message: BOOKING_RESERVE_BLOCKED_LABELS.UNAVAILABLE_ASSETS,
            status: 400,
            shouldBeCaptured: false,
          });
        }
      }

      if (uniqueQtyTrackedAssetIds.length > 0) {
        const assetById = new Map(
          qtyTrackedBookingAssets.map((ba) => [ba.asset.id, ba.asset])
        );

        // Sum the requested units per unique QT asset across the standalone
        // BookingAsset rows that reference it (kit rows excluded above).
        const requestedQtyByAssetId = new Map<string, number>();
        for (const ba of qtyTrackedBookingAssets) {
          requestedQtyByAssetId.set(
            ba.asset.id,
            (requestedQtyByAssetId.get(ba.asset.id) ?? 0) + ba.quantity
          );
        }

        // Acquire locks in a deterministic (sorted) global order so two
        // concurrent transactions touching the same assets can never deadlock
        // by locking them in opposite orders. Mirrors `updateBookingAssets`
        // and the checkout guard.
        for (const assetId of [...uniqueQtyTrackedAssetIds].sort()) {
          await lockAssetForQuantityUpdate(tx, assetId, organizationId);
        }

        await assertAssetQuantitiesAvailable(
          uniqueQtyTrackedAssetIds.map((assetId) => ({
            assetId,
            requestedQuantity: requestedQtyByAssetId.get(assetId) ?? 0,
            assetTitle: assetById.get(assetId)?.title ?? "",
            unitOfMeasure: assetById.get(assetId)?.unitOfMeasure,
          })),
          {
            organizationId,
            tx,
            window: from && to ? { from, to } : null,
            excludeBookingId: id,
          }
        );
      }

      return tx.booking.update({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingFound id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L1020; this is the write on that same proven id
        where: { id: bookingFound.id },
        data: dataToUpdate,
      });
    });

    /** Calculate the time difference between the booking.to and the current time */
    const { hours } = calcTimeDifference(updatedBooking.from!, new Date());
    const moreThanOneHourToCheckOut = hours > 1;

    /**
     * We send the checkout reminder, when there is 1 h left to booking.from
     * This is to make sure that the user is reminded to check out the booking
     *
     * If there is more than 1 hour to check out, we need to schedule the reminder
     * else we don't need to send a reminder
     * Start the reminder scheduler
     * */

    if (moreThanOneHourToCheckOut) {
      const when = new Date(from);
      when.setHours(when.getHours() - 1); // send the reminder 1 hour before the booking starts

      await scheduleNextBookingJob({
        data: {
          id: bookingFound.id,
          hints,
          eventType: BOOKING_SCHEDULER_EVENTS_ENUM.checkoutReminder,
        },
        when,
      });
    }

    /**
     * If the org auto-archives expired reservations, schedule the one-shot
     * archive job for this booking (end date + grace). Independent of the
     * checkout-reminder slot; the handler self-validates, so we never cancel it.
     */
    const expiryArchiveSettings = await db.bookingSettings.findUnique({
      where: { organizationId },
      select: { autoArchiveExpiredReservations: true, autoArchiveDays: true },
    });
    if (expiryArchiveSettings?.autoArchiveExpiredReservations) {
      // Best-effort: the booking is already persisted as RESERVED, so a
      // scheduler/queue hiccup must not fail the reservation. Log and continue —
      // the job is re-established if the org re-toggles the setting.
      try {
        await scheduleExpiryArchiveJob({
          bookingId: bookingFound.id,
          to,
          autoArchiveDays: expiryArchiveSettings.autoArchiveDays,
          hints,
        });
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message:
              "Failed to schedule auto-archive-expired job after reserving booking",
            additionalData: { bookingId: bookingFound.id, organizationId },
            label,
            shouldBeCaptured: false,
          })
        );
      }
    }

    // Resolve notification recipients and send emails.
    // Pass isSelfServiceOrBase so admin broadcast only fires for
    // reservations made by base/self-service users (pickup requests).
    const recipients = await getBookingNotificationRecipients({
      booking: bookingFound,
      eventType: "RESERVATION",
      organizationId,
      editorUserId: userId,
      isSelfServiceOrBase,
    });

    if (recipients.length > 0) {
      const custodian = bookingFound?.custodianUser
        ? resolveUserDisplayName(bookingFound.custodianUser)
        : bookingFound.custodianTeamMember?.name ?? "";

      // Only forward outstanding requests so the email doesn't render
      // fulfilled historical rows. `fulfilledAt
      // IS NULL` is the canonical outstanding filter in the new schema;
      // each row shows the STILL-PENDING unit count
      // (`quantity - fulfilledQuantity`).
      const outstandingModelRequests = bookingFound.modelRequests
        .filter((req) => req.fulfilledAt === null)
        .map((req) => ({
          quantity: req.quantity - req.fulfilledQuantity,
          modelName: req.assetModel.name,
        }));

      await sendBookingEmailToAllRecipients({
        recipients,
        booking: bookingFound,
        subject: `✅ Booking reserved (${bookingFound.name}) - shelf.nu`,
        buildText: (prefs) =>
          assetReservedEmailContent({
            bookingName: bookingFound.name,
            assetsCount: bookingFound._count.bookingAssets,
            custodian,
            from,
            to,
            prefs,
            bookingId: bookingFound.id,
            customEmailFooter: bookingFound.organization.customEmailFooter,
            modelRequests: outstandingModelRequests,
          }),
        buildHeading: () => `Booking reservation for ${custodian}`,
        hints,
        templateProps: {
          assets: bookingFound.bookingAssets,
          // Forward any outstanding `BookingModelRequest` rows so the
          // reservation email can render a "Requested models" section.
          // The include widening on
          // `BOOKING_INCLUDE_FOR_RESERVATION_EMAIL` guarantees
          // `modelRequests` is present on the loaded booking.
          modelRequests: bookingFound.modelRequests,
        },
      });
    }

    // Add activity log for status change to RESERVED
    await createStatusTransitionNote({
      bookingId: updatedBooking.id,
      organizationId,
      fromStatus: bookingFound.status,
      toStatus: updatedBooking.status,
      userId,
      custodianUserId: updatedBooking.custodianUserId || undefined,
    });

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Could not reserve the booking.",
    });
  }
}

/**
 * Schedules the post-checkout check-in reminder (and overdue handler) for a
 * booking that has just transitioned into an active (ONGOING) state.
 *
 * Extracted from {@link checkoutBooking}'s scheduler tail so the progressive
 * (partial) checkout path can reuse the exact same scheduling behaviour when
 * its first scan flips the booking to ONGOING. Callers must only invoke this
 * for NON-expired bookings (expired bookings go straight to OVERDUE and need no
 * reminder). The booking is re-hydrated internally with the email-include shape
 * so callers don't need to supply a full `BookingForEmail`.
 *
 * Behaviour:
 * - If less than 1 hour remains until `to`, the check-in reminder is sent
 *   immediately and an overdue handler is scheduled for `to`.
 * - Otherwise the check-in reminder is scheduled for 1 hour before `to`.
 *
 * @param booking - The effective (post-checkout) booking; must include `id` and
 *   a non-null `to`
 * @param hints - Client hints forwarded to the scheduled jobs and email
 * @param organizationId - Booking's organization (for recipient resolution)
 */
async function scheduleCheckinReminderForBooking(
  booking: { id: string; to: Date | null },
  hints: ClientHint,
  organizationId: string
) {
  const effectiveTo = booking.to;
  if (!effectiveTo) {
    return;
  }

  /** Calculate the time difference between the booking.to and the current time */
  const { hours } = calcTimeDifference(effectiveTo, new Date());
  const lessThanOneHourToCheckin = hours < 1;

  // For any checkout (early or not), what matters is time until check-in.
  /**
   * If less than 1 hour until check-in time, then
   * send checkin reminder immediately.
   * We also schedule the overdue handler for the booking
   */
  if (lessThanOneHourToCheckin) {
    // Re-hydrate the email-shaped booking only when we actually need to email.
    // BOOKING_INCLUDE_FOR_EMAIL carries `_count.bookingAssets` used for the email body.
    const bookingForEmail = await db.booking.findUniqueOrThrow({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: caller already org-checked this booking id before invoking the helper
      where: { id: booking.id },
      include: BOOKING_INCLUDE_FOR_EMAIL,
    });

    await sendCheckinReminder(
      bookingForEmail,
      bookingForEmail._count.bookingAssets,
      hints,
      organizationId
    );

    const when = new Date(effectiveTo);
    await scheduleNextBookingJob({
      data: {
        id: booking.id,
        hints,
        eventType: BOOKING_SCHEDULER_EVENTS_ENUM.overdueHandler,
      },
      when,
    });
  } else {
    /**
     * If the checkout is performed more than 1 hour before booking.to
     * the checkout reminder has not been sent yet
     * So we need to cancel it and manually schedule check-in reminder
     */
    const when = new Date(effectiveTo);
    when.setHours(when.getHours() - 1); // send the reminder 1 hour before the booking ends
    await scheduleNextBookingJob({
      data: {
        id: booking.id,
        hints,
        eventType: BOOKING_SCHEDULER_EVENTS_ENUM.checkinReminder,
      },
      when,
    });
  }
}

/**
 * Transaction-body helper shared by {@link checkoutBooking} and
 * {@link fulfilModelRequestsAndCheckout}.
 *
 * Runs the write-side of the RESERVED → ONGOING transition under the
 * caller's transaction:
 *   1. Re-reads `BookingModelRequest` rows with `quantity > 0` and throws
 *      a 400 `ShelfError` if any remain (hard block — model requests must
 *      all be fulfilled before checkout).
 *   2. For every QUANTITY_TRACKED booking asset, acquires a row lock and
 *      validates available pool capacity inside the tx — closes the TOCTOU
 *      window against sibling writers (other checkouts, custody
 *      assignments, quantity adjustments).
 *   3. Flips the checked-out assets + kits to `CHECKED_OUT` and updates
 *      the booking row with `dataToUpdate` (status + optional adjusted
 *      dates).
 *
 * Extracted so `fulfilModelRequestsAndCheckout` can compose
 * `addScannedAssetsToBookingWithinTx` and this body into a single atomic
 * unit — a failure here (availability, outstanding request, etc.) rolls
 * back BookingAsset creation AND the model-request materialisation in one
 * shot.
 *
 * @param tx - Prisma transaction client
 * @param args.bookingId - Booking being transitioned
 * @param args.bookingAssetIds - All asset IDs currently on the booking (used to fan the CHECKED_OUT status update)
 * @param args.qtyTrackedBookingAssets - Booking-asset pairs whose asset is QUANTITY_TRACKED (used for the availability guard)
 * @param args.uniqueQtyTrackedAssetIds - Deduplicated IDs from the above list
 * @param args.dataToUpdate - Pre-computed update payload for the booking row (status, optional from/originalFrom)
 * @param args.kitIds - Kits to flip to `CHECKED_OUT`
 * @param args.hasKits - Whether the kit update should fire
 * @throws {ShelfError} 400 when any model request is unfulfilled
 * @throws {ShelfError} 400 when any QUANTITY_TRACKED asset lacks sufficient pool availability
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkoutBookingWritesWithinTx(
  tx: any,
  {
    bookingId,
    organizationId,
    bookingAssetIds,
    qtyTrackedBookingAssets,
    uniqueQtyTrackedAssetIds,
    dataToUpdate,
    kitIds,
    hasKits,
    from,
    to,
    checkedOutById,
  }: {
    bookingId: Booking["id"];
    organizationId: Booking["organizationId"];
    bookingAssetIds: Asset["id"][];
    /**
     * Acting user, stamped onto each slice's checkout marker. Nullable because
     * `checkoutBooking`'s `userId` is optional (scheduler-driven checkouts have
     * no acting user) and the column is nullable to match.
     */
    checkedOutById: string | null;
    qtyTrackedBookingAssets: Array<{
      quantity: number;
      asset: Pick<Asset, "id" | "title">;
    }>;
    uniqueQtyTrackedAssetIds: Asset["id"][];
    dataToUpdate: Prisma.BookingUpdateInput;
    kitIds: string[];
    hasKits: boolean;
    /**
     * The booking's own committed reservation window (`Booking.from`/`.to`
     * — non-nullable in the schema). Used to windowed-scope the
     * QUANTITY_TRACKED availability guard below via
     * {@link getAssetAvailability}'s `window`, so that OTHER bookings whose
     * dates don't overlap this one no longer count against it (the #2724
     * "checkout wrongly refused" bug — the previous guard summed every
     * active reservation for the asset GLOBALLY, all-time). This is
     * deliberately the booking's PERSISTED dates, not the optional
     * conflict-check override params `checkoutBooking`/
     * `fulfilModelRequestsAndCheckout` accept for early-checkout handling —
     * those gate a different, pre-tx guard.
     */
    from: Booking["from"];
    to: Booking["to"];
  }
) {
  /**
   * Checkout guard for unfulfilled `BookingModelRequest` rows. Model
   * requests (Book-by-Model) represent units that
   * were reserved at the model level but haven't been assigned to
   * a concrete asset yet. If any remain at checkout we refuse the
   * RESERVED → ONGOING transition and surface the outstanding counts
   * so the operator can either:
   *   1. put matching assets on the booking — from "Manage assets", the
   *      scanner, the asset index, or the mobile API; all of them drain
   *      the request via {@link fulfilModelRequestsForAssets}, or
   *   2. edit the requests from manage-assets (allowed while the
   *      booking is still RESERVED — see the model-request service).
   * This is a hard block — there is no force-partial escape hatch
   * because ONGOING implies "assets are physically out", which
   * unfulfilled requests directly contradict.
   *
   * Also enforced independently by `fulfilModelRequestsAndCheckout`
   * as defence in depth: the drawer disables submit while
   * `remaining > 0`, but a tampered payload would still hit this
   * guard inside the shared transaction and roll everything back.
   */
  /**
   * ONE definition of "outstanding", shared with every surface that renders it.
   *
   * This guard used to filter on `fulfilledAt: null` in SQL while the overview,
   * drawer, PDF, statistics panel and index pill all used
   * `getOutstandingModelRequests`, which additionally requires
   * `fulfilledQuantity < quantity`. Two predicates meant a row could fall in
   * the gap: fully delivered by unit count but with no completion timestamp, so
   * invisible everywhere in the UI while still hard-blocking check-out — with
   * no row on screen to edit and `removeBookingModelRequest` refusing to delete
   * it. An unrecoverable booking.
   *
   * Reading through the same helper closes the class rather than this instance
   * of it: units delivered is the truth, `fulfilledAt` is a timestamp. Fetching
   * the booking's requests and filtering in JS keeps the two in lockstep by
   * construction — Prisma cannot compare two columns in a `where`, so a SQL
   * predicate here could only ever be an approximation of the helper.
   *
   * @see {@link file://./../../utils/booking-model-requests.ts}
   */
  // Shape pinned explicitly — `tx` is typed `any` (the extended Prisma client's
  // tx type is incompatible with `Prisma.TransactionClient`), so without this
  // the helper's generic widens and `assetModel` is lost.
  type GuardModelRequest = {
    quantity: number;
    fulfilledQuantity: number;
    fulfilledAt: Date | null;
    assetModel: { name: string };
  };
  const allRequests: GuardModelRequest[] =
    await tx.bookingModelRequest.findMany({
      where: { bookingId },
      include: { assetModel: { select: { name: true } } },
    });
  const outstandingRequests =
    getOutstandingModelRequests<GuardModelRequest>(allRequests);

  if (outstandingRequests.length > 0) {
    // `tx` is typed `any` so the result shape is lost; annotate the callback.
    //
    // Report `req.quantity` (the original reservation intent), NOT
    // `quantity - fulfilledQuantity`. This throw rolls the whole tx
    // back — including the in-tx `fulfilledQuantity` increments from
    // `addScannedAssetsToBookingWithinTx`. So the number the operator
    // sees post-failure is the pre-tx outstanding count, which equals
    // `quantity` for rows whose `fulfilledAt` is still null. Showing
    // `quantity - fulfilledQuantity` here would report a mid-tx view
    // that doesn't match post-rollback reality.
    const outstanding: Array<{ assetModelName: string; remaining: number }> =
      outstandingRequests.map((req) => ({
        assetModelName: req.assetModel.name,
        remaining: req.quantity,
      }));

    const summary = outstanding
      .map((row) => `${row.remaining} × ${row.assetModelName}`)
      .join(", ");

    throw new ShelfError({
      cause: null,
      label,
      status: 400,
      shouldBeCaptured: false,
      // Names both routes out. It used to say "Scan matching assets", which
      // was the literal truth — fulfilment only happened on the scan path — and
      // left a workspace without a working scanner with no way to check the
      // booking out at all. Adding a matching asset from "Manage assets" now
      // discharges the reservation too, so the message says so.
      message: `Cannot check out — ${summary} still unassigned. Add matching assets from "Manage assets", or scan them, to fulfil the reservation.`,
      additionalData: { outstanding },
    });
  }

  /**
   * Validate quantity availability for QUANTITY_TRACKED assets.
   * Between when a booking was created and checkout, other
   * operations (custody assignments, other booking checkouts) may
   * have consumed some units. We check here — under the row lock —
   * so the user gets a clear error listing which assets need
   * their quantities adjusted before proceeding, and no two
   * concurrent writers can both pass this guard against the same
   * snapshot.
   *
   * Windowed by this booking's own `[from, to]` via
   * {@link getAssetAvailability} — NOT a global all-time sum. The prior
   * implementation (`computeBookingAvailableQuantity`) summed every
   * RESERVED/ONGOING/OVERDUE reservation for the asset regardless of
   * date, so three non-overlapping bookings of 7 against a 10-qty asset
   * would wrongly block each other's checkout (#2724). Peak-concurrent
   * sweeping (inside {@link getAssetAvailability}) only counts
   * reservations that actually overlap this booking's window.
   *
   * `getAssetAvailability` is called with `db: tx` so its reads run
   * inside this same transaction; combined with the row lock acquired
   * above, read-committed isolation guarantees that once any competing
   * writer has committed its change it is visible here, and any
   * still-open writer is blocked on the same row lock until we commit or
   * roll back.
   */
  if (uniqueQtyTrackedAssetIds.length > 0) {
    const insufficientQtyWarnings: string[] = [];

    // Sorted so concurrent transactions acquire these row locks in the same
    // global order — prevents deadlocks with `reserveBooking` /
    // `updateBookingAssets`, which lock the same assets sorted too.
    for (const assetId of [...uniqueQtyTrackedAssetIds].sort()) {
      await lockAssetForQuantityUpdate(tx, assetId, organizationId);

      const { bookable } = await getAssetAvailability({
        assetId,
        organizationId,
        window: { from, to },
        excludeBookingId: bookingId,
        db: tx,
      });

      // Sum the requested STANDALONE units for this asset on this booking.
      // Callers pre-filter `qtyTrackedBookingAssets` to `assetKitId == null`
      // slices (kit-driven units are covered by `inKits`, already reserved out
      // of `bookable`), so every row here is a free-pool request against the
      // free-pool capacity — an apples-to-apples comparison (#2790).
      const requested = qtyTrackedBookingAssets
        .filter((ba) => ba.asset.id === assetId)
        .reduce((sum, ba) => sum + ba.quantity, 0);

      if (requested > bookable) {
        const title =
          qtyTrackedBookingAssets.find((ba) => ba.asset.id === assetId)?.asset
            .title ?? "";
        insufficientQtyWarnings.push(
          `"${title}": requested ${requested}, only ${Math.max(
            0,
            bookable
          )} available in this window`
        );
      }
    }

    if (insufficientQtyWarnings.length > 0) {
      throw new ShelfError({
        cause: null,
        label,
        message: `Some quantity-tracked assets have insufficient availability:\n${insufficientQtyWarnings.join(
          "\n"
        )}\nPlease adjust quantities in the booking before checkout.`,
        shouldBeCaptured: false,
        status: 400,
      });
    }
  }

  // SECURITY (cross-org IDOR): scope the status mutation to the caller's
  // organization so it can never flip the status of an asset that lives in
  // another workspace, even if a foreign asset ID slipped into the list.
  await tx.asset.updateMany({
    where: {
      id: { in: bookingAssetIds },
      organizationId,
    },
    data: { status: AssetStatus.CHECKED_OUT },
  });

  /**
   * A quantity-tracked slice partially dispatched by progressive scans before
   * this full checkout keeps its earlier stamp, but its residual units go out
   * NOW and would otherwise leave no record of their own: dispatched units
   * are judged from session attribution wherever a slice has session units
   * (see `computeDispatchedUnitsByAsset`), so an unrecorded residue would let
   * the booking complete once just the scanned units return. Read the
   * pre-stamp state here; the matching session row is written below, after
   * the stamps.
   */
  const preStampedQtySlices = (await tx.bookingAsset.findMany({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingId was org-checked by the caller's findUniqueOrThrow({where:{id,organizationId}})
    where: {
      bookingId,
      checkedOutAt: { not: null },
      asset: { type: AssetType.QUANTITY_TRACKED },
    },
    select: { id: true, assetId: true, quantity: true, assetKitId: true },
  })) as Array<{
    id: string;
    assetId: string;
    quantity: number;
    assetKitId: string | null;
  }>;
  const checkoutTopUps: Array<{
    id: string;
    assetId: string;
    residue: number;
  }> = [];
  if (preStampedQtySlices.length > 0) {
    const priorSessions = (await tx.partialBookingCheckout.findMany({
      where: { bookingId },
      select: { assetIds: true, quantities: true, bookingAssetIds: true },
    })) as Array<{
      assetIds: string[];
      quantities: number[];
      bookingAssetIds: string[];
    }>;
    const logsByAsset = checkoutSessionsToLogsByAsset(
      priorSessions,
      () => true
    );
    const slicesByAsset = new Map<string, typeof preStampedQtySlices>();
    for (const s of preStampedQtySlices) {
      const group = slicesByAsset.get(s.assetId);
      if (group) group.push(s);
      else slicesByAsset.set(s.assetId, [s]);
    }
    for (const [assetId, group] of slicesByAsset) {
      const attributed = attributeDispositionsByBookingAsset({
        bookingAssetRows: group.map((s) => ({
          id: s.id,
          quantity: s.quantity,
          assetKitId: s.assetKitId,
        })),
        consumptionLogs: logsByAsset.get(assetId) ?? [],
      });
      for (const s of group) {
        const units = attributed.get(s.id) ?? 0;
        // Only a slice with SOME session units under-reads — a stamped slice
        // with none reads back as fully dispatched from its stamp alone.
        if (units > 0 && units < s.quantity) {
          checkoutTopUps.push({
            id: s.id,
            assetId: s.assetId,
            residue: s.quantity - units,
          });
        }
      }
    }
  }

  /**
   * Record the checkout on each slice. Together with the residue session row
   * below, this is what marks an all-at-once checkout — the path writes no
   * `PartialBookingCheckout` row for slices without prior session units — and
   * it is what the check-in guard reads to decide eligibility.
   *
   * Scoped to slices not already out so a progressive batch that ran earlier
   * keeps its own (earlier, more accurate) timestamp. Any stale check-in marker
   * is cleared: a full checkout sends the whole booking back out.
   */
  /**
   * The slices this call sends out, read while they are still identifiable —
   * the marker writes below are what distinguish them, so afterwards nothing
   * separates them from slices an earlier batch sent out.
   *
   * Two groups depart, and both count. A slice that never left is the obvious
   * one. A slice that already went out and came back IN FULL is departing
   * again: the re-out write below clears its `checkedInAt`, and its units are
   * physically gone a second time. Counting only the first group would let the
   * derived "still out" figure go negative, because the return that came
   * between the two departures is already recorded against it.
   *
   * An all-at-once checkout sends every unit of every slice it touches, so each
   * one's count grows by its full booked quantity.
   */
  const departingSlices = await tx.bookingAsset.findMany({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingId was org-checked by the caller's findUniqueOrThrow({where:{id,organizationId}})
    where: {
      bookingId,
      OR: [
        { checkedOutAt: null },
        { checkedOutAt: { not: null }, checkedInAt: { not: null } },
      ],
    },
    select: { id: true, quantity: true },
  });

  await tx.bookingAsset.updateMany({
    // Keyed on the ids read above, not on `checkedOutAt: null`, so the marker
    // write and the counter increment below cover the SAME slices. A slice
    // that went out, came back in full and is departing again has a stamped
    // `checkedOutAt`, so a `checkedOutAt: null` filter skipped it: its counter
    // grew while its `checkedInAt` stayed set, and the completion gate reads
    // that stale marker as "already reconciled" while the units are out.
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: these ids were read above from a bookingId the caller org-checked
    where: { id: { in: departingSlices.map((s: { id: string }) => s.id) } },
    data: {
      checkedOutAt: new Date(),
      checkedOutById,
      checkedInAt: null,
      checkedInById: null,
    },
  });

  /**
   * Size those departures, each slice's count becoming its full booked
   * quantity.
   *
   * Grouped by quantity because `updateMany`'s `data` takes literals only and
   * cannot name another column on the row. Real bookings carry very few
   * distinct quantities — every `INDIVIDUAL` slice is 1 — so this is a handful
   * of statements, not one per slice.
   *
   * Incremented, never assigned: the column is cumulative, so a slice on its
   * second departure adds to what its first one recorded. Only the slices read
   * above — a slice a progressive batch had partly sent out is not among them,
   * because its residue rather than its whole quantity departs now; it is
   * topped up alongside the residue session row below.
   */
  const departingSliceIdsByQuantity = new Map<number, string[]>();
  for (const slice of departingSlices) {
    const ids = departingSliceIdsByQuantity.get(slice.quantity);
    if (ids) {
      ids.push(slice.id);
    } else {
      departingSliceIdsByQuantity.set(slice.quantity, [slice.id]);
    }
  }
  for (const [quantity, sliceIds] of departingSliceIdsByQuantity) {
    await tx.bookingAsset.updateMany({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: these ids were read above from a bookingId the caller org-checked
      where: { id: { in: sliceIds } },
      data: { checkedOutQuantity: { increment: quantity } },
    });
  }

  /**
   * The residue of partially-scanned slices, recorded in BOTH places that
   * answer "how many units left", because two readers ask it differently and
   * a residue in only one of them is a disagreement rather than a record.
   *
   * The session row makes the slice's full obligation read back out of session
   * attribution (tagged per slice — no greedy ambiguity), which is what
   * completion and the lifecycle progress derive from.
   * `BookingAsset.checkedOutQuantity` is the stored counter every quantity
   * surface reads, and the departure statement above cannot carry these
   * slices: it adds a whole booked quantity, while only the residue departs
   * here. Topping it up by the same figure keeps the stored count and the
   * derived one equal.
   */
  if (checkoutTopUps.length > 0) {
    await tx.partialBookingCheckout.create({
      data: {
        bookingId,
        checkedOutById,
        assetIds: checkoutTopUps.map((t) => t.assetId),
        quantities: checkoutTopUps.map((t) => t.residue),
        bookingAssetIds: checkoutTopUps.map((t) => t.id),
        checkoutCount: checkoutTopUps.length,
      },
    });

    // A slice already counted by the departure statement is skipped here.
    // `checkoutTopUps` is derived from every stamped slice, including one that
    // went out earlier and came back IN FULL — that slice departs again whole,
    // so the statement above already added its entire booked quantity, and
    // adding a residue on top would count units that never left. Only a slice
    // still partly out reaches this loop, which is the case the residue
    // describes. Its session row is written regardless: that row records the
    // dispatch, while this counter records the units.
    const departingSliceIds = new Set(
      departingSlices.map((s: { id: string }) => s.id)
    );

    // Grouped by residue for the same reason the departure statement groups by
    // quantity: `updateMany`'s `data` takes literals and cannot name a column.
    const topUpSliceIdsByResidue = new Map<number, string[]>();
    for (const topUp of checkoutTopUps) {
      if (departingSliceIds.has(topUp.id)) continue;
      const ids = topUpSliceIdsByResidue.get(topUp.residue);
      if (ids) {
        ids.push(topUp.id);
      } else {
        topUpSliceIdsByResidue.set(topUp.residue, [topUp.id]);
      }
    }
    for (const [residue, sliceIds] of topUpSliceIdsByResidue) {
      await tx.bookingAsset.updateMany({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: these ids were read above from a bookingId the caller org-checked
        where: { id: { in: sliceIds } },
        data: { checkedOutQuantity: { increment: residue } },
      });
    }
  }

  /**
   * Slices that were already out AND reconciled return to outstanding. The
   * statement above cannot reach them — it only matches unmarked slices — and
   * leaving `checkedInAt` set would make physically-out units read as fully
   * returned, which the check-in guard then refuses.
   */
  await tx.bookingAsset.updateMany({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingId was org-checked by the caller's findUniqueOrThrow({where:{id,organizationId}})
    where: {
      bookingId,
      checkedOutAt: { not: null },
      checkedInAt: { not: null },
    },
    data: { checkedInAt: null, checkedInById: null },
  });

  await tx.booking.update({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingId already org-checked by the caller via findUniqueOrThrow({where:{id,organizationId}}); this is the write on that same proven id
    where: { id: bookingId },
    data: dataToUpdate,
    select: { id: true },
  });

  if (hasKits) {
    await tx.kit.updateMany({
      where: { id: { in: kitIds }, organizationId },
      data: { status: KitStatus.CHECKED_OUT },
    });
  }
}

/**
 * Post-commit side-effects shared by {@link checkoutBooking} and
 * {@link fulfilModelRequestsAndCheckout}.
 *
 * These operations MUST run after the checkout transaction has committed
 * — they touch external systems (scheduler) and write notes that should
 * reflect the post-commit truth.
 *
 *   1. Writes the RESERVED → ONGOING/OVERDUE status transition note.
 *   2. Cancels any outstanding scheduler job for the booking.
 *   3. Either sends the check-in reminder now (if under an hour to
 *      booking.to) + schedules the overdue handler, or schedules the
 *      check-in reminder for ~1h before booking.to.
 *   4. Hydrates and returns the full booking payload.
 *
 * @returns The hydrated booking row with reservation-email includes.
 */
async function runCheckoutSideEffects({
  bookingFound,
  userId,
  effectiveStatus,
  effectiveTo,
  hints,
  organizationId,
  isExpired,
}: {
  bookingFound: BookingForEmail;
  userId?: string;
  effectiveStatus: BookingStatus;
  effectiveTo: Date | null | undefined;
  hints: ClientHint;
  organizationId: Booking["organizationId"];
  isExpired: boolean;
}) {
  // Create status transition note. `organizationId` is required by
  // the hardened signature merged from `main` (cross-org safety
  // — every booking-note write must be scoped).
  if (userId) {
    await createStatusTransitionNote({
      bookingId: bookingFound.id,
      organizationId,
      fromStatus: bookingFound.status,
      toStatus: effectiveStatus,
      userId,
      custodianUserId: bookingFound.custodianUserId || undefined,
    });
  }

  /** We cancel just in case there is something pending */
  await cancelScheduler(bookingFound);

  /**
   * If its expired that means its status will directly go to OVERDUE,
   * so we can cancel everything and don't schedule any more events
   */
  if (isExpired) {
    return db.booking.findUniqueOrThrow({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `bookingFound.id` already org-checked via findUniqueOrThrow({where:{id,organizationId}}); this re-fetches the same proven id for the return payload
      where: { id: bookingFound.id },
      include: { ...BOOKING_INCLUDE_FOR_EMAIL, bookingAssets: true },
    });
  }

  // Delegate to the shared scheduler helper so the progressive-checkout path
  // and the full-checkout path use identical scheduling behaviour.
  await scheduleCheckinReminderForBooking(
    { id: bookingFound.id, to: effectiveTo ?? null },
    hints,
    organizationId
  );

  /** Hydrate the full booking with relations for the return payload only. */
  return db.booking.findUniqueOrThrow({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `bookingFound.id` already org-checked via findUniqueOrThrow({where:{id,organizationId}}); this re-fetches the same proven id for the return payload
    where: { id: bookingFound.id },
    include: { ...BOOKING_INCLUDE_FOR_EMAIL, bookingAssets: true },
  });
}

export async function checkoutBooking({
  id,
  organizationId,
  intentChoice,
  hints,
  from,
  to,
  userId,
}: Pick<Booking, "id" | "organizationId"> & {
  hints: ClientHint;
  intentChoice?: CheckoutIntentEnum;
  from?: Date | null;
  to?: Date | null;
  userId?: string;
}) {
  try {
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          bookingAssets: {
            include: {
              asset: {
                include: {
                  bookingAssets: {
                    ...createBookingConflictConditions({
                      currentBookingId: id,
                      fromDate: from,
                      toDate: to,
                    }),
                    select: {
                      id: true,
                      quantity: true,
                      booking: {
                        select: { id: true, status: true, name: true },
                      },
                    },
                  },
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
          ...BOOKING_INCLUDE_FOR_EMAIL,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found, are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    // Not a reported finding — the twin of D084 on the check-out side, swept
    // in because it is the same missing guard. Unlocked early exit; the
    // authoritative locked check runs inside the write transaction below.
    // Deliberately rejects only the
    // CLOSED statuses: an existing pinned test checks out a DRAFT booking, so
    // narrowing this to RESERVED would be a behaviour change rather than a
    // fix. Re-running a FULL checkout on an ONGOING booking is a separate
    // integrity problem (it re-processes every asset and duplicates events)
    // and is left alone here for the same reason.
    assertBookingIsOpen({
      status: bookingFound.status,
      operation: "check out",
      bookingId: id,
    });

    // SECURITY (defense-in-depth): reject checkout if any attached asset is
    // not in this org BEFORE any asset-derived logic runs. A legacy
    // pre-remediation cross-org link would otherwise (a) leak the foreign
    // asset's title through the conflict/custody error messages below, and
    // (b) let the booking transition while the org-scoped updateMany skips it.
    // Legitimately-created bookings (assets validated at create/add) pass.
    const bookingFoundAssetIds = [
      ...new Set(bookingFound.bookingAssets.map((ba) => ba.asset.id)),
    ];
    if (bookingFoundAssetIds.length > 0) {
      await assertAssetsBelongToOrg({
        assetIds: bookingFoundAssetIds,
        organizationId,
      });
    }

    /** Server-side conflict validation to prevent race conditions */
    if (from && to && bookingFound.bookingAssets) {
      const conflictedAssets = bookingFound.bookingAssets
        .map((ba) => ba.asset)
        .filter((asset) => hasAssetBookingConflicts(asset, id));

      if (conflictedAssets.length > 0) {
        const conflictedAssetNames = conflictedAssets
          .slice(0, 3)
          .map((asset) => asset.title)
          .join(", ");
        const additionalCount =
          conflictedAssets.length > 3 ? conflictedAssets.length - 3 : 0;
        const additionalText =
          additionalCount > 0 ? ` and ${additionalCount} more` : "";

        throw new ShelfError({
          cause: null,
          label,
          title: "Booking conflict",
          message: `Cannot check out booking. Some assets are already booked or checked out: ${conflictedAssetNames}${additionalText}. Please remove conflicted assets and try again.`,
          // Expected business-rule conflict shown to the user — a 400, not a
          // server error. Mirrors the reserve path above (was noise:
          // SHELF-WEBAPP-1KR).
          shouldBeCaptured: false,
        });
      }
    }

    /**
     * Server-side validation: Block checkout if any INDIVIDUAL asset is
     * in custody. QUANTITY_TRACKED assets can have row-level status
     * IN_CUSTODY because *some* units are operator-allocated; the
     * remaining pool is still bookable and the in-tx availability
     * check below validates the math against current custody +
     * outstanding bookings under a row lock.
     */
    const assetsInCustody = bookingFound.bookingAssets
      .map((ba) => ba.asset)
      .filter(
        (asset) =>
          !isQuantityTracked(asset) && asset.status === AssetStatus.IN_CUSTODY
      );

    if (assetsInCustody.length > 0) {
      const assetNames = assetsInCustody
        .slice(0, 3)
        .map((asset) => asset.title)
        .join(", ");
      const additionalCount =
        assetsInCustody.length > 3 ? assetsInCustody.length - 3 : 0;
      const additionalText =
        additionalCount > 0 ? ` and ${additionalCount} more` : "";

      throw new ShelfError({
        cause: null,
        label,
        title: "Assets in custody",
        message: `Cannot check out booking. Some assets are currently in custody: ${assetNames}${additionalText}. Please release custody first or remove these assets from the booking.`,
        shouldBeCaptured: false,
      });
    }

    /**
     * Identify QUANTITY_TRACKED bookingAssets upfront. Availability
     * validation happens INSIDE the transaction below, guarded by a
     * per-asset row lock, to avoid TOCTOU races with sibling writers
     * (other booking checkouts, direct custody assignments, quantity
     * adjustments) that could oversubscribe the same physical pool.
     */
    // Only STANDALONE (free-pool) slices are validated against `bookable` —
    // kit-driven slices draw from the kit's fixed allocation, which is already
    // reserved out of `bookable` via `inKits`. Counting them here would
    // double-charge those units against the standalone pool and wrongly block
    // checkout of a booking whose kit legitimately owns them (#2790: Boards had
    // 4 standalone + 3+3 in kits → "requested 10, only 4 available"). Mirrors
    // the reserve path's identical `assetKitId == null` filter above (Codex P1).
    const qtyTrackedBookingAssets = bookingFound.bookingAssets.filter(
      (ba) => isQuantityTracked(ba.asset) && ba.assetKitId == null
    );

    /**
     * This checks if the booking end date is in the past
     * We need this because sometimes the user can checkout a booking
     * that is already overdue for check in
     */
    const isExpired = isBookingExpired({ to: bookingFound.to! });

    const dataToUpdate: Prisma.BookingUpdateInput = {
      status: isExpired ? BookingStatus.OVERDUE : BookingStatus.ONGOING,
    };

    /**
     * Get the kitIds because we need them to update their status later on
     */
    const kitIds = getKitIdsByAssets(
      bookingFound.bookingAssets.map((ba) => ba.asset)
    );
    const hasKits = kitIds.length > 0;

    const isEarlyCheckout = isBookingEarlyCheckout(bookingFound.from!);

    /**
     * If user is doing an early checkout of booking then update the
     * booking's `from` date accordingly
     */
    if (
      isEarlyCheckout &&
      intentChoice === CheckoutIntentEnum["with-adjusted-date"]
    ) {
      // Keep the planned start intact; only seeds rows predating the column.
      dataToUpdate.originalFrom = plannedStartToPreserve(bookingFound);

      // Update `from` date to current date
      const fromDateStr = DateTime.fromJSDate(new Date(), {
        zone: hints.timeZone,
      }).toFormat(DATE_TIME_FORMAT);

      dataToUpdate.from = DateTime.fromFormat(fromDateStr, DATE_TIME_FORMAT, {
        zone: hints.timeZone,
      }).toJSDate();
    }

    /** Keep the transaction lean (writes only + per-asset row locks for
     * qty-tracked availability guard) to stay within the timeout. The
     * heavy read for the return payload is done after commit. This
     * prevents P2028 timeouts on bookings with many assets (262 assets in
     * Sentry SHELF-WEBAPP-1KN), so we bump the interactive-tx timeout from
     * the 5s default to 15s.
     *
     * We use the interactive (callback) form of `$transaction` so we can
     * acquire `SELECT … FOR UPDATE` row locks via
     * `lockAssetForQuantityUpdate` on each unique qty-tracked asset
     * BEFORE validating availability. This serializes concurrent writers
     * (other booking checkouts, direct custody assignments, quantity
     * adjustments) on the same asset, closing a TOCTOU window where two
     * checkouts could otherwise pass the guard against the same stale
     * snapshot and both commit. The same callback also records activity
     * events from main's audit-trail integration — atomic with the
     * checkout writes so a partial failure doesn't leave orphaned events. */
    const uniqueQtyTrackedAssetIds = Array.from(
      new Set(qtyTrackedBookingAssets.map((ba) => ba.asset.id))
    );

    // Dedupe asset ids before recording one BOOKING_CHECKED_OUT per asset —
    // a booking can carry multiple BookingAsset rows per asset.
    const uniqueCheckedOutAssetIds = Array.from(
      new Set(bookingFound.bookingAssets.map((ba) => ba.asset.id))
    );

    // Per-asset booked quantity (sum across all BookingAsset rows for the
    // same asset on this booking) — feeds `meta.quantity` on the dedup'd
    // BOOKING_CHECKED_OUT events below. No-op for INDIVIDUAL via
    // assetQtyMeta.
    const checkedOutQtyByAssetId = new Map<string, number>();
    const checkedOutAssetById = new Map<
      string,
      { type: AssetType; unitOfMeasure: string | null }
    >();
    for (const ba of bookingFound.bookingAssets) {
      checkedOutQtyByAssetId.set(
        ba.asset.id,
        (checkedOutQtyByAssetId.get(ba.asset.id) ?? 0) + ba.quantity
      );
      checkedOutAssetById.set(ba.asset.id, {
        type: ba.asset.type,
        unitOfMeasure: ba.asset.unitOfMeasure,
      });
    }

    await db.$transaction(
      async (tx) => {
        // Authoritative status check. The pre-transaction assert above is a
        // cheap early exit; THIS one is the one that holds, because it locks
        // the row and the lock is kept until this transaction commits.
        //
        // The race is not theoretical: cancelling a RESERVED booking from
        // another tab while this checkout is in flight would otherwise leave a
        // CANCELLED booking whose assets are all CHECKED_OUT.
        assertBookingIsOpen({
          status: await lockBookingForStatusCheck(tx, id, organizationId),
          operation: "check out",
          bookingId: id,
        });

        await checkoutBookingWritesWithinTx(tx, {
          bookingId: bookingFound.id,
          // SECURITY (cross-org IDOR): the helper scopes the asset/kit
          // status mutations to this org so a foreign asset id that slipped
          // into the booking's list can never be flipped.
          organizationId,
          bookingAssetIds: bookingFound.bookingAssets.map((ba) => ba.asset.id),
          qtyTrackedBookingAssets,
          uniqueQtyTrackedAssetIds,
          dataToUpdate,
          kitIds,
          hasKits,
          // Booking's own committed window — windows the QT availability
          // guard (see the doc comment on `checkoutBookingWritesWithinTx`).
          from: bookingFound.from,
          to: bookingFound.to,
          checkedOutById: userId ?? null,
        });

        // Activity events — one BOOKING_CHECKED_OUT per asset on the
        // booking. Map through the deduped asset ids so a multi-row asset
        // doesn't produce duplicate events. `meta.quantity` is the SUM of
        // per-row BookingAsset.quantity across all slices of that asset
        // (qty-tracked only; no-op for INDIVIDUAL).
        if (uniqueCheckedOutAssetIds.length > 0) {
          await recordEvents(
            uniqueCheckedOutAssetIds.map((assetId) => {
              const asset = checkedOutAssetById.get(assetId);
              const totalQty = checkedOutQtyByAssetId.get(assetId);
              return {
                organizationId,
                actorUserId: userId ?? null,
                action: "BOOKING_CHECKED_OUT" as const,
                entityType: "BOOKING" as const,
                entityId: bookingFound.id,
                bookingId: bookingFound.id,
                assetId,
                meta: asset ? assetQtyMeta(asset, totalQty) : {},
              };
            }),
            tx
          );
        }
      },
      { timeout: 15000 }
    );

    /** The post-checkout values, taken from `dataToUpdate` where it changed
     * them and from `bookingFound` otherwise. Avoids re-reading the row, and
     * keeps downstream logic (notes, scheduling) on post-checkout truth. */
    const effectiveTo =
      (dataToUpdate.to as Date | undefined) ?? bookingFound.to;
    const effectiveStatus =
      (dataToUpdate.status as BookingStatus) ?? bookingFound.status;

    // Extracted to a shared helper so `fulfilModelRequestsAndCheckout`
    // can run the same post-commit work (status transition note,
    // scheduler, reminders, hydrate) without duplicating the body.
    // `organizationId` is required for `createStatusTransitionNote` and
    // `createSystemBookingNote` — forwarded inside the helper, see
    // {@link runCheckoutSideEffects}. The helper itself delegates the
    // scheduler tail to `scheduleCheckinReminderForBooking` (shared with
    // the progressive-checkout path).
    return await runCheckoutSideEffects({
      bookingFound,
      userId,
      effectiveStatus,
      effectiveTo,
      hints,
      organizationId,
      isExpired,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while checking out booking.",
    });
  }
}

/**
 * Combined service that fulfils outstanding `BookingModelRequest` rows via
 * scanned assets AND transitions the booking from RESERVED to
 * ONGOING/OVERDUE in a single atomic transaction.
 *
 * Used by the fulfil-and-checkout drawer — the operator
 * scans the assets that satisfy their model-level reservations, optionally
 * adds off-model scans that get checked out along with everything else,
 * and clicks Check Out. The route action then delegates here instead of
 * calling `addScannedAssetsToBooking` + `checkoutBooking` sequentially,
 * because a sequential call pattern would leak half-materialised state if
 * availability validation failed AFTER requests had already been drained.
 *
 * Atomicity guarantees (all-or-nothing):
 *   - `BookingModelRequest` decrements (via `materializeModelRequestForAsset`)
 *   - `BookingAsset` row creation for the scanned assets
 *   - Booking `from`/`originalFrom` adjustment for early checkout
 *   - Booking status transition + kit/asset CHECKED_OUT flags
 *   - Outstanding-request guard (defence in depth — the drawer also
 *     blocks submit while any `remaining > 0`, but the server enforces
 *     independently in case the payload is tampered with)
 *   - QUANTITY_TRACKED availability guard (with row locks against
 *     concurrent checkouts)
 *
 * Post-commit side-effects (fired only after the tx succeeds) mirror
 * `checkoutBooking` + `addScannedAssetsToBooking`:
 *   - Activity notes for each scanned asset/kit
 *   - Status transition note
 *   - Scheduler cancellation + rescheduling (checkin-reminder / overdue)
 *   - Hydrated booking payload returned
 *
 * NOTE: this function reuses the same tx-body helpers that
 * {@link addScannedAssetsToBooking} and {@link checkoutBooking} use
 * (`addScannedAssetsToBookingWithinTx` and `checkoutBookingWritesWithinTx`)
 * so behaviour never drifts between the two code paths.
 *
 * @param args.bookingId - Booking to fulfil + check out
 * @param args.organizationId - Organisation scope for all reads/writes
 * @param args.userId - User performing the scan + checkout (attribution for notes + materialised logs)
 * @param args.assetIds - Scanned asset IDs (QRs resolved to assets). May include off-model scans; those bypass the model-request drain and land as direct BookingAssets.
 * @param args.kitIds - Optional scanned kit IDs. Kits don't participate in model requests (out of scope for Book-by-Model), so this is forwarded purely for note attribution + kit status sync.
 * @param args.checkoutIntentChoice - If `"with-adjusted-date"` and the booking is an early checkout, `booking.from` is rewritten to "now" and the original value preserved on `booking.originalFrom`. Same semantics as `checkoutBooking`'s `intentChoice`.
 * @param args.hints - Client hints used for scheduler timestamps + check-in reminder emails post-commit.
 * @param args.from - Optional booking.from for conflict detection (mirrors `checkoutBooking`'s pre-tx conflict guard).
 * @param args.to - Optional booking.to for conflict detection.
 * @returns The hydrated booking with reservation-email includes (same shape as `checkoutBooking`).
 * @throws {ShelfError} 400 if any model request remains unfulfilled after scanning (drawer also guards, server enforces).
 * @throws {ShelfError} 400 if any QUANTITY_TRACKED asset lacks pool availability.
 * @throws {ShelfError} If any asset is in custody / conflicted with another booking window.
 */
export async function fulfilModelRequestsAndCheckout({
  bookingId,
  organizationId,
  userId,
  assetIds,
  kitIds = [],
  checkoutIntentChoice,
  hints,
  from,
  to,
}: {
  bookingId: Booking["id"];
  organizationId: Booking["organizationId"];
  userId: string;
  assetIds: Asset["id"][];
  kitIds?: string[];
  checkoutIntentChoice?: CheckoutIntentEnum;
  hints: ClientHint;
  from?: Date | null;
  to?: Date | null;
}) {
  try {
    /**
     * Pre-tx: hydrate the booking with the same include shape
     * `checkoutBooking` uses so we can run the conflict + custody guards
     * against the pre-existing asset set. The newly scanned assets are
     * validated inside the tx via the availability + outstanding-request
     * guards (TOCTOU-safe).
     */
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id: bookingId, organizationId },
        include: {
          bookingAssets: {
            include: {
              asset: {
                include: {
                  bookingAssets: {
                    ...createBookingConflictConditions({
                      currentBookingId: bookingId,
                      fromDate: from,
                      toDate: to,
                    }),
                    select: {
                      id: true,
                      quantity: true,
                      booking: {
                        select: { id: true, status: true, name: true },
                      },
                    },
                  },
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
          ...BOOKING_INCLUDE_FOR_EMAIL,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found, are you sure it exists in current workspace?",
        });
      });

    /** Server-side conflict validation on pre-existing assets */
    if (from && to && bookingFound.bookingAssets) {
      const conflictedAssets = bookingFound.bookingAssets
        .map((ba) => ba.asset)
        .filter((asset) => hasAssetBookingConflicts(asset, bookingId));

      if (conflictedAssets.length > 0) {
        const conflictedAssetNames = conflictedAssets
          .slice(0, 3)
          .map((asset) => asset.title)
          .join(", ");
        const additionalCount =
          conflictedAssets.length > 3 ? conflictedAssets.length - 3 : 0;
        const additionalText =
          additionalCount > 0 ? ` and ${additionalCount} more` : "";

        throw new ShelfError({
          cause: null,
          label,
          message: `Cannot check out booking. Some assets are already booked or checked out: ${conflictedAssetNames}${additionalText}. Please remove conflicted assets and try again.`,
        });
      }
    }

    /**
     * Server-side validation: Block checkout if any INDIVIDUAL asset is
     * in custody. QUANTITY_TRACKED is exempt — see the parallel guard in
     * the other checkoutBooking path above for the full reasoning.
     */
    const assetsInCustody = bookingFound.bookingAssets
      .map((ba) => ba.asset)
      .filter(
        (asset) =>
          !isQuantityTracked(asset) && asset.status === AssetStatus.IN_CUSTODY
      );

    if (assetsInCustody.length > 0) {
      const assetNames = assetsInCustody
        .slice(0, 3)
        .map((asset) => asset.title)
        .join(", ");
      const additionalCount =
        assetsInCustody.length > 3 ? assetsInCustody.length - 3 : 0;
      const additionalText =
        additionalCount > 0 ? ` and ${additionalCount} more` : "";

      throw new ShelfError({
        cause: null,
        label,
        title: "Assets in custody",
        message: `Cannot check out booking. Some assets are currently in custody: ${assetNames}${additionalText}. Please release custody first or remove these assets from the booking.`,
        shouldBeCaptured: false,
      });
    }

    const isExpired = isBookingExpired({ to: bookingFound.to! });
    const isEarlyCheckout = isBookingEarlyCheckout(bookingFound.from!);

    /**
     * Build the booking update payload (status + optional early-date
     * adjustment). We intentionally match `checkoutBooking`'s existing
     * timezone-aware date rewrite so the two code paths produce
     * byte-identical `from`/`originalFrom` values when the operator
     * chooses `"with-adjusted-date"`.
     */
    const dataToUpdate: Prisma.BookingUpdateInput = {
      status: isExpired ? BookingStatus.OVERDUE : BookingStatus.ONGOING,
    };

    if (
      isEarlyCheckout &&
      checkoutIntentChoice === CheckoutIntentEnum["with-adjusted-date"]
    ) {
      // Keep the planned start intact; only seeds rows predating the column.
      dataToUpdate.originalFrom = plannedStartToPreserve(bookingFound);

      // Update `from` date to current date (timezone-aware, matching
      // `checkoutBooking`)
      const fromDateStr = DateTime.fromJSDate(new Date(), {
        zone: hints.timeZone,
      }).toFormat(DATE_TIME_FORMAT);

      dataToUpdate.from = DateTime.fromFormat(fromDateStr, DATE_TIME_FORMAT, {
        zone: hints.timeZone,
      }).toJSDate();
    }

    /**
     * Pre-compute the kit IDs that the scanned kits belong to so we can
     * flip their status inside the tx. We also union the pre-existing
     * kits on the booking so kit status reflects reality after commit
     * (matches `checkoutBooking`'s behaviour).
     */
    const preExistingKitIds = getKitIdsByAssets(
      bookingFound.bookingAssets.map((ba) => ba.asset)
    );

    /**
     * Single atomic transaction:
     *   1. Materialise scanned assets against outstanding model requests
     *      + create `BookingAsset` rows (shared helper).
     *   2. Re-read bookingAssets inside the tx so the checkout writes
     *      operate on the post-scan snapshot (includes the scanned rows).
     *   3. Run the checkout writes (outstanding guard, qty availability,
     *      status flips) via the shared helper.
     *
     * If any guard throws — unfulfilled requests, insufficient pool,
     * unique constraint on an already-added asset — the whole tx rolls
     * back: the scanned materialisations, the BookingAsset rows, the
     * early-date adjustment, and the status transition are all reverted
     * together.
     */
    await db.$transaction(
      async (tx) => {
        await addScannedAssetsToBookingWithinTx(tx, {
          assetIds,
          kitIds,
          bookingId,
          organizationId,
          userId,
        });

        /**
         * Post-scan snapshot of every booking asset that needs
         * CHECKED_OUT status + quantity validation. Read inside tx so
         * newly created rows are visible.
         */
        const postScanBookingAssets = await tx.bookingAsset.findMany({
          where: { bookingId },
          select: {
            quantity: true,
            // Needed to exclude kit-driven slices from the standalone
            // availability guard below (#2790) — see the filter's rationale.
            assetKitId: true,
            asset: {
              // `unitOfMeasure` is widened so per-row BOOKING_CHECKED_OUT
              // events can carry `meta.quantity` via assetQtyMeta.
              select: {
                id: true,
                title: true,
                type: true,
                unitOfMeasure: true,
              },
            },
          },
        });

        // Standalone slices only — kit-driven units are reserved out of
        // `bookable` via `inKits`, so validating them here double-charges the
        // free pool and wrongly blocks checkout (#2790). Mirrors the reserve
        // path and the non-scan checkout path above.
        const qtyTrackedBookingAssets = postScanBookingAssets.filter(
          (ba) => isQuantityTracked(ba.asset) && ba.assetKitId == null
        );
        const uniqueQtyTrackedAssetIds = Array.from(
          new Set(qtyTrackedBookingAssets.map((ba) => ba.asset.id))
        );
        const allBookingAssetIds = postScanBookingAssets.map(
          (ba) => ba.asset.id
        );

        // Union pre-existing kit ids with scanned kit ids so the
        // CHECKED_OUT flip covers both. (Dedup via Set.)
        const unionKitIds = Array.from(
          new Set([...preExistingKitIds, ...kitIds])
        );
        const hasKits = unionKitIds.length > 0;

        await checkoutBookingWritesWithinTx(tx, {
          bookingId,
          organizationId,
          bookingAssetIds: allBookingAssetIds,
          qtyTrackedBookingAssets,
          uniqueQtyTrackedAssetIds,
          dataToUpdate,
          kitIds: unionKitIds,
          hasKits,
          // Booking's own committed window — windows the QT availability
          // guard (see the doc comment on `checkoutBookingWritesWithinTx`).
          from: bookingFound.from,
          to: bookingFound.to,
          checkedOutById: userId ?? null,
        });

        /**
         * Activity events — mirrors `checkoutBooking`'s emission so the
         * combined fulfil-and-checkout flow produces the same per-asset
         * `BOOKING_CHECKED_OUT` rows as the standalone checkout path.
         * `allBookingAssetIds` is the post-scan snapshot: it covers both
         * pre-existing booking assets and the newly scanned ones, which
         * is the correct set for "assets that just transitioned to
         * CHECKED_OUT".
         */
        if (allBookingAssetIds.length > 0) {
          // One event per BookingAsset ROW (not deduped). For multi-row
          // qty-tracked, each event carries that row's own quantity in
          // `meta.quantity` (no-op for INDIVIDUAL).
          await recordEvents(
            postScanBookingAssets.map((ba) => ({
              organizationId,
              actorUserId: userId,
              action: "BOOKING_CHECKED_OUT" as const,
              entityType: "BOOKING" as const,
              entityId: bookingId,
              bookingId,
              assetId: ba.asset.id,
              meta: assetQtyMeta(ba.asset, ba.quantity),
            })),
            tx
          );
        }
      },
      { timeout: 15000 }
    );

    /** Post-commit: activity notes for the scanned assets + kits */
    await createNotesForScannedAssetsAndKits({
      booking: { id: bookingFound.id, name: bookingFound.name },
      assetIds,
      kitIds,
      organizationId,
      userId,
    });

    /** The post-checkout values, so the status-transition note and the email
     * scheduler see post-checkout truth without re-reading the row. */
    const effectiveTo =
      (dataToUpdate.to as Date | undefined) ?? bookingFound.to;
    const effectiveStatus =
      (dataToUpdate.status as BookingStatus) ?? bookingFound.status;

    /** Post-commit checkout side-effects shared with `checkoutBooking` */
    return await runCheckoutSideEffects({
      bookingFound,
      userId,
      effectiveStatus,
      effectiveTo,
      hints,
      organizationId,
      isExpired,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while fulfilling reservations and checking out.",
      additionalData: {
        bookingId,
        organizationId,
        userId,
        assetIds,
        kitIds,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                       Quantity-aware check-in helpers                       */
/* -------------------------------------------------------------------------- */

/**
 * Category values from `ConsumptionLog` that count toward a booking's
 * per-asset "dispositioned so far" total. Any log with one of these
 * categories + the booking's id + an asset id consumes one slice of that
 * asset's booked quantity.
 *
 * - RETURN: unit came back to the pool (no `Asset.quantity` change)
 * - CONSUME: unit used as intended (ONE_WAY; pool decrement)
 * - LOSS / DAMAGE: unit gone (pool decrement, distinct for reporting)
 *
 * "Pending" units are *absence* of logs — tracked implicitly via
 * `remaining = BookingAsset.quantity − Σ(these categories)`.
 */
const CHECKIN_DISPOSITION_CATEGORIES = [
  "RETURN",
  "CONSUME",
  "LOSS",
  "DAMAGE",
] as const;

/**
 * Returns how many units of a QUANTITY_TRACKED asset still need to be
 * accounted for in a booking.
 *
 * `remaining = BookingAsset.quantity − Σ(RETURN+CONSUME+LOSS+DAMAGE logs
 * for this (bookingId, assetId) pair)`.
 *
 * The result is clamped to 0 as a defence-in-depth — if `BookingAsset
 * .quantity` is reduced below what's already been logged (which the
 * manage-assets guardrail should prevent), `remaining` would otherwise go
 * negative and confuse downstream callers.
 *
 * Safe to call inside a transaction — accepts a Prisma tx client.
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param bookingId - Booking to measure against
 * @param assetId - Asset whose remaining quantity we want
 */
// `attributeDispositionsByBookingAsset` now lives in `./checkout-attribution`
// (next to the parser that feeds it) so pure read sites can import it without
// this heavyweight module. It is imported above for the internal call sites
// below and re-exported here so existing `~/modules/booking/service.server`
// import sites (routes, tests) keep working unchanged.
export { attributeDispositionsByBookingAsset };

/** Per-category disposition split for a single BookingAsset row. */
export type DispositionCategoryBreakdown = {
  returned: number;
  consumed: number;
  lost: number;
  damaged: number;
};

/**
 * Like {@link attributeDispositionsByBookingAsset} but produces a
 * per-category breakdown (returned / consumed / lost / damaged) per
 * BookingAsset row, with capacity **shared across categories**.
 *
 * This is the correct primitive when you need both the per-row total
 * AND the category split. Naïvely running the simple attributor once
 * per category over-counts: each pass would refill a kit-driven row to
 * its full quantity, so RETURN + CONSUME + LOSS could each independently
 * fill the same 33-unit row to 33 (= 99 attributed against 33 booked).
 *
 * Here a single running total per row is shared: categories are
 * processed in a fixed order (RETURN → CONSUME → LOSS → DAMAGE) and each
 * row only accepts units up to its remaining capacity
 * (`quantity − runningTotal`). The per-category split of legacy
 * (`bookingAssetId IS NULL`) logs is therefore deterministic but
 * somewhat arbitrary — that's inherent to legacy data that never
 * recorded which slice each disposition hit. Logs WITH a
 * `bookingAssetId` are always attributed exactly.
 *
 * Pure derivation — no DB calls.
 */
export function attributeCategorizedDispositionsByBookingAsset(args: {
  bookingAssetRows: Array<{
    id: string;
    quantity: number;
    assetKitId: string | null;
  }>;
  consumptionLogs: Array<{
    bookingAssetId: string | null;
    category: "RETURN" | "CONSUME" | "LOSS" | "DAMAGE";
    quantity: number;
  }>;
}): Map<string, DispositionCategoryBreakdown> {
  const { bookingAssetRows, consumptionLogs } = args;

  const breakdown = new Map<string, DispositionCategoryBreakdown>();
  const runningTotal = new Map<string, number>();
  for (const row of bookingAssetRows) {
    breakdown.set(row.id, { returned: 0, consumed: 0, lost: 0, damaged: 0 });
    runningTotal.set(row.id, 0);
  }

  const CATEGORY_FIELD = {
    RETURN: "returned",
    CONSUME: "consumed",
    LOSS: "lost",
    DAMAGE: "damaged",
  } as const;

  // Exact pass: logs that already know their slice land precisely.
  const legacyByCategory = new Map<string, number>();
  for (const log of consumptionLogs) {
    if (log.bookingAssetId && breakdown.has(log.bookingAssetId)) {
      const b = breakdown.get(log.bookingAssetId)!;
      b[CATEGORY_FIELD[log.category]] += log.quantity ?? 0;
      runningTotal.set(
        log.bookingAssetId,
        (runningTotal.get(log.bookingAssetId) ?? 0) + (log.quantity ?? 0)
      );
    } else {
      legacyByCategory.set(
        log.category,
        (legacyByCategory.get(log.category) ?? 0) + (log.quantity ?? 0)
      );
    }
  }

  // Greedy pass: fill legacy pool category-by-category, standalone rows
  // first (loose items are scanned/returned individually; kits are handled
  // as a whole), then kit-driven — consistent with
  // {@link attributeDispositionsByBookingAsset}'s check-out fallback so both
  // surfaces credit the same slice for identical untagged data. Respects the
  // SHARED running total so a row never exceeds its booked quantity across
  // all categories combined.
  const ordered = [...bookingAssetRows].sort((a, b) => {
    const aIsKit = a.assetKitId != null;
    const bIsKit = b.assetKitId != null;
    if (aIsKit !== bIsKit) return aIsKit ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (const category of ["RETURN", "CONSUME", "LOSS", "DAMAGE"] as const) {
    let pool = legacyByCategory.get(category) ?? 0;
    if (pool === 0) continue;
    for (const row of ordered) {
      if (pool === 0) break;
      const used = runningTotal.get(row.id) ?? 0;
      const capacity = Math.max(0, row.quantity - used);
      if (capacity === 0) continue;
      const take = Math.min(capacity, pool);
      breakdown.get(row.id)![CATEGORY_FIELD[category]] += take;
      runningTotal.set(row.id, used + take);
      pool -= take;
    }
  }

  return breakdown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeBookingAssetRemaining(
  tx: any,
  bookingId: Booking["id"],
  assetId: Asset["id"]
): Promise<number> {
  // The old `bookingId_assetId` composite unique was replaced by two
  // partial uniques (manual + kit-driven) so the same asset can have
  // multiple BookingAsset rows in one booking — sum the per-row
  // quantities to get the total booked for this (booking, asset)
  // pair. `ConsumptionLog` is still keyed by (bookingId, assetId)
  // alone (no per-row attribution), so its aggregate already covers
  // the booking-asset combination regardless of which slice the
  // check-in happened against.
  const [pivots, loggedSum] = await Promise.all([
    tx.bookingAsset.findMany({
      where: { bookingId, assetId },
      select: { quantity: true },
    }),
    tx.consumptionLog.aggregate({
      where: {
        assetId,
        bookingId,
        category: { in: CHECKIN_DISPOSITION_CATEGORIES },
      },
      _sum: { quantity: true },
    }),
  ]);

  const booked = (pivots as Array<{ quantity: number }>).reduce(
    (sum, p) => sum + (p.quantity ?? 0),
    0
  );
  const logged = loggedSum._sum?.quantity ?? 0;
  return Math.max(0, booked - logged);
}

/**
 * Remaining units for a SINGLE BookingAsset slice (Polish-7b per-row
 * check-in cap). Unlike {@link computeBookingAssetRemaining} (which sums
 * every slice of the asset), this bounds one slice:
 *
 *   `slice.quantity − Σ(ConsumptionLog tagged with this bookingAssetId)`
 *
 * Only logs explicitly attributed to this slice count — legacy
 * `bookingAssetId IS NULL` logs are intentionally excluded here. The
 * caller (`partialCheckinBooking`) takes `min(asset-level remaining,
 * slice remaining)` as the cap, so the asset-level guard still accounts
 * for those NULL logs and the total can never be over-checked-in.
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param bookingId - Booking the slice belongs to
 * @param bookingAssetId - The BookingAsset row id to measure
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeBookingAssetSliceRemaining(
  tx: any,
  bookingId: Booking["id"],
  bookingAssetId: string
): Promise<number> {
  const [slice, loggedSum] = await Promise.all([
    tx.bookingAsset.findUnique({
      where: { id: bookingAssetId },
      select: { quantity: true },
    }),
    tx.consumptionLog.aggregate({
      where: {
        bookingId,
        bookingAssetId,
        category: { in: CHECKIN_DISPOSITION_CATEGORIES },
      },
      _sum: { quantity: true },
    }),
  ]);

  const booked = (slice as { quantity: number } | null)?.quantity ?? 0;
  const logged = loggedSum._sum?.quantity ?? 0;
  return Math.max(0, booked - logged);
}

/**
 * Minimal Prisma surface the batched checkout "remaining" helpers touch. Both
 * the extended top-level client (`db`) and an interactive transaction client
 * satisfy this structurally, so callers can pass either without a cast — mirrors
 * the `OrgValidationTxClient` / `RecordEventTxClient` pattern used elsewhere for
 * the extended client, whose interactive-tx type does not reduce to the
 * generated `Prisma.TransactionClient`.
 */
type CheckoutRemainingTxClient = Pick<
  ExtendedPrismaClient,
  "bookingAsset" | "partialBookingCheckout" | "booking"
>;

/**
 * Batched sibling of {@link computeBookingAssetRemainingToCheckOut}: computes
 * the still-checkoutable remaining for MANY assets on ONE booking in a FIXED
 * three queries total, regardless of how many assets are requested.
 *
 * The singular helper fires three round-trips (per-asset pivots + ALL sessions
 * + booking status) on every call. The sessions and booking status are
 * BOOKING-level — identical for every asset — so calling the singular helper
 * inside a per-asset loop makes an interactive transaction do `O(3·M)`
 * sequential reads. On large bookings that blows the default 5s transaction
 * timeout and rolls the whole partial checkout back (Sentry SHELF-WEBAPP-217).
 * This batched core fetches the booking-level inputs ONCE and derives each
 * asset's remaining in memory instead.
 *
 * Per-asset semantics are byte-for-byte identical to the singular helper:
 * `Σ(BookingAsset.quantity for the asset) − Σ(PartialBookingCheckout claims for
 * the asset)`, floored at 0 — INCLUDING the legacy all-at-once fallback
 * (booked > 0, no claims for the asset, live CHECKED_OUT, booking
 * ONGOING/OVERDUE ⇒ remaining 0). The
 * shared positional parser {@link checkoutSessionsToLogsByAsset} is reused with
 * a set-membership predicate so the aligned/legacy quantity handling and the
 * `""` → greedy sentinel match every other read site.
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param bookingId - Booking the assets belong to
 * @param assetIds - Assets to measure (deduped internally). Ids not actually on
 *                   the booking resolve to `0` (never on the booking → nothing
 *                   to check out).
 * @returns Map keyed by every requested `assetId` → non-negative remaining
 *          units still checkoutable for that asset on this booking
 */
export async function computeBookingAssetsRemainingToCheckOut(
  tx: CheckoutRemainingTxClient,
  bookingId: Booking["id"],
  assetIds: Asset["id"][]
): Promise<Map<string, number>> {
  const uniqueAssetIds = [...new Set(assetIds)];
  const remainingByAsset = new Map<string, number>();
  // Nothing requested → nothing to read. Early-return so callers can invoke
  // this unconditionally (e.g. an INDIVIDUAL-only batch has no qty assets to
  // measure) without paying for a pointless round-trip.
  if (uniqueAssetIds.length === 0) {
    return remainingByAsset;
  }

  const requestedSet = new Set(uniqueAssetIds);

  const [pivots, sessions, booking] = await Promise.all([
    tx.bookingAsset.findMany({
      where: { bookingId, assetId: { in: uniqueAssetIds } },
      // `asset.status` is the per-asset half of the legacy fallback below: the
      // all-at-once checkout flips every asset it processed to CHECKED_OUT, so
      // that flag — not merely "this booking is ONGOING" — is what marks a row
      // as already off the shelf. Joined here rather than fetched separately so
      // the fixed-query-count guarantee in the JSDoc still holds.
      select: {
        assetId: true,
        quantity: true,
        asset: { select: { status: true } },
      },
    }),
    tx.partialBookingCheckout.findMany({
      where: { bookingId },
      select: { assetIds: true, quantities: true, bookingAssetIds: true },
    }),
    // Cheap PK read — needed only so the legacy all-at-once fallback below can
    // distinguish "checked out via all-at-once (no PBC rows by design)" from
    // "RESERVED, not yet touched". Mirrors the singular helper exactly.
    tx.booking.findUnique({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: pure read helper called from already-org-scoped contexts (the bookingId was resolved by callers via an org-scoped findUniqueOrThrow). Only reads non-sensitive `status` metadata. Mirrors computeBookingAssetRemainingToCheckOut.
      where: { id: bookingId },
      select: { status: true },
    }),
  ]);

  /**
   * Live asset status per requested asset, read off the pivot join. Feeds the
   * per-asset half of the legacy fallback below. Absent (asset row not
   * projected by a test mock) ⇒ treated as NOT checked out, which is the safe
   * direction: the asset keeps its real `booked − claimed` remaining rather
   * than being silently zeroed.
   */
  const statusByAsset = new Map<string, AssetStatus>();

  // Booked total per requested asset (Σ pivot quantities across its slices).
  const bookedByAsset = new Map<string, number>();
  if (uniqueAssetIds.length === 1) {
    // The pivot query is filtered to this single asset via `assetId: { in }`,
    // so every returned row provably belongs to it — sum them directly. This
    // keeps parity with the singular helper's original "sum all returned
    // pivots" and does not depend on each row projecting its own `assetId`.
    const rows = pivots as Array<{
      quantity: number;
      asset?: { status: AssetStatus } | null;
    }>;
    const booked = rows.reduce((sum, p) => sum + (p.quantity ?? 0), 0);
    bookedByAsset.set(uniqueAssetIds[0], booked);
    const status = rows.find((p) => p.asset?.status)?.asset?.status;
    if (status) {
      statusByAsset.set(uniqueAssetIds[0], status);
    }
  } else {
    for (const p of pivots as Array<{
      assetId: string;
      quantity: number;
      asset?: { status: AssetStatus } | null;
    }>) {
      bookedByAsset.set(
        p.assetId,
        (bookedByAsset.get(p.assetId) ?? 0) + (p.quantity ?? 0)
      );
      if (p.asset?.status) {
        statusByAsset.set(p.assetId, p.asset.status);
      }
    }
  }

  const sessionsArr = sessions as Array<{
    assetIds: string[];
    quantities: number[];
    bookingAssetIds: string[];
  }>;
  // Booking-level half of the legacy signal (see JSDoc): only an active booking
  // can have units physically off the shelf. Deliberately NOT "the booking has
  // zero sessions" — one progressive batch for ONE asset would otherwise
  // switch every OTHER all-at-once asset back to "fully remaining" and invite a
  // duplicate checkout. The per-asset test below is what decides coverage.
  const bookingStatus = (booking as { status: BookingStatus } | null)?.status;
  const isActiveBooking =
    bookingStatus === BookingStatus.ONGOING ||
    bookingStatus === BookingStatus.OVERDUE;

  // Parse every session ONCE into per-asset checkout logs through the shared
  // positional-array parser, scoped to the requested assets via set membership
  // so the INDIVIDUAL-vs-QT skip in the parser never drops a requested asset.
  const logsByAsset = checkoutSessionsToLogsByAsset(sessionsArr, (id) =>
    requestedSet.has(id)
  );

  for (const assetId of uniqueAssetIds) {
    const booked = bookedByAsset.get(assetId) ?? 0;
    const claimed = (logsByAsset.get(assetId) ?? []).reduce(
      (sum, log) => sum + log.quantity,
      0
    );

    // Legacy all-at-once fallback, decided entirely PER ASSET:
    //   - `booked > 0`: an asset that isn't on the booking (no pivots) falls
    //     through to the normal math rather than synthesizing "fully out".
    //   - `claimed === 0`: nothing was ever progressively checked out for this
    //     asset, so its zeroed counters are the all-at-once flow's silence
    //     rather than a real "still on the shelf" reading. An asset WITH claims
    //     needs no fallback — `booked − claimed` is already exact.
    //   - live `CHECKED_OUT`: the flag the all-at-once flow actually writes.
    //     An asset ADDED to the booking afterwards is still AVAILABLE
    //     (updateBookingAssets deliberately does not auto-check-out on an
    //     ONGOING booking), so it keeps its real remaining (GitHub #2815).
    //
    // Keying on the ASSET rather than "the booking has zero sessions" is what
    // makes this survive a later batch: once "check out remaining" records the
    // first session for a newly-added asset, a booking-level test would flip
    // every already-out asset back to "fully remaining" and allow a duplicate
    // checkout of stock that is already in the field.
    if (
      booked > 0 &&
      claimed === 0 &&
      isActiveBooking &&
      statusByAsset.get(assetId) === AssetStatus.CHECKED_OUT
    ) {
      remainingByAsset.set(assetId, 0);
      continue;
    }

    remainingByAsset.set(assetId, Math.max(0, booked - claimed));
  }

  return remainingByAsset;
}

/**
 * Remaining units of an asset that can still be checked OUT on this booking.
 *
 * `Σ(BookingAsset.quantity for this asset) − Σ(PartialBookingCheckout claims
 * for this asset on this booking)`, floored at 0. Mirror of
 * {@link computeBookingAssetRemaining} (the check-IN side) but reads
 * {@link PartialBookingCheckout} instead of `ConsumptionLog`.
 *
 * Already-claimed count comes from the Wave-B `quantities[]` parallel array
 * on each session row. Legacy rows (pre-Wave-B) wrote `quantities = []`; for
 * those each occurrence of the asset in `assetIds[]` defaults to 1 unit
 * (matching the implicit INDIVIDUAL semantics those rows carried). This
 * keeps the read backward-compatible with the existing all-at-once and
 * pre-Wave-B partial-checkout history without a backfill.
 *
 * Legacy all-at-once fallback (bug #96 follow-up): the all-at-once checkout
 * flips every asset it processes to `AssetStatus.CHECKED_OUT` but writes NO
 * {@link PartialBookingCheckout} rows, so an asset that is live CHECKED_OUT
 * with no claims of its own on an ONGOING/OVERDUE booking has every booked
 * unit physically off the shelf — `remaining` is 0, not `booked`. Without
 * this, {@link computeCheckedOutForAsset} (which reads `booked − remaining`
 * as the checked-out portion) would compute `booked − booked = 0` and the
 * asset overview "checked out" tile would silently drop them.
 *
 * The test is PER ASSET, deliberately not "this booking has zero sessions":
 * one progressive batch for ONE asset would otherwise switch every other
 * all-at-once asset back to "fully remaining" and invite a duplicate checkout
 * of stock already in the field. An asset WITH claims needs no fallback
 * (`booked − claimed` is exact), and an asset ADDED after the checkout is
 * still AVAILABLE so it keeps its real remaining (GitHub #2815). RESERVED
 * bookings never trip it (no units out yet). The status fetch is a single
 * indexed-PK read against `Booking.status`, idempotent and safe to call from
 * inside or outside a transaction.
 *
 * @param tx - Prisma transaction client (or default `db`)
 * @param bookingId - Booking the asset belongs to
 * @param assetId - Asset to measure
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeBookingAssetRemainingToCheckOut(
  tx: any,
  bookingId: Booking["id"],
  assetId: Asset["id"]
): Promise<number> {
  // Delegate to the batched core with a single-element set so this helper stays
  // byte-for-byte identical for its ~6 external callers while the attribution,
  // legacy all-at-once fallback, and positional-parser handling live in ONE place.
  const remainingByAsset = await computeBookingAssetsRemainingToCheckOut(
    tx,
    bookingId,
    [assetId]
  );
  return remainingByAsset.get(assetId) ?? 0;
}

/**
 * Per-slice remaining units that can still be checked OUT. Mirror of
 * {@link computeBookingAssetSliceRemaining} (the check-IN side) on the OUT
 * side: bounds one slice rather than summing every slice of the asset.
 *
 *   `slice.quantity − Σ(PartialBookingCheckout claims attributed to this slice)`
 *
 * Attribution mirrors what {@link computeBookingAssetRemainingToCheckOut} does
 * across the asset, but scoped to a single `bookingAssetId`. Because
 * `PartialBookingCheckout` has no per-row FK (no `bookingAssetId` column),
 * the per-slice attribution uses the SAME greedy fill the loader uses
 * (kit-driven slices first, standalone after) by calling
 * {@link attributeDispositionsByBookingAsset} with the asset's slices + a
 * single legacy log entry for the asset's total claim pool, then picking the
 * entry for our `bookingAssetId`.
 *
 * For non-multi-slice assets (the common case: ONE BookingAsset per asset),
 * the attribution trivially returns the whole pool into the one slice →
 * equivalent to `computeBookingAssetRemainingToCheckOut`. For multi-slice
 * assets (kit slice + standalone of the same asset on the same booking) the
 * greedy fill gives the same per-slice cap the check-OUT path uses when
 * deciding which slice a claim consumes from.
 *
 * Used by {@link getRemainingCheckoutPayload} so the booking-header "Check
 * out remaining" action proposes per-slice remaining values that
 * `partialCheckoutBooking` will accept (it caps each claim by the same
 * per-slice math when it processes the batch).
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param bookingId - Booking the slice belongs to
 * @param bookingAssetId - The BookingAsset row id to measure
 * @returns Units still allowed to be progressively checked OUT for this slice
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeBookingAssetSliceRemainingToCheckOut(
  tx: any,
  bookingId: Booking["id"],
  bookingAssetId: string
): Promise<number> {
  // Delegate to the batched core with a single-element list so this helper stays
  // byte-for-byte identical for its external caller (getRemainingCheckoutPayload)
  // while the slice fetch, session parsing, and greedy attribution live in ONE
  // place. The batched core is what the in-transaction disposition loop calls to
  // avoid an O(K) per-slice read fan-out (Sentry SHELF-WEBAPP-217).
  const remainingBySlice = await computeBookingAssetsSliceRemainingToCheckOut(
    tx,
    bookingId,
    [bookingAssetId]
  );
  return remainingBySlice.get(bookingAssetId) ?? 0;
}

/**
 * Batched sibling of {@link computeBookingAssetSliceRemainingToCheckOut}:
 * computes the still-checkoutable remaining for MANY slices on ONE booking in a
 * FIXED number of queries (at most three), independent of how many slices are
 * requested.
 *
 * The singular helper issues three round-trips (the slice, the asset's full
 * slice set, and ALL sessions) on EVERY call. The sessions are BOOKING-level and
 * the slice sets depend only on the involved assets — so calling the singular
 * helper once per slice-tagged QUANTITY_TRACKED disposition inside an
 * interactive transaction makes it do `O(3·K)` sequential reads. On a batch with
 * many QT slices that compounds the asset-level fan-out already fixed in
 * {@link computeBookingAssetsRemainingToCheckOut} and can blow the transaction
 * timeout (Sentry SHELF-WEBAPP-217). This batched core fetches the requested
 * slices, every sibling slice of the involved assets, and every session ONCE,
 * then attributes per asset in memory.
 *
 * Per-slice semantics are byte-for-byte identical to the singular helper:
 * `slice.quantity − Σ(PartialBookingCheckout claims attributed to this slice)`,
 * floored at 0, using the SAME greedy standalone-first fill via
 * {@link attributeDispositionsByBookingAsset} over the asset's FULL slice set
 * (so a claim tagged to one slice never leaks into a sibling). The shared
 * positional parser {@link checkoutSessionsToLogsByAsset} is reused with a
 * set-membership predicate so the `""` → greedy sentinel and the aligned/legacy
 * quantity handling match every other read site.
 *
 * That parity INCLUDES the legacy all-at-once fallback (quantity > 0, no claims
 * for the slice, live CHECKED_OUT, booking ONGOING/OVERDUE ⇒ remaining 0).
 * Without it this per-slice reader
 * disagreed with its asset-level sibling on exactly one booking shape — one
 * checked out all-at-once — and the disagreement was load-bearing:
 * {@link getRemainingCheckoutPayload} PROPOSES from here while
 * {@link partialCheckoutBooking} CAPS with the asset-level helper, so "Check
 * out remaining" proposed the full booked quantity for an already-out QT slice,
 * the cap rejected it as "Only 0 units left…", and the whole batch rolled back
 * — taking any genuinely-outstanding asset in the same batch down with it
 * (GitHub #2814).
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param bookingId - Booking the slices belong to
 * @param bookingAssetIds - BookingAsset row ids to measure (deduped internally).
 *   An id that is not actually a slice on this booking resolves to `0`.
 * @returns Map keyed by EVERY requested `bookingAssetId` → non-negative
 *   remaining units still checkoutable for that slice on this booking. Empty
 *   input ⇒ empty map with no query issued.
 */
export async function computeBookingAssetsSliceRemainingToCheckOut(
  tx: CheckoutRemainingTxClient,
  bookingId: Booking["id"],
  bookingAssetIds: string[]
): Promise<Map<string, number>> {
  const uniqueSliceIds = [...new Set(bookingAssetIds)];
  const remainingBySlice = new Map<string, number>();
  // Seed every requested id with 0 so callers always get an entry back, even
  // for ids that turn out not to be slices on this booking (nothing to check
  // out).
  for (const sliceId of uniqueSliceIds) {
    remainingBySlice.set(sliceId, 0);
  }
  // Nothing requested → nothing to read (e.g. an INDIVIDUAL-only batch has no
  // slice-tagged QT dispositions), so callers can invoke this unconditionally
  // without paying for a pointless round-trip.
  if (uniqueSliceIds.length === 0) {
    return remainingBySlice;
  }

  // (1) Fetch the requested slices ONCE — we need each slice's `assetId` (to
  // pool claims across its siblings) and its own `quantity` (the cap remaining
  // is subtracted from). Scope by `bookingId` even though it's redundant for
  // legitimate callers (a slice id from this booking's own dialog): the ids
  // originate from user input (`checkouts[].bookingAssetId`), so scoping keeps
  // a foreign/cross-org slice id from ever surfacing a row here — it falls
  // through to the seeded 0 directly (org-scope-user-supplied-ids rule), rather
  // than relying only on the downstream assetCap to neutralize it.
  const requestedRows = (await tx.bookingAsset.findMany({
    where: { bookingId, id: { in: uniqueSliceIds } },
    // `asset.status` feeds the per-asset half of the legacy fallback below —
    // see the asset-level sibling for the full rationale.
    select: {
      id: true,
      assetId: true,
      quantity: true,
      assetKitId: true,
      asset: { select: { status: true } },
    },
  })) as Array<{
    id: string;
    assetId: string;
    quantity: number;
    assetKitId: string | null;
    asset?: { status: AssetStatus } | null;
  }>;

  // Keep only genuinely-requested rows (a widened query or a static test mock
  // could surface extras) and collect the assets those slices belong to.
  const requestedSet = new Set(uniqueSliceIds);
  const requestedById = new Map<
    string,
    { assetId: string; quantity: number; status?: AssetStatus }
  >();
  const involvedAssetIds = new Set<string>();
  for (const row of requestedRows) {
    if (!requestedSet.has(row.id)) continue;
    requestedById.set(row.id, {
      assetId: row.assetId,
      quantity: row.quantity,
      status: row.asset?.status,
    });
    involvedAssetIds.add(row.assetId);
  }
  // No requested id resolved to a real slice → every entry stays 0, no further
  // reads needed.
  if (involvedAssetIds.size === 0) {
    return remainingBySlice;
  }

  const involvedAssetIdList = [...involvedAssetIds];

  // (2) The FULL slice set of every involved asset (the greedy standalone-first
  // fill needs every sibling, not just the requested ones) + (3) ALL sessions +
  // (4) the booking's status, all fetched ONCE and in parallel. The status read
  // is a cheap indexed-PK lookup and rides along in the same round-trip batch,
  // so the fixed-query-count guarantee in the JSDoc is unaffected.
  const [allSlices, sessions, booking] = await Promise.all([
    tx.bookingAsset.findMany({
      where: { bookingId, assetId: { in: involvedAssetIdList } },
      select: { id: true, assetId: true, quantity: true, assetKitId: true },
    }),
    tx.partialBookingCheckout.findMany({
      where: { bookingId },
      select: { assetIds: true, quantities: true, bookingAssetIds: true },
    }),
    tx.booking.findUnique({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: pure read helper called from already-org-scoped contexts (the bookingId was resolved by callers via an org-scoped findUniqueOrThrow). Only reads non-sensitive `status` metadata. Mirrors computeBookingAssetsRemainingToCheckOut.
      where: { id: bookingId },
      select: { status: true },
    }),
  ]);

  const sessionsArr = sessions as Array<{
    assetIds: string[];
    quantities: number[];
    bookingAssetIds: string[];
  }>;

  // Booking-level half of the legacy signal — the per-slice mirror of the
  // branch in {@link computeBookingAssetsRemainingToCheckOut}. Only an active
  // booking can have units physically off the shelf; everything else about the
  // decision is per slice below. Deliberately NOT "the booking has zero
  // sessions": one progressive batch for one asset would otherwise flip every
  // other already-out slice back to "fully remaining".
  const bookingStatus = (booking as { status: BookingStatus } | null)?.status;
  const isActiveBooking =
    bookingStatus === BookingStatus.ONGOING ||
    bookingStatus === BookingStatus.OVERDUE;

  // Group each involved asset's slices so the attributor sees its full set.
  const slicesByAsset = new Map<
    string,
    Array<{ id: string; quantity: number; assetKitId: string | null }>
  >();
  for (const row of allSlices as Array<{
    id: string;
    assetId: string;
    quantity: number;
    assetKitId: string | null;
  }>) {
    const entry = {
      id: row.id,
      quantity: row.quantity,
      assetKitId: row.assetKitId,
    };
    const list = slicesByAsset.get(row.assetId);
    if (list) {
      list.push(entry);
    } else {
      slicesByAsset.set(row.assetId, [entry]);
    }
  }

  // Parse every session ONCE into per-asset checkout logs, scoped to the
  // involved assets via set membership so the parser's INDIVIDUAL-vs-QT skip
  // never drops a requested asset. Logs tagged with an exact `bookingAssetId`
  // attribute to that slice; untagged (`""` → null) logs greedy-fill.
  const logsByAsset = checkoutSessionsToLogsByAsset(sessionsArr, (id) =>
    involvedAssetIds.has(id)
  );

  // Attribute each involved asset's claims across its full slice set ONCE, then
  // fold the per-asset maps into a single slice → claimed lookup.
  const claimedBySliceId = new Map<string, number>();
  for (const assetId of involvedAssetIdList) {
    const attributed = attributeDispositionsByBookingAsset({
      bookingAssetRows: slicesByAsset.get(assetId) ?? [],
      consumptionLogs: logsByAsset.get(assetId) ?? [],
    });
    for (const [sliceId, claimed] of attributed) {
      claimedBySliceId.set(sliceId, claimed);
    }
  }

  // Remaining per requested slice = its own booked quantity − claims attributed
  // to it, floored at 0.
  for (const sliceId of uniqueSliceIds) {
    const requested = requestedById.get(sliceId);
    // Unknown slice (not on the booking) → keep the seeded 0.
    if (!requested) continue;
    const claimed = claimedBySliceId.get(sliceId) ?? 0;
    // Legacy all-at-once fallback, decided per SLICE — mirror of the
    // asset-level sibling's `booked > 0` + `claimed === 0` + live-CHECKED_OUT
    // guards. A slice with claims needs no fallback (`quantity − claimed` is
    // exact), and a slice whose asset was added after the checkout is still
    // AVAILABLE so it keeps its real remaining (GitHub #2815). Keying on the
    // slice rather than the booking is what keeps an already-out slice at 0
    // after a later batch records the booking's first session row.
    if (
      isActiveBooking &&
      requested.quantity > 0 &&
      claimed === 0 &&
      requested.status === AssetStatus.CHECKED_OUT
    ) {
      remainingBySlice.set(sliceId, 0);
      continue;
    }
    remainingBySlice.set(sliceId, Math.max(0, requested.quantity - claimed));
  }

  return remainingBySlice;
}

/**
 * Determines whether a booking has been fully checked in across all of
 * its assets.
 *
 * Dispatch is judged per asset from that asset's OWN records — the slice
 * markers (`BookingAsset.checkedOutAt`, stamped by both the all-at-once
 * checkout and progressive scans) plus its progressive session units. There
 * is deliberately no booking-level "has any progressive checkout" mode
 * switch: `PartialBookingCheckout` rows record scan SESSIONS, absence proves
 * nothing (the Check-out button writes none — see the model's doc comment),
 * and a booking-level test would let one scanned asset strip the return
 * obligation off every button-checked-out asset on the booking.
 *
 * For `INDIVIDUAL` assets: a slice with `checkedOutAt` must be reconciled —
 * `checkedInAt` set, or present in a `PartialBookingCheckin.assetIds` row
 * (rows reconciled before the marker existed carry only the session record).
 * Slices never dispatched (added onto an ONGOING booking, or left behind by
 * a progressive checkout) have nothing to check in and never block.
 *
 * For `QUANTITY_TRACKED` assets: obligated units are judged PER SLICE and
 * summed — a slice's session-attributed units when any exist (capped by its
 * booked quantity), otherwise its whole booked quantity when its marker is
 * stamped (an all-at-once stamp dispatches the full slice). One asset can
 * mix both across its slices, so neither source alone may answer for the
 * asset (see `computeDispatchedUnitsByAsset`). Complete when every obligated
 * unit is reconciled; units that never left the warehouse carry no
 * obligation.
 *
 * Called by both `partialCheckinBooking` and `checkinBooking` to decide
 * the ONGOING/OVERDUE → COMPLETE transition. Keeping this in one place
 * prevents the two code paths from drifting.
 *
 * @param tx - Prisma transaction client
 * @param bookingId - Booking to evaluate
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isBookingFullyCheckedIn(
  tx: any,
  bookingId: Booking["id"]
): Promise<boolean> {
  const [bookingAssets, partialCheckins, partialCheckouts] = await Promise.all([
    tx.bookingAsset.findMany({
      where: { bookingId },
      select: {
        // `id` + `assetKitId` feed the per-slice session attribution in
        // `computeDispatchedUnitsByAsset` (tagged claims name a slice; greedy
        // fill orders by the discriminator).
        id: true,
        assetId: true,
        quantity: true,
        assetKitId: true,
        // The slice markers are the per-booking dispatch record — stamped by
        // the all-at-once checkout (which writes no PartialBookingCheckout
        // rows) and by progressive scans alike. They are the same source the
        // check-in eligibility guard reads, so an item gates completion
        // exactly when it is checkinable.
        checkedOutAt: true,
        checkedInAt: true,
        // Cumulative units this slice has sent out, across every departure.
        // The markers say WHETHER a slice is out; only this says HOW MANY
        // units have left in total, which is what a second departure changes.
        checkedOutQuantity: true,
        asset: { select: { id: true, type: true } },
      },
    }),
    tx.partialBookingCheckin.findMany({
      where: { bookingId },
      // The timestamp is what ties a session to the departure it answers. A
      // slice can depart twice, and a session from the first trip must not
      // reconcile the second.
      select: { assetIds: true, checkinTimestamp: true },
    }),
    tx.partialBookingCheckout.findMany({
      where: { bookingId },
      select: { assetIds: true, quantities: true, bookingAssetIds: true },
    }),
  ]);

  if (bookingAssets.length === 0) {
    // An empty booking has nothing to check in — treat as complete.
    return true;
  }

  /**
   * The most recent check-in session naming each asset. Kept as a time rather
   * than a flag: a slice that departed twice has a session for the first trip
   * whose asset id never leaves this set, and a bare set of ids would let that
   * session reconcile the second departure too.
   */
  const latestSessionCheckinByAsset = new Map<string, Date>();
  for (const row of partialCheckins as Array<{
    assetIds: string[];
    checkinTimestamp: Date | null;
  }>) {
    for (const id of row.assetIds) {
      const at = row.checkinTimestamp;
      if (!at) continue;
      const seen = latestSessionCheckinByAsset.get(id);
      if (!seen || at > seen) latestSessionCheckinByAsset.set(id, at);
    }
  }

  type SliceRow = {
    id: string;
    assetId: string;
    quantity: number;
    assetKitId: string | null;
    checkedOutAt: Date | null;
    checkedInAt: Date | null;
    checkedOutQuantity: number | null;
    asset: { id: string; type: AssetType } | null;
  };
  const slices = bookingAssets as SliceRow[];

  // Dispatched units per ASSET, judged slice by slice: a slice's progressive
  // session units when any were attributed to it, otherwise its whole booked
  // quantity when its marker is stamped. One asset can mix both across its
  // slices (a button-checked-out slice plus a progressively-scanned sibling),
  // so neither sessions nor stamps alone may answer for the asset — see
  // `computeDispatchedUnitsByAsset`.
  const dispatchedUnitsByAsset = computeDispatchedUnitsByAsset({
    slices,
    checkoutSessions: partialCheckouts as Array<{
      assetIds: string[];
      quantities: number[];
      bookingAssetIds: string[];
    }>,
  });

  // Booked units summed per ASSET across all of its slices (standalone +
  // kit-driven) — reconciliation below is asset-level.
  const bookedUnitsByAsset = new Map<string, number>();
  /** Cumulative units sent out per asset, summed across its slices. */
  const countedOutUnitsByAsset = new Map<string, number>();
  for (const s of slices) {
    bookedUnitsByAsset.set(
      s.assetId,
      (bookedUnitsByAsset.get(s.assetId) ?? 0) + s.quantity
    );
    countedOutUnitsByAsset.set(
      s.assetId,
      (countedOutUnitsByAsset.get(s.assetId) ?? 0) + (s.checkedOutQuantity ?? 0)
    );
  }

  /** QT assets already judged — an asset's slices are evaluated as one. */
  const qtyAssetIdsEvaluated = new Set<string>();

  for (const ba of slices) {
    const isQtyTrackedAsset = ba.asset?.type === AssetType.QUANTITY_TRACKED;

    if (!isQtyTrackedAsset) {
      // INDIVIDUAL. The slice marker is the same source the check-in
      // eligibility guard reads, so an asset gates completion exactly when
      // it is checkinable. A slice never dispatched on THIS booking (added
      // onto an ONGOING booking, or left behind by a progressive checkout)
      // has nothing to reconcile and never blocks.
      if (!ba.checkedOutAt) continue;
      // Reconciled — by the slice marker, or by a partial-checkin session
      // for rows reconciled before the marker existed.
      //
      // The check-in has to be no older than the departure it answers. A slice
      // that came back and then went out again carries both markers, and the
      // refreshed `checkedOutAt` is what says it is out now; reading
      // `checkedInAt` alone would report the second trip as already returned.
      if (ba.checkedInAt && ba.checkedInAt >= ba.checkedOutAt) continue;
      // Session fallback, for rows reconciled before the marker existed. It is
      // held to the same test as the marker: the session has to be no older
      // than the departure it claims to answer. Without that, a second
      // departure clears `checkedInAt` and the FIRST trip's session — whose
      // asset id is still listed — silently reconciles the new one.
      const sessionAt = latestSessionCheckinByAsset.get(ba.assetId);
      if (sessionAt && sessionAt >= ba.checkedOutAt) continue;
      return false;
    }

    // QUANTITY_TRACKED — judged once per ASSET, because `remaining` and the
    // unit sums span all of the asset's slices.
    if (qtyAssetIdsEvaluated.has(ba.assetId)) continue;
    qtyAssetIdsEvaluated.add(ba.assetId);

    // Obligated units = what actually went out for this asset, judged slice
    // by slice (session-attributed units per slice, else the stamped slice's
    // booked quantity). Judging per slice keeps one progressively-scanned
    // sibling from erasing a button-checked-out slice's obligation, and one
    // scanned-out asset from stripping the obligation off every other asset
    // on the booking.
    const booked = bookedUnitsByAsset.get(ba.assetId) ?? 0;
    // Whichever record accounts for more units. The marker-and-session figure
    // is capped at the booked quantity, which is right for one trip and wrong
    // for two: an asset that went out, came back and went out again has sent
    // out more units than it ever booked, and only the cumulative counter
    // carries that. Taking the larger keeps every single-trip booking judged
    // exactly as before.
    const obligatedUnits = Math.max(
      Math.min(dispatchedUnitsByAsset.get(ba.assetId) ?? 0, booked),
      countedOutUnitsByAsset.get(ba.assetId) ?? 0
    );
    if (obligatedUnits === 0) {
      // Never dispatched in any form — nothing to reconcile.
      continue;
    }

    // Reconciled units, uncapped. `computeBookingAssetRemaining` clamps to the
    // booked quantity, which would hide returns from a second trip the same
    // way the cap above hid the departure, so read the log directly.
    const reconciledSum = await tx.consumptionLog.aggregate({
      where: {
        assetId: ba.assetId,
        bookingId,
        category: { in: CHECKIN_DISPOSITION_CATEGORIES },
      },
      _sum: { quantity: true },
    });
    const reconciledUnits =
      (reconciledSum as { _sum?: { quantity: number | null } })._sum
        ?.quantity ?? 0;
    if (obligatedUnits - reconciledUnits > 0) return false;
  }

  return true;
}

/**
 * Runs the best-effort low-stock check for every quantity-tracked asset whose
 * pool dropped during a check-in. Only CONSUME / LOSS / DAMAGE reduce the pool;
 * RETURN restores units and cannot cross a threshold downward, so it is skipped
 * (predicate: `consumed + lost + damaged > 0`). Asset ids are de-duplicated so
 * an asset with several dispositions is checked once.
 *
 * MUST be called AFTER the mutation transaction commits — it reads committed
 * state, and its failures are logged and never propagated, so a notification
 * problem cannot fail a committed check-in.
 *
 * Shared by {@link checkinBooking} and {@link partialCheckinBooking} so the
 * predicate and error handling can't drift between the two flows.
 *
 * @param params.summaries - Per-asset disposition summaries from the transaction
 * @param params.organizationId - Organization that owns the assets
 * @param params.bookingId - Booking the check-in belongs to (log context)
 * @param params.userId - Acting user, when one exists (may be undefined)
 * @param params.context - Short label naming the calling flow, used in the log
 */
async function notifyLowStockForDecrementedAssets({
  summaries,
  organizationId,
  bookingId,
  userId,
  context,
}: {
  summaries: Array<{
    assetId: string;
    consumed: number;
    lost: number;
    damaged: number;
  }>;
  organizationId: string;
  bookingId: string;
  userId?: string;
  context: string;
}): Promise<void> {
  const decrementedAssetIds = [
    ...new Set(
      summaries
        .filter((s) => s.consumed + s.lost + s.damaged > 0)
        .map((s) => s.assetId)
    ),
  ];

  for (const assetId of decrementedAssetIds) {
    try {
      await checkAndNotifyLowStock({ assetId, userId, organizationId });
    } catch (lowStockError) {
      Logger.error(
        new ShelfError({
          cause: lowStockError,
          message: `Failed to run low-stock check after ${context}`,
          label,
          additionalData: { assetId, bookingId, organizationId },
        })
      );
    }
  }
}

/* -------------------------------------------------------------------------- */

export async function checkinBooking({
  id,
  organizationId,
  hints,
  intentChoice,
  userId,
  specificAssetIds,
  checkins,
}: Pick<Booking, "id" | "organizationId"> & {
  hints: ClientHint;
  intentChoice?: CheckinIntentEnum;
  userId?: string;
  specificAssetIds?: string[];
  /**
   * Optional per-asset dispositions. When omitted, qty-tracked assets
   * on the booking default to "return all remaining" (TWO_WAY) or
   * "consume all remaining" (ONE_WAY) — the happy-path when the user hits
   * the big Check-in button without opening the scanner drawer.
   */
  checkins?: CheckinDispositionInput[];
}) {
  try {
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          bookingAssets: {
            // `quantity` + `unitOfMeasure` widen the select so the per-row
            // BOOKING_CHECKED_IN events below can attach `meta.quantity`
            // for QUANTITY_TRACKED assets (no-op for INDIVIDUAL).
            // `id` + `assetId` feed the per-slice qty-tracked check-in
            // bookkeeping below (see `qtyTrackedSlices`).
            select: {
              id: true,
              assetId: true,
              quantity: true,
              // Kit provenance: which kit this slice came from, which survives
              // the member being detached from the kit mid-booking. Required by
              // `getKitIdsByBookingSlices`, so dropping either is a type error.
              assetKitId: true,
              sourceKitId: true,
              asset: {
                select: {
                  id: true,
                  type: true,
                  unitOfMeasure: true,
                  consumptionType: true,
                  title: true,
                  assetKits: { select: { kitId: true } },
                  status: true,
                  bookingAssets: {
                    select: {
                      booking: {
                        select: { id: true, status: true },
                      },
                    },
                    where: {
                      booking: {
                        status: {
                          in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          status: 404,
          label,
          message:
            "Booking not found, are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    // `dataToUpdate` below sets COMPLETE unconditionally. Without this guard a
    // direct POST against a DRAFT or RESERVED booking marked it COMPLETE while
    // checking in nothing: the asset filter keeps only CHECKED_OUT assets, and
    // on those statuses there are none. The booking then reads as finished
    // although it never happened. (detail.dev D084)
    //
    // This read is NOT locked — `bookingFound` is loaded outside the write
    // transaction — so treat it as a cheap early exit only. The authoritative,
    // locked check runs inside the transaction below.
    assertBookingIsCheckinable({ status: bookingFound.status, bookingId: id });

    const dataToUpdate: Prisma.BookingUpdateInput = {
      status: BookingStatus.COMPLETE,
    };

    /** Map bookingAssets to flat asset array for downstream logic */
    const bookingFoundAssets = bookingFound.bookingAssets.map((ba) => ba.asset);

    /**
     * Kits to release, from BOTH directions.
     *
     * Live membership alone misses a kit whose member was detached while the
     * booking ran; the booking's own slices alone miss a kit reached through a
     * standalone row, which carries no provenance. A kit released redundantly
     * is a no-op write; a kit missed stays stuck with no way out of the UI.
     */
    const sliceKitAssetIds = await getKitIdsByBookingSlices({
      slices: bookingFound.bookingAssets,
      organizationId,
    });
    const kitIds = [
      ...new Set([
        ...getKitIdsByAssets(bookingFoundAssets),
        ...sliceKitAssetIds.keys(),
      ]),
    ];
    const hasKits = kitIds.length > 0;

    const isEarlyCheckin = isBookingEarlyCheckin(bookingFound.to!);

    /**
     * If user is doing an early checkin of booking then update
     * the booking's `to` date accordingly
     */
    if (
      isEarlyCheckin &&
      intentChoice === CheckinIntentEnum["with-adjusted-date"]
    ) {
      // Keep the planned end intact; only seeds rows predating the column.
      dataToUpdate.originalTo = plannedEndToPreserve(bookingFound);

      // Update the `to` date to current date
      const toDateStr = DateTime.fromJSDate(new Date(), {
        zone: hints.timeZone,
      }).toFormat(DATE_TIME_FORMAT);

      dataToUpdate.to = DateTime.fromFormat(toDateStr, DATE_TIME_FORMAT, {
        zone: hints.timeZone,
      }).toJSDate();
    }

    /**
     * If booking was overdue then we have to adjust the endDate of booking
     * */
    if (bookingFound.status === BookingStatus.OVERDUE) {
      // Keep the planned end intact; only seeds rows predating the column.
      dataToUpdate.originalTo = plannedEndToPreserve(bookingFound);

      const toDateStr = DateTime.fromJSDate(new Date(), {
        zone: hints.timeZone,
      }).toFormat(DATE_TIME_FORMAT);

      // Update the `to` date to current date
      dataToUpdate.to = DateTime.fromFormat(toDateStr, DATE_TIME_FORMAT, {
        zone: hints.timeZone,
      }).toJSDate();
    }

    // Pre-compute linked active booking IDs outside the transaction
    const linkedActiveBookingIds = new Set<string>();
    bookingFoundAssets.forEach((asset) => {
      (asset.bookingAssets ?? []).forEach((ba) => {
        const linkedBooking = ba.booking;
        if (
          linkedBooking.id !== bookingFound.id &&
          (linkedBooking.status === BookingStatus.ONGOING ||
            linkedBooking.status === BookingStatus.OVERDUE)
        ) {
          linkedActiveBookingIds.add(linkedBooking.id);
        }
      });
    });

    // Pre-fetch partial check-ins for linked bookings outside the transaction
    const partialCheckinsForLinkedBookings =
      linkedActiveBookingIds.size > 0
        ? await db.partialBookingCheckin.findMany({
            where: {
              bookingId: { in: Array.from(linkedActiveBookingIds) },
            },
            select: { bookingId: true, assetIds: true },
          })
        : [];

    // Build a map of bookingId -> Set of asset IDs that were partially checked in
    const partiallyCheckedInAssetsByBooking = new Map<string, Set<string>>();
    partialCheckinsForLinkedBookings.forEach((checkin) => {
      if (!partiallyCheckedInAssetsByBooking.has(checkin.bookingId)) {
        partiallyCheckedInAssetsByBooking.set(checkin.bookingId, new Set());
      }
      checkin.assetIds.forEach((assetId) => {
        partiallyCheckedInAssetsByBooking.get(checkin.bookingId)!.add(assetId);
      });
    });

    // Pre-compute which assets to check in outside the transaction
    const assetsToCheckin = bookingFoundAssets
      .filter((asset) => {
        if (asset.status !== AssetStatus.CHECKED_OUT) {
          return false;
        }

        const hasActiveBookingConflict = (asset.bookingAssets ?? []).some(
          (ba) => {
            const linkedBooking = ba.booking;
            if (
              linkedBooking.id === bookingFound.id ||
              (linkedBooking.status !== BookingStatus.ONGOING &&
                linkedBooking.status !== BookingStatus.OVERDUE)
            ) {
              return false;
            }

            const checkedInAssets = partiallyCheckedInAssetsByBooking.get(
              linkedBooking.id
            );
            if (checkedInAssets && checkedInAssets.has(asset.id)) {
              return false;
            }

            return true;
          }
        );

        if (hasActiveBookingConflict) {
          return false;
        }

        return true;
      })
      .map((asset) => asset.id);

    // Pre-compute which kits to check in
    const assetsToCheckinSet = new Set(assetsToCheckin);
    const kitsToCheckin = hasKits
      ? kitIds.filter((kitId) => {
          // Same union as the resolution above. Filtering on membership alone
          // yields [] for a kit reached only through provenance, and `.every()`
          // on [] is vacuously true — which would release it unconditionally.
          const kitAssetsInBooking = bookingFoundAssets.filter(
            (asset) =>
              sliceKitAssetIds.get(kitId)?.has(asset.id) ||
              asset.assetKits?.[0]?.kitId === kitId
          );
          return kitAssetsInBooking.every(
            (asset) =>
              assetsToCheckinSet.has(asset.id) ||
              asset.status === AssetStatus.AVAILABLE
          );
        })
      : [];

    /**
     * Build the lookups of explicit dispositions. Qty-tracked slices
     * without an explicit entry will auto-fill their remaining quantity
     * inside the transaction (default: RETURN all for TWO_WAY, CONSUME
     * all for ONE_WAY). This is the "big Check-in button" happy path —
     * everything's back.
     *
     * Two maps because a caller can target a disposition either:
     *   - at a specific slice (`bookingAssetId` set) — exact attribution,
     *     consumed once for that slice; OR
     *   - at the asset as a whole (`bookingAssetId` omitted) — legacy /
     *     drawer-less callers. An asset-level explicit disposition is
     *     applied to exactly ONE slice (see `consumedAssetLevelExplicit`
     *     below) so it isn't double-counted across every slice.
     */
    const explicitByBookingAssetId = new Map<string, CheckinDispositionInput>(
      checkins
        ?.filter((d) => d.bookingAssetId)
        .map((d) => [d.bookingAssetId!, d]) ?? []
    );
    const explicitByAssetId = new Map<string, CheckinDispositionInput>(
      checkins?.filter((d) => !d.bookingAssetId).map((d) => [d.assetId, d]) ??
        []
    );

    /**
     * Per-BookingAsset SLICE rows for qty-tracked assets. The same asset
     * can have multiple slices in one booking (one standalone +
     * N kit-driven), and each slice's ConsumptionLog rows must be tagged
     * with its own `bookingAssetId`. We carry the slice `id`, `assetId`
     * and `quantity` from the org-scoped `bookingFound.bookingAssets`
     * load at the top of this function.
     */
    const qtyTrackedSlices = bookingFound.bookingAssets
      .filter((ba) => ba.asset.type === AssetType.QUANTITY_TRACKED)
      .map((ba) => ({
        id: ba.id,
        assetId: ba.assetId,
        consumptionType: ba.asset.consumptionType,
        title: ba.asset.title,
      }));

    /** Distinct qty-tracked asset ids touched by the slices above. */
    const qtyTrackedAssetIds = [
      ...new Set(qtyTrackedSlices.map((s) => s.assetId)),
    ];

    /**
     * Per-asset disposition summary populated inside the transaction
     * (used AFTER the transaction for the quantity-aware activity note).
     */
    type CheckinQtySummary = {
      assetId: string;
      title: string;
      /**
       * Asset shape needed to render unit-aware disposition phrasing
       * via `formatUnitCount` (Phase 4e canonical helper). Populated
       * from the row-locked asset inside the tx so notes can read
       * "returned 10 boxes" rather than "returned 10".
       */
      type: AssetType;
      unitOfMeasure: string | null;
      returned: number;
      consumed: number;
      lost: number;
      damaged: number;
    };

    const qtySummariesRef: { value: CheckinQtySummary[] } = { value: [] };

    const updatedBooking = await db.$transaction(
      async (tx) => {
        // Authoritative status check — the pre-transaction assert above is a
        // cheap early exit, this is the one that holds. Locking matters here
        // because two concurrent check-ins would otherwise both read ONGOING
        // and both run the completion writes.
        assertBookingIsCheckinable({
          status: await lockBookingForStatusCheck(tx, id, organizationId),
          bookingId: id,
        });

        /**
         * Per-qty-tracked-asset disposition work. Runs FIRST so the
         * pool-drain guard can read the current `Asset.quantity` before
         * downstream status flips. Uses the Phase 2 row-lock pattern.
         */
        /**
         * ConsumptionLog rows require an attributed user. `checkinBooking`
         * permits `userId === undefined` (legacy signature), but we can't
         * write logs without one. If the booking has qty-tracked assets
         * with remaining units, userId must be provided.
         */
        if (qtyTrackedAssetIds.length > 0 && !userId) {
          // Check if any qty-tracked asset actually has work to do.
          for (const assetId of qtyTrackedAssetIds) {
            const remaining = await computeBookingAssetRemaining(
              tx,
              id,
              assetId
            );
            if (remaining > 0) {
              throw new ShelfError({
                cause: null,
                status: 400,
                label,
                message:
                  "Internal error: userId is required to check in a booking with quantity-tracked assets.",
              });
            }
          }
        }

        /**
         * Per-asset running pool of remaining units, seeded once from the
         * asset-level `computeBookingAssetRemaining`. As each slice claims
         * units we decrement this so the SUM across all slices of one asset
         * can never exceed the asset-level remaining — the backstop that
         * accounts for legacy `bookingAssetId IS NULL` logs which the
         * per-slice helper deliberately excludes.
         */
        const assetRemainingSoFar = new Map<string, number>();
        for (const assetId of qtyTrackedAssetIds) {
          assetRemainingSoFar.set(
            assetId,
            await computeBookingAssetRemaining(tx, id, assetId)
          );
        }

        /**
         * Asset-level explicit dispositions (no `bookingAssetId`) apply to
         * exactly ONE slice. Track which asset ids have already consumed
         * their asset-level explicit so later slices fall back to the
         * auto-default rather than re-applying it.
         */
        const consumedAssetLevelExplicit = new Set<string>();

        /**
         * Accumulate per-slice work into ONE summary per assetId so the
         * post-tx activity note (which renders per asset) isn't duplicated
         * when an asset has multiple slices.
         */
        const summaryByAssetId = new Map<string, CheckinQtySummary>();

        // Structured `ASSET_QUANTITY_CHANGED` events for the pool decrements
        // below — collected across slices and flushed once with `recordEvents`
        // (one round-trip) so the per-slice loop can't blow the interactive-tx
        // budget on large check-ins.
        const quantityChangeEvents: Parameters<typeof recordEvents>[0] = [];

        for (const slice of qtyTrackedSlices) {
          const sliceRemaining = await computeBookingAssetSliceRemaining(
            tx,
            id,
            slice.id
          );
          if (sliceRemaining <= 0) continue; // Already reconciled.

          // Cap by BOTH the slice's own remaining AND the asset-level
          // remaining still unclaimed in this pass. The asset-level cap is
          // the safety net for legacy NULL-tagged logs (excluded by the
          // per-slice helper) — without it, an asset with both tagged and
          // NULL logs could over-decrement the shared pool.
          const assetCap = assetRemainingSoFar.get(slice.assetId) ?? 0;
          const cap = Math.min(sliceRemaining, assetCap);
          if (cap <= 0) continue;

          // Resolve the effective disposition: explicit-by-slice wins;
          // else an asset-level explicit applied to ONE slice only; else
          // the auto-default based on consumptionType (capped to `cap`).
          let explicit = explicitByBookingAssetId.get(slice.id);
          if (!explicit) {
            const assetExplicit = explicitByAssetId.get(slice.assetId);
            if (
              assetExplicit &&
              !consumedAssetLevelExplicit.has(slice.assetId)
            ) {
              explicit = assetExplicit;
              consumedAssetLevelExplicit.add(slice.assetId);
            }
          }

          const disposition: CheckinDispositionInput = explicit ?? {
            assetId: slice.assetId,
            // Auto-default claims exactly `cap` units — never more than the
            // pool can cover, so it can't throw on legacy-NULL-reduced pools.
            ...(slice.consumptionType === "ONE_WAY"
              ? { consumed: cap }
              : { returned: cap }),
          };

          const claimed = sumDisposition(disposition);
          if (claimed === 0) {
            // Explicit disposition with no quantities — "leave pending".
            continue;
          }

          // Explicit dispositions that over-claim are a hard error (the
          // caller asked for more than is available). The auto-default
          // path is pre-clamped to `cap` above, so it never trips this.
          if (claimed > cap) {
            throw new ShelfError({
              cause: null,
              status: 400,
              label,
              message: `Cannot check in ${claimed} units for "${slice.title}". Only ${cap} remaining on this booking.`,
              shouldBeCaptured: false,
            });
          }

          const locked = await lockAssetForQuantityUpdate(
            tx,
            slice.assetId,
            organizationId
          );

          const poolDecrement =
            (disposition.consumed ?? 0) +
            (disposition.lost ?? 0) +
            (disposition.damaged ?? 0);

          if (poolDecrement > 0) {
            const custodyAgg = await tx.custody.aggregate({
              where: { assetId: slice.assetId },
              _sum: { quantity: true },
            });
            const inCustody = custodyAgg._sum?.quantity ?? 0;
            const projected = (locked.quantity ?? 0) - poolDecrement;
            if (projected < inCustody) {
              throw new ShelfError({
                cause: null,
                status: 400,
                label,
                message: `Cannot remove ${poolDecrement} units from "${locked.title}" — ${inCustody} are currently in custody and would be left uncovered.`,
                shouldBeCaptured: false,
              });
            }
          }

          // Always tag the slice id. An explicit disposition may already
          // carry its own `bookingAssetId` (drawer flow that picked a
          // specific slice) — honour that; otherwise tag with this slice's
          // id so the auto-default path no longer writes NULL.
          const dispBookingAssetId = disposition.bookingAssetId ?? slice.id;
          if ((disposition.returned ?? 0) > 0) {
            await createConsumptionLog({
              assetId: slice.assetId,
              category: "RETURN",
              quantity: disposition.returned!,
              userId: userId!,
              bookingId: id,
              bookingAssetId: dispBookingAssetId,
              tx,
            });
          }
          if ((disposition.consumed ?? 0) > 0) {
            await createConsumptionLog({
              assetId: slice.assetId,
              category: "CONSUME",
              quantity: disposition.consumed!,
              userId: userId!,
              bookingId: id,
              bookingAssetId: dispBookingAssetId,
              tx,
            });
          }
          if ((disposition.lost ?? 0) > 0) {
            await createConsumptionLog({
              assetId: slice.assetId,
              category: "LOSS",
              quantity: disposition.lost!,
              userId: userId!,
              bookingId: id,
              bookingAssetId: dispBookingAssetId,
              tx,
            });
          }
          if ((disposition.damaged ?? 0) > 0) {
            await createConsumptionLog({
              assetId: slice.assetId,
              category: "DAMAGE",
              quantity: disposition.damaged!,
              userId: userId!,
              bookingId: id,
              bookingAssetId: dispBookingAssetId,
              tx,
            });
          }

          if (poolDecrement > 0) {
            const beforeQuantity = locked.quantity ?? 0;
            await tx.asset.update({
              // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `slice.assetId` comes from `bookingFound.bookingAssets` loaded org-scoped via findUniqueOrThrow({where:{id,organizationId}}) at the top of checkinBooking
              where: { id: slice.assetId },
              data: { quantity: { decrement: poolDecrement } },
            });
            // Audit the stock drop. `locked` was freshly re-read per slice, so
            // for multiple slices of the same asset the from/to values chain
            // through the sequential decrements.
            quantityChangeEvents.push({
              organizationId,
              actorUserId: userId ?? null,
              action: "ASSET_QUANTITY_CHANGED",
              entityType: "ASSET",
              entityId: slice.assetId,
              assetId: slice.assetId,
              field: "quantity",
              fromValue: beforeQuantity,
              toValue: beforeQuantity - poolDecrement,
            });

            /**
             * Consumed / lost / damaged units are destroyed, which lowers the
             * total the PRD's location-axis invariant is measured against
             * (`SUM(AssetLocation.quantity WHERE assetKitId IS NULL) <=
             * Asset.quantity`). Reconcile in the same tx, or a placement sum
             * that was valid before check-in silently exceeds the total and
             * blocks the next legitimate placement edit.
             */
            const reconcile = await reconcileManualPlacementsForStockDecrease({
              assetId: slice.assetId,
              newTotal: beforeQuantity - poolDecrement,
              tx,
            });

            reportAmbiguousPlacementReconcile({
              result: reconcile,
              context: "Check-in",
              additionalData: { assetId: slice.assetId, bookingId: id },
            });
          }

          // Decrement the per-asset running pool by the amount claimed so
          // the next slice of the same asset can't re-claim it.
          assetRemainingSoFar.set(slice.assetId, assetCap - claimed);

          // Fold this slice's work into the per-asset summary.
          const existing = summaryByAssetId.get(slice.assetId) ?? {
            assetId: slice.assetId,
            title: locked.title,
            type: locked.type,
            unitOfMeasure: locked.unitOfMeasure,
            returned: 0,
            consumed: 0,
            lost: 0,
            damaged: 0,
          };
          existing.returned += disposition.returned ?? 0;
          existing.consumed += disposition.consumed ?? 0;
          existing.lost += disposition.lost ?? 0;
          existing.damaged += disposition.damaged ?? 0;
          summaryByAssetId.set(slice.assetId, existing);
        }

        // Flush the accumulated pool-decrement audit events atomically with
        // the decrements (same tx, single insert).
        if (quantityChangeEvents.length > 0) {
          await recordEvents(quantityChangeEvents, tx);
        }

        qtySummariesRef.value.push(...summaryByAssetId.values());

        if (assetsToCheckin.length > 0) {
          // INDIVIDUAL assets always get reset to AVAILABLE. Scope to the
          // caller's org (cross-org IDOR defence) on top of the type filter.
          await tx.asset.updateMany({
            where: {
              id: { in: assetsToCheckin },
              type: AssetType.INDIVIDUAL,
              organizationId,
            },
            data: { status: AssetStatus.AVAILABLE },
          });

          // QUANTITY_TRACKED assets need terminal-status reconciliation
          // rather than a binary AVAILABLE flip: an asset can simultaneously
          // sit on another ONGOING/OVERDUE booking or be held by a Custody
          // row, and stamping AVAILABLE silently strips those signals
          // (bug #99 follow-up a). `reconcileAssetStatusForBookingExit`
          // queries — under the same `tx` snapshot as the booking write —
          // the other active bookings and custody rows per asset, then
          // picks the strongest remaining commitment
          // (CHECKED_OUT > IN_CUSTODY > AVAILABLE). `excludeBookingId` is
          // the booking being checked in so its own rows do not self-pin
          // the asset to CHECKED_OUT.
          const qtyAssetIds = bookingFoundAssets
            .filter(
              (a) =>
                a.type === "QUANTITY_TRACKED" && assetsToCheckin.includes(a.id)
            )
            .map((a) => a.id);

          if (qtyAssetIds.length > 0) {
            await reconcileAssetStatusForBookingExit({
              tx,
              assetIds: qtyAssetIds,
              excludeBookingIds: [id],
              organizationId,
            });
          }
        }
        /* If there are any kits associated with the booking, then update their status */
        if (hasKits) {
          if (kitsToCheckin.length > 0) {
            await tx.kit.updateMany({
              where: { id: { in: kitsToCheckin }, organizationId },
              data: { status: KitStatus.AVAILABLE },
            });
          }
        }

        // Activity events — one BOOKING_CHECKED_IN per BookingAsset ROW that
        // was actually checked in. Progressive checkout can leave some assets
        // never-checked-out; those must NOT get a check-in event. Walk the
        // `bookingAssets` pivot (filtered by assetsToCheckin) so per-row
        // `meta.quantity` is sourced from the pivot row (qty-tracked only via
        // assetQtyMeta). Atomic with the booking status update for audit
        // trail consistency.
        const checkedInBookingAssets = bookingFound.bookingAssets.filter((ba) =>
          assetsToCheckinSet.has(ba.asset.id)
        );
        if (checkedInBookingAssets.length > 0) {
          await recordEvents(
            checkedInBookingAssets.map((ba) => ({
              organizationId,
              actorUserId: userId ?? null,
              action: "BOOKING_CHECKED_IN" as const,
              entityType: "BOOKING" as const,
              entityId: bookingFound.id,
              bookingId: bookingFound.id,
              assetId: ba.asset.id,
              meta: assetQtyMeta(ba.asset, ba.quantity),
            })),
            tx
          );
        }

        /**
         * Mark every outstanding slice as returned. This path writes no
         * `PartialBookingCheckin` row, so without this a completed booking
         * leaves its slices looking permanently checked out.
         *
         * Scoped to slices that actually went out: one never checked out has
         * nothing to reconcile, and stamping it would claim it came back.
         */
        await tx.bookingAsset.updateMany({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingFound id already org-checked via findUniqueOrThrow({where:{id,organizationId}})
          where: {
            bookingId: bookingFound.id,
            checkedOutAt: { not: null },
            checkedInAt: null,
          },
          data: { checkedInAt: new Date(), checkedInById: userId },
        });

        /** Finally update the booking */
        return tx.booking.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingFound id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L1552; this is the write on that same proven id
          where: { id: bookingFound.id },
          data: dataToUpdate,
          include: {
            ...BOOKING_INCLUDE_FOR_EMAIL,
            bookingAssets: {
              include: {
                asset: {
                  select: {
                    id: true,
                    assetKits: { select: { kitId: true } },
                  },
                },
              },
            },
          },
        });
      },
      { timeout: 15000 }
    );

    // Create status transition note
    if (userId) {
      if (specificAssetIds && specificAssetIds.length > 0) {
        // Create enhanced completion message with asset details
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });

        // Get asset and kit data for consistent formatting
        const assetsWithKitInfo = await db.asset.findMany({
          where: { id: { in: specificAssetIds }, organizationId },
          select: {
            id: true,
            title: true,
            assetKits: {
              select: { kit: { select: { id: true, name: true } } },
            },
          },
        });

        // Separate complete kits from individual assets
        const kitIds = getKitIdsByAssets(
          (updatedBooking.bookingAssets || [])
            .map((ba) => ba.asset)
            .filter((a) => specificAssetIds?.includes(a.id))
        );
        const completeKits: Array<{ id: string; name: string }> = [];
        const standaloneAssets: Array<{ id: string; title: string }> = [];
        const processedKitIds = new Set<string>();

        for (const asset of assetsWithKitInfo) {
          const assetKit = asset.assetKits?.[0]?.kit;
          if (
            assetKit &&
            kitIds.includes(assetKit.id) &&
            !processedKitIds.has(assetKit.id)
          ) {
            completeKits.push({ id: assetKit.id, name: assetKit.name });
            processedKitIds.add(assetKit.id);
          } else if (!assetKit) {
            standaloneAssets.push({ id: asset.id, title: asset.title });
          }
        }

        // Build items description
        const hasKits = completeKits.length > 0;
        const hasAssets = standaloneAssets.length > 0;
        let itemsDescription = "";

        if (hasKits && hasAssets) {
          const kitContent = wrapKitsWithDataForNote(
            completeKits,
            "checked in"
          );
          const assetContent = wrapAssetsWithDataForNote(
            standaloneAssets,
            "checked in"
          );
          itemsDescription = `${assetContent} and ${kitContent}`;
        } else if (hasKits) {
          itemsDescription = wrapKitsWithDataForNote(
            completeKits,
            "checked in"
          );
        } else if (hasAssets) {
          itemsDescription = wrapAssetsWithDataForNote(
            standaloneAssets,
            "checked in"
          );
        }

        // Create enhanced completion message
        const fromStatusBadge = wrapBookingStatusForNote(
          bookingFound.status,
          updatedBooking.custodianUserId || undefined
        );
        const toStatusBadge = wrapBookingStatusForNote(
          BookingStatus.COMPLETE,
          updatedBooking.custodianUserId || undefined
        );

        await createSystemBookingNote({
          bookingId: updatedBooking.id,
          organizationId,
          content: `${wrapUserLinkForNote(
            user!
          )} performed a partial check-in: ${itemsDescription} and completed the booking. Status changed from ${fromStatusBadge} to ${toStatusBadge}`,
        });

        // Record the canonical status transition event for reports.
        // The custom system note above replaces the standard transition note,
        // but downstream consumers (Booking Compliance report) still need the
        // BOOKING_STATUS_CHANGED → COMPLETE ActivityEvent to know when the
        // booking was actually checked in.
        await recordBookingStatusChangedEvent({
          organizationId,
          bookingId: updatedBooking.id,
          userId,
          fromStatus: bookingFound.status,
          toStatus: BookingStatus.COMPLETE,
        });
      } else {
        // Standard status transition note
        await createStatusTransitionNote({
          bookingId: updatedBooking.id,
          organizationId,
          fromStatus: bookingFound.status,
          toStatus: BookingStatus.COMPLETE,
          userId,
          custodianUserId: updatedBooking.custodianUserId || undefined,
        });
      }
    }

    /**
     * Per-asset notes for qty-tracked dispositions applied in this
     * check-in. Wrapped in try/catch — activity logging must never
     * fail a successful check-in. See the matching pattern in
     * `partialCheckinBooking` and `manage-assets`.
     */
    if (userId && qtySummariesRef.value.length > 0) {
      try {
        const actorUser = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });
        const actor = wrapUserLinkForNote({ ...actorUser, id: userId });

        /**
         * Shared booking link — per-asset notes point back to the booking
         * so the asset's activity feed shows which booking consumed /
         * returned / lost the units.
         */
        const bookingLink = wrapLinkForNote(
          `/bookings/${updatedBooking.id}`,
          updatedBooking.name
        );

        for (const summary of qtySummariesRef.value) {
          /**
           * Render disposition counts with the asset's `unitOfMeasure`
           * via `formatUnitCount` ("returned 10 boxes" instead of
           * "returned 10"). Phase 4e wording parity. The helper returns
           * `null` for INDIVIDUAL — defence-in-depth fallback to bare
           * integer (in practice this loop only sees qty-tracked rows).
           */
          const fmt = (qty: number) =>
            formatUnitCount(
              { type: summary.type, unitOfMeasure: summary.unitOfMeasure },
              qty
            ) ?? String(qty);

          const parts: string[] = [];
          if (summary.returned > 0)
            parts.push(`returned **${fmt(summary.returned)}**`);
          if (summary.consumed > 0)
            parts.push(`consumed **${fmt(summary.consumed)}**`);
          if (summary.lost > 0) parts.push(`**${fmt(summary.lost)}** lost`);
          if (summary.damaged > 0)
            parts.push(`**${fmt(summary.damaged)}** damaged`);

          if (parts.length > 0) {
            await createNotes({
              content: `${actor} via check-in on ${bookingLink}: ${parts.join(
                ", "
              )}.`,
              type: "UPDATE",
              userId,
              assetIds: [summary.assetId],
              organizationId,
            });
          }
        }

        // Booking-side summary for qty-tracked dispositions — one line
        // per asset with a clickable link + non-zero category parts so
        // the operator can see WHICH assets were touched, not just
        // aggregate totals. Previously this note conflated everything
        // into "10 returned, 2 lost" with no asset names.
        const perAssetFragment = buildQtyPerAssetFragment(
          qtySummariesRef.value
        );
        if (perAssetFragment) {
          await createSystemBookingNote({
            bookingId: updatedBooking.id,
            organizationId,
            content: `${actor} dispositioned quantity-tracked assets: ${perAssetFragment}.`,
          });
        }
      } catch (noteError) {
        Logger.error(
          new ShelfError({
            cause: noteError,
            message: "Failed to write quantity check-in activity notes",
            label,
            additionalData: { userId, bookingId: id },
          })
        );
      }
    }

    /**
     * At this point when user is checking in the booking,
     * we just have to cancel all active scheduler (if there is any).
     * Because, if the only possible case is OVERDUE, and if it was OVERDUE
     * during the checkin it must have been handled by overdueHandler.
     */
    await cancelScheduler(updatedBooking);

    /**
     * Check if auto-archive is enabled for this organization
     * and schedule the auto-archive job if needed
     */
    const bookingSettings = await db.bookingSettings.findUnique({
      where: { organizationId: updatedBooking.organizationId },
      select: {
        autoArchiveBookings: true,
        autoArchiveDays: true,
      },
    });

    if (bookingSettings?.autoArchiveBookings) {
      const when = new Date();
      when.setDate(when.getDate() + bookingSettings.autoArchiveDays);

      await scheduleNextBookingJob({
        data: {
          id: updatedBooking.id,
          hints,
          eventType: BOOKING_SCHEDULER_EVENTS_ENUM.autoArchiveHandler,
        },
        when,
      });
    }

    // Resolve notification recipients and send personalized emails
    const recipients = await getBookingNotificationRecipients({
      booking: updatedBooking,
      eventType: "CHECKIN",
      organizationId: updatedBooking.organizationId,
      editorUserId: userId,
    });

    if (recipients.length > 0) {
      const custodian =
        resolveUserDisplayName(updatedBooking.custodianUser) ||
        updatedBooking.custodianTeamMember?.name ||
        "";

      await sendBookingEmailToAllRecipients({
        recipients,
        booking: updatedBooking,
        subject: `🎉 Booking complete (${updatedBooking.name}) - shelf.nu`,
        buildText: (prefs) =>
          completedBookingEmailContent({
            bookingName: updatedBooking.name,
            assetsCount: updatedBooking._count.bookingAssets,
            custodian,
            from: updatedBooking.from!,
            to: updatedBooking.to!,
            bookingId: updatedBooking.id,
            prefs,
            customEmailFooter: updatedBooking.organization.customEmailFooter,
          }),
        buildHeading: () =>
          `Your booking has been completed: "${updatedBooking.name}"`,
        hints,
      });
    }

    /**
     * Low-stock check for every qty-tracked asset whose pool actually dropped
     * this check-in (CONSUME / LOSS / DAMAGE — RETURN puts units back so it
     * can't cross a threshold DOWN). Derived from the per-asset summaries: a
     * decrement happened iff consumed + lost + damaged > 0. Runs OUTSIDE the
     * committed transaction (best-effort — a notification failure must never
     * roll back a successful check-in). `userId` may be undefined here
     * (legacy signature); the notifier emails owner+admins regardless and
     * only skips the in-app sender when there is no acting user.
     */
    await notifyLowStockForDecrementedAssets({
      summaries: qtySummariesRef.value,
      organizationId,
      bookingId: id,
      userId,
      context: "booking check-in",
    });

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while checking in booking.",
    });
  }
}

/**
 * Per-asset disposition entry accepted by the check-in service functions.
 *
 * See `checkinDispositionSchema` in
 * `components/scanner/drawer/uses/partial-checkin-drawer.tsx` for the
 * corresponding Zod schema / payload documentation.
 */
export type CheckinDispositionInput = {
  assetId: string;
  /**
   * Per-row attribution for QUANTITY_TRACKED assets with multiple
   * BookingAsset slices (kit-driven + standalone). When set the
   * ConsumptionLog rows get this `bookingAssetId` so future reads
   * can attribute the disposition to the right slice. Optional for
   * back-compat with callers that pre-date Polish-6 per-row support
   * (mobile API, simple `assetIds`-only check-ins) — those write
   * `bookingAssetId: null` and rely on the greedy-fill fallback in
   * the loaders.
   */
  bookingAssetId?: string | null;
  returned?: number;
  consumed?: number;
  lost?: number;
  damaged?: number;
};

/**
 * Sum of all "claimed" units in a single check-in disposition — i.e. the
 * ones that reduce `remaining` for the (booking, asset) pair. Pending
 * units are never submitted explicitly; they emerge from the gap between
 * remaining and this sum.
 */
function sumDisposition(d: CheckinDispositionInput): number {
  return (
    (d.returned ?? 0) + (d.consumed ?? 0) + (d.lost ?? 0) + (d.damaged ?? 0)
  );
}

/**
 * Per-asset payload for a progressive checkout disposition. Mirror of the
 * `CheckinDispositionInput` shape but unidirectional — checkout only takes
 * units from the booking's pool; it does not have return/consumed/lost
 * categories like the check-IN side.
 *
 * INDIVIDUAL assets always implicitly use quantity=1 and don't need an
 * entry here — bare `assetIds[]` continues to work for the legacy
 * callers + INDIVIDUAL-only bookings.
 */
export type CheckoutDispositionInput = {
  assetId: string;
  /** Per-slice attribution; mirror of Polish-7b semantics in check-IN. Optional for legacy / INDIVIDUAL. */
  bookingAssetId?: string | null;
  /** Units to claim from this asset's BookingAsset slice on this booking.
   *  Required for QUANTITY_TRACKED; clamped to [1, remaining-to-check-out]. */
  quantity: number;
  /**
   * INTERNAL ONLY — never set by an API caller. The legacy `assetIds[]`
   * fallback tags a QUANTITY_TRACKED asset scanned with no explicit count so
   * the in-tx loop resolves it to "all remaining units" (the per-asset cap
   * under the row lock) instead of the sentinel `quantity: 1`. Mirrors the
   * "Check Out All" default so a bare mobile scan takes the whole line, not one
   * unit. Explicit per-unit `quantity` payloads are honored verbatim.
   */
  defaultAllRemaining?: boolean;
};

/**
 * Local summary type carried out of the partial-checkout tx into the post-tx
 * note writers. Phase 4e parity: carries `type` + `unitOfMeasure` so
 * `formatUnitCount` can render "checked out 10 boxes" instead of
 * "checked out 10".
 */
export type CheckoutQtyDispositionSummary = {
  assetId: string;
  title: string;
  type: AssetType;
  unitOfMeasure: string | null;
  /** Quantity claimed by this scan. (Cumulative remaining on the booking is
   *  derived elsewhere — this is per-batch.) */
  quantity: number;
};

/**
 * Build a markdoc fragment naming each qty-tracked asset touched in
 * this session along with its per-category disposition. Used by the
 * booking-side activity note for both `partialCheckinBooking` and
 * `checkinBooking` so the operator can see WHICH assets were
 * dispositioned — not just aggregate totals.
 *
 * Produces something like:
 *   `{% link to="/assets/<id>" text="Pens" /%} (10 returned), {% link
 *    to="/assets/<id>" text="AA Batteries" /%} (5 consumed, 2 damaged)`
 *
 * Returns an empty string when no row has any non-zero disposition,
 * so callers can safely concatenate without extra guards.
 */
function buildQtyPerAssetFragment(
  summaries: Array<{
    assetId: string;
    title: string;
    /**
     * Asset shape — feeds `formatUnitCount` so qty-tracked rows render
     * the asset's `unitOfMeasure` ("10 boxes" instead of "10"). Phase 4e
     * wording parity with the per-axis note sweep.
     */
    type: AssetType;
    unitOfMeasure: string | null;
    returned: number;
    consumed: number;
    lost: number;
    damaged: number;
    pendingAfter?: number;
  }>
): string {
  const fragments: string[] = [];
  for (const s of summaries) {
    /**
     * `formatUnitCount` returns `null` for INDIVIDUAL (the helper's contract).
     * Defence-in-depth: this loop only sees qty-tracked rows in practice (the
     * `qtySummaries`/`CheckinQtySummary` arrays are populated inside the
     * QUANTITY_TRACKED disposition branches), but the bare-integer fallback
     * keeps phrasing sensible if an INDIVIDUAL ever sneaks in.
     */
    const fmt = (qty: number) =>
      formatUnitCount({ type: s.type, unitOfMeasure: s.unitOfMeasure }, qty) ??
      String(qty);

    const parts: string[] = [];
    if (s.returned > 0) parts.push(`${fmt(s.returned)} returned`);
    if (s.consumed > 0) parts.push(`${fmt(s.consumed)} consumed`);
    if (s.lost > 0) parts.push(`${fmt(s.lost)} lost`);
    if (s.damaged > 0) parts.push(`${fmt(s.damaged)} damaged`);
    if (s.pendingAfter && s.pendingAfter > 0) {
      parts.push(`${fmt(s.pendingAfter)} pending`);
    }
    if (parts.length === 0) continue;
    const link = wrapLinkForNote(`/assets/${s.assetId}`, s.title);
    fragments.push(`${link} (${parts.join(", ")})`);
  }
  return fragments.join(", ");
}

/**
 * A reservation that was outranked by an in-flight booking's check-out.
 *
 * @see {@link buildOverriddenReservationNotes}
 */
export type OverriddenReservation = {
  /** The RESERVED booking that lost the asset(s) */
  id: string;
  /** Its user-supplied name — untrusted, must never be spliced raw */
  name: string;
  /** The assets it reserved that were just checked out elsewhere */
  assets: Array<{ id: string; title: string }>;
};

/**
 * Build the pair of system notes recording that an in-flight booking checked
 * out an asset an overlapping RESERVED booking also held.
 *
 * Both sides get a note so the clash is never silent: the checking-out booking
 * records what it overrode, and the reservation records that its asset is gone
 * — the reservation's owner would otherwise not discover it until their own
 * check-out failed.
 *
 * All user-supplied values (booking names, asset titles) go through the
 * markdoc wrappers, which place them inside quoted, escaped tag attributes —
 * never raw — so a booking named `{% link to="javascript:…" /%}` cannot inject
 * a live tag into the rendered note feed.
 *
 * @param reservation - The outranked reservation and the assets it lost
 * @param current - The in-flight booking that checked the assets out
 * @returns Note content for the current booking and for the reservation
 */
export function buildOverriddenReservationNotes(
  reservation: OverriddenReservation,
  current: { id: string; name: string }
): { currentBookingNote: string; reservedBookingNote: string } {
  const assetsFragment = wrapAssetsWithDataForNote(
    reservation.assets,
    "checked out"
  );
  const isPlural = reservation.assets.length > 1;
  const verb = isPlural ? "were" : "was";
  const pronoun = isPlural ? "them" : "it";

  const reservationLink = wrapLinkForNote(
    `/bookings/${reservation.id}`,
    reservation.name
  );
  const currentLink = wrapLinkForNote(`/bookings/${current.id}`, current.name);

  return {
    currentBookingNote:
      `${assetsFragment} ${verb} also reserved by ${reservationLink} for an overlapping period. ` +
      `This booking is already checked out, so it takes priority — that reservation may need ${pronoun} replaced.`,
    reservedBookingNote:
      `${assetsFragment} ${verb} checked out by ${currentLink}, which overlaps this reservation and is already in progress. ` +
      `You may need to replace ${pronoun} before this booking starts.`,
  };
}

/**
 * Build a markdoc fragment naming each qty-tracked slice checked OUT in this
 * session. Mirror of {@link buildQtyPerAssetFragment} but unidirectional —
 * checkout only carries one count per slice (no return/consume/loss/damage
 * fan-out).
 *
 * Layer 3: each row is now rendered PER SLICE with a label, so a slice-level
 * checkout reports slice-level totals instead of the whole asset's booked
 * count. A tagged slice (dialog checkout, `bookingAssetId` set) produces:
 *   `{% link ... text="Gloves" /%} · standalone (11 of 22 boxes checked out, 11 still booked)`
 *   `{% link ... text="Gloves" /%} · in kit Kittington (100 of 100 boxes checked out)`
 * — the `, N still booked` clause is omitted when the slice is fully out. A
 * legacy / greedy disposition (no `bookingAssetId`, e.g. the scanner) has no
 * slice context, so it falls back to the pre-Layer-3 asset-level phrasing:
 *   `{% link ... text="Pens" /%} (10 boxes checked out, 5 boxes still booked)`
 *
 * Returns an empty string when no row has a positive count so callers can
 * safely concatenate without extra guards.
 */
function buildQtyPerAssetCheckoutFragment(
  summaries: Array<{
    assetId: string;
    title: string;
    type: AssetType;
    unitOfMeasure: string | null;
    checkedOut: number;
    remainingAfter: number;
    bookingAssetId: string | null;
    assetKitId: string | null;
    kitName: string | null;
    sliceBooked: number;
  }>
): string {
  const fragments: string[] = [];
  for (const s of summaries) {
    // `formatUnitCount` returns `null` for INDIVIDUAL; fall back to the bare
    // integer so phrasing stays sensible if one ever sneaks in (in practice
    // this loop only sees qty-tracked rows).
    const fmt = (qty: number) =>
      formatUnitCount({ type: s.type, unitOfMeasure: s.unitOfMeasure }, qty) ??
      String(qty);
    const link = wrapLinkForNote(`/assets/${s.assetId}`, s.title);

    // Per-slice phrasing — dialog checkouts carry the exact BookingAsset id.
    if (s.bookingAssetId) {
      const sliceLabel = s.assetKitId
        ? // SECURITY: `kitName` is free-form user input (Kit.name) spliced into
          // note text that is rendered through Markdoc. Strip Markdoc delimiters
          // so a kit named e.g. `X{% link to="javascript:..." /%}` cannot inject
          // a live tag (stored XSS). Sanitize-at-write — see
          // .claude/rules/sanitize-note-content-markdoc.md.
          `in kit ${stripMarkdocDelimiters(s.kitName ?? "kit") || "kit"}`
        : "standalone";
      // The unit rides on the slice total via `formatUnitCount` ("22 boxes");
      // the checked-out count stays a bare number so the phrase reads
      // "11 of 22 boxes checked out". `still booked` is a bare number too, and
      // is omitted entirely when the slice is fully out (remaining 0).
      const sliceParts = [
        `${s.checkedOut} of ${fmt(s.sliceBooked)} checked out`,
      ];
      if (s.remainingAfter > 0) {
        sliceParts.push(`${s.remainingAfter} still booked`);
      }
      fragments.push(`${link} · ${sliceLabel} (${sliceParts.join(", ")})`);
      continue;
    }

    // Legacy / greedy disposition (no slice tag) → asset-level phrasing.
    const parts: string[] = [];
    if (s.checkedOut > 0) parts.push(`${fmt(s.checkedOut)} checked out`);
    if (s.remainingAfter > 0) {
      parts.push(`${fmt(s.remainingAfter)} still booked`);
    }
    if (parts.length === 0) continue;
    fragments.push(`${link} (${parts.join(", ")})`);
  }
  return fragments.join(", ");
}

export async function partialCheckinBooking({
  id,
  organizationId,
  assetIds: rawAssetIds,
  checkins,
  userId,
  hints,
  intentChoice,
}: Pick<Booking, "id" | "organizationId"> & {
  /** Legacy payload — asset IDs only, no per-asset quantities. */
  assetIds?: Asset["id"][];
  /** Per-asset dispositions (takes precedence over `assetIds`). */
  checkins?: CheckinDispositionInput[];
  userId: User["id"];
  hints: ClientHint;
  intentChoice?: CheckinIntentEnum;
}) {
  try {
    // Dedupe once up front so counts, the PartialBookingCheckin record, and the
    // per-asset events are idempotent — the mobile endpoint's body schema does
    // not enforce unique assetIds, so a client could submit duplicates.
    const assetIds = rawAssetIds ? [...new Set(rawAssetIds)] : undefined;

    /**
     * Resolve the effective per-asset payload. Callers MAY pass either
     * or BOTH of:
     *   - `checkins` — per-asset disposition for QUANTITY_TRACKED assets
     *     (new drawer flow)
     *   - `assetIds` — flat asset-id list (legacy callers + INDIVIDUAL
     *     assets in the new drawer, which don't carry dispositions)
     *
     * When a mixed drawer session scans an INDIVIDUAL asset AND a
     * qty-tracked asset with a disposition, BOTH arrays arrive
     * populated. We merge them: every entry in `checkins` is used
     * verbatim, and any `assetIds` entry not already covered by
     * `checkins` is added as a no-disposition entry (the INDIVIDUAL
     * status-update branch below picks them up).
     *
     * Treating the two as mutually exclusive was a regression —
     * INDIVIDUAL scans would silently drop out whenever a qty-tracked
     * disposition was in the same submit.
     */
    const dispositions: CheckinDispositionInput[] = [];
    /**
     * Dedup key for `checkins`: `(assetId, bookingAssetId)`. Polish-7b
     * allows MULTIPLE dispositions for the same asset in one submit — one
     * per BookingAsset slice (kit-driven + standalone) — so we must NOT
     * collapse by `assetId`. A repeated (assetId, bookingAssetId) pair
     * (double-submit of the same slice) still collapses to one. Legacy
     * callers omit `bookingAssetId`, so they key on `assetId::null` and
     * behave exactly as before (one entry per asset).
     */
    const seenDispositionKeys = new Set<string>();
    const assetIdsWithDisposition = new Set<string>();
    /**
     * Bare (assetIds-only) scans of QUANTITY_TRACKED assets. These carry no
     * disposition and mean "check in all remaining units" for that asset —
     * resolved in the tx loop below (mirrors checkinBooking's big-button
     * default). Tracked so the zero-disposition guard exempts them: only an
     * EXPLICIT drawer disposition must carry a non-zero amount.
     */
    const bareCheckinAssetIds = new Set<string>();
    for (const d of checkins ?? []) {
      const key = `${d.assetId}::${d.bookingAssetId ?? "null"}`;
      if (seenDispositionKeys.has(key)) continue;
      seenDispositionKeys.add(key);
      dispositions.push(d);
      assetIdsWithDisposition.add(d.assetId);
    }
    /**
     * INDIVIDUAL scans (and legacy `assetIds`-only callers) arrive via
     * `assetIds`. Add a no-disposition entry for any asset not already
     * covered by a `checkins` entry — the INDIVIDUAL status-update branch
     * below picks them up. Treating the two arrays as mutually exclusive
     * was a regression: INDIVIDUAL scans dropped out whenever a qty
     * disposition shared the submit.
     */
    for (const assetId of assetIds ?? []) {
      if (!assetIdsWithDisposition.has(assetId)) {
        assetIdsWithDisposition.add(assetId);
        dispositions.push({ assetId });
        bareCheckinAssetIds.add(assetId);
      }
    }

    if (dispositions.length === 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message: "No assets provided for check-in.",
        shouldBeCaptured: false,
      });
    }

    /** Derived flat asset-id list used by the existing kit/status logic. */
    const effectiveAssetIds = dispositions.map((d) => d.assetId);

    /**
     * True when any disposition in this payload carries non-zero quantity
     * fields. Used to decide whether to skip the "all remaining scanned →
     * redirect to checkinBooking" early-exit: per-asset qty logic must run
     * in this function's transaction so we don't split the work across
     * two services.
     */
    const hasQuantityDispositions = dispositions.some(
      (d) => sumDisposition(d) > 0
    );

    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    // First, validate the booking exists and get its current assets
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          bookingAssets: {
            // `checkedOutAt`/`checkedInAt` drive the per-slice check-in
            // eligibility guard below.
            include: {
              asset: {
                select: {
                  id: true,
                  type: true,
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          status: 404,
          label,
          message:
            "Booking not found, are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    /**
     * Map bookingAssets to flat asset array for downstream logic. Also validate
     * that every asset in the payload is actually on the booking BEFORE any
     * completion shortcut. Without this guard a batch like [lastOutstandingAsset,
     * unrelatedSameOrgAsset] would satisfy "covers all outstanding" and complete
     * the booking (writing notes about a non-booking asset) instead of returning
     * a 400. The mobile endpoint forwards raw assetIds with none of the web
     * drawer's client-side filtering, so this is the only safety net.
     */
    const bookingFoundAssets = bookingFound.bookingAssets.map((ba) => ba.asset);

    /** Types keyed by assetId — lets per-asset branches pick the right code path. */
    const assetTypeById = new Map<string, AssetType>(
      bookingFoundAssets.map((a) => [a.id, a.type])
    );

    const bookingAssetIds = new Set(bookingFoundAssets.map((a) => a.id));
    const invalidAssetIds = effectiveAssetIds.filter(
      (id_) => !bookingAssetIds.has(id_)
    );
    if (invalidAssetIds.length > 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message: `Some assets are not part of this booking: ${invalidAssetIds.join(
          ", "
        )}`,
        shouldBeCaptured: false,
      });
    }

    // Qty-tracked assets MUST carry at least one non-zero disposition.
    // The drawer surfaces this as a blocker before submission, but we
    // defend server-side too.
    for (const d of dispositions) {
      const isQty = assetTypeById.get(d.assetId) === AssetType.QUANTITY_TRACKED;
      // Bare scans (assetIds-only) auto-default to "all remaining" in the tx
      // loop below, so exempt them here — only an EXPLICIT drawer disposition
      // must carry a non-zero amount.
      if (
        isQty &&
        sumDisposition(d) === 0 &&
        !bareCheckinAssetIds.has(d.assetId)
      ) {
        throw new ShelfError({
          cause: null,
          status: 400,
          label,
          message:
            "Quantity-tracked assets must include at least one non-zero disposition (returned, consumed, lost, or damaged).",
          shouldBeCaptured: false,
        });
      }
    }

    // Progressive checkout guard: an asset can only be checked IN if it was
    // first checked OUT. With progressive checkout a booking can hold
    // still-Booked (AVAILABLE) assets that were never scanned out — attempting
    // to check those in is invalid and must be rejected before the
    // "covers all remaining" early-exit (which would otherwise complete the
    // booking and flip never-checked-out assets to AVAILABLE no-ops).
    // Eligibility is per SLICE, read from `BookingAsset.checkedOutAt`, and
    // neither of the two obvious stand-ins can replace it:
    //   - global `Asset.status`: an asset may be CHECKED_OUT by a DIFFERENT
    //     active booking while never having gone out on this one.
    //   - "does this booking have any PartialBookingCheckout rows?": those
    //     record progressive scan SESSIONS, and the all-at-once checkout writes
    //     none. A booking checked out with the button that later gains ONE
    //     scanned asset gets its first row, and a booking-level test then
    //     reports every button-checked-out asset as never checked out.
    /**
     * Slices by id, for the per-disposition checks below. Built from the
     * booking's own rows, which `findUniqueOrThrow({ id, organizationId })`
     * already org-scoped — so a `bookingAssetId` naming a foreign or unrelated
     * slice is ineligible by construction rather than by a separate lookup.
     */
    const sliceById = new Map(
      bookingFound.bookingAssets.map((ba) => [ba.id, ba])
    );

    /**
     * Asset-level view of the same markers, for UNTAGGED callers only: the
     * mobile endpoint and legacy `assetIds`-only scans send no
     * `bookingAssetId`, and an INDIVIDUAL asset has a single slice per booking,
     * so asset-level and slice-level coincide for them.
     *
     * A tagged disposition must NOT be judged through this — one slice's marker
     * would authorise a sibling that never went out.
     */
    const assetIdsWithACheckedOutSlice = new Set(
      bookingFound.bookingAssets
        .filter((ba) => Boolean(ba.checkedOutAt))
        .map((ba) => ba.assetId)
    );
    const assetIdsWithAReconciledSlice = new Set(
      bookingFound.bookingAssets
        .filter((ba) => Boolean(ba.checkedInAt))
        .map((ba) => ba.assetId)
    );
    /**
     * Slices still out: gone out and not yet reconciled. An asset can hold a
     * reconciled slice AND an outstanding one at the same time — a qty-tracked
     * asset carries a standalone slice plus one per kit — so a reconciled slice
     * alone does not mean the asset is finished with.
     */
    const assetIdsWithAnOutstandingSlice = new Set(
      bookingFound.bookingAssets
        .filter((ba) => Boolean(ba.checkedOutAt) && !ba.checkedInAt)
        .map((ba) => ba.assetId)
    );

    /**
     * Tagged dispositions are judged against their EXACT slice. A
     * `QUANTITY_TRACKED` asset can hold a standalone slice plus N kit-driven
     * slices on one booking (see the partial uniques on `BookingAsset`), and a
     * slice added to an already-ONGOING booking carries no checkout marker —
     * so "some slice of this asset is out" is not permission to reconcile
     * units of a different one.
     */
    for (const d of dispositions) {
      if (!d.bookingAssetId) continue;
      const slice = sliceById.get(d.bookingAssetId);
      if (!slice || slice.assetId !== d.assetId) {
        throw new ShelfError({
          cause: null,
          status: 400,
          label,
          message:
            "One of the submitted items does not belong to this booking.",
          shouldBeCaptured: false,
        });
      }
      if (slice.checkedInAt) {
        throw new ShelfError({
          cause: null,
          status: 400,
          label,
          message: "These assets are already checked in.",
          shouldBeCaptured: false,
        });
      }
      if (!slice.checkedOutAt) {
        throw new ShelfError({
          cause: null,
          status: 400,
          label,
          message: "Cannot check in assets that were never checked out.",
          shouldBeCaptured: false,
        });
      }
    }

    /**
     * Assets whose eligibility the asset-level path still decides: everything
     * scanned that no TAGGED disposition already covered. Derived by exclusion
     * rather than from the untagged dispositions, because a bare `assetIds`
     * scan carries no disposition entry at all and must still be judged.
     */
    const assetIdsCoveredBySliceCheck = new Set(
      dispositions.filter((d) => d.bookingAssetId).map((d) => d.assetId)
    );

    const scannedAssets = await db.asset.findMany({
      where: { id: { in: effectiveAssetIds }, organizationId },
      select: { id: true, title: true },
    });

    /** Formats up to three titles, then "and N more". */
    const nameList = (assets: { title: string }[]) =>
      `${assets
        .slice(0, 3)
        .map((a) => a.title)
        .join(", ")}${
        assets.length > 3 ? ` and ${assets.length - 3} more` : ""
      }`;

    // Checked in already: a duplicate request, not an invalid one. Tested
    // FIRST, and independently of `checkedOutAt` — a reconciled slice carries
    // both markers, and "never checked out" would be the wrong reason to give.
    //
    // "Already" has to mean the whole asset, not one of its slices. An untagged
    // claim names no slice, so it is a claim on whatever the asset still has
    // out; while any slice is outstanding there is something left to check in,
    // and refusing would strand it with no way for the operator around it.
    const alreadyCheckedIn = scannedAssets.filter(
      (a) =>
        !assetIdsCoveredBySliceCheck.has(a.id) &&
        assetIdsWithAReconciledSlice.has(a.id) &&
        !assetIdsWithAnOutstandingSlice.has(a.id)
    );
    if (alreadyCheckedIn.length > 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message: `These assets are already checked in: ${nameList(
          alreadyCheckedIn
        )}.`,
        shouldBeCaptured: false,
      });
    }

    const notCheckedOut = scannedAssets.filter(
      (a) =>
        !assetIdsCoveredBySliceCheck.has(a.id) &&
        !assetIdsWithACheckedOutSlice.has(a.id) &&
        !assetIdsWithAReconciledSlice.has(a.id)
    );
    if (notCheckedOut.length > 0) {
      // A booking can hold still-Booked (AVAILABLE) assets that were added
      // after checkout — `updateBookingAssets` deliberately does not
      // auto-check-out onto an ONGOING booking — and those cannot be checked in.
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message: `Cannot check in assets that were never checked out: ${nameList(
          notCheckedOut
        )}.`,
        // User-input validation, like the sibling guards above. Without this it
        // defaulted to captured and filled Sentry with a working guard.
        shouldBeCaptured: false,
      });
    }

    // Early exit: if this batch returns every asset still outstanding for THIS
    // booking, run a complete check-in instead of recording another partial one.
    //
    // Completion is decided from this booking's PartialBookingCheckin records —
    // NOT from the assets' global `status`. Assets are shared across overlapping
    // bookings, so an asset that was returned for this booking can be
    // CHECKED_OUT again by a later booking. Keying completion on global status
    // therefore left the booking stuck ONGOING/OVERDUE even though every item
    // was returned here. The records are the per-booking source of truth and
    // match what the check-in progress bar shows the user (fix from main:
    // ddafe62fd / 9df00afff).
    //
    // Only safe when no qty dispositions are in play, because per-asset qty
    // work needs to run in this function's transaction (so we don't split
    // consumption-log writes across two services).
    if (!hasQuantityDispositions) {
      const alreadyCheckedInAssetIds = await getPartiallyCheckedInAssetIds(id);
      const recordedAssetIdSet = new Set(alreadyCheckedInAssetIds);
      const providedAssetIds = new Set(effectiveAssetIds);

      // Outstanding = CHECKED-OUT-for-this-booking assets not yet checked
      // back in. Crucially this is the eligible (checked-out) set, NOT every
      // booking asset: a progressive booking can hold never-checked-out items,
      // and counting those as outstanding would keep it stuck ONGOING forever
      // after the actually checked-out items are all returned.
      const outstandingAssetIds = [...assetIdsWithACheckedOutSlice].filter(
        (assetId) => !recordedAssetIdSet.has(assetId)
      );

      if (
        bookingFoundAssets.length > 0 &&
        outstandingAssetIds.length > 0 &&
        outstandingAssetIds.every((assetId) => providedAssetIds.has(assetId))
      ) {
        // Don't create a PartialBookingCheckin row — the redirect to
        // `checkinBooking` handles completion itself.
        const actor = wrapUserLinkForNote({ ...user, id: userId });
        await createNotes({
          content: `${actor} checked in via explicit check-in scanner. All assets were scanned, so complete check-in was performed.`,
          type: "UPDATE",
          userId,
          assetIds: effectiveAssetIds,
          organizationId,
        });

        const completedBooking = await checkinBooking({
          id,
          organizationId,
          hints,
          intentChoice,
          userId,
          specificAssetIds: effectiveAssetIds,
        });

        return {
          booking: completedBooking,
          checkedInAssetCount: effectiveAssetIds.length,
          remainingAssetCount: 0,
          isComplete: true,
        };
      }
    }

    /**
     * The kits each of this booking's slices belongs to.
     *
     * Slice-grained because that is the grain the release gate has to answer
     * at. A QUANTITY_TRACKED asset holds a standalone slice plus one per kit it
     * belongs to on the same booking — the two partial uniques on
     * `BookingAsset` allow exactly that — so an asset id names several kits at
     * once and cannot say which of them a given return came back to.
     *
     * Which kits this session actually releases is decided inside the
     * transaction, once the slices it settled are known: see `completeKitIds`
     * there.
     */
    const kitIdsBySliceId = await getKitIdsBySlice({
      slices: bookingFound.bookingAssets.map((ba) => ({
        id: ba.id,
        assetKitId: ba.assetKitId ?? null,
        sourceKitId: ba.sourceKitId ?? null,
        assetKits: ba.asset?.assetKits ?? [],
      })),
      organizationId,
    });

    /**
     * Per-asset disposition summary — populated inside the transaction as
     * each qty-tracked asset is processed. Used AFTER the transaction for
     * activity notes (kept outside the tx so a markdoc hiccup can't roll
     * back a valid check-in).
     */
    type QtyDispositionSummary = {
      assetId: string;
      title: string;
      /**
       * Asset shape needed to render unit-aware disposition phrasing
       * via `formatUnitCount` (Phase 4e canonical helper). Populated
       * from the row-locked asset inside the tx so notes can read
       * "returned 10 boxes" rather than "returned 10".
       */
      type: AssetType;
      unitOfMeasure: string | null;
      returned: number;
      consumed: number;
      lost: number;
      damaged: number;
      /** Units still outstanding after this session (implicit "pending"). */
      pendingAfter: number;
    };

    const txResult = await db.$transaction(async (tx) => {
      /**
       * Per-asset quantity dispositions for QUANTITY_TRACKED assets.
       * Runs before the status updates so the pool-drain guard can
       * read the current `Asset.quantity`. Uses the row-lock pattern
       * to serialize concurrent check-in sessions on the same asset.
       */
      const qtySummaries: QtyDispositionSummary[] = [];
      const fullyReconciledQtyAssetIds: string[] = [];

      // Structured `ASSET_QUANTITY_CHANGED` events for the pool decrements
      // below — collected across dispositions and flushed once with
      // `recordEvents` so the loop stays within the interactive-tx budget.
      const quantityChangeEvents: Parameters<typeof recordEvents>[0] = [];

      for (const disp of dispositions) {
        if (assetTypeById.get(disp.assetId) !== AssetType.QUANTITY_TRACKED) {
          continue;
        }

        const lockedAsset = await lockAssetForQuantityUpdate(
          tx,
          disp.assetId,
          organizationId
        );

        /**
         * Re-query remaining inside the transaction, AFTER the lock. This
         * closes the race with another check-in session that committed
         * between our loader read and our tx start.
         */
        const remaining = await computeBookingAssetRemaining(
          tx,
          id,
          disp.assetId
        );

        /**
         * Per-slice cap (Polish-7b): when the drawer targets a specific
         * BookingAsset slice, bound the claim by BOTH the slice's own
         * remaining AND the asset-level remaining. The asset-level guard
         * still backstops the total (and counts legacy NULL-tagged logs),
         * while the slice guard stops one slice over-claiming into
         * another. Legacy callers omit `bookingAssetId` → asset-level cap
         * only, unchanged.
         */
        let cap = remaining;
        if (disp.bookingAssetId) {
          const sliceRemaining = await computeBookingAssetSliceRemaining(
            tx,
            id,
            disp.bookingAssetId
          );
          cap = Math.min(cap, sliceRemaining);
        }

        // Bare scan of a QUANTITY_TRACKED asset (no explicit disposition):
        // default to "all remaining" — return all for a returnable (TWO_WAY)
        // asset, consume all for a consumable (ONE_WAY) one. Mirrors
        // checkinBooking's big-button default. Only bare ids reach here with a
        // zero disposition (the guard above rejects an explicit zero), so this
        // never overrides an operator's explicit returned/consumed split.
        if (
          bareCheckinAssetIds.has(disp.assetId) &&
          sumDisposition(disp) === 0
        ) {
          // Re-scan of an asset with no units left to check in (`cap === 0`):
          // reject instead of writing a no-op PartialBookingCheckin + event.
          // Matches the `claimed > cap` rejection an explicit re-scan gets.
          if (cap <= 0) {
            throw new ShelfError({
              cause: null,
              status: 400,
              label,
              message: `Cannot check in "${lockedAsset.title}" — no units remain to check in on this booking.`,
              shouldBeCaptured: false,
            });
          }
          if (lockedAsset.consumptionType === "ONE_WAY") {
            disp.consumed = cap;
          } else {
            disp.returned = cap;
          }
        }

        const claimed = sumDisposition(disp);

        if (claimed > cap) {
          throw new ShelfError({
            cause: null,
            status: 400,
            label,
            message: `Cannot check in ${claimed} units for "${lockedAsset.title}". Only ${cap} remaining on this booking.`,
            shouldBeCaptured: false,
          });
        }

        const poolDecrement =
          (disp.consumed ?? 0) + (disp.lost ?? 0) + (disp.damaged ?? 0);

        /**
         * Pool-drain guard: `Asset.quantity` must stay ≥ current custody
         * sum. Mirrors the invariant from `adjustQuantity` — we never let
         * the physical pool drop below what team members are holding.
         */
        if (poolDecrement > 0) {
          const custodyAgg = await tx.custody.aggregate({
            where: { assetId: disp.assetId },
            _sum: { quantity: true },
          });
          const inCustody = custodyAgg._sum?.quantity ?? 0;
          const projected = (lockedAsset.quantity ?? 0) - poolDecrement;
          if (projected < inCustody) {
            throw new ShelfError({
              cause: null,
              status: 400,
              label,
              message: `Cannot remove ${poolDecrement} units from "${lockedAsset.title}" — ${inCustody} are currently in custody and would be left uncovered.`,
              shouldBeCaptured: false,
            });
          }
        }

        // One ConsumptionLog per non-zero category, all scoped to this booking.
        // `bookingAssetId` carries per-row attribution when the caller knows
        // the slice (drawer post-Polish-6); legacy callers leave it null and
        // the loader's greedy-fill handles them on read.
        const dispBookingAssetId = disp.bookingAssetId ?? null;
        if ((disp.returned ?? 0) > 0) {
          await createConsumptionLog({
            assetId: disp.assetId,
            category: "RETURN",
            quantity: disp.returned!,
            userId,
            bookingId: id,
            bookingAssetId: dispBookingAssetId,
            tx,
          });
        }
        if ((disp.consumed ?? 0) > 0) {
          await createConsumptionLog({
            assetId: disp.assetId,
            category: "CONSUME",
            quantity: disp.consumed!,
            userId,
            bookingId: id,
            bookingAssetId: dispBookingAssetId,
            tx,
          });
        }
        if ((disp.lost ?? 0) > 0) {
          await createConsumptionLog({
            assetId: disp.assetId,
            category: "LOSS",
            quantity: disp.lost!,
            userId,
            bookingId: id,
            bookingAssetId: dispBookingAssetId,
            tx,
          });
        }
        if ((disp.damaged ?? 0) > 0) {
          await createConsumptionLog({
            assetId: disp.assetId,
            category: "DAMAGE",
            quantity: disp.damaged!,
            userId,
            bookingId: id,
            bookingAssetId: dispBookingAssetId,
            tx,
          });
        }

        // Decrement the pool for CONSUME/LOSS/DAMAGE only. RETURN leaves
        // the pool alone — the unit is back where it came from.
        if (poolDecrement > 0) {
          const beforeQuantity = lockedAsset.quantity ?? 0;
          await tx.asset.update({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `disp.assetId` validated against `bookingFoundAssets` (loaded org-scoped) before this loop
            where: { id: disp.assetId },
            data: { quantity: { decrement: poolDecrement } },
          });
          // Audit the stock drop. `lockedAsset` was freshly re-read per
          // disposition, so from/to chains through sequential decrements when
          // one asset has several dispositions.
          quantityChangeEvents.push({
            organizationId,
            actorUserId: userId,
            action: "ASSET_QUANTITY_CHANGED",
            entityType: "ASSET",
            entityId: disp.assetId,
            assetId: disp.assetId,
            field: "quantity",
            fromValue: beforeQuantity,
            toValue: beforeQuantity - poolDecrement,
          });

          /**
           * Same reconcile as the full check-in path above: destroyed units
           * lower the total the location-axis invariant is measured against,
           * so bring the placement sum back inside it within this tx.
           */
          const reconcile = await reconcileManualPlacementsForStockDecrease({
            assetId: disp.assetId,
            newTotal: beforeQuantity - poolDecrement,
            tx,
          });

          reportAmbiguousPlacementReconcile({
            result: reconcile,
            context: "Partial check-in",
            additionalData: { assetId: disp.assetId, bookingId: id },
          });
        }

        const pendingAfter = remaining - claimed;
        if (pendingAfter === 0) {
          fullyReconciledQtyAssetIds.push(disp.assetId);
        }

        qtySummaries.push({
          assetId: disp.assetId,
          title: lockedAsset.title,
          type: lockedAsset.type,
          unitOfMeasure: lockedAsset.unitOfMeasure,
          returned: disp.returned ?? 0,
          consumed: disp.consumed ?? 0,
          lost: disp.lost ?? 0,
          damaged: disp.damaged ?? 0,
          pendingAfter,
        });
      }

      // Flush the accumulated pool-decrement audit events atomically with the
      // decrements (same tx, single insert).
      if (quantityChangeEvents.length > 0) {
        await recordEvents(quantityChangeEvents, tx);
      }

      // ---- Individual asset status updates (unchanged) ----
      const individualAssetIds = effectiveAssetIds.filter(
        (id_) => assetTypeById.get(id_) === AssetType.INDIVIDUAL
      );
      if (individualAssetIds.length > 0) {
        // Scope to the caller's org (cross-org IDOR defence).
        await tx.asset.updateMany({
          where: { id: { in: individualAssetIds }, organizationId },
          data: { status: AssetStatus.AVAILABLE },
        });
      }

      // QUANTITY_TRACKED assets: only reset status to AVAILABLE if they
      // have no other active bookings and no custody records — pools
      // shared across bookings must not flicker on a partial check-in.
      // De-dup: with multiple slices of the same asset in one submit
      // (Polish-7b) `effectiveAssetIds` can list an asset twice — the
      // status reset must run once per asset.
      const qtyCheckinIds = [
        ...new Set(
          effectiveAssetIds.filter(
            (id_) => assetTypeById.get(id_) === AssetType.QUANTITY_TRACKED
          )
        ),
      ];
      for (const assetId of qtyCheckinIds) {
        const [otherBookings, custodyCount] = await Promise.all([
          tx.bookingAsset.count({
            where: {
              assetId,
              bookingId: { not: id },
              booking: {
                status: {
                  in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                },
              },
            },
          }),
          tx.custody.count({ where: { assetId } }),
        ]);
        if (otherBookings === 0 && custodyCount === 0) {
          await tx.asset.update({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` comes from `effectiveAssetIds` validated against the org-scoped booking assets earlier in partialCheckinBooking
            where: { id: assetId },
            data: { status: AssetStatus.AVAILABLE },
          });
        }
      }

      /**
       * PartialBookingCheckin session row. `assetIds` intentionally only
       * lists assets FULLY reconciled in this session:
       *   - INDIVIDUAL: always included (presence = checked in).
       *   - QUANTITY_TRACKED: only when `remaining` hit zero.
       *
       * Partially-reconciled qty-tracked assets are tracked via
       * ConsumptionLog instead — that's the source of truth for
       * "how much has flowed back". The "touched" signal for the drawer
       * (so the scanner can mark an asset as already-handled) should key
       * off consumption-log presence, not just this row.
       */
      const sessionReconciledAssetIds = [
        ...individualAssetIds,
        ...fullyReconciledQtyAssetIds,
      ];
      await tx.partialBookingCheckin.create({
        data: {
          bookingId: id,
          checkedInById: userId,
          assetIds: sessionReconciledAssetIds,
          checkinCount: sessionReconciledAssetIds.length,
        },
      });

      /**
       * The slices this session finished, at slice grain.
       *
       * `checkedInAt` means FULLY reconciled, and "fully" is a property of the
       * SLICE. `sessionReconciledAssetIds` above is asset-level on purpose —
       * the session row and `isBookingFullyCheckedIn` read it as an asset-level
       * obligation — and an asset's `remaining` sums across every slice it has
       * on the booking. Returning one kit's slice in full finishes that slice
       * whatever its siblings still owe, and finishes nothing else, so the
       * marker and the kit gate need their own set.
       */
      const settledSliceIds = new Set<string>();

      /** Went out on this booking and has not been reconciled yet. */
      const isOutstandingSlice = (slice: {
        checkedOutAt: Date | null;
        checkedInAt: Date | null;
      }) => Boolean(slice.checkedOutAt) && !slice.checkedInAt;

      const bookingSlicesByAssetId = new Map<
        string,
        (typeof bookingFound.bookingAssets)[number][]
      >();
      for (const slice of bookingFound.bookingAssets) {
        const bucket = bookingSlicesByAssetId.get(slice.assetId);
        if (bucket) {
          bucket.push(slice);
        } else {
          bookingSlicesByAssetId.set(slice.assetId, [slice]);
        }
      }

      /**
       * INDIVIDUAL assets reconcile by presence: scanning one returns every
       * slice of it that went out. Unchanged from what the marker has always
       * done for them.
       */
      for (const assetId of individualAssetIds) {
        for (const slice of bookingSlicesByAssetId.get(assetId) ?? []) {
          if (isOutstandingSlice(slice)) {
            settledSliceIds.add(slice.id);
          }
        }
      }

      /**
       * A QUANTITY_TRACKED slice is finished when everything that actually LEFT
       * on it is accounted for — not when its booked quantity is. Progressive
       * checkout stamps `checkedOutAt` as soon as any unit goes, so a slice
       * booked at 10 with 3 in the field is ordinary; measuring against 10 would
       * leave it outstanding after all 3 came back, and its kit checked out with
       * nothing of it anywhere.
       *
       * Read this booking's dispositions back — including the rows written above
       * — and spread them with
       * {@link attributeDispositionsByBookingAsset}, the same function every
       * read site uses: a log tagged with a slice lands on it, an untagged one
       * greedy-fills in `compareSlicesForGreedyFill` order.
       *
       * Resolving an untagged claim any other way would settle a slice the
       * booking's own screens still report as out — the agreement
       * `.claude/rules/booking-checkout-is-recorded-per-slice` requires between
       * the marker writer and the quantity attribution.
       *
       * One query for every touched asset rather than one per slice: this loop
       * runs over a whole batch inside an interactive transaction that already
       * spends several round-trips per disposition (SHELF-WEBAPP-217).
       */
      const qtyAssetIdsTouched = [
        ...new Set(qtySummaries.map((s) => s.assetId)),
      ];
      if (qtyAssetIdsTouched.length > 0) {
        /**
         * Units dispatched per slice = booked minus what is still checkoutable.
         * {@link computeBookingAssetsSliceRemainingToCheckOut} is the reader
         * every checkout surface already uses, including its all-at-once
         * fallback, so a slice sent out by the button reports its whole
         * quantity dispatched and settles exactly as it always has.
         */
        const remainingToCheckOutBySlice =
          await computeBookingAssetsSliceRemainingToCheckOut(
            tx,
            id,
            qtyAssetIdsTouched.flatMap((assetId) =>
              (bookingSlicesByAssetId.get(assetId) ?? []).map((s) => s.id)
            )
          );

        const dispositionLogs = await tx.consumptionLog.findMany({
          where: {
            bookingId: id,
            assetId: { in: qtyAssetIdsTouched },
            category: { in: [...CHECKIN_DISPOSITION_CATEGORIES] },
          },
          select: { assetId: true, bookingAssetId: true, quantity: true },
        });

        const logsByAssetId = new Map<
          string,
          Array<{ bookingAssetId: string | null; quantity: number }>
        >();
        for (const log of dispositionLogs) {
          const entry = {
            bookingAssetId: log.bookingAssetId,
            quantity: log.quantity,
          };
          const bucket = logsByAssetId.get(log.assetId);
          if (bucket) {
            bucket.push(entry);
          } else {
            logsByAssetId.set(log.assetId, [entry]);
          }
        }

        for (const assetId of qtyAssetIdsTouched) {
          const slices = bookingSlicesByAssetId.get(assetId) ?? [];
          if (slices.length === 0) continue;

          /**
           * What each slice owes: the units it actually sent out.
           *
           * Both halves of the decision below measure against this one number.
           * As the CAPACITY it stops a slice that never left from absorbing an
           * untagged return — the mobile payload names no slice, so its units
           * are spread standalone-first, and every unit swallowed by a slice
           * that owes nothing is one the kit-driven slice needs to settle. As
           * the THRESHOLD it settles a slice on what it owes rather than what
           * it booked. Sizing the two differently strands a kit either way.
           *
           * A slice marked out that the sessions cannot size falls back to its
           * booked quantity, which holds its kit — the safe direction while the
           * two disagree. One that never left owes nothing at all.
           */
          const owedBySlice = new Map<string, number>();
          for (const slice of slices) {
            // Whether a slice left is answered by its OWN marker and nothing
            // else. `computeBookingAssetsSliceRemainingToCheckOut` reports a
            // slice with no session claims as fully dispatched whenever the
            // booking is live and the ASSET reads CHECKED_OUT — and that status
            // is global, so a sibling slice being out is enough to trigger it.
            // Sizing from that alone hands a slice that never moved the whole
            // obligation of one that did.
            if (!slice.checkedOutAt) {
              owedBySlice.set(slice.id, 0);
              continue;
            }
            const dispatched =
              slice.quantity - (remainingToCheckOutBySlice.get(slice.id) ?? 0);
            owedBySlice.set(
              slice.id,
              dispatched > 0 ? dispatched : slice.quantity
            );
          }

          // The asset's FULL slice set, so a claim tagged to one slice never
          // leaks into a sibling and the untagged pool is capped per slice.
          const attributed = attributeDispositionsByBookingAsset({
            bookingAssetRows: slices.map((slice) => ({
              id: slice.id,
              quantity: owedBySlice.get(slice.id) ?? 0,
              assetKitId: slice.assetKitId,
            })),
            consumptionLogs: logsByAssetId.get(assetId) ?? [],
          });
          for (const slice of slices) {
            const owed = owedBySlice.get(slice.id) ?? 0;
            if (
              isOutstandingSlice(slice) &&
              owed > 0 &&
              (attributed.get(slice.id) ?? 0) >= owed
            ) {
              settledSliceIds.add(slice.id);
            }
          }
        }
      }

      /**
       * Mark the slices this session fully reconciled.
       *
       * Keyed by `BookingAsset.id`. Keyed by `assetId` it stamped a return on
       * every sibling slice at once — kit B reading as returned because kit A's
       * units came back — and, in the other direction, refused to stamp kit A's
       * slice until kit B's units were accounted for too, because an asset's
       * remaining sums across all of them.
       *
       * `checkedOutAt: { not: null }` still guards the write: a slice added
       * after checkout never left, and stamping `checkedInAt` beside a NULL
       * `checkedOutAt` claims a return for units that never went anywhere.
       *
       * `checkedInAt: null` keeps the first reconciliation: where one slice was
       * settled in an earlier session and a sibling in this one, each keeps the
       * moment it was actually reconciled.
       */
      if (settledSliceIds.size > 0) {
        await tx.bookingAsset.updateMany({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: these slice ids come from this booking's own rows, which the action's `findUniqueOrThrow({ id, organizationId })` already org-checked
          where: {
            bookingId: id,
            id: { in: [...settledSliceIds] },
            checkedOutAt: { not: null },
            checkedInAt: null,
          },
          data: { checkedInAt: new Date(), checkedInById: userId },
        });
      }

      /**
       * Kits released by this session: one whose slices this session finished,
       * and which has nothing left out on this booking.
       *
       * Both halves are per slice. Counted by asset, a kit's own returned slice
       * read as outstanding because a SIBLING kit's slice of the same asset had
       * not come back — the kit stayed CHECKED_OUT with nothing of its own out
       * — and a kit was released because a sibling kit's slice had come back,
       * sending it AVAILABLE with its units in the field. Over-release is the
       * failure that loses equipment, so a kit needs BOTH: something of its own
       * settled here, and nothing of its own still owed.
       *
       * A partially returned QUANTITY_TRACKED slice is outstanding by exactly
       * this test — `checkedInAt` stays NULL while it still owes units — so its
       * kit keeps reading CHECKED_OUT until the last unit is logged.
       */
      const kitIdsSettledHere = new Set<string>();
      const kitIdsStillOut = new Set<string>();
      for (const slice of bookingFound.bookingAssets) {
        const kitIds = kitIdsBySliceId.get(slice.id);
        if (!kitIds) continue;
        if (settledSliceIds.has(slice.id)) {
          for (const kitId of kitIds) kitIdsSettledHere.add(kitId);
        } else if (isOutstandingSlice(slice)) {
          for (const kitId of kitIds) kitIdsStillOut.add(kitId);
        }
      }

      /**
       * Slices this request never saw.
       *
       * The booking was loaded before the transaction opened — several
       * round-trips earlier — so a progressive checkout that committed in
       * between is invisible to it, and releasing a kit whose gear left in that
       * window is the failure this gate exists to prevent.
       *
       * Read as a VETO only: it runs when a kit is already a candidate, and
       * only slices absent from the snapshot contribute. It can hold a kit
       * back; it can never release one. So a read that comes back short leaves
       * the decision exactly where the snapshot put it.
       */
      if (kitIdsSettledHere.size > 0) {
        const stillOutNow = await tx.bookingAsset.findMany({
          where: {
            bookingId: id,
            checkedOutAt: { not: null },
            checkedInAt: null,
          },
          select: {
            id: true,
            assetKitId: true,
            sourceKitId: true,
            asset: { select: { assetKits: { select: { kitId: true } } } },
          },
        });
        const unseenSlices = stillOutNow.filter(
          (slice) => !sliceById.has(slice.id)
        );
        if (unseenSlices.length > 0) {
          const unseenKitIds = await getKitIdsBySlice({
            slices: unseenSlices.map((slice) => ({
              id: slice.id,
              assetKitId: slice.assetKitId,
              sourceKitId: slice.sourceKitId,
              assetKits: slice.asset?.assetKits ?? [],
            })),
            organizationId,
            client: tx,
          });
          for (const kitIds of unseenKitIds.values()) {
            for (const kitId of kitIds) kitIdsStillOut.add(kitId);
          }
        }
      }

      const completeKitIds = [...kitIdsSettledHere].filter(
        (kitId) => !kitIdsStillOut.has(kitId)
      );

      if (completeKitIds.length > 0) {
        await tx.kit.updateMany({
          where: { id: { in: completeKitIds }, organizationId },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      // Activity events — one BOOKING_PARTIAL_CHECKIN per asset that had
      // activity in this session (qty disposition or individual flip).
      // Inside the tx so audit-trail recording is atomic with the writes
      // (matches `checkoutBooking` + the project's `use-record-event` rule).
      // Qty assets with 0/0/0/0 dispositions are filtered out — they
      // haven't actually been touched.
      // De-dup assetIds: multiple slices of one asset (Polish-7b) share
      // a single BOOKING_PARTIAL_CHECKIN event per asset.
      const assetIdsTouchedInTx = [
        ...new Set([
          ...individualAssetIds,
          ...qtySummaries.map((s) => s.assetId),
        ]),
      ];
      if (assetIdsTouchedInTx.length > 0) {
        await recordEvents(
          assetIdsTouchedInTx.map((assetId) => ({
            organizationId,
            actorUserId: userId,
            action: "BOOKING_PARTIAL_CHECKIN",
            entityType: "BOOKING",
            entityId: id,
            bookingId: id,
            assetId,
          })),
          tx
        );
      }

      // Determine completion uniformly via the shared helper — keeps
      // individual + qty-tracked semantics in one place.
      const bookingIsComplete = await isBookingFullyCheckedIn(tx, id);

      const updatedBookingSnapshot = await tx.booking.findUniqueOrThrow({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking `id` already org-checked via findUniqueOrThrow({where:{id,organizationId}}) in partialCheckinBooking
        where: { id },
        include: {
          bookingAssets: true,
          custodianUser: true,
          custodianTeamMember: true,
          _count: { select: { bookingAssets: true } },
        },
      });

      if (bookingIsComplete) {
        const dataToComplete: Prisma.BookingUpdateInput = {
          status: BookingStatus.COMPLETE,
        };

        /**
         * Same end-date rewrite `checkinBooking` performs, so a booking's
         * period does not depend on which check-in route completed it: `to`
         * becomes the actual return moment when the booking is being returned
         * late, or early with the operator's consent. The planned end stays in
         * `originalTo` (seeded only for rows predating that column).
         */
        const shouldAdjustEndDate =
          updatedBookingSnapshot.status === BookingStatus.OVERDUE ||
          (!!updatedBookingSnapshot.to &&
            isBookingEarlyCheckin(updatedBookingSnapshot.to) &&
            intentChoice === CheckinIntentEnum["with-adjusted-date"]);

        if (shouldAdjustEndDate) {
          dataToComplete.originalTo = plannedEndToPreserve(
            updatedBookingSnapshot
          );

          const toDateStr = DateTime.fromJSDate(new Date(), {
            zone: hints.timeZone,
          }).toFormat(DATE_TIME_FORMAT);

          dataToComplete.to = DateTime.fromFormat(toDateStr, DATE_TIME_FORMAT, {
            zone: hints.timeZone,
          }).toJSDate();
        }

        const completedBooking = await tx.booking.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking `id` already org-checked via findUniqueOrThrow({where:{id,organizationId}}) in partialCheckinBooking
          where: { id },
          data: dataToComplete,
          include: {
            bookingAssets: true,
            custodianUser: true,
            custodianTeamMember: true,
            _count: { select: { bookingAssets: true } },
          },
        });

        return {
          booking: completedBooking,
          previousStatus: updatedBookingSnapshot.status,
          isComplete: true as const,
          qtySummaries,
          individualAssetIds,
          completeKitIds,
        };
      }

      return {
        booking: updatedBookingSnapshot,
        previousStatus: updatedBookingSnapshot.status,
        isComplete: false as const,
        qtySummaries,
        individualAssetIds,
        completeKitIds,
      };
    });

    /**
     * Canonical status-transition event for the completion. This path writes
     * its own system note instead of calling `createStatusTransitionNote`, so
     * the event it would normally emit has to be recorded here — the Booking
     * Compliance report reads a booking's check-in moment from
     * `BOOKING_STATUS_CHANGED → COMPLETE` (see `resolveCheckInTimes`) and
     * otherwise falls back to `updatedAt`, which drifts on any later edit.
     */
    if (txResult.isComplete) {
      await recordBookingStatusChangedEvent({
        organizationId,
        bookingId: id,
        userId,
        fromStatus: txResult.previousStatus,
        toStatus: BookingStatus.COMPLETE,
      });
    }

    /**
     * Activity notes — best-effort, OUTSIDE the transaction.
     *
     * Wrapped in try/catch matching the pattern from manage-assets:
     * the check-in itself is already persisted, so a note rendering
     * failure must not propagate as a user-facing error. Any failure is
     * captured server-side via `Logger.error`.
     */
    try {
      const actor = wrapUserLinkForNote({ ...user, id: userId });

      /**
       * Shared booking link used by every asset-side note below so the
       * activity feed on each asset tells the reader which booking the
       * check-in was for (and jumps straight to it via a markdoc link).
       */
      const bookingLink = wrapLinkForNote(
        `/bookings/${txResult.booking.id}`,
        txResult.booking.name
      );

      /**
       * Polish-7b: a single submit can disposition MULTIPLE slices of one
       * asset (kit-driven + standalone). The per-asset note + booking-note
       * fragment below read per-asset, so fold the per-slice summaries
       * into one entry per asset — sum the category counts; `pendingAfter`
       * is the asset's final outstanding (the last slice processed already
       * carries the running asset-level total).
       */
      const aggregatedQtySummaries: QtyDispositionSummary[] = (() => {
        const byAsset = new Map<string, QtyDispositionSummary>();
        for (const s of txResult.qtySummaries) {
          const prev = byAsset.get(s.assetId);
          if (!prev) {
            byAsset.set(s.assetId, { ...s });
          } else {
            prev.returned += s.returned;
            prev.consumed += s.consumed;
            prev.lost += s.lost;
            prev.damaged += s.damaged;
            prev.pendingAfter = s.pendingAfter;
          }
        }
        return [...byAsset.values()];
      })();

      /**
       * Per-row asset note summarizing this session's disposition.
       * Only generated for qty-tracked assets that actually had activity
       * this session; individual assets get the short "checked in" note
       * to preserve current behavior.
       */
      for (const summary of aggregatedQtySummaries) {
        /**
         * Render disposition counts with the asset's `unitOfMeasure` via
         * `formatUnitCount` ("returned 10 boxes" instead of "returned 10")
         * — Phase 4e wording parity. The helper returns `null` for
         * INDIVIDUAL; defence-in-depth fallback to bare integer (in
         * practice this loop only sees qty-tracked rows — the partial-
         * checkin tx skips INDIVIDUAL dispositions at line ~4114).
         */
        const fmt = (qty: number) =>
          formatUnitCount(
            { type: summary.type, unitOfMeasure: summary.unitOfMeasure },
            qty
          ) ?? String(qty);

        const parts: string[] = [];
        if (summary.returned > 0)
          parts.push(`returned **${fmt(summary.returned)}**`);
        if (summary.consumed > 0)
          parts.push(`consumed **${fmt(summary.consumed)}**`);
        if (summary.lost > 0) parts.push(`**${fmt(summary.lost)}** lost`);
        if (summary.damaged > 0)
          parts.push(`**${fmt(summary.damaged)}** damaged`);
        if (summary.pendingAfter > 0) {
          parts.push(`**${fmt(summary.pendingAfter)}** still pending`);
        }

        await createNotes({
          content: `${actor} via partial check-in on ${bookingLink}: ${parts.join(
            ", "
          )}.`,
          type: "UPDATE",
          userId,
          assetIds: [summary.assetId],
          // why: createNotes now requires organizationId (it internally runs
          // the cross-org asset guard); forward the booking's org.
          organizationId,
        });
      }

      if (txResult.individualAssetIds.length > 0) {
        await createNotes({
          content: `${actor} checked in via partial check-in on ${bookingLink}.`,
          type: "UPDATE",
          userId,
          assetIds: txResult.individualAssetIds,
          // why: createNotes now requires organizationId (it internally runs
          // the cross-org asset guard); forward the booking's org.
          organizationId,
        });
      }

      // Booking-side summary note (one per session).
      // (Activity events were already recorded INSIDE the tx — see
      //  `assetIdsTouchedInTx` block.)
      const assetIdsTouched = [
        ...txResult.individualAssetIds,
        ...txResult.qtySummaries.map((s) => s.assetId),
      ];
      const assetsWithKitInfo =
        assetIdsTouched.length > 0
          ? await db.asset.findMany({
              // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetIdsTouched` derive from the org-scoped booking assets/qty summaries in partialCheckinBooking
              where: { id: { in: assetIdsTouched } },
              select: {
                id: true,
                title: true,
                assetKits: {
                  select: { kit: { select: { id: true, name: true } } },
                },
              },
            })
          : [];

      const completeKits: Array<{ id: string; name: string }> = [];
      const standaloneAssets: Array<{ id: string; title: string }> = [];
      const processedKitIds = new Set<string>();
      for (const asset of assetsWithKitInfo) {
        const assetKit = asset.assetKits?.[0]?.kit;
        if (
          assetKit &&
          txResult.completeKitIds.includes(assetKit.id) &&
          !processedKitIds.has(assetKit.id)
        ) {
          completeKits.push({ id: assetKit.id, name: assetKit.name });
          processedKitIds.add(assetKit.id);
        } else if (
          !assetKit ||
          !txResult.completeKitIds.includes(assetKit.id)
        ) {
          // Asset belongs to a kit that is only partially being checked
          // in/out: the kit isn't a complete-kit line, so name the individual
          // asset (the same way standalone assets are shown) instead of
          // dropping it. Without this, a batch made up entirely of such
          // assets produced an empty note (e.g. "partial check-out: .").
          standaloneAssets.push({ id: asset.id, title: asset.title });
        }
      }

      const hasKits = completeKits.length > 0;
      const hasAssets = standaloneAssets.length > 0;
      let itemsDescription = "";
      if (hasKits && hasAssets) {
        itemsDescription = `${wrapAssetsWithDataForNote(
          standaloneAssets,
          "checked in"
        )} and ${wrapKitsWithDataForNote(completeKits, "checked in")}`;
      } else if (hasKits) {
        itemsDescription = wrapKitsWithDataForNote(completeKits, "checked in");
      } else if (hasAssets) {
        itemsDescription = wrapAssetsWithDataForNote(
          standaloneAssets,
          "checked in"
        );
      }

      // Per-asset qty disposition fragment for the booking note —
      // names each qty-tracked asset touched in this session (linked)
      // with its non-zero categories. Replaces the old aggregate-only
      // tail that just said "(10 returned, 2 lost)" with no asset
      // names.
      const qtyPerAsset = buildQtyPerAssetFragment(aggregatedQtySummaries);
      const qtyTail = qtyPerAsset ? ` — qty: ${qtyPerAsset}` : "";

      // `txResult.isComplete` is set inside the partial-checkin tx using the
      // same records-based outstanding calculation as the early-exit above
      // (records, not global asset status — fix from main: ddafe62fd) and
      // additionally handles qty-tracked completion. The tx already wrote the
      // booking status update, so we just emit the right note variant here.
      if (txResult.isComplete) {
        const fromStatusBadge = wrapBookingStatusForNote(
          txResult.previousStatus,
          txResult.booking.custodianUserId || undefined
        );
        const toStatusBadge = wrapBookingStatusForNote(
          BookingStatus.COMPLETE,
          txResult.booking.custodianUserId || undefined
        );
        await createSystemBookingNote({
          bookingId: id,
          // `createSystemBookingNote` requires `organizationId` for
          // workspace scoping. The pre-computed `actor` matches the
          // ledger-style notes the qty-tracked check-in flow writes and
          // the `qtyTail` suffix surfaces per-disposition counts
          // (returned / consumed / lost / damaged) when present.
          organizationId,
          content: `${actor} performed a partial check-in: ${itemsDescription}${qtyTail} and completed the booking. Status changed from ${fromStatusBadge} to ${toStatusBadge}`,
        });
      } else {
        await createSystemBookingNote({
          bookingId: id,
          organizationId,
          content: `${actor} performed a partial check-in: ${itemsDescription}${qtyTail}.`,
        });
      }
    } catch (noteError) {
      Logger.error(
        new ShelfError({
          cause: noteError,
          message: "Failed to write check-in activity notes",
          label,
          additionalData: { userId, bookingId: id },
        })
      );
    }

    // Compute a coarse "remaining" count for the toast: bookingAssets not
    // yet fully reconciled. Individuals count as remaining if not in any
    // PartialBookingCheckin session; qty-tracked count as remaining if
    // `computeBookingAssetRemaining > 0`.
    const outstandingBookingAssets = await db.bookingAsset.findMany({
      where: { bookingId: id },
      select: {
        assetId: true,
        asset: { select: { type: true } },
      },
    });
    const allSessions = await db.partialBookingCheckin.findMany({
      where: { bookingId: id },
      select: { assetIds: true },
    });
    const reconciledIndividualIds = new Set<string>(
      allSessions.flatMap((s) => s.assetIds as string[])
    );
    let remainingAssetCount = 0;
    for (const ba of outstandingBookingAssets) {
      if (ba.asset?.type === AssetType.QUANTITY_TRACKED) {
        const rem = await computeBookingAssetRemaining(db, id, ba.assetId);
        if (rem > 0) remainingAssetCount += 1;
      } else if (!reconciledIndividualIds.has(ba.assetId)) {
        remainingAssetCount += 1;
      }
    }

    /**
     * Low-stock check for every qty-tracked asset whose pool actually dropped
     * this session (CONSUME / LOSS / DAMAGE — RETURN puts units back so it
     * can't cross a threshold DOWN). Derived from the tx's per-slice
     * summaries: a decrement happened iff consumed + lost + damaged > 0.
     * Runs OUTSIDE the committed transaction (best-effort — a notification
     * failure must never roll back a successful check-in).
     */
    await notifyLowStockForDecrementedAssets({
      summaries: txResult.qtySummaries,
      organizationId,
      bookingId: id,
      userId,
      context: "partial booking check-in",
    });

    return {
      booking: txResult.booking,
      checkedInAssetCount: effectiveAssetIds.length,
      remainingAssetCount,
      isComplete: txResult.isComplete,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while partially checking in booking.",
    });
  }
}

/**
 * Progressive (partial) check-OUT of a booking.
 *
 * Mirrors {@link partialCheckinBooking} but for the checkout direction: scan
 * booking items to check them out one batch at a time. Each batch records a
 * `PartialBookingCheckout` row (the per-booking source of truth) and flips the
 * scanned assets/kits to CHECKED_OUT.
 *
 * Semantic differences from partial check-in:
 * - The FIRST scan transitions the booking RESERVED → ONGOING (or OVERDUE if
 *   the booking's `to` is already in the past). Subsequent scans leave the
 *   status untouched. Partial checkout NEVER auto-completes the booking.
 * - Every scanned batch is run through conflict + custody validation (scoped to
 *   the scanned assets), which partial check-in does not perform.
 * - If a batch covers every still-Booked asset, the full {@link checkoutBooking}
 *   is delegated to (clean status transition + schedulers + notes), mirroring
 *   how partial check-in delegates to checkinBooking for the final batch.
 *
 * @param id - Booking id (org-checked via findUniqueOrThrow)
 * @param organizationId - Caller's active organization
 * @param assetIds - Asset ids scanned in this batch (must belong to the booking)
 * @param userId - Acting user
 * @param hints - Client hints (timezone/locale) for scheduling + date math
 * @param intentChoice - Optional early-checkout intent forwarded to the full op
 * @returns booking + checkedOutAssetCount + remainingAssetCount + isComplete
 * @throws {ShelfError} 404 if booking not found; 400 for membership/idempotency
 *   violations; conflict/custody business-rule rejections
 */
export async function partialCheckoutBooking({
  id,
  organizationId,
  assetIds: rawAssetIds,
  checkouts,
  userId,
  hints,
  intentChoice,
}: Pick<Booking, "id" | "organizationId"> & {
  /** Legacy payload — asset IDs only, no per-asset quantities. INDIVIDUAL rows
   *  implicitly carry quantity = 1. */
  assetIds?: Asset["id"][];
  /** Wave-B per-asset quantity dispositions. May arrive together with
   *  `assetIds` — INDIVIDUAL rows still flow through `assetIds` while
   *  QUANTITY_TRACKED rows arrive here with explicit `quantity`. */
  checkouts?: CheckoutDispositionInput[];
  userId: User["id"];
  hints: ClientHint;
  intentChoice?: CheckoutIntentEnum;
}) {
  try {
    // Dedupe once up front so counts, the PartialBookingCheckout record, and the
    // per-asset events are idempotent — the mobile endpoint's body schema does
    // not enforce unique assetIds, so a client could submit duplicates.
    const assetIds = rawAssetIds ? [...new Set(rawAssetIds)] : [];

    /**
     * Merge `checkouts` (qty-tracked, with explicit quantity) and `assetIds`
     * (INDIVIDUAL / legacy, implicit qty = 1) into one unified disposition
     * list. Mirror of the `partialCheckinBooking` dedup pattern — key on
     * `(assetId, bookingAssetId)` so per-slice payloads survive (kit-driven
     * + standalone of the same asset), and asset-id-only legacy entries
     * collapse on `assetId::null`.
     */
    const dispositions: CheckoutDispositionInput[] = [];
    const seenDispositionKeys = new Set<string>();
    const assetIdsWithDisposition = new Set<string>();
    for (const d of checkouts ?? []) {
      const key = `${d.assetId}::${d.bookingAssetId ?? "null"}`;
      if (seenDispositionKeys.has(key)) continue;
      seenDispositionKeys.add(key);
      dispositions.push(d);
      assetIdsWithDisposition.add(d.assetId);
    }
    for (const assetId of assetIds) {
      if (!assetIdsWithDisposition.has(assetId)) {
        assetIdsWithDisposition.add(assetId);
        // Legacy / INDIVIDUAL fallback: no slice tag. INDIVIDUAL keeps the
        // implicit quantity = 1; a QUANTITY_TRACKED asset scanned with no
        // explicit count is tagged `defaultAllRemaining` so the in-tx loop
        // resolves it to "all remaining units". The sentinel 1 is still used by
        // the delegate gate below (where `1 < remaining` keeps a >1-unit QT
        // asset on this partial path — so it never delegates with a wrong
        // count). Harmless for INDIVIDUAL: the flag is only read on the QT path.
        dispositions.push({ assetId, quantity: 1, defaultAllRemaining: true });
      }
    }

    /** Flat, deduped asset-id list driven by all dispositions (legacy + Wave B). */
    const effectiveAssetIds = [...new Set(dispositions.map((d) => d.assetId))];

    if (dispositions.length === 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message: "No assets provided for check-out.",
        shouldBeCaptured: false,
      });
    }

    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    // First, validate the booking exists and get its current assets via the
    // BookingAsset pivot. `status` is needed for the custody/CHECKED_OUT
    // guards below; `assetKits` carries kit membership in the pivot world.
    // Wave B: `id` + `quantity` on the pivot row + `type`/`title`/`unitOfMeasure`
    // on the asset feed the per-slice qty-tracked checkout loop below.
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          bookingAssets: {
            select: {
              id: true,
              quantity: true,
              // Slice discriminator (Layer 2/3): `null` = standalone (free
              // pool), non-null = kit-driven slice (FK → `AssetKit.id`). Drives
              // the per-slice checkout note label ("standalone" vs "in kit X").
              assetKitId: true,
              asset: {
                select: {
                  id: true,
                  status: true,
                  type: true,
                  title: true,
                  unitOfMeasure: true,
                  // `kitId` retained for the complete-kit status logic below.
                  // `id` + `kit.name` added so the per-slice checkout note can
                  // resolve a kit-driven slice's kit label by matching the
                  // slice's `assetKitId` (an `AssetKit.id`) against these
                  // memberships — no extra round-trip inside the qty loop.
                  assetKits: {
                    select: {
                      id: true,
                      kitId: true,
                      kit: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          status: 404,
          label,
          message:
            "Booking not found, are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    // Reject ineligible booking statuses BEFORE any mutation. Only RESERVED
    // (start the checkout), ONGOING and OVERDUE (continue checking out
    // still-booked items) are valid. Both the web action and the mobile
    // endpoint call this service directly, so without this guard a direct POST
    // against a DRAFT/COMPLETE/CANCELLED/ARCHIVED booking would flip asset
    // statuses and write checkout records (and a DRAFT would stay DRAFT while
    // its assets became checked out).
    if (
      bookingFound.status !== BookingStatus.RESERVED &&
      bookingFound.status !== BookingStatus.ONGOING &&
      bookingFound.status !== BookingStatus.OVERDUE
    ) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message:
          "This booking can't be checked out in its current status. Only reserved, ongoing, or overdue bookings can have items checked out.",
        shouldBeCaptured: false,
      });
    }

    // Deduplicate booking assets — a single asset can appear on multiple
    // BookingAsset pivot rows for qty-tracked bookings (slices per kit /
    // location). The progressive-checkout flow treats assets as opaque IDs,
    // so collapse the pivot to a unique-by-asset list once here and use it
    // everywhere downstream.
    // Wave B: also carries `type` / `unitOfMeasure` / `title` so the per-asset
    // qty loop can render unit-aware notes and decide qty vs. INDIVIDUAL paths.
    const bookingAssetsDeduped = (() => {
      const map = new Map<
        string,
        {
          id: string;
          status: AssetStatus;
          type: AssetType;
          title: string;
          unitOfMeasure: string | null;
          assetKits: { kitId: string }[];
        }
      >();
      for (const ba of bookingFound.bookingAssets) {
        if (!map.has(ba.asset.id)) {
          map.set(ba.asset.id, ba.asset);
        }
      }
      return [...map.values()];
    })();

    /** Quick lookup: assetId → AssetType (used by qty/individual branching). */
    const assetTypeById = new Map<string, AssetType>(
      bookingAssetsDeduped.map((a) => [a.id, a.type])
    );

    // Validate that all provided assetIds are actually in the booking BEFORE any
    // completion shortcut. The early-exit below delegates to the full checkout
    // when this batch covers all outstanding assets; without this guard a batch
    // like [lastOutstandingAsset, unrelatedSameOrgAsset] would satisfy that
    // check and check out the booking (writing notes about a non-booking asset)
    // instead of returning a 400. This matters especially for the mobile
    // endpoint, which forwards raw assetIds with none of the web drawer's
    // client-side filtering.
    const bookingAssetIds = new Set(bookingAssetsDeduped.map((a) => a.id));
    const invalidAssetIds = effectiveAssetIds.filter(
      (assetId) => !bookingAssetIds.has(assetId)
    );

    if (invalidAssetIds.length > 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message: `Some assets are not part of this booking: ${invalidAssetIds.join(
          ", "
        )}`,
      });
    }

    // QUANTITY_TRACKED dispositions must carry a positive `quantity`. INDIVIDUAL
    // rows always get implicit `quantity = 1` upstream, so this guard only fires
    // on malformed qty payloads from a direct API caller.
    for (const d of dispositions) {
      const isQty = assetTypeById.get(d.assetId) === AssetType.QUANTITY_TRACKED;
      if (isQty && (!d.quantity || d.quantity <= 0)) {
        throw new ShelfError({
          cause: null,
          status: 400,
          label,
          message:
            "Quantity-tracked assets must include a positive quantity to check out.",
          shouldBeCaptured: false,
        });
      }
    }

    // SECURITY (per-slice IDOR / data integrity): `bookingAssetId` is
    // caller-supplied and now load-bearing — it drives the per-slice checkout
    // cap AND the exact per-slice attribution persisted on
    // `PartialBookingCheckout`. A stale UI or a direct/mobile client could tag a
    // disposition with a slice id from a DIFFERENT asset or booking; the
    // exact-attribution reader would then credit the wrong slice, corrupting
    // per-slice remaining + notes. Validate every tagged disposition's slice
    // belongs to THIS booking AND matches its `assetId` before it is used for
    // caps or stored (covers both the delegate and progressive paths below).
    const assetIdBySliceId = new Map(
      bookingFound.bookingAssets.map((ba) => [ba.id, ba.asset.id])
    );
    for (const d of dispositions) {
      if (
        d.bookingAssetId &&
        assetIdBySliceId.get(d.bookingAssetId) !== d.assetId
      ) {
        throw new ShelfError({
          cause: null,
          status: 400,
          label,
          message: "Invalid booking asset slice supplied for check-out.",
          shouldBeCaptured: false,
        });
      }
    }

    // Assets already checked out for THIS booking. Source of truth is the
    // PartialBookingCheckout records, but a booking checked out via the
    // all-at-once flow leaves NO records while its assets are live CHECKED_OUT —
    // so also treat any currently-CHECKED_OUT booking asset as already checked
    // out. Without this, a progressive scan over an all-at-once booking would
    // re-check-out CHECKED_OUT assets (dup records/events) and misreport
    // outstanding/remaining counts.
    const alreadyCheckedOutAssetIds = await getPartiallyCheckedOutAssetIds({
      bookingId: id,
      organizationId,
    });
    const recordedAssetIdSet = new Set(alreadyCheckedOutAssetIds);
    const alreadyCheckedOutSet = new Set([
      ...recordedAssetIdSet,
      ...bookingAssetsDeduped
        .filter((asset) => asset.status === AssetStatus.CHECKED_OUT)
        .map((asset) => asset.id),
    ]);
    const providedAssetIds = new Set(effectiveAssetIds);

    // Booking assets not yet checked out (by record OR live status) = still Booked.
    const outstandingAssetIds = bookingAssetsDeduped
      .map((asset) => asset.id)
      .filter((assetId) => !alreadyCheckedOutSet.has(assetId));

    /**
     * Wave B: when callers carry per-asset `quantity`, delegating to the full
     * `checkoutBooking` is only correct when EVERY qty-tracked asset's full
     * `remainingToCheckOut` is being claimed by this batch. If a partial
     * quantity arrives, we must stay in the per-disposition path so the
     * `PartialBookingCheckout.quantities[]` row records the exact slice and
     * the check-IN side later reads the right `remaining` figure. The lookup
     * runs OUTSIDE the tx for the gating decision (it re-checks inside the
     * tx after the row lock, so no race risk).
     */
    let qtyClaimsCoverFullRemaining = true;
    if (dispositions.some((d) => d.assetId)) {
      for (const d of dispositions) {
        if (assetTypeById.get(d.assetId) !== AssetType.QUANTITY_TRACKED) {
          continue;
        }
        // eslint-disable-next-line no-await-in-loop -- sequential reads are fine here; loop is bounded by qty-tracked asset count in this batch
        const remainingForFull = await computeBookingAssetRemainingToCheckOut(
          db,
          id,
          d.assetId
        );
        if (d.quantity < remainingForFull) {
          qtyClaimsCoverFullRemaining = false;
          break;
        }
      }
    }

    // Delegate to the full checkout ONLY on the very first all-items scan of a
    // RESERVED booking (no prior partial-checkout records). `checkoutBooking`
    // re-processes EVERY booking asset, so running it after earlier partial
    // checkouts would duplicate full-checkout events and re-flip already-returned
    // assets to CHECKED_OUT. Once any records exist, later "final" batches stay
    // in the partial path below and report completion via remainingAssetCount.
    const shouldDelegateToFullCheckout =
      bookingFound.status === BookingStatus.RESERVED &&
      recordedAssetIdSet.size === 0 &&
      bookingAssetsDeduped.length > 0 &&
      outstandingAssetIds.every((assetId) => providedAssetIds.has(assetId)) &&
      qtyClaimsCoverFullRemaining;

    if (shouldDelegateToFullCheckout) {
      const fullyCheckedOut = await checkoutBooking({
        id,
        organizationId,
        hints,
        intentChoice,
        from: bookingFound.from,
        to: bookingFound.to,
        userId,
      });

      // Record the final batch in the partial-checkout source of truth.
      // `checkoutBooking` flips statuses + handles schedulers but does NOT write
      // PartialBookingCheckout rows, so without this the final assets stay
      // invisible to getPartiallyCheckedOutAssetIds / getDetailedPartialCheckoutData
      // — which would leave them "outstanding" (re-scan could re-trigger full
      // checkout) and mislabel them on the completed-booking "Returned" badge.
      // We record only the still-outstanding ids so re-scanned assets that were
      // already recorded in an earlier batch don't get duplicated.
      if (outstandingAssetIds.length > 0) {
        // Mirror the main-path `sessionAssetIds`/`sessionQuantities` invariant:
        // `assetIds[i]`, `quantities[i]` and `bookingAssetIds[i]` must be
        // positionally aligned so downstream readers
        // (computeBookingAssetRemainingToCheckOut, the completion gate in
        // isBookingFullyCheckedIn, and the per-slice attributor) get correct
        // per-slice figures. INDIVIDUAL ids without an explicit disposition
        // carry the implicit quantity = 1 and no slice tag (`""` → greedy).
        // This is the first all-items scan of a RESERVED booking, so
        // `outstandingAssetIds` is deduped per asset. A multi-slice QT asset
        // (e.g. standalone + kit slices of the same battery) has more than one
        // `bookingAssetId`, so a per-asset entry cannot faithfully name a
        // single slice — recording one arbitrary slice's tag would starve the
        // other slice's per-slice remaining. Since a full checkout claims
        // EVERY slice, we record greedy `""` for all entries and let the
        // standalone-first greedy attributor split the pool across slices on
        // read.
        const checkoutQtyByAssetId = new Map<string, number>();
        for (const d of checkouts ?? []) {
          checkoutQtyByAssetId.set(d.assetId, d.quantity);
        }
        const outstandingQuantities = outstandingAssetIds.map(
          (assetId) => checkoutQtyByAssetId.get(assetId) ?? 1
        );
        // Greedy `""` for every deduped entry (see comment above).
        const outstandingBookingAssetIds = outstandingAssetIds.map(() => "");
        await db.partialBookingCheckout.create({
          data: {
            bookingId: id,
            checkedOutById: userId,
            assetIds: outstandingAssetIds,
            quantities: outstandingQuantities,
            bookingAssetIds: outstandingBookingAssetIds,
            checkoutCount: outstandingAssetIds.length,
          },
        });
      }

      return {
        booking: fullyCheckedOut,
        checkedOutAssetCount: outstandingAssetIds.length,
        remainingAssetCount: 0,
        isComplete: true,
      };
    }

    // Validate the SCANNED assets only: reject if any is in custody or is
    // booked/checked-out by another overlapping booking. Mirrors
    // checkoutBooking's guards, scoped to this scan batch. Post-pivot we
    // look at conflicting BookingAsset rows (the `asset.bookings[]`
    // implicit relation no longer exists).
    const scannedAssetsWithConflicts = await db.asset.findMany({
      where: { id: { in: assetIds }, organizationId },
      include: {
        bookingAssets: {
          ...createBookingConflictConditions({
            currentBookingId: id,
            fromDate: bookingFound.from,
            toDate: bookingFound.to,
          }),
          select: {
            booking: {
              // `name` powers the overridden-reservation note below — a
              // conflict the user can act on has to name the other booking.
              select: { id: true, status: true, name: true },
            },
          },
        },
      },
    });

    // why: mirrors the proven `checkoutBooking` guard — QT assets can be in
    // IN_CUSTODY status with only SOME units claimed; the per-slice cap inside
    // the tx (below) is the authoritative availability check for QT.
    const inCustody = scannedAssetsWithConflicts.filter(
      (a) => !isQuantityTracked(a) && a.status === AssetStatus.IN_CUSTODY
    );
    if (inCustody.length > 0) {
      const names = inCustody
        .slice(0, 3)
        .map((a) => a.title)
        .join(", ");
      const more =
        inCustody.length > 3 ? ` and ${inCustody.length - 3} more` : "";
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        title: "Assets in custody",
        message: `Cannot check out. Some assets are currently in custody: ${names}${more}. Release custody first or remove them from the booking.`,
        shouldBeCaptured: false,
      });
    }

    /**
     * An already-in-flight booking outranks a not-yet-started reservation for
     * the same asset, so overlapping RESERVED bookings do not block THIS
     * check-out (see {@link outranksReservations}). A RESERVED booking checking
     * out still hits the full guard — this only relaxes the ONGOING/OVERDUE
     * direction, and only for reservations: an asset physically CHECKED_OUT on
     * another in-flight booking is still a hard block.
     */
    const inFlight = outranksReservations(bookingFound.status);

    /**
     * Reservations we are overriding by checking out anyway, deduped by booking
     * id. Drives the system notes written after the transaction commits so the
     * clash is visible to both sides instead of silently resolving in favour of
     * whoever clicked first.
     */
    const overriddenReservations = new Map<
      string,
      { id: string; name: string; assets: { id: string; title: string }[] }
    >();
    if (inFlight && bookingFound.from && bookingFound.to) {
      for (const asset of scannedAssetsWithConflicts) {
        // Only INDIVIDUAL assets can be starved this way — the helper leaves
        // QUANTITY_TRACKED availability to the per-slice caps inside the tx.
        if (isQuantityTracked(asset)) continue;
        for (const { booking } of asset.bookingAssets) {
          if (booking.id === id) continue;
          if (booking.status !== BookingStatus.RESERVED) continue;
          const entry = overriddenReservations.get(booking.id) ?? {
            id: booking.id,
            name: booking.name,
            assets: [],
          };
          entry.assets.push({ id: asset.id, title: asset.title });
          overriddenReservations.set(booking.id, entry);
        }
      }
    }

    if (bookingFound.from && bookingFound.to) {
      const conflicted = scannedAssetsWithConflicts.filter((a) =>
        hasAssetBookingConflicts(a, id, { ignoreReservedConflicts: inFlight })
      );
      if (conflicted.length > 0) {
        const names = conflicted
          .slice(0, 3)
          .map((a) => a.title)
          .join(", ");
        const more =
          conflicted.length > 3 ? ` and ${conflicted.length - 3} more` : "";
        throw new ShelfError({
          cause: null,
          status: 400,
          label,
          title: "Booking conflict",
          message: `Cannot check out. Some assets are already booked or checked out elsewhere: ${names}${more}. Remove the conflicted assets and try again.`,
          shouldBeCaptured: false,
        });
      }
    }

    // Defensive: skip assets already checked out for this booking — by record
    // OR by live CHECKED_OUT status (idempotent re-scan, incl. all-at-once
    // checkouts that left no records).
    // NOTE: for QUANTITY_TRACKED assets "already checked out" is a per-asset
    // boolean and intentionally lossy — partial qty already claimed shows up
    // there only when the asset's status flipped to CHECKED_OUT (every unit
    // claimed). The per-slice cap inside the tx is the precise gate.
    const assetIdsToCheckOut = effectiveAssetIds.filter(
      (assetId) =>
        !alreadyCheckedOutSet.has(assetId) ||
        assetTypeById.get(assetId) === AssetType.QUANTITY_TRACKED
    );
    if (assetIdsToCheckOut.length === 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message: "All scanned assets are already checked out for this booking.",
      });
    }

    // For kits: only update kit status if ALL assets of a kit are being checked out.
    // Post-pivot, kit membership lives on `Asset.assetKits[]`; collapse to the
    // first kitId per asset (kits-as-bag-of-assets is still a 1:1 relation in
    // the customer-facing semantics of this flow).
    const assetsBeingCheckedOut = bookingAssetsDeduped.filter((a) =>
      assetIdsToCheckOut.includes(a.id)
    );
    const kitIdsBeingCheckedOut = getKitIdsByAssets(assetsBeingCheckedOut);

    // Only process kits where ALL their assets in this booking are being checked out
    const completeKitIds: string[] = [];
    for (const kitId of kitIdsBeingCheckedOut) {
      const kitAssetsInBooking = bookingAssetsDeduped.filter(
        (a) => a.assetKits?.[0]?.kitId === kitId
      );
      const kitAssetsBeingCheckedOut = assetsBeingCheckedOut.filter(
        (a) => a.assetKits?.[0]?.kitId === kitId
      );

      if (kitAssetsInBooking.length === kitAssetsBeingCheckedOut.length) {
        completeKitIds.push(kitId);
      }
    }

    /**
     * Per-asset qty-checkout summary populated INSIDE the tx and consumed by the
     * post-tx note pipeline. Mirror of {@link QtyDispositionSummary} from the
     * check-IN side but unidirectional — only `checkedOut` + `remainingAfter`.
     * Phase 4e parity: carries `type` + `unitOfMeasure` so `formatUnitCount`
     * can render "checked out 10 boxes" without an extra DB roundtrip.
     */
    type CheckoutQtySummary = {
      assetId: string;
      title: string;
      type: AssetType;
      unitOfMeasure: string | null;
      checkedOut: number;
      remainingAfter: number;
      /**
       * The exact `BookingAsset.id` this checked-out slice came from, or `null`
       * for a legacy / greedy disposition that carried no slice tag. Drives the
       * per-slice vs. asset-level phrasing in the checkout note.
       */
      bookingAssetId: string | null;
      /** `AssetKit.id` when the slice is kit-driven; `null` when standalone/legacy. */
      assetKitId: string | null;
      /** Kit display name for a kit-driven slice; `null` when standalone/legacy. */
      kitName: string | null;
      /** `BookingAsset.quantity` — units booked on THIS slice (0 for legacy). */
      sliceBooked: number;
    };

    /**
     * Per-slice lookup for the checkout note (Layer 3): `BookingAsset.id` → its
     * booked quantity + kit label. Built once from the already-loaded booking
     * graph so the qty loop can attribute each disposition to its exact slice
     * without an extra DB round-trip. `assetKitId`/`kitName` are `null` for
     * standalone slices; the kit name is resolved by matching the slice's
     * `assetKitId` (an `AssetKit.id`) against the asset's `assetKits`
     * memberships loaded above.
     */
    const sliceInfoById = new Map<
      string,
      { sliceBooked: number; assetKitId: string | null; kitName: string | null }
    >();
    for (const ba of bookingFound.bookingAssets) {
      const assetKitId = ba.assetKitId ?? null;
      const kitName = assetKitId
        ? ba.asset.assetKits.find((ak) => ak.id === assetKitId)?.kit?.name ??
          null
        : null;
      sliceInfoById.set(ba.id, {
        sliceBooked: ba.quantity ?? 0,
        assetKitId,
        kitName,
      });
    }

    const result = await db.$transaction(
      async (tx) => {
        /**
         * Wave B: per-disposition qty-tracked loop. Mirrors the partial-checkin
         * row-lock pattern — lock → re-read remaining inside tx → enforce cap →
         * (no ConsumptionLog write here; checkout records live on
         * `PartialBookingCheckout` rows that we batch-create below).
         *
         * Critical invariant: subsequent iterations of THIS batch must see the
         * claims made by earlier iterations. `PartialBookingCheckout` is written
         * once at the end, so we accumulate per-asset / per-slice claims in
         * memory and subtract them from each iteration's freshly-read remaining
         * before enforcing the cap. Without this, two slices of the same asset
         * (kit + standalone) would both see the same `committedRemaining` and
         * over-claim.
         */
        const qtySummaries: CheckoutQtySummary[] = [];
        const claimedByAssetThisBatch = new Map<string, number>();
        const claimedBySliceThisBatch = new Map<string, number>();
        /**
         * Track which asset titles each disposition saw so the post-loop status
         * flip can reuse them without re-reading the asset. Populated only for
         * qty-tracked dispositions (the only path that goes through the lock).
         */
        const titleByAssetId = new Map<string, string>();
        /** Track type+unitOfMeasure for `assetQtyMeta` of qty events post-loop. */
        const qtyShapeByAssetId = new Map<
          string,
          { type: AssetType; unitOfMeasure: string | null }
        >();
        /**
         * Locked-asset row per qty asset touched this batch, captured during the
         * pre-lock pass below so the disposition loop can reuse its
         * title/type/unitOfMeasure without re-reading (and without re-locking a
         * shared asset once per slice).
         */
        const lockedAssetById = new Map<
          string,
          Awaited<ReturnType<typeof lockAssetForQuantityUpdate>>
        >();

        /**
         * Distinct qty-tracked assets in this batch. Used to (a) row-lock each
         * asset ONCE up front and (b) issue a SINGLE batched committed-remaining
         * read for all of them — replacing one lock + three queries PER
         * disposition, which scaled the transaction's round-trips with the batch
         * (and, via the singular helper's per-call booking-level reads, with the
         * booking size) and blew the tx timeout (Sentry SHELF-WEBAPP-217).
         *
         * Sorted so every concurrent checkout acquires the per-asset row locks
         * in the SAME deterministic order — two batches touching the same assets
         * in opposite payload order can't take the locks in reverse and deadlock.
         * Disposition processing below keeps its original `dispositions` order.
         */
        const qtyDispositionAssetIds = [
          ...new Set(
            dispositions
              .filter(
                (d) =>
                  assetTypeById.get(d.assetId) === AssetType.QUANTITY_TRACKED
              )
              .map((d) => d.assetId)
          ),
        ].sort();

        // Row-lock every qty asset BEFORE reading committed remaining, preserving
        // the lock-before-read ordering the per-disposition loop relied on: a
        // concurrent checkout on the same asset can't slip a claim between our
        // read and our lock. Capture title/type/unitOfMeasure while we hold it.
        for (const assetId of qtyDispositionAssetIds) {
          const lockedAsset = await lockAssetForQuantityUpdate(
            tx,
            assetId,
            organizationId
          );
          lockedAssetById.set(assetId, lockedAsset);
          titleByAssetId.set(assetId, lockedAsset.title);
          qtyShapeByAssetId.set(assetId, {
            type: lockedAsset.type,
            unitOfMeasure: lockedAsset.unitOfMeasure,
          });
        }

        // ONE batched committed-remaining read (booking total − Σ prior PBC
        // sessions) for every qty asset. This value is CONSTANT across the
        // disposition loop below: it reads only prior/committed sessions (this
        // batch's own claims are tracked in `claimedByAssetThisBatch` and the new
        // session row is written AFTER the loop), so precomputing it once is
        // exactly equivalent to re-reading it per disposition.
        const committedRemainingByAsset =
          await computeBookingAssetsRemainingToCheckOut(
            tx,
            id,
            qtyDispositionAssetIds
          );

        /**
         * Distinct slice-tagged BookingAsset ids across this batch's QT
         * dispositions. Read their committed per-slice remaining in ONE batched
         * call (mirroring the asset-level precompute above) instead of firing the
         * singular helper — three queries each — once per slice inside the loop,
         * which fanned out `O(3·K)` sequential reads and compounded the tx-timeout
         * (Sentry SHELF-WEBAPP-217). Like the asset-level value, this is CONSTANT
         * across the loop: it reads only prior/committed sessions (this batch's
         * per-slice claims live in `claimedBySliceThisBatch`; the new session row
         * is written AFTER the loop), so precomputing once is exactly equivalent.
         */
        const sliceTaggedBookingAssetIds = [
          ...new Set(
            dispositions
              .filter(
                (d) =>
                  d.bookingAssetId &&
                  assetTypeById.get(d.assetId) === AssetType.QUANTITY_TRACKED
              )
              .map((d) => d.bookingAssetId!)
          ),
        ];
        /**
         * Assets claimed WITHOUT a slice tag. The mobile route accepts
         * `{ assetId, quantity }` and the companion sends exactly that, so a
         * qty-tracked asset can be claimed with no slice named. The
         * `checkedOutAt` marker still has to name specific slices, so their
         * remainings are read in the same batch — widening this call rather
         * than adding a second round-trip inside the transaction.
         */
        const untaggedQtyAssetIds = new Set(
          dispositions
            .filter(
              (d) =>
                !d.bookingAssetId &&
                assetTypeById.get(d.assetId) === AssetType.QUANTITY_TRACKED
            )
            .map((d) => d.assetId)
        );
        const untaggedQtySliceIds = bookingFound.bookingAssets
          .filter((ba) => untaggedQtyAssetIds.has(ba.asset.id))
          .map((ba) => ba.id);
        const sliceCommittedRemainingBySlice =
          await computeBookingAssetsSliceRemainingToCheckOut(tx, id, [
            ...sliceTaggedBookingAssetIds,
            ...untaggedQtySliceIds,
          ]);

        for (const disp of dispositions) {
          if (assetTypeById.get(disp.assetId) !== AssetType.QUANTITY_TRACKED) {
            continue;
          }

          // Reuse the row-lock captured in the pre-lock pass above (the asset was
          // locked BEFORE the batched committed-remaining read). Non-null is safe:
          // `disp.assetId` is QUANTITY_TRACKED here, so it is in
          // `qtyDispositionAssetIds` and therefore in `lockedAssetById`.
          const lockedAsset = lockedAssetById.get(disp.assetId)!;

          // Committed remaining = booking total − Σ(prior PBC sessions). Does NOT
          // include this batch's prior iterations — that comes from the in-memory
          // running map below.
          const committedRemaining =
            committedRemainingByAsset.get(disp.assetId) ?? 0;

          const claimedSoFarThisBatch =
            claimedByAssetThisBatch.get(disp.assetId) ?? 0;
          const assetCap = Math.max(
            0,
            committedRemaining - claimedSoFarThisBatch
          );

          /**
           * Per-slice cap (Polish-7b parity): when the disposition targets a
           * specific BookingAsset slice (kit-driven + standalone of the same
           * asset both flow as separate dispositions), bound the claim by BOTH
           * the slice's own remaining AND the asset-level remaining. The slice
           * remaining ALSO subtracts the running batch claim for the same slice
           * so a double-submit of the same slice can't over-claim. Legacy
           * callers omit `bookingAssetId` → asset-level cap only.
           */
          let cap = assetCap;
          // Hoisted out of the slice branch so the per-slice `remainingAfter` in
          // the summary below can reuse them. `null` for a legacy disposition
          // (no slice tag) → the summary falls back to the asset-level remaining.
          let sliceCommittedRemaining: number | null = null;
          let claimedThisSliceSoFar = 0;
          if (disp.bookingAssetId) {
            // Checkout-side per-slice remaining: booked − prior
            // `PartialBookingCheckout` claims attributed to THIS slice. Must NOT
            // use the check-IN helper (`computeBookingAssetSliceRemaining`), which
            // only subtracts return `ConsumptionLog`s and would let a slice with
            // prior checkouts be over-claimed here — and would mis-report the
            // note's per-slice "still booked" (which reuses this value below).
            // Read from the batched precompute above (constant across the loop):
            // committed-only, so the in-memory `claimedThisSliceSoFar` supplies
            // this batch's running claim.
            sliceCommittedRemaining =
              sliceCommittedRemainingBySlice.get(disp.bookingAssetId) ?? 0;
            claimedThisSliceSoFar =
              claimedBySliceThisBatch.get(disp.bookingAssetId) ?? 0;
            const sliceCap = Math.max(
              0,
              sliceCommittedRemaining - claimedThisSliceSoFar
            );
            cap = Math.min(cap, sliceCap);
          }

          // Bare QUANTITY_TRACKED scan (assetIds-only, no explicit count):
          // resolve to "all remaining" for this asset — the per-asset `cap`
          // computed above (the asset was row-locked in the pre-lock pass).
          // Mutating the disposition so the
          // `PartialBookingCheckout.quantities[]` ledger write below records
          // the real units, not the sentinel 1. Mirrors the "Check Out All"
          // default; explicit per-unit `quantity` payloads are left untouched.
          //
          // Only resolve when units remain. On a re-scan of an already
          // fully-checked-out asset `cap === 0`; we KEEP the sentinel
          // `quantity: 1` so the `claimed > cap` guard below throws
          // "Only 0 units left…" — the same rejection an explicit re-scan
          // gets — instead of persisting a bogus `quantities: [0]` row +
          // audit events.
          if (disp.defaultAllRemaining && cap > 0) {
            disp.quantity = cap;
          }

          const claimed = disp.quantity;
          if (claimed > cap) {
            // Render `cap` with the asset's unit of measure so qty-tracked rows
            // say "Only 5 boxes left to check out for \"Cardboard Boxes\""
            // instead of "Only 5 left". Including the asset title disambiguates
            // multi-asset error reports and makes the message actionable on
            // mobile (no row-level context). INDIVIDUAL would fall through, but
            // this branch is only reachable for QUANTITY_TRACKED rows.
            const capRendered =
              formatUnitCount(
                {
                  type: lockedAsset.type,
                  unitOfMeasure: lockedAsset.unitOfMeasure,
                },
                cap
              ) ?? `${cap} units`;
            throw new ShelfError({
              cause: null,
              status: 400,
              label,
              message: `Only ${capRendered} left to check out for "${lockedAsset.title}"`,
              shouldBeCaptured: false,
            });
          }

          // Record the claim so the NEXT iteration sees the running total.
          claimedByAssetThisBatch.set(
            disp.assetId,
            claimedSoFarThisBatch + claimed
          );
          if (disp.bookingAssetId) {
            claimedBySliceThisBatch.set(
              disp.bookingAssetId,
              (claimedBySliceThisBatch.get(disp.bookingAssetId) ?? 0) + claimed
            );
          }

          // Layer 3 per-slice attribution for the checkout note. When the
          // disposition carries a slice tag, resolve the slice's booked total +
          // kit label from the in-memory booking graph (no round-trip) and report
          // the PER-SLICE remaining. Legacy dispositions (scanner / untagged)
          // keep the asset-level remaining and null slice fields, so the note
          // formatter falls back to the pre-Layer-3 asset-level phrasing.
          const sliceInfo = disp.bookingAssetId
            ? sliceInfoById.get(disp.bookingAssetId)
            : undefined;
          const remainingAfter =
            disp.bookingAssetId && sliceCommittedRemaining !== null
              ? // Per-slice: this slice's committed remaining minus the batch's
                // running claim for the SAME slice (this iteration inclusive).
                Math.max(
                  0,
                  sliceCommittedRemaining - claimedThisSliceSoFar - claimed
                )
              : // Legacy: asset-level remaining after this iteration.
                Math.max(
                  0,
                  committedRemaining - claimedSoFarThisBatch - claimed
                );

          qtySummaries.push({
            assetId: disp.assetId,
            title: lockedAsset.title,
            type: lockedAsset.type,
            unitOfMeasure: lockedAsset.unitOfMeasure,
            checkedOut: claimed,
            bookingAssetId: disp.bookingAssetId ?? null,
            assetKitId: sliceInfo?.assetKitId ?? null,
            kitName: sliceInfo?.kitName ?? null,
            sliceBooked: sliceInfo?.sliceBooked ?? 0,
            remainingAfter,
          });
        }

        /**
         * INDIVIDUAL assets in this batch: always flip to CHECKED_OUT.
         * QUANTITY_TRACKED assets: per-asset flip only when ALL booked units
         * (sum of pivot quantities across all slices for this asset) have been
         * claimed across ALL sessions (prior + this batch). The conflict +
         * custody validation upstream already rejects ineligible assets.
         */
        const individualToFlip = assetIdsToCheckOut.filter(
          (assetId) => assetTypeById.get(assetId) !== AssetType.QUANTITY_TRACKED
        );
        if (individualToFlip.length > 0) {
          /**
           * The conflict + custody guards above ran on a PRE-transaction
           * snapshot. An overlapping booking can check one of these assets out
           * (or take custody) in the window between that read and this write —
           * the in-flight override widens that window, because a booking that
           * merely looked RESERVED at read time no longer blocks us. Without a
           * precondition both bookings would record a check-out of the same
           * physical asset.
           *
           * Constraining the UPDATE itself makes the re-check atomic: Postgres
           * blocks on any row a concurrent transaction is updating, then
           * re-evaluates this `where` against the committed row. A row taken
           * meanwhile no longer matches, so `count` comes up short and we abort
           * the whole batch rather than double-claiming it.
           */
          const flipped = await tx.asset.updateMany({
            where: {
              id: { in: individualToFlip },
              organizationId,
              status: {
                notIn: [AssetStatus.CHECKED_OUT, AssetStatus.IN_CUSTODY],
              },
            },
            data: { status: AssetStatus.CHECKED_OUT },
          });

          if (flipped.count !== individualToFlip.length) {
            // Error path only — resolve the titles for a message that names
            // what was lost instead of failing anonymously.
            const taken = await tx.asset.findMany({
              where: {
                id: { in: individualToFlip },
                organizationId,
                status: {
                  in: [AssetStatus.CHECKED_OUT, AssetStatus.IN_CUSTODY],
                },
              },
              select: { title: true },
            });
            const names = taken
              .slice(0, 3)
              .map((a) => a.title)
              .join(", ");
            const more =
              taken.length > 3 ? ` and ${taken.length - 3} more` : "";
            throw new ShelfError({
              cause: null,
              status: 409,
              label,
              title: "Booking conflict",
              message: `Cannot check out. Some assets were checked out or taken into custody elsewhere while this check-out was being processed: ${names}${more}. Refresh and try again.`,
              shouldBeCaptured: false,
            });
          }
        }

        /**
         * Per-asset QT status flip across ALL sessions. For each qty-tracked
         * asset touched in this batch, compute `bookedTotal` (sum of all
         * `BookingAsset.quantity` pivot rows for this asset on this booking)
         * and compare against `priorCommittedClaims + thisBatchClaims`. Flip
         * to CHECKED_OUT only when the asset is fully claimed across every
         * session — a partial slice must leave the status alone (the pool is
         * still partly available for the same or other bookings).
         */
        const qtyAssetsTouched = [
          ...new Set(qtySummaries.map((s) => s.assetId)),
        ];
        const bookedTotalByAsset = (() => {
          const map = new Map<string, number>();
          for (const ba of bookingFound.bookingAssets) {
            const prev = map.get(ba.asset.id) ?? 0;
            map.set(ba.asset.id, prev + (ba.quantity ?? 0));
          }
          return map;
        })();
        // Collect the qty assets that this batch fully claimed across every
        // session. We then issue ONE `updateMany` for the whole set rather than
        // one write per asset — fewer round-trips + mirrors the INDIVIDUAL flip
        // path above + lets the org-scope `where` clause be enforced on the
        // batched query (defense-in-depth — the assetIds already came from
        // qtySummaries which were validated against the org-scoped booking).
        const qtyAssetsToFlip: string[] = [];
        for (const assetId of qtyAssetsTouched) {
          // Committed remaining (prior sessions only) for this asset was already
          // resolved by the batched pre-loop read — reuse it instead of a fresh
          // per-asset round-trip. `qtyAssetsTouched ⊆ qtyDispositionAssetIds`, and
          // no PartialBookingCheckout row is written until below, so the pre-loop
          // value is still current. Combined with this batch's running total it
          // gives "remaining after all sessions including this batch", which
          // drives the flip decision.
          const committedRemaining =
            committedRemainingByAsset.get(assetId) ?? 0;
          const thisBatchClaim = claimedByAssetThisBatch.get(assetId) ?? 0;
          const remainingAfterAllSessions = Math.max(
            0,
            committedRemaining - thisBatchClaim
          );
          const bookedTotal = bookedTotalByAsset.get(assetId) ?? 0;
          // Flip only when every booked unit has been claimed. Guard against
          // `bookedTotal === 0` (defensive: shouldn't happen for valid bookings)
          // by requiring positive total before flipping.
          if (bookedTotal > 0 && remainingAfterAllSessions === 0) {
            qtyAssetsToFlip.push(assetId);
          }
        }
        if (qtyAssetsToFlip.length > 0) {
          await tx.asset.updateMany({
            where: { id: { in: qtyAssetsToFlip }, organizationId },
            data: { status: AssetStatus.CHECKED_OUT },
          });
        }

        // Only update kit status for kits that are completely checked out
        if (completeKitIds.length > 0) {
          await tx.kit.updateMany({
            where: { id: { in: completeKitIds }, organizationId },
            data: { status: KitStatus.CHECKED_OUT },
          });
        }

        /**
         * `PartialBookingCheckout` session row. `assetIds[i]` and `quantities[i]`
         * are positionally aligned: every entry corresponds to one disposition
         * (INDIVIDUAL or qty-tracked slice). Repeated `assetId` entries are
         * legal — they record multiple slices of the same asset in one session.
         */
        const sessionAssetIds: string[] = [];
        const sessionQuantities: number[] = [];
        // Positional with `sessionAssetIds`/`sessionQuantities`: the exact
        // `BookingAsset.id` a slice was checked out from, or `""` when the
        // disposition carries no slice tag (INDIVIDUAL / legacy). Read back by
        // `checkoutSessionsToLogsByAsset` so per-slice attribution is exact and
        // `""` collapses to greedy. Prisma `String[]` cannot hold `null`, hence
        // the `""` sentinel.
        const sessionBookingAssetIds: string[] = [];
        for (const disp of dispositions) {
          if (!assetIdsToCheckOut.includes(disp.assetId)) continue;
          sessionAssetIds.push(disp.assetId);
          // INDIVIDUAL rows always count as 1 unit (the legacy implicit), even if
          // an upstream caller set a different value by mistake. QUANTITY_TRACKED
          // rows record their explicit per-slice quantity.
          const qty =
            assetTypeById.get(disp.assetId) === AssetType.QUANTITY_TRACKED
              ? disp.quantity
              : 1;
          sessionQuantities.push(qty);
          // QT dialog dispositions carry `bookingAssetId`; INDIVIDUAL / legacy
          // fallback dispositions do not → `""` (single-slice, greedy == exact).
          sessionBookingAssetIds.push(disp.bookingAssetId ?? "");
        }

        const createdSession = await tx.partialBookingCheckout.create({
          data: {
            bookingId: id,
            checkedOutById: userId,
            assetIds: sessionAssetIds,
            quantities: sessionQuantities,
            bookingAssetIds: sessionBookingAssetIds,
            // `checkoutCount` historically counted distinct assetIds, but the
            // existing reports treat it as the array length — preserve that
            // semantic (one entry per row, including repeated slices).
            checkoutCount: sessionAssetIds.length,
          },
          select: { id: true },
        });

        /**
         * Mark the slices this session sent out. The session row above owns
         * per-slice QUANTITY attribution; this marker owns the boolean "is it
         * out", which is what the check-in guard reads. Both are needed: the
         * row cannot answer it for assets the all-at-once flow sent out.
         */
        /**
         * Scoped to the slices this batch actually claimed. `assetId`-wide
         * would stamp every sibling slice of a multi-slice qty-tracked asset —
         * standalone plus N kit-driven rows can coexist for one (booking,
         * asset) — recording units that never left as out, which the check-in
         * guard then reads as permission to reconcile them.
         *
         * Asset-wide is exact only when the claim covers every outstanding unit
         * of the asset. That holds for INDIVIDUAL entries (one slice per
         * booking) and for a bare scan, whose `defaultAllRemaining` resolves to
         * the whole asset-level remaining. A PARTIAL untagged qty-tracked claim
         * is neither: the mobile route accepts `{ assetId, quantity }` with no
         * slice tag and the companion sends exactly that, so those are resolved
         * to a greedy slice prefix below.
         */
        const taggedSliceIds = sessionBookingAssetIds.filter(Boolean);
        const untaggedAssetIds = sessionAssetIds.filter(
          (_, i) => !sessionBookingAssetIds[i]
        );

        /** Untagged claim per asset, summed across this batch's entries. */
        const untaggedClaimByAsset = new Map<string, number>();
        sessionAssetIds.forEach((assetId, i) => {
          if (sessionBookingAssetIds[i]) return;
          untaggedClaimByAsset.set(
            assetId,
            (untaggedClaimByAsset.get(assetId) ?? 0) +
              (sessionQuantities[i] ?? 0)
          );
        });

        /**
         * Resolve an untagged qty-tracked claim to the slices it actually
         * takes: walk that asset's slices in the shared greedy order and
         * consume each one's remaining until the claim is covered.
         *
         * Capacity is the slice's REMAINING, not its booked quantity, which is
         * where this parts company with the quantity attribution in
         * {@link attributeDispositionsByBookingAsset}. A slice already fully
         * out has room in the booked sense and would swallow the claim, so the
         * slice the units are really leaving from would go unmarked — and an
         * unmarked slice reads as "never checked out" at check-in.
         *
         * An asset is left to the asset-wide branch when the claim covers
         * everything outstanding, and also when the walk cannot cover it (the
         * claim disagrees with what we read as remaining). Under-marking is the
         * worse failure of the two: it refuses a check-in outright, with no way
         * for the operator around it.
         */
        const greedySliceIds: string[] = [];
        const resolvedUntaggedAssetIds = new Set<string>();
        for (const [assetId, claimed] of untaggedClaimByAsset) {
          if (assetTypeById.get(assetId) !== AssetType.QUANTITY_TRACKED) {
            continue;
          }
          if (claimed >= (committedRemainingByAsset.get(assetId) ?? 0)) {
            continue;
          }
          let toCover = claimed;
          const picked: string[] = [];
          const slices = bookingFound.bookingAssets
            .filter((ba) => ba.asset.id === assetId)
            .sort(compareSlicesForGreedyFill);
          for (const slice of slices) {
            if (toCover <= 0) break;
            const capacity = sliceCommittedRemainingBySlice.get(slice.id) ?? 0;
            if (capacity <= 0) continue;
            picked.push(slice.id);
            toCover -= capacity;
          }
          if (toCover > 0) continue;
          greedySliceIds.push(...picked);
          resolvedUntaggedAssetIds.add(assetId);
        }

        const assetWideIds = untaggedAssetIds.filter(
          (assetId) => !resolvedUntaggedAssetIds.has(assetId)
        );
        const exactSliceIds = [...taggedSliceIds, ...greedySliceIds];
        const sliceScope = {
          bookingId: id,
          OR: [
            ...(exactSliceIds.length ? [{ id: { in: exactSliceIds } }] : []),
            ...(assetWideIds.length ? [{ assetId: { in: assetWideIds } }] : []),
          ],
        };

        if (sliceScope.OR.length > 0) {
          // First marker wins: a slice a previous batch sent out keeps its
          // original "out since / out by", matching the full-checkout writer.
          await tx.bookingAsset.updateMany({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `id` was org-checked by this action's booking lookup
            where: { ...sliceScope, checkedOutAt: null },
            data: {
              checkedOutAt: new Date(),
              checkedOutById: userId,
              checkedInAt: null,
              checkedInById: null,
            },
          });

          // A slice that was reconciled and is going out again returns to
          // outstanding without losing its original checkout marker. The
          // statement above cannot reach it, and leaving `checkedInAt` set
          // makes physically-out units read as fully returned.
          await tx.bookingAsset.updateMany({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `id` was org-checked by this action's booking lookup
            where: {
              ...sliceScope,
              checkedOutAt: { not: null },
              checkedInAt: { not: null },
            },
            data: { checkedInAt: null, checkedInById: null },
          });
        }

        /**
         * Size what this session sent out, per slice.
         *
         * The marker above says a slice is out; this says how many of its units
         * went, which is the part a timestamp cannot carry. Read from the three
         * positionally-aligned arrays the session row was just built from, so
         * the count and the session can never describe different departures.
         *
         * {@link attributeSessionCheckoutToSlices} owns the per-slice split and
         * the capacity rule that keeps it agreeing with the marker above.
         *
         * Cumulative: a slice returned in full and sent out again adds to its
         * count rather than replacing it.
         */
        const unitsBySliceId = attributeSessionCheckoutToSlices({
          sliceRows: bookingFound.bookingAssets.map((ba) => ({
            id: ba.id,
            assetId: ba.asset.id,
            quantity: ba.quantity,
            assetKitId: ba.assetKitId,
          })),
          committedRemainingBySlice: sliceCommittedRemainingBySlice,
          // The session arrays are positionally aligned and carry "" for an
          // untagged claim, which the attributor reads as "names no slice".
          claims: sessionAssetIds.map((assetId, index) => ({
            assetId,
            bookingAssetId: sessionBookingAssetIds[index] || null,
            quantity: sessionQuantities[index] ?? 1,
          })),
        });

        for (const [sliceId, units] of unitsBySliceId) {
          if (units <= 0) continue;
          await tx.bookingAsset.updateMany({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: slice ids come from this booking's own rows, loaded org-scoped by this action's booking lookup
            where: { id: sliceId, bookingId: id },
            data: { checkedOutQuantity: { increment: units } },
          });
        }

        // Layer 3: the per-asset fold that previously collapsed both slices of an
        // asset into one summary is gone — the checkout note pipeline now renders
        // one line PER SLICE so a slice-level action reports slice-level totals
        // (a standalone-slice checkout no longer shows the whole asset's booked
        // count). The per-slice `qtySummaries` flow straight to the note fragment
        // and the post-tx per-asset note loop.

        // Create audit notes for INDIVIDUAL rows. Qty-tracked rows get their
        // own per-asset note written OUTSIDE the tx (with unit-aware phrasing).
        const actor = wrapUserLinkForNote({ ...user, id: userId });
        if (individualToFlip.length > 0) {
          await createNotes(
            {
              content: `${actor} checked out via partial check-out.`,
              type: "UPDATE",
              userId,
              assetIds: individualToFlip,
              organizationId,
            },
            tx
          );
        }

        /**
         * Activity events — one `BOOKING_PARTIAL_CHECKOUT` per disposition row.
         * `meta.quantity` is set for QUANTITY_TRACKED rows (via `assetQtyMeta`,
         * which returns `{}` for INDIVIDUAL). `meta.partialCheckoutSessionId`
         * groups events from the same scan batch for the reports.
         */
        const eventInputs: ActivityEventInput[] = dispositions
          .filter((d) => assetIdsToCheckOut.includes(d.assetId))
          .map((d) => {
            // Prefer the locked-asset shape captured in-loop (truth-source for
            // qty rows); fall back to the deduped booking pivot snapshot for
            // INDIVIDUAL rows so `assetQtyMeta` still returns `{}` cleanly.
            const qtyShape =
              qtyShapeByAssetId.get(d.assetId) ??
              (() => {
                const ba = bookingAssetsDeduped.find((a) => a.id === d.assetId);
                return ba
                  ? { type: ba.type, unitOfMeasure: ba.unitOfMeasure }
                  : null;
              })();
            const qtyMeta = qtyShape ? assetQtyMeta(qtyShape, d.quantity) : {};
            return {
              organizationId,
              actorUserId: userId,
              action: "BOOKING_PARTIAL_CHECKOUT",
              entityType: "BOOKING",
              entityId: id,
              bookingId: id,
              assetId: d.assetId,
              meta: {
                ...qtyMeta,
                partialCheckoutSessionId: createdSession.id,
              },
            };
          });
        if (eventInputs.length > 0) {
          await recordEvents(eventInputs, tx);
        }

        // First scan marks the booking checked out: RESERVED → ONGOING/OVERDUE.
        let bookingStatusChanged = false;
        if (bookingFound.status === BookingStatus.RESERVED) {
          const expired = bookingFound.to
            ? isBookingExpired({ to: bookingFound.to })
            : false;

          const transitionData: Prisma.BookingUpdateInput = {
            status: expired ? BookingStatus.OVERDUE : BookingStatus.ONGOING,
          };

          // Early checkout: if the booking hasn't started yet and the user chose
          // to adjust the date (via the early-checkout dialog), move `from` to now
          // and preserve the original start in `originalFrom`. Mirrors the
          // all-at-once checkoutBooking path so a partial early checkout doesn't
          // leave a future start time while custody has already begun.
          if (
            bookingFound.from &&
            isBookingEarlyCheckout(bookingFound.from) &&
            intentChoice === CheckoutIntentEnum["with-adjusted-date"]
          ) {
            transitionData.originalFrom = plannedStartToPreserve(bookingFound);
            const fromDateStr = DateTime.fromJSDate(new Date(), {
              zone: hints.timeZone,
            }).toFormat(DATE_TIME_FORMAT);
            transitionData.from = DateTime.fromFormat(
              fromDateStr,
              DATE_TIME_FORMAT,
              { zone: hints.timeZone }
            ).toJSDate();
          }

          await tx.booking.update({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) above
            where: { id },
            data: transitionData,
            select: { id: true },
          });
          bookingStatusChanged = true;
        }

        // BOOKING ACTIVITY LOG: Log partial check-out activity.
        // Get the kit and standalone asset data for consistent formatting.
        // Post-pivot, kit membership lives on `Asset.assetKits[]`; project the
        // related kit through the pivot row (kits-as-bag-of-assets still treats
        // each asset as a member of at most one kit in this code path).
        const assetsWithKitInfo = await tx.asset.findMany({
          where: { id: { in: assetIdsToCheckOut }, organizationId },
          select: {
            id: true,
            title: true,
            assetKits: {
              select: {
                kit: { select: { id: true, name: true } },
              },
              take: 1,
            },
          },
        });

        // Separate complete kits from individual assets
        const completeKits: Array<{ id: string; name: string }> = [];
        const standaloneAssets: Array<{ id: string; title: string }> = [];
        const processedKitIds = new Set<string>();

        for (const asset of assetsWithKitInfo) {
          const kit = asset.assetKits?.[0]?.kit ?? null;
          if (
            kit &&
            completeKitIds.includes(kit.id) &&
            !processedKitIds.has(kit.id)
          ) {
            completeKits.push({ id: kit.id, name: kit.name });
            processedKitIds.add(kit.id);
          } else if (!kit || !completeKitIds.includes(kit.id)) {
            // Asset belongs to a kit that is only partially being checked
            // in/out: the kit isn't a complete-kit line, so name the individual
            // asset (the same way standalone assets are shown) instead of
            // dropping it. Without this, a batch made up entirely of such
            // assets produced an empty note (e.g. "partial check-out: .").
            standaloneAssets.push({ id: asset.id, title: asset.title });
          }
        }

        const hasKits = completeKits.length > 0;
        const hasAssets = standaloneAssets.length > 0;

        let itemsDescription = "";
        if (hasKits && hasAssets) {
          const kitContent = wrapKitsWithDataForNote(
            completeKits,
            "checked out"
          );
          const assetContent = wrapAssetsWithDataForNote(
            standaloneAssets,
            "checked out"
          );
          itemsDescription = `${assetContent} and ${kitContent}`;
        } else if (hasKits) {
          const kitContent = wrapKitsWithDataForNote(
            completeKits,
            "checked out"
          );
          itemsDescription = kitContent;
        } else if (hasAssets) {
          const assetContent = wrapAssetsWithDataForNote(
            standaloneAssets,
            "checked out"
          );
          itemsDescription = assetContent;
        }

        // Get the updated booking with all original assets to calculate remaining count.
        // Post-pivot, assets live behind `bookingAssets[].asset`; `_count` mirrors
        // the pivot rows (not unique asset count — we dedup below if needed).
        const updatedBookingForNote = await tx.booking.findUniqueOrThrow({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) above; this re-fetches the same proven id
          where: { id },
          include: {
            bookingAssets: { include: { asset: true } },
            custodianUser: true,
            custodianTeamMember: true,
            _count: { select: { bookingAssets: true } },
          },
        });

        const statusNote = bookingStatusChanged
          ? ` and checked out the booking (status changed to ${
              bookingFound.to && isBookingExpired({ to: bookingFound.to })
                ? "Overdue"
                : "Ongoing"
            })`
          : "";

        /**
         * Per-slice qty fragment for the booking-side note — names each
         * qty-tracked slice touched in this session (linked) with its
         * `standalone`/`in kit X` label and `checked out / still booked` counts.
         * Empty string when there's nothing to say, so the `itemsDescription`
         * concatenation stays clean for INDIVIDUAL-only batches. Layer 3: fed the
         * per-slice `qtySummaries` directly (no per-asset fold) so a slice-level
         * checkout reports slice-level totals.
         */
        const qtyPerAsset = buildQtyPerAssetCheckoutFragment(qtySummaries);

        /**
         * Layer 3 redundancy fix: when the batch is ONLY qty-tracked slices (no
         * INDIVIDUAL assets, no complete kits), `itemsDescription` merely re-names
         * the same qty-tracked asset(s) that `qtyPerAsset` already describes in
         * per-slice detail. In that case render the per-slice fragment as the
         * whole items description instead of the duplicated
         * "{asset} checked out — qty: {asset} · standalone (…)". The mixed case
         * (INDIVIDUAL and/or complete kits present) keeps the "— qty:" tail so
         * those non-qty items are still named.
         */
        const qtyOnlyCheckout =
          individualToFlip.length === 0 &&
          completeKits.length === 0 &&
          qtyPerAsset !== "";
        const itemsBody = qtyOnlyCheckout
          ? qtyPerAsset
          : `${itemsDescription}${qtyPerAsset ? ` — qty: ${qtyPerAsset}` : ""}`;

        await createSystemBookingNote(
          {
            bookingId: id,
            organizationId,
            content: `${wrapUserLinkForNote(
              user!
            )} performed a partial check-out: ${itemsBody}${statusNote}.`,
          },
          tx
        );

        /**
         * Record every reservation this check-out outranked, on BOTH bookings.
         * Written inside the tx so a rolled-back check-out can't leave a note
         * claiming an asset was taken. Only populated when this booking is
         * already in flight — see the guard above.
         *
         * Collected first and written in ONE batch: a large batch can override
         * many distinct reservations, and two singular note writes each (a
         * check + an insert apiece) would spend the transaction's 15s budget on
         * audit notes and roll the check-out back.
         */
        const overrideNotes: Array<{ content: string; bookingId: string }> = [];
        for (const reservation of overriddenReservations.values()) {
          // An idempotent re-scan carries assets that were already out; only
          // the ones this batch actually took belong in the note.
          const takenNow = reservation.assets.filter((asset) =>
            assetIdsToCheckOut.includes(asset.id)
          );
          if (takenNow.length === 0) continue;

          const { currentBookingNote, reservedBookingNote } =
            buildOverriddenReservationNotes(
              { ...reservation, assets: takenNow },
              { id, name: bookingFound.name }
            );

          overrideNotes.push(
            { bookingId: id, content: currentBookingNote },
            { bookingId: reservation.id, content: reservedBookingNote }
          );
        }
        await createSystemBookingNotes(
          { notes: overrideNotes, organizationId },
          tx
        );

        /**
         * Unit-level remaining count + completion. For each unique booking
         * asset, compare `booked total` to `committed checked-out units (incl.
         * THIS batch — the session row was written above so the read sees it)`.
         * Asset counts as remaining when `booked - checkedOut > 0`.
         *
         * Replaces the legacy asset-id-set filter: a 5-of-50 QT slice no longer
         * reports `isComplete: true` just because the asset id is in
         * `checkedOutAfterThisBatch`.
         */
        const uniqueBookingAssetIds = [
          ...new Set(
            updatedBookingForNote.bookingAssets.map((ba) => ba.asset.id)
          ),
        ];
        // ONE batched read for EVERY unique booking asset, then count in memory.
        // This is the dominant fix for Sentry SHELF-WEBAPP-217: the old per-asset
        // loop fired three sequential queries PER asset (via the singular helper),
        // so a large booking issued `O(3·M)` round-trips here even when checking
        // out a single item — blowing the transaction timeout. The batched call
        // reads the booking-level sessions (INCLUDING the row created above, so
        // completion is computed against this batch) exactly once.
        const remainingByBookingAsset =
          await computeBookingAssetsRemainingToCheckOut(
            tx,
            id,
            uniqueBookingAssetIds
          );
        let remainingAssetCount = 0;
        for (const assetId of uniqueBookingAssetIds) {
          if ((remainingByBookingAsset.get(assetId) ?? 0) > 0) {
            remainingAssetCount += 1;
          }
        }

        return {
          booking: updatedBookingForNote,
          checkedOutAssetCount: assetIdsToCheckOut.length,
          remainingAssetCount,
          // A later final batch (after earlier partial checkouts) completes the
          // checkout here in the partial path rather than via the delegation
          // above, so report completion from the remaining count.
          isComplete: remainingAssetCount === 0,
          bookingStatusChanged,
          // Layer 3: pass the PER-SLICE summaries downstream so the post-tx
          // per-asset note loop renders one note per slice with slice-level
          // counts (a standalone-slice checkout no longer reports the whole
          // asset's remaining). Legacy/untagged dispositions still carry the
          // asset-level remaining and render the pre-Layer-3 phrasing.
          qtySummaries,
          individualAssetIds: individualToFlip,
        };
        // Defense-in-depth: match the 15s timeout the sibling checkout/checkin
        // transactions in this file use. The per-asset query fan-out above is now
        // batched to O(1), but a large booking still does meaningful work inside
        // the tx, so keep the same generous ceiling as the all-at-once path.
      },
      { timeout: 15000 }
    );

    /**
     * Per-slice qty-tracked asset-timeline notes (post-tx, best-effort). Uses
     * `wrapAssetWithCountForNote` so qty-tracked rows render as
     * "You checked out 10 boxes of {asset} on {booking}". Layer 3: iterates the
     * per-slice summaries, so a multi-slice checkout of one asset writes one
     * note per slice with slice-level `remainingAfter` (tagged slices) or the
     * asset-level remaining (legacy/untagged dispositions). Wrapped in
     * try/catch — a markdoc hiccup here must not roll back the already-
     * committed checkout.
     */
    try {
      const actorLink = wrapUserLinkForNote({ ...user, id: userId });
      const bookingLink = wrapLinkForNote(
        `/bookings/${result.booking.id}`,
        result.booking.name
      );

      for (const summary of result.qtySummaries) {
        const assetWithCount = wrapAssetWithCountForNote(
          {
            id: summary.assetId,
            title: summary.title,
            type: summary.type,
            unitOfMeasure: summary.unitOfMeasure,
          },
          summary.checkedOut
        );
        const remainingFragment =
          summary.remainingAfter > 0
            ? ` (${
                formatUnitCount(
                  { type: summary.type, unitOfMeasure: summary.unitOfMeasure },
                  summary.remainingAfter
                ) ?? String(summary.remainingAfter)
              } still booked)`
            : "";

        await createNotes({
          content: `${actorLink} checked out ${assetWithCount} on ${bookingLink}${remainingFragment}.`,
          type: "UPDATE",
          userId,
          assetIds: [summary.assetId],
          organizationId,
        });
      }
    } catch (noteError) {
      Logger.error(
        new ShelfError({
          cause: noteError,
          message: "Failed to write partial check-out activity notes",
          label,
          additionalData: { userId, bookingId: id },
        })
      );
    }

    // The first scan moved the booking from RESERVED to ONGOING/OVERDUE. Cancel
    // the checkout-reminder job that reserveBooking queued (tracked in
    // activeSchedulerReference) so it can't fire after the booking is already
    // checked out, then schedule the check-in reminder exactly like the full
    // checkout does (non-expired bookings only). `scheduleNextBookingJob`
    // overwrites activeSchedulerReference, so without the explicit cancel the
    // old job would be orphaned in the queue.
    if (result.bookingStatusChanged) {
      await cancelScheduler(bookingFound);

      const expired = bookingFound.to
        ? isBookingExpired({ to: bookingFound.to })
        : false;
      if (!expired && bookingFound.to) {
        await scheduleCheckinReminderForBooking(
          { id: bookingFound.id, to: bookingFound.to },
          hints,
          organizationId
        );
      }
    }

    // Strip internal-only fields from the returned payload.
    const {
      bookingStatusChanged: _ignored,
      qtySummaries: _qty,
      individualAssetIds: _individual,
      ...publicResult
    } = result;
    return publicResult;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while partially checking out booking.",
    });
  }
}

/**
 * One kit-driven booking slice to insert.
 *
 * Carries BOTH kit pointers because they answer different questions and have
 * different lifetimes:
 * - `assetKitId` is the live `AssetKit` membership row. The DB `SET NULL`s it
 *   when the asset leaves the kit, which is what makes it useless as history.
 * - `kitId` is the owning `Kit`, persisted to `BookingAsset.sourceKitId`, and
 *   survives that deletion.
 *
 * `kitId` is required so the compiler flags any producer that forgets it —
 * a missing value is unrecoverable once the membership row is gone.
 */
export type KitSliceSpec = {
  assetId: string;
  assetKitId: string;
  kitId: string;
  quantity: number;
};

/**
 * Scanner-path variant of {@link KitSliceSpec} where `quantity` may be omitted.
 *
 * The scan drawer only knows which `AssetKit` memberships were scanned, not
 * their slice quantities — `addScannedAssetsToBookingWithinTx` resolves the
 * fallback from `AssetKit.quantity` server-side.
 *
 * `kitId` stays REQUIRED at the type level so the compiler keeps flagging
 * producers that forget it, but it is NOT a trusted input: the write site
 * re-resolves it from the org-proven `AssetKit` row and that value wins. The
 * scan route's runtime validator therefore tolerates a stale client omitting
 * it (passing `""`) rather than rejecting the request.
 */
export type ScannedKitSliceSpec = Omit<KitSliceSpec, "quantity"> & {
  quantity?: number;
};

/**
 * Resolves a set of kits into the kit-driven `BookingAsset` slice specs needed
 * to add those kits to a booking.
 *
 * Each `AssetKit` membership row becomes one slice in the shape the booking
 * write paths expect ({@link KitSliceSpec}). A kit with N member assets yields
 * N slices; the SAME asset belonging to MULTIPLE kits yields
 * MULTIPLE slices (one per `AssetKit.id`). That one-slice-per-membership shape
 * is exactly what lets a single quantity-tracked asset produce multiple
 * distinct kit-driven rows — the kit partial unique is on
 * `(bookingId, assetKitId)`, not `(bookingId, assetId)`.
 *
 * Centralizes the resolution previously inlined in the `manage-kits` route
 * action so `createBooking`, the kit-add route, and any future kit→booking flow
 * build slices the exact same, org-scoped way (per the repo's
 * code-abstraction rule).
 *
 * SECURITY (cross-org IDOR): `kitIds` originate from request/form input, so the
 * lookup is scoped by `organizationId`. `AssetKit` carries its own
 * `organizationId` column, so this is the authoritative org guard — a
 * foreign-org kit id simply resolves to no rows rather than leaking another
 * org's kit membership into the caller's booking.
 *
 * @param params.kitIds - Kit IDs whose members should become booking slices
 * @param params.organizationId - The caller's (validated) organization ID
 * @param params.existingAssetKitIds - Optional set of `AssetKit.id`s already
 *   represented on the target booking; matching memberships are skipped so
 *   re-adding a kit that's already (partly) present is idempotent per slice.
 * @returns One slice spec per newly-added `AssetKit` membership
 * @throws {ShelfError} If the database lookup fails
 */
export async function buildKitSlicesForBooking({
  kitIds,
  organizationId,
  existingAssetKitIds,
}: {
  kitIds: string[];
  organizationId: string;
  existingAssetKitIds?: Set<string>;
}): Promise<KitSliceSpec[]> {
  // Nothing to resolve — short-circuit so callers can pass an empty list freely.
  if (kitIds.length === 0) return [];

  try {
    const assetKits = await db.assetKit.findMany({
      where: { kitId: { in: kitIds }, organizationId },
      // `kitId` is already the filter column, so selecting it costs nothing.
      select: { id: true, assetId: true, quantity: true, kitId: true },
    });

    // One slice per AssetKit membership, skipping memberships already on the
    // booking so re-adding a kit doesn't duplicate its slices.
    return assetKits
      .filter((ak) => !existingAssetKitIds?.has(ak.id))
      .map((ak) => ({
        assetId: ak.assetId,
        assetKitId: ak.id,
        // Durable provenance — see `BookingAsset.sourceKitId`.
        kitId: ak.kitId,
        quantity: ak.quantity,
      }));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while resolving kit contents for the booking.",
      additionalData: { kitIds, organizationId },
      label,
    });
  }
}

export async function updateBookingAssets({
  id,
  organizationId,
  assetIds,
  kitIds,
  userId,
  quantities,
  kitSlices,
  skipBookingNote,
}: Pick<Booking, "id" | "organizationId"> & {
  /**
   * Standalone assets to add (no kit attribution). Kit-driven rows are
   * supplied separately via `kitSlices` so the same asset can be both
   * standalone AND a member of one-or-more kits in the same booking.
   */
  assetIds: Asset["id"][];
  kitIds?: Kit["id"][];
  userId?: User["id"];
  /** Optional map of assetId → quantity for standalone QUANTITY_TRACKED assets. Defaults to 1 for any asset not in the map. */
  quantities?: Record<string, number>;
  /**
   * Optional list of kit-driven slice specs — one element per
   * `AssetKit` membership being added. Each spec records the source
   * asset, the originating `AssetKit.id`, and that slice's quantity.
   *
   * Carrying a list (rather than a 1:1 assetId → assetKitId map) is
   * what lets a single quantity-tracked asset belonging to MULTIPLE
   * kits produce MULTIPLE kit-driven `BookingAsset` rows: the kit
   * partial unique is on `(bookingId, assetKitId)`, so each kit's
   * slice is a distinct, legal row. Non-kit callers (manage-assets
   * picker, asset bulk actions) omit this and only add standalone rows.
   */
  kitSlices?: KitSliceSpec[];
  /**
   * Opt out of the booking-side `"… added … to the booking."` note written
   * near the end of this function. Callers that compose their OWN
   * booking-side note MUST pass `true`.
   *
   * Without it the booking activity feed shows the same add twice, and for a
   * single INDIVIDUAL asset the two rows are byte-identical: the service's
   * `wrapAssetWithCountForNote` degrades to the same bare asset link the
   * caller's `wrapAssetsWithDataForNote` emits at count 1, because
   * `formatUnitCount` returns null for anything that is not
   * QUANTITY_TRACKED. A reader cannot tell whether one asset was added or
   * two — the audit trail says something untrue.
   *
   * Until now the ONLY way to suppress this note was to pass a non-empty
   * `kitIds`, which is why the kit routes are unaffected and the asset route
   * is not: `kitIds` was standing in for "the caller writes its own note",
   * and a caller with no kits had no way to say so. This flag states the
   * ownership directly instead of inferring it.
   *
   * Scope is the BOOKING-side note only. Asset-side notes (`createNotes`),
   * `BOOKING_ASSETS_ADDED` events and model-request fulfilment all still
   * happen — those are keyed to different feeds and must not be suppressed.
   */
  skipBookingNote?: boolean;
}) {
  try {
    const { booking, addedAssetIds } = await db.$transaction(async (tx) => {
      // Verify booking exists before inserting into the join table,
      // so a stale/deleted booking returns a proper 404 (P2025)
      // instead of a FK violation (P2003)
      const b = await tx.booking.findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          name: true,
          status: true,
          // Needed to window the QUANTITY_TRACKED availability guard below
          // to this booking's own dates.
          from: true,
          to: true,
        },
      });

      // The four callers each validate the status before getting here, but
      // every one of them does so in a read of its own, so a booking closed in
      // between was still written to. (detail.dev D055)
      //
      // Re-reading inside this transaction is NOT sufficient on its own: under
      // READ COMMITTED the `findUniqueOrThrow` above takes no lock, so a
      // concurrent check-in or cancellation can still commit between it and
      // the writes below. The row lock is what actually closes the window —
      // it is held until this transaction commits.
      const lockedStatus = await lockBookingForStatusCheck(
        tx,
        id,
        organizationId
      );
      assertBookingIsOpen({
        status: lockedStatus,
        operation: "change the items on",
        bookingId: id,
      });

      const slices = kitSlices ?? [];

      // Validate the UNION of standalone asset ids and the asset ids
      // referenced by kit slices. An asset can legitimately appear in
      // both buckets (standalone + kit-driven), so we validate the
      // distinct set once.
      const uniqueAssetIds = [
        ...new Set([...assetIds, ...slices.map((s) => s.assetId)]),
      ];

      // Validate that all asset IDs exist before inserting into the join table
      // to prevent FK violations when assets are deleted between UI load and
      // submission. `type` is selected so we can enforce the standalone/
      // kit-driven invariant below (INDIVIDUAL assets can't legitimately be
      // both in the same booking). `title`/`unitOfMeasure` are selected too
      // so the QUANTITY_TRACKED availability guard below can build its
      // shortfall message without a second read.
      const validAssets = await tx.asset.findMany({
        where: { id: { in: uniqueAssetIds }, organizationId },
        select: { id: true, type: true, title: true, unitOfMeasure: true },
      });
      const validAssetIds = validAssets.map((a) => a.id);

      if (validAssetIds.length === 0) {
        throw new ShelfError({
          cause: null,
          message:
            "None of the selected assets exist. They may have been deleted.",
          label,
          shouldBeCaptured: false,
          status: 400,
        });
      }

      if (validAssetIds.length !== uniqueAssetIds.length) {
        throw new ShelfError({
          cause: null,
          message:
            "Some of the selected assets no longer exist. Please reload and try again.",
          label,
          shouldBeCaptured: false,
          status: 400,
        });
      }

      // Org-scope the kit-source discriminators. `kitSlices[].assetKitId`
      // is request-supplied and written straight onto BookingAsset, so we
      // must prove each AssetKit belongs to the caller's org (the asset
      // ids were already validated above; this closes the cross-org gap
      // for the kit ids).
      //
      // The guard hands back the org-proven `assetKitId -> kitId` map, which
      // is the ONLY source we accept for `sourceKitId` below — `slice.kitId`
      // is request input and that column's FK accepts any org's kit.
      const kitIdByAssetKitId = await assertAssetKitsBelongToOrg(
        { assetKitIds: slices.map((s) => s.assetKitId), organizationId },
        tx
      );

      // INVARIANT: an INDIVIDUAL asset is a single physical unit, so it can
      // never legitimately be BOTH a standalone row AND a kit-driven row in
      // the same booking — that would book the one unit twice. Defensive
      // guard for callers that wrongly route a kit member through the
      // standalone bucket too: when the SAME INDIVIDUAL asset appears in both
      // `assetIds` and `kitSlices` in this call, drop it from the standalone
      // insert and let the kit-driven row own it.
      //
      // QUANTITY_TRACKED assets are deliberately EXEMPT: N units booked
      // standalone PLUS M units via a kit are two legitimate, distinct rows,
      // so we must NOT touch them here.
      const kitSliceAssetIds = new Set(slices.map((s) => s.assetId));
      const individualKitSliceAssetIds = [...kitSliceAssetIds].filter(
        (assetId) =>
          validAssets.some(
            (a) => a.id === assetId && a.type === AssetType.INDIVIDUAL
          )
      );
      const individualKitOverlapAssetIds = new Set(
        individualKitSliceAssetIds.filter((assetId) =>
          assetIds.includes(assetId)
        )
      );

      // FINDING: an INDIVIDUAL kit member ALREADY on the booking as a standalone
      // row would be booked twice if we also inserted its kit-driven row (the
      // two partial uniques don't collide). The same-call guard above only
      // covers overlap WITHIN this call; here we check rows already persisted and
      // SKIP the kit slice for any INDIVIDUAL asset that already has a standalone
      // row — the existing row already books that single physical unit. (QT is
      // exempt: a free-pool standalone slice legitimately coexists with kits.)
      const existingStandaloneIndividualAssetIds = new Set<string>(
        individualKitSliceAssetIds.length > 0
          ? (
              await tx.bookingAsset.findMany({
                where: {
                  bookingId: id,
                  assetKitId: null,
                  assetId: { in: individualKitSliceAssetIds },
                },
                select: { assetId: true },
              })
            ).map((row) => row.assetId)
          : []
      );
      const effectiveSlices = slices.filter(
        (s) => !existingStandaloneIndividualAssetIds.has(s.assetId)
      );

      // Standalone rows go through an upsert keyed on the
      // (bookingId, assetId) partial unique. Dedupe the standalone ids
      // since the upsert can't accept duplicate keys in one statement, and
      // exclude any INDIVIDUAL asset that is also a kit slice (see invariant
      // above). `standaloneAssetIds` and `standaloneQuantities` stay
      // index-aligned because both derive from the same filtered array.
      const standaloneAssetIds = [...new Set(assetIds)].filter(
        (assetId) => !individualKitOverlapAssetIds.has(assetId)
      );
      const standaloneQuantities = standaloneAssetIds.map(
        (assetId) => quantities?.[assetId] ?? 1
      );

      // Kit-driven rows go through a separate insert keyed on the
      // (bookingId, assetKitId) partial unique — they use ON CONFLICT
      // DO NOTHING because adding the same kit twice should be a no-op,
      // not an upsert (the picker filters already-added kits out
      // client-side anyway). One row per kit slice, so an asset in two
      // kits yields two rows with distinct assetKitId. Uses `effectiveSlices`
      // so an INDIVIDUAL already-standalone member is skipped (see above).
      const kitAssetIds = effectiveSlices.map((s) => s.assetId);
      const kitQuantities = effectiveSlices.map((s) => s.quantity);
      const kitAssetKitIds = effectiveSlices.map((s) => s.assetKitId);
      // Index-aligned with the three arrays above. Persisted to
      // `BookingAsset.sourceKitId` so the row still names its kit after the
      // `AssetKit` membership (and therefore `assetKitId`) is gone. Sourced
      // from the org-scoped guard's map, never from `s.kitId` — see the
      // comment on `kitIdByAssetKitId`. The map is total over the validated
      // ids (the guard throws otherwise), so the `?? null` is unreachable.
      const kitSourceKitIds = effectiveSlices.map(
        (s) => kitIdByAssetKitId.get(s.assetKitId) ?? null
      );

      // The complete set of assets touched by this call — standalone +
      // kit-driven, deduped. Everything after the insert (status flip,
      // events, notes) operates on this set so a kit-only add still
      // flips statuses and records events for its member assets.
      const addedAssetIds = [
        ...new Set([...standaloneAssetIds, ...kitAssetIds]),
      ];

      /**
       * QUANTITY_TRACKED windowed-availability guard for assets being
       * added/updated on an already-ACTIVE booking (RESERVED/ONGOING/
       * OVERDUE). A DRAFT booking is exempt here — it hasn't committed to
       * holding any stock yet, and `reserveBooking`'s own guard validates
       * the full asset list at the DRAFT → RESERVED transition, so
       * checking twice would only reject drafts prematurely while they're
       * still being assembled.
       *
       * Scope: only the STANDALONE quantities THIS CALL is writing
       * (`standaloneQuantities`) are validated against the free pool. Kit
       * slices (`effectiveSlices`) draw from their kit's own allocation, which
       * `getAssetAvailability` already subtracts from the pool via `inKits` —
       * counting them here too would double-count and reject a legitimate kit
       * booking (Codex P1). The standalone amount IS the row's new target
       * quantity (the upsert below sets it exactly).
       *
       * `currentQuantity` is this booking's EXISTING standalone quantity for
       * the asset (fetched below), so the shared guard's directional rule
       * treats a reduction as always-allowed: a booking already over-committed
       * by OTHER bookings must still be reducible via the manage-assets route
       * (the same #2725 recovery rule the adjust dialog relies on). Without it,
       * `excludeBookingId: id` removes this booking's own reservation from the
       * pool and every edit — including reductions — would be checked as a
       * fresh increase against every OTHER booking's demand, re-creating the
       * over-reservation dead-end.
       */
      if (
        (ACTIVE_BOOKING_STATUSES as readonly BookingStatus[]).includes(b.status)
      ) {
        const qtAssetIds = new Set(
          validAssets
            .filter((asset) => isQuantityTracked(asset))
            .map((a) => a.id)
        );

        if (qtAssetIds.size > 0) {
          const requestedQtyByAssetId = new Map<string, number>();
          standaloneAssetIds.forEach((assetId, index) => {
            if (!qtAssetIds.has(assetId)) return;
            requestedQtyByAssetId.set(
              assetId,
              (requestedQtyByAssetId.get(assetId) ?? 0) +
                standaloneQuantities[index]
            );
          });

          if (requestedQtyByAssetId.size > 0) {
            const assetById = new Map(validAssets.map((a) => [a.id, a]));
            // Sorted for a deterministic global lock order (deadlock-safety) —
            // matches `reserveBooking` / the checkout guard.
            const affectedAssetIds = Array.from(
              requestedQtyByAssetId.keys()
            ).sort();

            for (const assetId of affectedAssetIds) {
              await lockAssetForQuantityUpdate(tx, assetId, organizationId);
            }

            // This booking's CURRENT standalone quantity per affected asset
            // (pre-upsert), so a reduction is recognized as directional and
            // always allowed by the guard.
            const existingStandalone = await tx.bookingAsset.groupBy({
              by: ["assetId"],
              where: {
                bookingId: id,
                assetId: { in: affectedAssetIds },
                assetKitId: null,
              },
              _sum: { quantity: true },
            });
            const currentQtyByAssetId = new Map<string, number>(
              existingStandalone.map(
                (row: {
                  assetId: string;
                  _sum: { quantity: number | null };
                }) => [row.assetId, row._sum.quantity ?? 0]
              )
            );

            await assertAssetQuantitiesAvailable(
              affectedAssetIds.map((assetId) => ({
                assetId,
                requestedQuantity: requestedQtyByAssetId.get(assetId) ?? 0,
                currentQuantity: currentQtyByAssetId.get(assetId) ?? 0,
                assetTitle: assetById.get(assetId)?.title ?? "",
                unitOfMeasure: assetById.get(assetId)?.unitOfMeasure,
              })),
              {
                organizationId,
                tx,
                window: b.from && b.to ? { from: b.from, to: b.to } : null,
                excludeBookingId: id,
              }
            );
          }
        }
      }

      /**
       * Which assets already hold a STANDALONE row on this booking.
       *
       * A model reservation is a promise of LOOSE units from the free pool, so
       * it is discharged by a new standalone `BookingAsset` row and by nothing
       * else. Two things follow, and both were wrong before:
       *
       *  - The scope must be `assetKitId: null`. Without it, an asset present
       *    only as a kit slice reads as "already here", so picking it to
       *    discharge a reservation silently does nothing: the booking gains the
       *    asset a second time and stays hard-blocked on check-out.
       *  - Only NEW rows may discharge. `addedAssetIds` is "every asset this
       *    call touched", and the manage-assets dialog reposts the whole
       *    selection on every save against an upsert, so keying off it lets a
       *    plain re-save decrement again — a 3-unit reservation reaching 3/3
       *    with two physical assets behind it.
       *
       * Read BEFORE the inserts below, or every asset looks pre-existing.
       *
       * @see {@link file://./../booking-model-request/service.server.ts} —
       *   `fulfilModelRequestsForAssets`, which the survivors are handed to.
       */
      const preExistingRows: Array<{
        assetId: string;
        assetKitId: string | null;
      }> =
        addedAssetIds.length > 0
          ? await tx.bookingAsset.findMany({
              where: { bookingId: id, assetId: { in: addedAssetIds } },
              select: { assetId: true, assetKitId: true },
            })
          : [];

      const preExistingStandaloneAssetIds = new Set<string>(
        preExistingRows
          .filter((row) => row.assetKitId === null)
          .map((row) => row.assetId)
      );

      /**
       * `AssetKit` ids already represented on this booking. Used only to tell a
       * genuinely new kit slice from a re-submitted one, since the kit insert
       * below is `ON CONFLICT DO NOTHING` and therefore creates nothing the
       * second time.
       */
      const preExistingAssetKitIds = new Set<string>(
        preExistingRows
          .map((row) => row.assetKitId)
          .filter((assetKitId): assetKitId is string => assetKitId !== null)
      );

      /**
       * The assets whose standalone row is genuinely new on this call — the
       * only ones allowed to discharge a reservation.
       *
       * Deliberately built from `standaloneAssetIds`, NOT `addedAssetIds`.
       * The latter unions in `kitSlices[].assetId`, so a kit member would
       * discharge a promise made for loose units: the section would drop to
       * "1 of 2 units still to assign" when nothing loose had arrived, and the
       * operator would pack one camera instead of two. It also contradicts
       * `BookingAsset.bookingModelRequestId`'s own contract, which says the
       * column is null for assets "pulled in via a kit".
       */
      const newlyStandaloneAssetIds = new Set<string>(
        standaloneAssetIds.filter(
          (assetId: string) => !preExistingStandaloneAssetIds.has(assetId)
        )
      );

      await Promise.all([
        // Standalone branch: upsert against the manual partial unique
        // `(bookingId, assetId) WHERE assetKitId IS NULL`. Re-submitting
        // an existing standalone row updates its quantity.
        standaloneAssetIds.length > 0
          ? tx.$executeRaw`
              INSERT INTO "BookingAsset" ("id", "assetId", "bookingId", "quantity", "assetKitId")
              SELECT gen_random_uuid()::text, unnest(${standaloneAssetIds}::text[]), ${id}, unnest(${standaloneQuantities}::int[]), NULL
              ON CONFLICT ("bookingId", "assetId") WHERE "assetKitId" IS NULL DO UPDATE SET quantity = EXCLUDED.quantity
            `
          : Promise.resolve(),
        // Kit-driven branch: insert against the kit partial unique
        // `(bookingId, assetKitId) WHERE assetKitId IS NOT NULL`. DO
        // NOTHING on conflict so adding the same kit twice is harmless
        // (kit qty edits cascade from `updateKitAssets`, not from here).
        kitAssetIds.length > 0
          ? tx.$executeRaw`
              INSERT INTO "BookingAsset" ("id", "assetId", "bookingId", "quantity", "assetKitId", "sourceKitId")
              SELECT gen_random_uuid()::text, unnest(${kitAssetIds}::text[]), ${id}, unnest(${kitQuantities}::int[]), unnest(${kitAssetKitIds}::text[]), unnest(${kitSourceKitIds}::text[])
              ON CONFLICT ("bookingId", "assetKitId") WHERE "assetKitId" IS NOT NULL DO NOTHING
            `
          : Promise.resolve(),
        // Touch updatedAt since the raw INSERTs don't update the booking row
        tx.booking.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L2328; this is the write on that same proven id
          where: { id },
          data: { updatedAt: new Date() },
        }),
      ]);

      /**
       * Progressive checkout: assets added to an ONGOING/OVERDUE booking are
       * NOT auto-flipped to CHECKED_OUT. They join the booking as line items
       * and stay AVAILABLE until purposefully checked out via the
       * progressive-checkout flow ({@link partialCheckoutBooking}). This keeps
       * an active booking flexible — you can stage assets onto it without
       * committing them to the field. See the checked-out guard in the add
       * routes (manage-assets / manage-kits) which still blocks adding an asset
       * that is physically checked out on ANOTHER booking.
       */

      // Activity events — one BOOKING_ASSETS_ADDED per asset added, inside the tx.
      // Must be atomic with asset addition for audit trail consistency.
      // Use the deduped union of standalone + kit-driven assets so a
      // kit-only add still records events for its member assets.
      // `meta.quantity` (qty-tracked only) sums the standalone qty (from
      // `quantities` map, default 1) plus every kit-driven slice qty for
      // the same asset on this call — mirrors the actual booked count
      // even when the same asset is added both standalone and via N kits.
      if (addedAssetIds.length > 0) {
        // `title` + `assetModelId` widen this select purely so the same rows
        // can feed model-request fulfilment below without a second round-trip.
        const assetTypeRows = await tx.asset.findMany({
          where: { id: { in: addedAssetIds }, organizationId },
          select: {
            id: true,
            type: true,
            unitOfMeasure: true,
            title: true,
            assetModelId: true,
          },
        });
        const assetTypeById = new Map(assetTypeRows.map((a) => [a.id, a]));

        /**
         * Discharge any model reservation these assets answer.
         *
         * Naming a concrete unit of model M satisfies a "N units of M, any
         * units" reservation — the promise and the delivery are the same
         * physical thing. Before this ran here, only the scanner discharged
         * reservations, so adding the very asset a booking had reserved left
         * the request outstanding and check-out hard-blocked. See
         * {@link fulfilModelRequestsForAssets} for the full rationale.
         */
        const fulfilledRequestIdByAssetId = await fulfilModelRequestsForAssets({
          bookingId: b.id,
          // Only assets whose STANDALONE row is new on this call — see
          // `newlyStandaloneAssetIds` for why kit slices and re-submitted
          // rows are both excluded.
          assets: assetTypeRows.filter((asset: { id: string }) =>
            newlyStandaloneAssetIds.has(asset.id)
          ),
          organizationId,
          userId,
          tx,
        });

        // Persist which reservation each asset discharged.
        //
        // Scoped to `assetKitId IS NULL`, matching the rule that only a
        // standalone row discharges. An earlier version ordered by
        // `("assetKitId" IS NOT NULL)` to "prefer" the standalone row, but a
        // preference is not a constraint: with no standalone row present the
        // ordering simply fell through and stamped a kit-driven row, recording
        // that a camera committed to a kit had answered a promise for a loose
        // one. The `WHERE` refuses instead of guessing.
        for (const [assetId, requestId] of fulfilledRequestIdByAssetId) {
          await tx.$executeRaw`
            UPDATE "BookingAsset" SET "bookingModelRequestId" = ${requestId}
            WHERE "id" = (
              SELECT "id" FROM "BookingAsset"
              WHERE "bookingId" = ${b.id}
                AND "assetId" = ${assetId}
                AND "assetKitId" IS NULL
                AND "bookingModelRequestId" IS NULL
              LIMIT 1
            )
          `;
        }

        // Sum the booked quantity per asset across all rows this call
        // is responsible for. Standalone defaults to 1 when missing
        // from `quantities` — mirrors the SQL upsert default above.
        const addedQtyByAssetId = new Map<string, number>();
        for (const sid of standaloneAssetIds) {
          addedQtyByAssetId.set(
            sid,
            (addedQtyByAssetId.get(sid) ?? 0) + (quantities?.[sid] ?? 1)
          );
        }
        for (const slice of slices) {
          addedQtyByAssetId.set(
            slice.assetId,
            (addedQtyByAssetId.get(slice.assetId) ?? 0) + slice.quantity
          );
        }

        /**
         * One event per asset that ACTUALLY arrived.
         *
         * `addedAssetIds` is every asset the call touched, so the pure
         * quantity-edit path — which re-submits assets already on the booking —
         * was emitting `BOOKING_ASSETS_ADDED` for assets that were already
         * there. Suppressing the human-readable note via `skipBookingNote`
         * without filtering here left the machine-readable feed, which reports
         * aggregate, still claiming a phantom add. An asset is "added" if this
         * call created its standalone row or any of its kit-driven rows.
         */
        /**
         * An asset was ADDED by this call if it gained a standalone row or a
         * kit-driven row that did not exist before.
         *
         * The previous version read
         * `newlyStandaloneAssetIds.has(id) || !preExistingStandaloneAssetIds.has(id)`,
         * whose first operand is a strict subset of the second — so it reduced
         * to the second alone and never looked at kit rows at all, despite the
         * comment claiming it did. Harmless in practice (the kit insert is
         * `ON CONFLICT DO NOTHING` and the picker filters already-added kits),
         * but code and comment disagreeing is how the next reader gets misled.
         */
        const assetsGainingAKitSlice = new Set<string>(
          effectiveSlices
            .filter((slice) => !preExistingAssetKitIds.has(slice.assetKitId))
            .map((slice) => slice.assetId)
        );

        const newlyAddedAssetIds = addedAssetIds.filter(
          (assetId: string) =>
            newlyStandaloneAssetIds.has(assetId) ||
            assetsGainingAKitSlice.has(assetId)
        );

        await recordEvents(
          newlyAddedAssetIds.map((assetId: string) => {
            const asset = assetTypeById.get(assetId);
            return {
              organizationId,
              actorUserId: userId ?? null,
              action: "BOOKING_ASSETS_ADDED" as const,
              entityType: "BOOKING" as const,
              entityId: b.id,
              bookingId: b.id,
              assetId,
              meta: asset
                ? assetQtyMeta(asset, addedQtyByAssetId.get(assetId))
                : {},
            };
          }),
          tx
        );
      }

      return { booking: b, addedAssetIds };
    });

    // BOOKING ACTIVITY LOG: Log asset addition activity
    // Creates user-attributed note when assets are added to a booking
    // Skip note creation if kits are involved (kit notes are created
    // separately), or if the caller told us it writes its own booking-side
    // note (`skipBookingNote`). The `kitIds` arm was doing both jobs; the
    // explicit flag is what a non-kit caller needs to avoid a duplicate.
    // Note creation is best-effort — the booking update already succeeded,
    // so we log failures instead of throwing to prevent false error reports.
    if (!skipBookingNote && (!kitIds || kitIds.length === 0)) {
      try {
        // Widen the select to type+unitOfMeasure so the single-asset
        // branch can prefix a unit count ("added 50 units of Pens to
        // the booking"). The multi-asset summary uses
        // `wrapAssetsWithDataForNote`'s popover unchanged.
        const assets = await db.asset.findMany({
          where: { id: { in: addedAssetIds }, organizationId },
          select: {
            id: true,
            title: true,
            type: true,
            unitOfMeasure: true,
          },
        });

        // why: out of this rule — multi-asset popover, per-asset qty deferred.
        // Single-asset path uses wrapAssetWithCountForNote so qty-tracked
        // shows "N units of {asset}"; INDIVIDUAL is byte-for-byte unchanged.
        // Falls back to the popover when the single-asset metadata is
        // missing (title/type), so callers with minimal asset shapes
        // don't crash.
        const assetContent =
          assets.length === 1 && assets[0].title && assets[0].type
            ? wrapAssetWithCountForNote(
                assets[0],
                quantities?.[assets[0].id] ?? 1
              )
            : wrapAssetsWithDataForNote(assets, "added");

        if (userId) {
          const user = await getUserByID(userId, {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            } satisfies Prisma.UserSelect,
          });
          await createSystemBookingNote({
            bookingId: booking.id,
            organizationId,
            content: `${wrapUserLinkForNote(
              user
            )} added ${assetContent} to the booking.`,
          });
        } else {
          await createSystemBookingNote({
            bookingId: booking.id,
            organizationId,
            content: `${assetContent} added to the booking.`,
          });
        }
      } catch (noteError) {
        Logger.error(
          new ShelfError({
            cause: noteError,
            message: "Failed to create booking note after asset update",
            label,
            shouldBeCaptured: false,
          })
        );
      }
    }

    return booking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating booking assets.",
    });
  }
}

export async function createKitBookingNote({
  bookingId,
  organizationId,
  kitIds,
  kits = [],
  userId,
  action = "added",
}: {
  bookingId: string;
  organizationId: string;
  kitIds: string[];
  kits?: Array<{ id: string; name: string }>;
  userId?: string;
  action?: string;
}) {
  const kitContent =
    kits.length > 0
      ? wrapKitsWithDataForNote(kits, action)
      : wrapKitsForNote(kitIds, action);

  if (userId) {
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    await createSystemBookingNote({
      bookingId,
      organizationId,
      content: `${wrapUserLinkForNote(
        user
      )} ${action} ${kitContent} to the booking.`,
    });
  } else {
    await createSystemBookingNote({
      bookingId,
      organizationId,
      content: `${kitContent} ${action} to the booking.`,
    });
  }
}

export async function archiveBooking({
  id,
  organizationId,
  userId,
}: Pick<Booking, "id" | "organizationId"> & {
  userId?: string;
}) {
  try {
    const booking = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          status: true,
          to: true,
          activeSchedulerReference: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          title: "Not found",
          message:
            "Booking not found, are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    /**
     * Archivable when COMPLETE (gear was checked back in) or a past-due
     * RESERVED booking (a reservation whose window elapsed without checkout).
     * ONGOING/OVERDUE are rejected — their assets are still CHECKED_OUT.
     * @see {@link isBookingArchivable}
     */
    if (!isBookingArchivable({ status: booking.status, to: booking.to })) {
      throw new ShelfError({
        cause: null,
        label,
        message:
          "This booking can't be archived. Only completed bookings, or reserved bookings whose end date has passed, can be archived.",
      });
    }

    /**
     * A booking archived straight from RESERVED was never checked in, so flag
     * it: return-behaviour reports (Booking Compliance) exclude these.
     */
    const archivedWithoutCheckin = booking.status === BookingStatus.RESERVED;

    /**
     * Guard the write on the status we just read. If a concurrent checkout
     * flipped a RESERVED booking to ONGOING/OVERDUE between the read above and
     * this write, the update matches no row and we abort — otherwise we'd
     * archive a booking whose assets are now physically checked out (TOCTOU).
     */
    const updatedBooking = await db.booking
      .update({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) above; this is the write on that same proven id
        where: { id: booking.id, status: booking.status },
        data: {
          status: BookingStatus.ARCHIVED,
          ...(archivedWithoutCheckin ? { archivedWithoutCheckin: true } : {}),
        },
      })
      .catch(() => null);

    if (!updatedBooking) {
      throw new ShelfError({
        cause: null,
        label,
        message:
          "This booking's status changed before it could be archived. Please refresh and try again.",
      });
    }

    // Cancel any pending auto-archive job
    await cancelScheduler(booking);

    // Add activity log for booking archival
    await createStatusTransitionNote({
      bookingId: updatedBooking.id,
      organizationId,
      fromStatus: booking.status,
      toStatus: BookingStatus.ARCHIVED,
      userId,
      custodianUserId: updatedBooking.custodianUserId || undefined,
    });

    // Semantic event — complements BOOKING_STATUS_CHANGED for filtered queries.
    await recordEvent({
      organizationId,
      actorUserId: userId ?? null,
      action: "BOOKING_ARCHIVED",
      entityType: "BOOKING",
      entityId: updatedBooking.id,
      bookingId: updatedBooking.id,
    });

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while archiving the booking. Please try again.",
    });
  }
}

export async function cancelBooking({
  id,
  organizationId,
  hints,
  userId,
  cancellationReason,
}: Pick<Booking, "id" | "organizationId"> & {
  hints: ClientHint;
  userId?: string;
  cancellationReason?: string;
}) {
  try {
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          status: true,
          bookingAssets: {
            include: {
              asset: {
                select: {
                  id: true,
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found. Are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    /** Map bookingAssets to flat asset array for downstream logic */
    const cancelAssets = bookingFound.bookingAssets.map((ba) => ba.asset);

    const allowedStatusForCancel: BookingStatus[] = [
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
      BookingStatus.RESERVED,
    ];

    if (!allowedStatusForCancel.includes(bookingFound.status)) {
      // User-input validation, not a server fault: the Cancel action is gated in
      // the UI, so this only fires on a genuine race (the booking's status
      // changed elsewhere between render and submit). A 400 keeps it out of the
      // Sentry error pipeline; the outer catch inherits status/shouldBeCaptured
      // from this cause. See SHELF-WEBAPP-222.
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking cannot be cancelled at the current state.",
        status: 400,
        shouldBeCaptured: false,
        additionalData: { bookingId: id, status: bookingFound.status },
      });
    }

    /**
     * Kits to release, from live membership AND the booking's own slices.
     * A kit released redundantly is a no-op write; a kit missed stays stuck.
     */
    const cancelSliceKitIds = await getKitIdsByBookingSlices({
      slices: bookingFound.bookingAssets,
      organizationId,
    });
    const kitIds = [
      ...new Set([
        ...getKitIdsByAssets(cancelAssets),
        ...cancelSliceKitIds.keys(),
      ]),
    ];
    const hasKits = kitIds.length > 0;

    const booking = await db.$transaction(async (tx) => {
      /**
       * If booking is ONGOING or OVERDUE, the cancelled booking's assets
       * are exiting an active commitment and need terminal-status
       * reconciliation. The historical blanket flip to AVAILABLE was unsafe:
       * an asset can simultaneously sit on another ONGOING/OVERDUE booking
       * or be held by a Custody row, and stamping AVAILABLE silently
       * stripped those signals (bug #99).
       *
       * `reconcileAssetStatusForBookingExit` queries — under the same `tx`
       * snapshot as the booking write — the other active bookings and
       * custody rows per asset, then picks the strongest remaining
       * commitment (CHECKED_OUT > IN_CUSTODY > AVAILABLE). `excludeBookingId`
       * is set to the cancelled booking so its own about-to-be-orphaned
       * `BookingAsset` rows don't self-pin the asset to CHECKED_OUT. Kits
       * keep the existing blanket flip — kit status is a coarser indicator
       * and is out of scope for this bug.
       *
       * RESERVED cancellations are unchanged: nothing was checked out so
       * no reconciliation is needed.
       */
      if (bookingFound.status !== BookingStatus.RESERVED) {
        await reconcileAssetStatusForBookingExit({
          tx,
          assetIds: cancelAssets.map((a) => a.id),
          excludeBookingIds: [bookingFound.id],
          organizationId,
        });

        /** If there are any kits, then update their status as well */
        if (hasKits) {
          await tx.kit.updateMany({
            where: { id: { in: kitIds }, organizationId },
            data: { status: KitStatus.AVAILABLE },
          });
        }
      }

      return tx.booking.update({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingFound id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L2624; this is the write on that same proven id
        where: { id: bookingFound.id },
        data: { status: BookingStatus.CANCELLED, cancellationReason },
        include: {
          bookingAssets: true,
          ...BOOKING_INCLUDE_FOR_EMAIL,
        },
      });
    });

    /** Cancel any active schedulers */
    await cancelScheduler(booking);

    // Resolve notification recipients and send personalized emails
    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CANCEL",
      organizationId: booking.organizationId,
      editorUserId: userId,
    });

    if (recipients.length > 0) {
      const custodian = booking.custodianUser
        ? resolveUserDisplayName(booking.custodianUser)
        : booking.custodianTeamMember?.name ?? "";

      await sendBookingEmailToAllRecipients({
        recipients,
        booking,
        subject: `❌ Booking cancelled (${booking.name}) - shelf.nu`,
        buildText: (prefs) =>
          cancelledBookingEmailContent({
            bookingName: booking.name,
            assetsCount: booking._count.bookingAssets,
            custodian,
            from: booking.from!,
            to: booking.to!,
            bookingId: booking.id,
            prefs,
            customEmailFooter: booking.organization.customEmailFooter,
            cancellationReason: cancellationReason || undefined,
          }),
        buildHeading: () =>
          `Your booking has been cancelled: "${booking.name}"`,
        hints,
        templateProps: {
          cancellationReason: cancellationReason || undefined,
        },
      });
    }

    // Add activity log for booking cancellation
    await createStatusTransitionNote({
      bookingId: booking.id,
      organizationId,
      fromStatus: bookingFound.status,
      toStatus: BookingStatus.CANCELLED,
      userId,
      custodianUserId: booking.custodianUserId || undefined,
    });

    // Semantic event — complements BOOKING_STATUS_CHANGED for filtered queries.
    await recordEvent({
      organizationId,
      actorUserId: userId ?? null,
      action: "BOOKING_CANCELLED",
      entityType: "BOOKING",
      entityId: booking.id,
      bookingId: booking.id,
      meta: cancellationReason ? { cancellationReason } : undefined,
    });

    return booking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while cancelling the booking, please try again.",
      // ShelfError inherits status/shouldBeCaptured from a ShelfError cause but
      // NOT additionalData — forward it so the handled-400 branch's { bookingId,
      // status } debug context survives the re-wrap. See SHELF-WEBAPP-222.
      additionalData: isLikeShelfError(cause)
        ? cause.additionalData
        : undefined,
    });
  }
}

export async function revertBookingToDraft({
  id,
  organizationId,
  userId,
  hints,
}: Pick<Booking, "id" | "organizationId"> & {
  userId?: User["id"];
  /** Acting user's client hints — fallback prefs for the notification emails. */
  hints: ClientHint;
}) {
  try {
    const booking = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: { id: true, status: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found, are you sure the booking exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    /** User can only revert the booking to DRAFT from RESERVED */
    if (booking.status !== BookingStatus.RESERVED) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking can be reverted to draft only for reserved state.",
      });
    }

    const draftBooking = await db.booking.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L2773; this is the write on that same proven id
      where: { id: booking.id },
      data: { status: BookingStatus.DRAFT },
      // The custodian (and other notification recipients) are emailed below,
      // so pull the same payload the other lifecycle emails use.
      include: BOOKING_INCLUDE_FOR_EMAIL,
    });

    // Add activity log for booking revert to draft
    if (userId) {
      await createStatusTransitionNote({
        bookingId: draftBooking.id,
        organizationId,
        fromStatus: booking.status,
        toStatus: BookingStatus.DRAFT,
        userId,
        custodianUserId: draftBooking.custodianUserId || undefined,
      });
    } else {
      // System-initiated revert (fallback)
      await createStatusTransitionNote({
        bookingId: draftBooking.id,
        organizationId,
        fromStatus: booking.status,
        toStatus: BookingStatus.DRAFT,
        custodianUserId: draftBooking.custodianUserId || undefined,
      });
    }

    /** Cancels all scheduled events */
    await cancelScheduler(draftBooking);

    // Notify the custodian (and other configured recipients) that their
    // reservation went back to draft — the same fan-out every other booking
    // lifecycle transition (reserve, cancel, check-in, …) already does. The
    // admin broadcast doesn't apply to this event type, and the acting user
    // is excluded by the resolver.
    //
    // The status write above is already committed, so a notification failure
    // must not fail the revert: it would report an error for a transition
    // that happened, and a retry would trip the RESERVED-only guard. Log and
    // return instead.
    try {
      const recipients = await getBookingNotificationRecipients({
        booking: draftBooking,
        eventType: "REVERT_TO_DRAFT",
        organizationId,
        editorUserId: userId,
      });

      if (recipients.length > 0) {
        const custodian = draftBooking.custodianUser
          ? resolveUserDisplayName(draftBooking.custodianUser)
          : draftBooking.custodianTeamMember?.name ?? "";

        await sendBookingEmailToAllRecipients({
          recipients,
          booking: draftBooking,
          subject: `↩️ Booking reverted to draft (${draftBooking.name}) - shelf.nu`,
          buildText: (prefs) =>
            revertedToDraftEmailContent({
              bookingName: draftBooking.name,
              assetsCount: draftBooking._count.bookingAssets,
              custodian,
              from: draftBooking.from!,
              to: draftBooking.to!,
              bookingId: draftBooking.id,
              prefs,
              customEmailFooter: draftBooking.organization.customEmailFooter,
            }),
          buildHeading: () =>
            `Your booking has been reverted to draft: "${draftBooking.name}"`,
          hints,
        });
      }
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause,
          message:
            "Failed to send the reverted-to-draft notification emails. The booking itself was reverted successfully.",
          additionalData: { bookingId: draftBooking.id, organizationId },
          label,
        })
      );
    }

    return draftBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while reverting the booking to draft.",
    });
  }
}

export async function extendBooking({
  id,
  organizationId,
  newEndDate,
  hints,
  userId,
  role,
}: Pick<Booking, "id" | "organizationId"> & {
  newEndDate: Date;
  hints: ClientHint;
  userId: string;
  role: OrganizationRoles;
}) {
  try {
    const booking = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          status: true,
          to: true,
          activeSchedulerReference: true,
          bookingAssets: {
            include: {
              asset: { select: { id: true, status: true } },
            },
          },
          from: true,
          creatorId: true,
          custodianUserId: true,
          partialCheckins: { select: { assetIds: true } },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found. Are you sure it exists in the current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    validateBookingOwnership({
      booking,
      userId,
      role,
      action: "extend",
      blockBaseEntirely: true,
    });

    /** Extending booking is allowed only for these status */
    const allowedStatus: BookingStatus[] = [
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
    ];

    if (!allowedStatus.includes(booking.status)) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Extending booking is not allowed for current status.",
      });
    }

    /** Get assets that have been returned via partial check-in */
    const checkedInAssetIds = booking.partialCheckins.flatMap(
      (checkin) => checkin.assetIds
    );

    /** Filter to only assets that are actively checked out (not returned) */
    const activeAssets = booking.bookingAssets
      .map((ba) => ba.asset)
      .filter(
        (asset) =>
          (asset.status === AssetStatus.CHECKED_OUT ||
            asset.status === AssetStatus.IN_CUSTODY) &&
          !checkedInAssetIds.includes(asset.id)
      );

    /** Validate that there are still active assets to extend the booking for */
    if (activeAssets.length === 0) {
      throw new ShelfError({
        cause: null,
        label,
        message:
          "Cannot extend booking. All assets have been returned. Please complete the booking instead.",
        shouldBeCaptured: false,
      });
    }

    /** Wrap conflict detection and update in a transaction to prevent race conditions */
    const updatedBooking = await db.$transaction(async (tx) => {
      /** Checking if the booking period is clashing with any other booking containing the same active asset(s).*/
      const clashingBookings: ClashingBooking[] = await tx.booking.findMany({
        where: {
          id: { not: booking.id },
          organizationId,
          status: {
            in: [BookingStatus.RESERVED],
          },
          bookingAssets: {
            some: { assetId: { in: activeAssets.map((a) => a.id) } },
          },
          // Check for bookings that start within the extension period
          from: {
            gt: booking.to,
            lte: newEndDate,
          },
        },
        select: { id: true, name: true },
      });

      if (clashingBookings?.length > 0) {
        throw new ShelfError({
          cause: null,
          label,
          message:
            "Cannot extend booking because the extended period is overlapping with the following bookings:",
          additionalData: {
            clashingBookings: [...clashingBookings],
          },
          shouldBeCaptured: false,
        });
      }

      return tx.booking.update({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L2853; this is the write on that same proven id
        where: { id: booking.id },
        data: {
          /**
           * If booking is currently OVERDUE we have to make it ONGOING
           */
          status:
            booking.status === BookingStatus.OVERDUE
              ? BookingStatus.ONGOING
              : undefined,
          /**
           * Only the LIVE end date moves. `originalTo` holds the end date the
           * booking was planned for, and extension is allowed only once the
           * booking has started (ONGOING/OVERDUE), so the plan is already
           * fixed: moving it here would erase the deadline the custodian
           * actually agreed to, and with it every late return from Booking
           * Compliance.
           */
          to: newEndDate,
        },
        include: BOOKING_INCLUDE_FOR_EMAIL,
      });
    });

    // Add activity log for booking extension
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    await createSystemBookingNote({
      bookingId: updatedBooking.id,
      organizationId,
      content: `${wrapUserLinkForNote(
        user
      )} extended the booking from **${wrapDateForNote(
        booking.to
      )}** to **${wrapDateForNote(newEndDate)}**.`,
    });

    /**
     * Activity event — record the date change for reports. Best-effort:
     * post-tx (mirrors the surrounding note-write location). The
     * `extendBooking` flow does NOT call `createStatusTransitionNote`
     * even when the status flips OVERDUE → ONGOING, so we also emit a
     * `BOOKING_STATUS_CHANGED` event ourselves for that case.
     */
    try {
      await recordEvent({
        organizationId,
        actorUserId: userId,
        action: "BOOKING_DATES_CHANGED",
        entityType: "BOOKING",
        entityId: updatedBooking.id,
        bookingId: updatedBooking.id,
        field: "to",
        fromValue: booking.to ? booking.to.toISOString() : null,
        toValue: newEndDate.toISOString(),
      });

      // Status flip is determined by the same condition used in the tx
      // update: OVERDUE → ONGOING. Anything else keeps the prior status.
      if (booking.status === BookingStatus.OVERDUE) {
        await recordEvent({
          organizationId,
          actorUserId: userId,
          action: "BOOKING_STATUS_CHANGED",
          entityType: "BOOKING",
          entityId: updatedBooking.id,
          bookingId: updatedBooking.id,
          field: "status",
          fromValue: BookingStatus.OVERDUE,
          toValue: BookingStatus.ONGOING,
        });
      }
    } catch (err) {
      Logger.error(
        new ShelfError({
          cause: err,
          message: "Failed to record extendBooking activity events",
          additionalData: { bookingId: updatedBooking.id },
          label,
        })
      );
    }

    // Resolve notification recipients and send personalized emails
    const recipients = await getBookingNotificationRecipients({
      booking: updatedBooking,
      eventType: "EXTEND",
      organizationId: updatedBooking.organizationId,
      editorUserId: userId,
    });

    if (recipients.length > 0) {
      const custodian = updatedBooking?.custodianUser
        ? resolveUserDisplayName(updatedBooking.custodianUser)
        : updatedBooking.custodianTeamMember?.name ?? "";

      await sendBookingEmailToAllRecipients({
        recipients,
        booking: updatedBooking,
        subject: `Booking extended (${updatedBooking.name}) - shelf.nu`,
        buildText: (prefs) =>
          extendBookingEmailContent({
            bookingName: updatedBooking.name,
            assetsCount: updatedBooking._count.bookingAssets,
            custodian,
            from: updatedBooking.from!,
            to: updatedBooking.to!,
            prefs,
            bookingId: updatedBooking.id,
            oldToDate: booking.to,
            customEmailFooter: updatedBooking.organization.customEmailFooter,
          }),
        buildHeading: (prefs) =>
          `Booking extended from ${formatDate(booking.to, prefs, {
            includeTime: true,
          })} to ${formatDate(newEndDate, prefs, { includeTime: true })}`,
        hints,
      });
    }

    /**
     * In case of ONGOING, a checkin reminder should have be scheduled. So we have to reschedule it.
     * And in case of OVERDUE all the jobs are completed, so we have to reschedule the checkin reminder.
     */
    await cancelScheduler(booking);

    const { hours } = calcTimeDifference(newEndDate, new Date());

    /**
     * If there is less than 1 hours left for checkin, then we immediately send the checkin
     * reminder and we schedule the overdue handler.
     */
    if (hours < 1) {
      await sendCheckinReminder(
        updatedBooking,
        updatedBooking._count.bookingAssets,
        hints,
        updatedBooking.organizationId
      );

      await scheduleNextBookingJob({
        data: {
          id: updatedBooking.id,
          hints,
          eventType: BOOKING_SCHEDULER_EVENTS_ENUM.overdueHandler,
        },
        when: newEndDate,
      });
    } else {
      const when = newEndDate;
      when.setHours(newEndDate.getHours() - 1);

      await scheduleNextBookingJob({
        data: {
          id: updatedBooking.id,
          hints,
          eventType: BOOKING_SCHEDULER_EVENTS_ENUM.checkinReminder,
        },
        when,
      });
    }

    return updatedBooking;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      label,
      title: "Error",
      message: isShelfError
        ? cause.message
        : "Something went wrong while extending the booking.",
      additionalData: isShelfError ? cause.additionalData : undefined,
      shouldBeCaptured: isShelfError ? cause.shouldBeCaptured : true,
    });
  }
}

/**
 * Resolves the `custodianScope` restriction for one user in one organization —
 * the "these bookings are mine" clause that {@link getBookings} ANDs in so a
 * restricted (SELF_SERVICE / BASE) user only ever sees their own bookings.
 *
 * Resolves **every** `TeamMember` row the user has in the org, not just one:
 * the schema has no unique constraint on `(userId, organizationId)` (the
 * demotion backfill migration depends on that), so a user can hold more than
 * one team-member row, and a legacy booking's custody link may point at any of
 * them. A `findFirst` would silently hide bookings linked via the other rows.
 *
 * Returns `teamMemberIds: []` when the user has no team member — callers that
 * require one (the index, the iCal feed) throw on that; list surfaces simply
 * fall back to matching on the user link alone.
 *
 * @param params.userId - The user whose bookings the scope restricts to
 * @param params.organizationId - The active workspace
 * @returns A `custodianScope` with all of the user's team-member ids in the org
 */
export async function resolveCustodianScope({
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<{ userId: string; teamMemberIds: string[] }> {
  const teamMembers = await db.teamMember.findMany({
    where: { userId, organizationId },
    select: { id: true },
  });

  return { userId, teamMemberIds: teamMembers.map((tm) => tm.id) };
}

export async function getBookingsFilterData({
  request,
  userId,
  canSeeAllBookings,
  organizationId,
}: {
  request: Request;
  userId: string;
  canSeeAllBookings: boolean;
  organizationId: Organization["id"];
}) {
  const {
    filters,
    redirectNeeded,
    serializedCookie: filtersCookie,
  } = await getFiltersFromRequest(request, organizationId, {
    name: "bookingFilter_v2",
    path: "/", // Use root path so cookie is sent with RR7 single fetch .data requests
  });

  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search, status, teamMemberIds, tags } =
    getParamsValues(searchParams);

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  const orderBy = searchParams.get("orderBy") ?? "from";
  const orderDirection = (searchParams.get("orderDirection") ??
    "asc") as SortingDirection;

  /**
   * For self service and base users, we look up their team member so the
   * restriction can match custody recorded on EITHER link.
   *
   * This handles the case where a booking was assigned while no user was
   * attached to the team member, and the two were linked only later — the
   * booking must stay visible to the user it was assigned to. It shouldn't
   * normally happen (accepting an invite now links them), but it is kept as a
   * safety net for rows that pre-date that fix.
   *
   * This fallback is live: `custodianScope.teamMemberIds` is read by
   * {@link getBookings}, which ORs it with the user link inside a single AND-ed
   * clause. It previously returned a singular `custodianTeamMemberId` that
   * `getBookings` never declared, so callers spreading this object had the key
   * silently dropped and the fallback never actually fired.
   */
  let selfServiceData = null;

  // Only fetch team member data if the user doesn't have permission to see all bookings
  if (!canSeeAllBookings) {
    const custodianScope = await resolveCustodianScope({
      userId,
      organizationId,
    });

    if (!custodianScope.teamMemberIds.length) {
      throw new ShelfError({
        cause: null,
        title: "Team member not found",
        message:
          "You are not part of a team in this organization. Please contact your organization admin to resolve this",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    // If the user is self service/base without override, we only show bookings
    // that belong to that user — matched via their user link OR any of their
    // team-member links.
    selfServiceData = { custodianScope };
  }

  return {
    searchParams,
    cookie,
    page,
    perPage,
    search,
    status,
    teamMemberIds,
    orderBy,
    orderDirection,
    selfServiceData,
    filtersCookie,
    filters,
    redirectNeeded,
    tags,
  };
}

/**
 * Turns a {@link resolveCustodianScope} result into the single AND-able clause
 * that expresses "these bookings are that person's" — custody on their user
 * link OR on any of their team-member links.
 *
 * Extracted so {@link getBookings} and `/api/model-filters` cannot disagree on
 * the shape. They previously did: the endpoint matched the user link alone, so
 * a booking custodied through a legacy team-member row showed in the list a
 * picker was seeded with and then vanished the moment the user typed.
 *
 * @param scope - Resolved custodian scope for ONE person.
 * @returns A `Prisma.BookingWhereInput` to push into `where.AND` — never into a
 *   top-level `OR`, where a user-supplied filter could widen it away.
 */
export function custodianScopeClause(scope: {
  userId: string;
  teamMemberIds?: string[];
}): Prisma.BookingWhereInput {
  const selfBranches: Prisma.BookingWhereInput[] = [
    { custodianUserId: scope.userId },
  ];

  if (scope.teamMemberIds?.length) {
    selfBranches.push({
      custodianTeamMemberId: { in: scope.teamMemberIds },
    });
  }

  return selfBranches.length === 1 ? selfBranches[0] : { OR: selfBranches };
}

/**
 * DRAFT-visibility rule shared by every booking-list query: bookings that are
 * not DRAFT are visible to everyone in the org, while DRAFT bookings are only
 * visible to their creator. Extracted so heavy ({@link getBookings}) and slim
 * ({@link getMinimalBookings}) list queries cannot drift apart on this
 * permission-sensitive predicate.
 *
 * @param userId - The viewer, matched against `Booking.creatorId` for drafts.
 * @returns A `Prisma.BookingWhereInput` OR-clause to push into `where.AND`.
 */
export function bookingDraftVisibilityClause(
  userId: Booking["creatorId"]
): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: { not: "DRAFT" } },
      { AND: [{ status: "DRAFT" }, { creatorId: userId }] },
    ],
  };
}

/**
 * Slim booking list for pickers that render only a name + date range and
 * filter client-side (e.g. the bulk "add to existing booking" dialog). Unlike
 * {@link getBookings} it selects a handful of scalar columns instead of the
 * heavy asset/kit/custodian projection, and runs no count query — the caller
 * gets every matching row (paginate-first is moot when only ~5 columns per row
 * are fetched). Shares {@link bookingDraftVisibilityClause} so it honours the
 * same DRAFT-creator visibility as the full index.
 *
 * @param params.organizationId - Workspace scope.
 * @param params.userId - Viewer, for the DRAFT-visibility rule.
 * @param params.statuses - Explicit status filter; defaults to excluding
 *   ARCHIVED + CANCELLED (mirrors {@link getBookings}).
 * @param params.custodianUserId - Restrict to a custodian (self-service views).
 *
 *   HAZARD — this is a *restriction*, not a user-supplied filter. It is safe
 *   today only because every call site passes the session user and no
 *   request-controlled value reaches it, so it stays AND-ed as a plain scalar.
 *   {@link getBookings} deliberately separates the two concepts (`custodianScope`
 *   = restriction, `custodianTeamMemberIds` = filter) because conflating them
 *   let a self-service caller widen their own restriction by supplying a
 *   custodian filter. If you add a custodian *filter* here, do not extend this
 *   param — add a separate one and AND it, exactly as `getBookings` does.
 *
 * @returns `{ bookings }` — id, name, status, from, to, ordered by `from`
 *   with a stable `id` tiebreaker.
 * @throws {ShelfError} If the query fails.
 */
export async function getMinimalBookings(params: {
  organizationId: Organization["id"];
  userId: Booking["creatorId"];
  statuses?: Booking["status"][] | null;
  /**
   * Restrict to bookings that are the acting user's own. Takes a flag rather
   * than an id so the caller cannot express the restriction narrowly: custody
   * lives on either the user link OR a team-member link, and this resolves
   * both through {@link custodianScopeClause}.
   */
  restrictToCustodian?: boolean;
}) {
  const { organizationId, userId, statuses, restrictToCustodian } = params;

  try {
    const andClauses: Prisma.BookingWhereInput[] = [
      bookingDraftVisibilityClause(userId),
    ];

    if (restrictToCustodian && userId) {
      // AND-ed, never merged into a top-level OR where a filter could widen it.
      andClauses.push(
        custodianScopeClause(
          await resolveCustodianScope({ userId, organizationId })
        )
      );
    }

    const where: Prisma.BookingWhereInput = {
      organizationId,
      AND: andClauses,
    };

    if (statuses?.length) {
      where.status = { in: statuses };
    } else {
      // Default: hide archived & cancelled, matching getBookings.
      where.status = {
        notIn: [BookingStatus.ARCHIVED, BookingStatus.CANCELLED],
      };
    }

    const bookings = await db.booking.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        from: true,
        to: true,
      },
      // `id` tiebreaker so the (unpaginated) order is stable across requests.
      orderBy: [{ from: "asc" }, { id: "asc" }],
    });

    return { bookings };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the bookings. Please try again or contact support.",
      additionalData: { ...params },
      label,
    });
  }
}

export async function getBookings(params: {
  organizationId: Organization["id"];
  /** Page number. Starts at 1 */
  page: number;
  /** Assets to be loaded per page */
  perPage?: number;
  search?: string | null;
  statuses?: Booking["status"][] | null;
  assetIds?: Asset["id"][] | null;
  /**
   * A RESTRICTION scoping results to the bookings of ONE person, matched via
   * either custody link. Set ONLY by callers that have established the viewer
   * is allowed to see no more than that person's bookings.
   *
   * Both halves identify the SAME person: a booking is theirs if custody sits on
   * their user link OR on their team-member link (legacy rows where
   * `custodianUserId` was never backfilled). Those halves are OR-ed with each
   * other, then the whole thing is AND-ed into the query as ONE clause — so this
   * ALWAYS narrows and can never be widened away by a user-supplied filter.
   * That AND-ing is the security contract; do not move it into a top-level `OR`.
   *
   * Usually the caller themselves (self-service/base users restricted to their
   * own bookings). NOT always: the team-member profile route scopes to the
   * profile BEING VIEWED, having already gated access with a
   * `teamMemberProfile.read` permission check. Hence the neutral name — pass
   * whichever person the caller has proven the viewer may see.
   *
   * Distinct from `custodianTeamMemberIds`, which is a user-facing FILTER built
   * from unvalidated search params. Conflating the two was a privilege
   * escalation: `?teamMember=<victim-id>` OR-ed the restriction away.
   */
  custodianScope?: {
    /** The person whose bookings the results are scoped to. */
    userId: string;
    /** That person's team-member ids in this org. Optional; omit to match on the user link only. */
    teamMemberIds?: string[];
  } | null;
  /**
   * User-facing FILTER — "show me this person's bookings" — built from
   * unvalidated `?teamMember=` search params, so the values are
   * attacker-controlled. It is NEVER a restriction: it is always AND-ed, so it
   * can only narrow what the caller is already allowed to see. To restrict a
   * user to their own bookings use `custodianScope` instead.
   *
   * Accepts an array so the bookings index can filter by several team members.
   */
  custodianTeamMemberIds?: string[] | null;
  /**
   * RESTRICTION scoping results to bookings this person may MUTATE — see
   * {@link bookingWriteScopeClause}. Set only by pickers whose selection feeds
   * an action gated by `validateBookingOwnership`; omit for read-only lists.
   *
   * ONE object rather than two sibling params on purpose: a half-set pair
   * (id without role, or role without id) would silently skip the restriction
   * entirely. Both halves are required together or not at all.
   */
  writableBy?: { userId: string; role: OrganizationRoles } | null;
  excludeBookingIds?: Booking["id"][] | null;
  bookingFrom?: Booking["from"] | null;
  bookingTo?: Booking["to"] | null;
  userId: Booking["creatorId"];
  extraInclude?: Prisma.BookingInclude;
  /** Controls whether entries should be paginated or not */
  takeAll?: boolean;
  orderBy?: string;
  orderDirection?: SortingDirection;
  kitId?: string;
  tags?: Tag["id"][];
  /**
   * Skip the `db.booking.count` companion query and return `bookingCount: 0`.
   * For callers that only need the rows and never read the total (e.g. the
   * iCal feed), this avoids a wasted aggregate on every call. Defaults to
   * `false`, so paginated callers are unaffected.
   */
  skipCount?: boolean;
  /**
   * Attach the `bookingAssets` payload — by far the heaviest part of this
   * query. Callers that render no asset data (the calendar, the dashboard
   * widgets, the bookings-list surfaces whose drawer fetches on open) pass
   * `false`, which omits the key from the Prisma include entirely. Defaults
   * to `true`, so existing callers are unaffected.
   */
  includeAssets?: boolean;
  /**
   * Hard row cap, bypassing the `perPage` ≤ 100 clamp below. For callers that
   * fetch one bounded set in a single query rather than a page of it. Unlike
   * `takeAll` the query stays bounded; ignored when `takeAll` is set.
   */
  takeCap?: number;
}) {
  const {
    organizationId,
    page = 1,
    perPage = 8,
    search,
    statuses,
    custodianScope,
    custodianTeamMemberIds,
    writableBy,
    assetIds,
    bookingTo,
    excludeBookingIds,
    bookingFrom,
    userId,
    extraInclude,
    takeAll = false,
    orderBy = "from",
    orderDirection = "asc",
    kitId,
    tags,
    skipCount = false,
    includeAssets = true,
    takeCap,
  } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 25 per page

    /** Default value of where. Takes the assetss belonging to current org */
    const where: Prisma.BookingWhereInput = { organizationId };

    /**
     * Clauses that must NARROW the result set. Everything AND-ed here composes:
     * no clause can widen another away.
     *
     * The idea is that only the creator of a draft booking can see it
     * This condition will fetch all bookings that are not in 'DRAFT' status, and also the bookings that are in 'DRAFT' status but only if their creatorId is the same as the userId
     */
    const andClauses: Prisma.BookingWhereInput[] = [
      bookingDraftVisibilityClause(userId),
    ];

    /** If the search string exists, add it to the where object */
    if (search?.trim()?.length) {
      const searchTerms = search
        .toLowerCase()
        .trim()
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean);

      where.OR = searchTerms.map((term) => ({
        OR: [
          // Search in booking fields
          { name: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
          // Search in tags
          { tags: { some: { name: { contains: term, mode: "insensitive" } } } },
          // Search in custodian team member name
          {
            custodianTeamMember: {
              name: { contains: term, mode: "insensitive" },
            },
          },
          // Search in custodian user names. `displayName` is one of them: it
          // replaces first/last name in the UI for users who set one, so it is
          // the name a searcher can actually see on the booking row.
          {
            custodianUser: {
              OR: [
                { firstName: { contains: term, mode: "insensitive" } },
                { lastName: { contains: term, mode: "insensitive" } },
                { displayName: { contains: term, mode: "insensitive" } },
              ],
            },
          },
          // Search in asset titles, QR codes, and barcodes
          {
            bookingAssets: {
              some: {
                asset: {
                  OR: [
                    { title: { contains: term, mode: "insensitive" } },
                    {
                      qrCodes: {
                        some: { id: { contains: term, mode: "insensitive" } },
                      },
                    },
                    {
                      barcodes: {
                        some: {
                          value: { contains: term, mode: "insensitive" },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      }));
    }

    /**
     * The restriction: AND-ed as ONE clause whose internal OR matches either
     * custody link. Nesting the OR inside a single AND member is what keeps it
     * un-widenable — a top-level `where.OR` is a single slot that the search
     * block also writes, so whichever ran last silently dropped the other.
     */
    if (custodianScope) {
      andClauses.push(custodianScopeClause(custodianScope));
    }

    /**
     * A SECOND, independent restriction: the caller may only be offered
     * bookings they are allowed to WRITE to. Set by mutation-target pickers
     * (the "Add to existing booking" dialogs), never by read-only lists.
     *
     * Scalars rather than a where-input, so a call site cannot hand this a
     * request-controlled predicate — the clause itself is fixed by
     * {@link bookingWriteScopeClause}. AND-ed alongside `custodianScope`, so
     * the two intersect and neither can widen the other.
     */
    if (writableBy) {
      const writeScope = bookingWriteScopeClause(writableBy);

      if (writeScope) {
        andClauses.push(writeScope);
      }
    }

    /** The filter: independent, always AND-ed, never a restriction. */
    if (custodianTeamMemberIds?.length) {
      andClauses.push({
        custodianTeamMemberId: { in: custodianTeamMemberIds },
      });
    }

    where.AND = andClauses;

    if (statuses?.length) {
      where.status = {
        in: statuses,
      };
    } else {
      where.status = {
        notIn: [BookingStatus.ARCHIVED, BookingStatus.CANCELLED], // By default we dont show archived & cancelled bookings
      };
    }

    if (assetIds?.length) {
      where.bookingAssets = {
        some: {
          assetId: {
            in: assetIds,
          },
        },
      };
    }

    if (excludeBookingIds?.length) {
      where.id = { notIn: excludeBookingIds };
    }

    if (bookingFrom && bookingTo) {
      // Add date filtering to AND clause instead of overriding OR clause
      // to preserve search conditions
      if (!where.AND) {
        where.AND = [];
      }
      where.AND.push({
        OR: [
          {
            from: { lte: bookingTo },
            to: { gte: bookingFrom },
          },
          {
            from: { gte: bookingFrom },
            to: { lte: bookingTo },
          },
        ],
      });
    }

    if (kitId) {
      where.bookingAssets = {
        some: { asset: { assetKits: { some: { kitId } } } },
      };
    }

    if (tags?.length) {
      if (tags.includes("untagged")) {
        where.tags = { none: {} };
      } else {
        where.tags = { some: { id: { in: tags } } };
      }
    }

    const [bookings, bookingCount] = await Promise.all([
      db.booking.findMany({
        ...(!takeAll && {
          skip,
          take: takeCap ?? take,
        }),
        where,
        include: {
          ...BOOKING_COMMON_INCLUDE,
          // NOTE: deliberately NO `bookingAssets` when `includeAssets` is
          // false — the calendar, the dashboard widgets and the five
          // bookings-list surfaces render no asset data. The cast keeps the
          // inferred row type stable for default-true callers; opt-out
          // callers must not read `bookingAssets` (the same runtime/static
          // divergence `extraInclude` already has). A conditional generic
          // would type this honestly, but this webapp sits at TypeScript's
          // instantiation ceiling over the extended Prisma client, where a
          // generic here surfaces as TS2321 somewhere unrelated.
          //
          // The include itself lives in `./constants` so the assets-sidebar
          // resource route serves the byte-identical shape.
          ...((includeAssets
            ? BOOKINGS_LIST_ASSETS_INCLUDE
            : {}) as typeof BOOKINGS_LIST_ASSETS_INCLUDE),
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
              profilePicture: true,
            },
          },
          ...(extraInclude || undefined),
        },
        // Stable `id` tiebreaker so rows tied on the sort key (same `from`
        // date, same name, ...) keep a fixed order across requests. Without
        // it, skip/take paging over ties can duplicate or drop rows between
        // pages. Skipped when the caller already sorts by id (duplicate
        // ORDER BY key). Mirrors the tiebreaker the advanced asset index
        // uses (see parseSortingOptions in asset/query.server.ts).
        orderBy: [
          { [orderBy]: orderDirection },
          ...(orderBy !== "id" ? [{ id: "asc" as const }] : []),
        ],
      }),
      // Callers that never read the total (skipCount) avoid the aggregate
      // while the row fetch above still runs; the normal path is unchanged.
      skipCount ? Promise.resolve(0) : db.booking.count({ where }),
    ]);

    return { bookings, bookingCount };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the bookings. Please try again or contact support.",
      additionalData: { ...params },
      label,
    });
  }
}

export async function removeAssets({
  booking,
  firstName,
  lastName,
  displayName,
  userId,
  kitIds = [],
  kits = [],
  assets = [],
  standaloneAssetIds,
  organizationId,
}: {
  booking: Pick<Booking, "id"> & {
    assetIds: Asset["id"][];
  };
  firstName: string;
  lastName: string;
  /**
   * The acting user's `User.displayName`. It wins over the legal-name halves
   * when set, so it must travel with them — a caller that passes only
   * `firstName`/`lastName` names the actor by a name they asked us not to use.
   */
  displayName: string | null;
  userId: string;
  kitIds?: Kit["id"][];
  kits?: Array<{ id: string; name: string }>;
  assets?: Array<{ id: string; title: string }>;
  /**
   * Assets whose *standalone* booking row the caller explicitly wants gone,
   * even if the same asset is also a member of a kit in `kitIds`.
   *
   * Only meaningful alongside `kitIds` — with no kits the whole call already
   * removes every slice of every asset in `booking.assetIds`.
   *
   * Omit it and the service falls back to inferring standalone intent from
   * kit membership. That inference cannot see a user who ticked BOTH an
   * asset's standalone row and the kit it also sits in, so callers that can
   * observe that distinction (the booking-overview bulk action, the mobile
   * remove endpoint) should pass it.
   */
  standaloneAssetIds?: Asset["id"][];
  organizationId: Booking["organizationId"];
}) {
  try {
    const { assetIds, id } = booking;

    /**
     * Audit trail: removing an asset that was materialised from a
     * `BookingModelRequest` must re-open that request by decrementing
     * its `fulfilledQuantity`. Otherwise the
     * operator ends up with `fulfilledQuantity > actualBookingAssets`
     * state — the Reserved Models card stays hidden (because
     * `fulfilledAt` is stamped) even though the booking is short by
     * the removed unit.
     *
     * Strategy:
     *   1. Look up `assetModelId` for each asset being removed.
     *   2. Group by `assetModelId` → how many units to "return".
     *   3. For each model with an open (or fulfilled) request on this
     *      booking, decrement `fulfilledQuantity` by that count (capped
     *      at 0) and clear `fulfilledAt` if it drops below `quantity`.
     *
     * Wrapped in a single transaction with the `bookingAsset.deleteMany`
     * so we don't end up with half-reverted state on failure.
     */
    // Captured inside the tx pre-delete so the per-asset
    // BOOKING_ASSETS_REMOVED event meta + asset-timeline note can
    // report the actual booked-row quantity that just disappeared.
    // Lives outside the tx scope so the post-commit consumers below
    // can read it.
    const removedQtyByAssetId = new Map<string, number>();
    const removedAssetMeta = new Map<
      string,
      {
        id: string;
        title: string;
        type: AssetType;
        unitOfMeasure: string | null;
      }
    >();

    // Lifted out of the tx so post-commit consumers (note rendering, the
    // kit blanket flip gate) can read the source booking's status / name
    // without an extra round-trip. Written inside the tx, read after.
    let sourceBookingStatus: BookingStatus | null = null;
    let sourceBookingName = "";

    await db.$transaction(async (tx) => {
      // Read the source booking's status under the SAME tx snapshot used by
      // `bookingAsset.deleteMany` below. Doing it inside the tx removes the
      // observable window where the source booking's pivot rows are gone
      // but the per-asset status flip hasn't fired yet — concurrent reads
      // would have seen stale `Asset.status` values (bug #99).
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: scoped by id + organizationId; org membership is enforced upstream via the caller's permission gate.
      const sourceBooking = await tx.booking.findUniqueOrThrow({
        where: { id, organizationId },
        select: { status: true, name: true },
      });
      sourceBookingStatus = sourceBooking.status;
      sourceBookingName = sourceBooking.name;

      // Race-proof backstop for the callers' own status gates. Those read the
      // booking before calling, so a booking completed/archived/cancelled in
      // between would still have its rows deleted. This read shares the tx
      // snapshot with the `deleteMany` below, so the status the check sees is
      // the status the delete commits against.
      if (!canUserRemoveBookingAssets(sourceBooking)) {
        throw new ShelfError({
          cause: null,
          message:
            "Removing items is not allowed for the current status of the booking.",
          additionalData: { bookingId: id, status: sourceBooking.status },
          label,
          status: 403,
          shouldBeCaptured: false,
        });
      }

      const removedAssets = await tx.asset.findMany({
        where: { id: { in: assetIds }, organizationId },
        select: {
          id: true,
          assetModelId: true,
          // type + title + unitOfMeasure feed the per-asset note
          // phrasing ("removed 50 units of {asset}") + the event meta.
          title: true,
          type: true,
          unitOfMeasure: true,
        },
      });
      for (const a of removedAssets) {
        removedAssetMeta.set(a.id, {
          id: a.id,
          title: a.title,
          type: a.type,
          unitOfMeasure: a.unitOfMeasure,
        });
      }

      // When the caller removes one or more kits, scope the kit half of the
      // deletion to the kit-driven BookingAsset rows for those kits'
      // AssetKits. Otherwise removing a kit would also blow away any
      // standalone slice the user added separately for the same asset
      // (e.g. Gloves booked standalone at qty 22 alongside the kit's slice
      // of 87 — only the 87 should disappear).
      //
      // `assetIds` can ALSO carry genuinely standalone assets in the same
      // call — the booking-overview bulk "Remove assets/kits" action and the
      // mobile remove-assets endpoint both send kits and loose assets
      // together. Those need the second, `assetKitId: null`-scoped clause;
      // without it the kit scope matched none of their rows and the loose
      // assets silently stayed on the booking.
      //
      // When `kitIds` is empty, the call comes from the manage-assets
      // picker or single-asset remove flow, where the intent is to remove
      // ALL slices of the asset from the booking (legacy behaviour).
      let rowsToDeleteWhere: Prisma.BookingAssetWhereInput;
      if (kitIds.length > 0) {
        const kitDrivenAssetKits = await tx.assetKit.findMany({
          where: { kitId: { in: kitIds }, assetId: { in: assetIds } },
          select: { id: true, assetId: true },
        });

        // Prefer the caller's explicit list — it is the only thing that can
        // distinguish "the user ticked this asset's standalone row" from
        // "this asset came along because its kit was ticked". An asset can
        // hold BOTH a standalone row and kit-driven rows on one booking, so
        // inferring from kit membership silently spares the standalone row.
        //
        // Fall back to the inference for callers that can't observe the
        // distinction: anything in `assetIds` that is NOT a member of a kit
        // being removed is, by definition, a loose asset the caller wants
        // gone. Members of the removed kits are covered by the kit clause.
        const kitMemberAssetIds = new Set(
          kitDrivenAssetKits.map((ak: { assetId: string }) => ak.assetId)
        );
        const resolvedStandaloneAssetIds =
          standaloneAssetIds ??
          assetIds.filter((assetId) => !kitMemberAssetIds.has(assetId));

        const orClauses: Prisma.BookingAssetWhereInput[] = [
          {
            assetKitId: {
              in: kitDrivenAssetKits.map((ak: { id: string }) => ak.id),
            },
          },
        ];
        if (resolvedStandaloneAssetIds.length > 0) {
          // `assetKitId: null` preserves the protection above in the other
          // direction: a loose asset's own slice goes, but slices it holds
          // via kits the caller did NOT select stay put. Paired with the
          // `bookingId` scope on the outer where, it also pins the delete to
          // exactly one row per asset (the partial unique index allows only
          // one standalone row per booking+asset), so caller-supplied ids
          // can't reach another booking's or another org's rows.
          orClauses.push({
            assetId: { in: resolvedStandaloneAssetIds },
            assetKitId: null,
          });
        }

        rowsToDeleteWhere =
          orClauses.length === 1
            ? { bookingId: id, ...orClauses[0] }
            : { bookingId: id, OR: orClauses };
      } else {
        rowsToDeleteWhere = { bookingId: id, assetId: { in: assetIds } };
      }

      // Snapshot the BookingAsset rows about to be deleted so per-asset
      // qty can be summed for the activity events + asset-timeline notes
      // emitted post-commit below. After `deleteMany` runs, those rows
      // are gone and we'd lose the count.
      const rowsBeingDeleted = await tx.bookingAsset.findMany({
        where: rowsToDeleteWhere,
        // `bookingModelRequestId` drives the reservation rollback below.
        select: { assetId: true, quantity: true, bookingModelRequestId: true },
      });
      for (const row of rowsBeingDeleted) {
        removedQtyByAssetId.set(
          row.assetId,
          (removedQtyByAssetId.get(row.assetId) ?? 0) + row.quantity
        );
      }

      await tx.bookingAsset.deleteMany({ where: rowsToDeleteWhere });

      /**
       * The zero-asset invariant, defended from the removal side.
       *
       * `reserveBooking` refuses to take a booking into RESERVED with nothing
       * in it, but that only guards the transition — emptying the booking
       * afterwards reached exactly the same state from the other direction,
       * leaving a booking that reserves nothing and cannot be checked out.
       * Enforced here, in the shared service, rather than at the six call
       * sites (web overview bulk + single, manage-assets, manage-kits, the
       * mobile endpoint), so no future caller can miss it.
       *
       * RESERVED only, deliberately. An empty DRAFT is normal
       * work-in-progress; COMPLETE / ARCHIVED / CANCELLED hold nothing any
       * more; and ONGOING / OVERDUE must stay emptiable, because pulling a
       * checked-out asset off a live booking is a real correction flow that
       * this service already reconciles asset status for (bug #99 coverage).
       *
       * Throwing inside the tx rolls the delete back, so the booking is never
       * observably empty.
       */
      if (sourceBooking.status === BookingStatus.RESERVED) {
        const remainingSlices = await tx.bookingAsset.count({
          where: { bookingId: id },
        });

        if (remainingSlices === 0) {
          // Model reservations survive asset removal (the rollback below only
          // decrements `fulfilledQuantity`), so a booking held purely by
          // outstanding model requests is still holding something.
          const remainingModelRequests = await tx.bookingModelRequest.count({
            where: { bookingId: id },
          });

          if (remainingModelRequests === 0) {
            throw new ShelfError({
              cause: null,
              label,
              title: "Booking would be left empty",
              message: BOOKING_EMPTY_RESERVED_MESSAGE,
              status: 400,
              shouldBeCaptured: false,
              additionalData: { bookingId: id, organizationId },
            });
          }
        }
      }

      /**
       * Re-open reservations that the removed rows had discharged.
       *
       * Counted from `bookingModelRequestId` — the row's own record of which
       * promise it answered — NOT from `assetModelId`. Grouping by model
       * counts every removed asset that merely SHARES a model with a
       * reservation, including ones that never discharged anything:
       *
       *   Reserve 2 x Dell. Add 3 matching assets: two discharge the
       *   reservation, the third is an ordinary add. Remove that third one and
       *   the model-based count re-opened the reservation, hard-blocking
       *   check-out while both discharging assets were still on the booking.
       *   The operator's only escape was deleting a reservation that was
       *   correctly satisfied.
       *
       * That was near-unreachable while only the scanner discharged
       * reservations. Routing every add-assets surface through
       * `fulfilModelRequestsForAssets` makes it routine, so the column this PR
       * adds has to be read here, not just written.
       */
      /**
       * `fulfilledAt` reversals to report, one per request this loop reopens.
       * Batched and flushed after the loop so N affected requests cost one
       * insert rather than N — same reasoning as the `recordEvents` docs.
       */
      const modelRequestReopenEvents: ActivityEventInput[] = [];

      const removalsByRequest = new Map<string, number>();
      for (const row of rowsBeingDeleted) {
        if (!row.bookingModelRequestId) continue;
        removalsByRequest.set(
          row.bookingModelRequestId,
          (removalsByRequest.get(row.bookingModelRequestId) ?? 0) + 1
        );
      }

      for (const [requestId, decrementBy] of removalsByRequest) {
        const request = await tx.bookingModelRequest.findUnique({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `requestId` comes from BookingAsset rows on this booking, which was org-checked above
          where: { id: requestId },
          // `fulfilledAt`, the model id and its name feed the reopen event
          // below; without the before-state we cannot report what changed.
          select: {
            quantity: true,
            fulfilledQuantity: true,
            bookingId: true,
            fulfilledAt: true,
            assetModelId: true,
            assetModel: { select: { name: true } },
          },
        });
        // Belt and braces: the FK guarantees it, but never touch a request
        // belonging to another booking.
        if (!request || request.bookingId !== id) continue;
        if (request.fulfilledQuantity === 0) continue;

        const nextFulfilled = Math.max(
          0,
          request.fulfilledQuantity - decrementBy
        );
        // Dropping below the reserved `quantity` means there is outstanding
        // work again — clear the completion stamp so the reservations section
        // and its CTAs come back.
        const nextFulfilledAt =
          nextFulfilled < request.quantity ? null : undefined;

        await tx.bookingModelRequest.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: same row just proven to belong to this booking
          where: { id: requestId },
          data: {
            fulfilledQuantity: nextFulfilled,
            ...(nextFulfilledAt === null ? { fulfilledAt: null } : {}),
          },
        });

        /**
         * Report the reversal, but only on a genuine set → unset flip.
         * `nextFulfilledAt === null` is also true for a request that was
         * never complete, so gating on it alone would emit spurious
         * null → null events on every removal from an outstanding request.
         *
         * This is the mirror of the null → timestamp events emitted in
         * `booking-model-request/service.server.ts`. Without it the stream
         * records reservations closing and never reopening, and
         * `fulfilledAt IS NULL` consumers reconstruct this one as still
         * fulfilled after the removal reopened it.
         */
        if (request.fulfilledAt != null && nextFulfilledAt === null) {
          modelRequestReopenEvents.push({
            organizationId,
            actorUserId: userId,
            action: "BOOKING_MODEL_REQUEST_CHANGED",
            entityType: "BOOKING",
            entityId: id,
            bookingId: id,
            field: "fulfilledAt",
            fromValue: request.fulfilledAt.toISOString(),
            toValue: null,
            meta: {
              assetModelId: request.assetModelId,
              assetModelName: request.assetModel.name,
            },
          });
        }
      }

      // Same tx as the decrement above — a rolled-back removal must not
      // leave an event claiming the reservation reopened.
      await recordEvents(modelRequestReopenEvents, tx);

      /** When removing an asset from an ONGOING/OVERDUE booking we need to
       * reconcile each asset's terminal status — NOT blanket-flip to
       * AVAILABLE.
       *
       * The blanket flip was unsafe: an asset can simultaneously sit on a
       * different ONGOING/OVERDUE booking OR be held by a Custody row, and
       * stamping AVAILABLE silently stripped those signals (bug #99). The
       * source booking's slice has already been deleted above in this same
       * tx, so `excludeBookingId` is informational (the rows are gone
       * anyway) but kept for symmetry with the other exit paths.
       *
       * RESERVED/DRAFT removals are unchanged: the asset was never out, so
       * there is nothing to reconcile.
       *
       * Running inside the same tx as `bookingAsset.deleteMany` ensures the
       * pivot deletion and the per-asset status flip commit atomically — no
       * observable window where the source booking's slice is gone but the
       * asset still reports a stale CHECKED_OUT (or, in the inverse, where
       * a parallel flip has stamped AVAILABLE over another booking's
       * legitimate CHECKED_OUT).
       *
       * See https://github.com/Shelf-nu/shelf.nu/issues/703#issuecomment-1944315975
       * for the original "don't reset assets on draft remove" guard that
       * this preserves.
       */
      if (
        sourceBookingStatus === BookingStatus.ONGOING ||
        sourceBookingStatus === BookingStatus.OVERDUE
      ) {
        await reconcileAssetStatusForBookingExit({
          tx,
          assetIds,
          excludeBookingIds: [id],
          organizationId,
        });
      }
    });

    // Surface the booking row to post-tx consumers — note rendering needs
    // `name`, the kit blanket-flip gate needs `status`. Both were captured
    // inside the tx above; the `findUniqueOrThrow` would have thrown if the
    // booking didn't exist, so we know these are populated by the time we
    // reach this line.
    if (sourceBookingStatus === null) {
      // Defensive: should be impossible — the tx above does
      // `findUniqueOrThrow`. Surfaces a clear error rather than a vague
      // null deref if a future refactor breaks the invariant.
      throw new ShelfError({
        cause: null,
        message:
          "Internal error: source booking status was not captured during asset removal.",
        additionalData: { bookingId: id, organizationId },
        label,
      });
    }
    const b = {
      id,
      name: sourceBookingName,
      status: sourceBookingStatus,
    };
    if (
      b.status === BookingStatus.ONGOING ||
      b.status === BookingStatus.OVERDUE
    ) {
      if (kitIds.length > 0) {
        // Kit status keeps the blanket flip — kit status is a coarser
        // indicator and out of scope for the per-asset #99 fix.
        await db.kit.updateMany({
          where: { id: { in: kitIds }, organizationId },
          data: { status: KitStatus.AVAILABLE },
        });
      }
    }

    const userForNotes = { firstName, lastName, displayName, id: userId };

    const bookingLink = wrapLinkForNote(`/bookings/${b.id}`, b.name);

    /**
     * Assets that genuinely lost a `BookingAsset` row on this call.
     *
     * `assetIds` is the caller's REQUEST, not the outcome: the bulk-remove
     * handler passes every member of a selected kit, including members added
     * to the kit after the booking was created and therefore never on it.
     * Reporting those as removed forges the audit trail — a note and a
     * `BOOKING_ASSETS_REMOVED` event for something that never left.
     *
     * `removedQtyByAssetId` was populated inside the tx from the rows about to
     * be deleted, so it is the exact record of what actually went.
     */
    const actuallyRemovedAssetIds = assetIds.filter((assetId) =>
      removedQtyByAssetId.has(assetId)
    );

    // Asset-timeline note — one row per asset. Previously every asset
    // shared the same "removed assets from {booking}" string via
    // createNotes (one content for N ids); now qty-tracked rows surface
    // the removed unit count ("removed 50 units of {asset} from
    // {booking}") while INDIVIDUAL keeps the legacy phrasing
    // byte-for-byte. why: content now differs per asset, so a single
    // shared `createNotes({assetIds: […]})` call no longer fits — we
    // flatMap one note per asset instead.
    const removalNoteData = actuallyRemovedAssetIds.map((assetId) => {
      const assetForNote = removedAssetMeta.get(assetId);
      const removedQty = removedQtyByAssetId.get(assetId);
      // Only switch to the qty-aware per-asset phrasing when we have the
      // full asset shape (title + type). Otherwise fall back to the
      // legacy "removed assets from {booking}" wording so nothing
      // regresses if the asset metadata fetch returns only ids.
      if (assetForNote?.title && assetForNote.type) {
        const assetMarkup = wrapAssetWithCountForNote(assetForNote, removedQty);
        return {
          content: `${wrapUserLinkForNote(
            userForNotes
          )} removed ${assetMarkup} from ${bookingLink}.`,
          assetId,
        };
      }
      return {
        content: `${wrapUserLinkForNote(
          userForNotes
        )} removed assets from ${bookingLink}.`,
        assetId,
      };
    });
    for (const note of removalNoteData) {
      await createNotes({
        content: note.content,
        type: "UPDATE",
        userId,
        assetIds: [note.assetId],
        organizationId,
      });
    }

    // Activity events — one BOOKING_ASSETS_REMOVED per asset detached.
    // Best-effort: don't fail the removal if event recording fails.
    // `meta.quantity` is the sum of BookingAsset.quantity from rows
    // dropped for that asset on this call (qty-tracked only).
    if (actuallyRemovedAssetIds.length > 0) {
      try {
        await recordEvents(
          actuallyRemovedAssetIds.map((assetId) => {
            const asset = removedAssetMeta.get(assetId);
            const removedQty = removedQtyByAssetId.get(assetId);
            return {
              organizationId,
              actorUserId: userId,
              action: "BOOKING_ASSETS_REMOVED" as const,
              entityType: "BOOKING" as const,
              entityId: booking.id,
              bookingId: booking.id,
              assetId,
              meta: asset ? assetQtyMeta(asset, removedQty) : {},
            };
          })
        );
      } catch (err) {
        Logger.error(
          new ShelfError({
            cause: err,
            message: "Failed to record BOOKING_ASSETS_REMOVED events",
            additionalData: { bookingId: booking.id, assetIds },
            label,
          })
        );
      }
    }

    // BOOKING ACTIVITY LOG: Log removal activity
    // Creates system note when assets/kits are removed from a booking
    // Handles three cases: kits only, assets only, or both combined
    // why: out of this rule — multi-asset popover, per-asset qty deferred.
    // These are the booking-level summary notes (wrapAssets/Kits popover);
    // the per-asset qty already surfaces on the asset-timeline notes above.
    const hasKits = kitIds && kitIds.length > 0;
    // Check if we have standalone assets (not belonging to kits being removed)
    const hasAssets = assets && assets.length > 0;

    if (hasKits && hasAssets) {
      // Both kits and assets removed - create combined note
      const kitContent =
        kits.length > 0
          ? wrapKitsWithDataForNote(kits, "removed")
          : wrapKitsForNote(kitIds, "removed");

      const assetContent = wrapAssetsWithDataForNote(assets, "removed");

      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
        content: `${wrapUserLinkForNote(
          userForNotes
        )} removed ${kitContent} and ${assetContent} from booking.`,
      });
    } else if (hasKits) {
      // Only kits removed
      const kitContent =
        kits.length > 0
          ? wrapKitsWithDataForNote(kits, "removed")
          : wrapKitsForNote(kitIds, "removed");

      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
        content: `${wrapUserLinkForNote(
          userForNotes
        )} removed ${kitContent} from booking.`,
      });
    } else if (hasAssets) {
      // Only assets removed
      const assetContent = wrapAssetsWithDataForNote(assets, "removed");

      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
        content: `${wrapUserLinkForNote(
          userForNotes
        )} removed ${assetContent} from booking.`,
      });
    }

    return b;
  } catch (cause) {
    throw new ShelfError({
      cause,
      // Keep a deliberate message (e.g. the closed-booking 403 above) instead
      // of burying it under the generic one. `status` and `shouldBeCaptured`
      // already carry over from a ShelfError cause.
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while removing assets from the booking. Please try again or contact support.",
      additionalData: { booking, userId },
      label,
    });
  }
}

/**
 * Permanently deletes a booking and reconciles the status of any assets that
 * were checked out on it.
 *
 * Atomicity invariant (bug #99 follow-up):
 * The user-visible state change — `Booking.delete` (which cascades to
 * `BookingAsset` rows) AND the per-asset status reconciliation — runs inside
 * a single `db.$transaction`. Without this, a concurrent reader could observe
 * an intermediate state where the booking row is gone but its assets are
 * still stamped `CHECKED_OUT` (or, inversely, where a parallel writer flips
 * an asset before reconciliation runs and we silently overwrite a fresh
 * commitment).
 *
 * Order inside the tx is deliberate: `activeAssetIds` are captured BEFORE
 * the tx body runs because the cascade removes the `BookingAsset` pivot
 * rows; the reconciliation helper still needs the list to scope its
 * per-asset count + updateMany queries. Then `booking.delete` runs, then
 * `reconcileAssetStatusForBookingExit` reads the post-delete world to decide
 * each asset's terminal status (CHECKED_OUT if another active booking still
 * holds it, IN_CUSTODY if a custody row holds it, else AVAILABLE).
 *
 * Out of the tx on purpose:
 *  - Email notifications (`getBookingNotificationRecipients`,
 *    `sendBookingEmailToAllRecipients`) — network calls; would hold the tx
 *    open across SMTP latency and cannot be rolled back anyway.
 *  - Kit blanket flip (`updateBookingKitStates`) — coarser indicator and
 *    intentionally out of scope for the bug #99 atomicity fix; the singular
 *    cancel path treats kits the same way.
 *  - `cancelScheduler` — touches the external scheduler; cannot participate
 *    in a Postgres tx.
 *
 * The reconcile helper is safe to call with the outer `tx` — it accepts a tx
 * parameter and runs all its queries through it (no nested transaction). This
 * is the same pattern `cancelBooking` and `removeAssets` already use.
 *
 * @param booking - Org-scoped booking identifier
 * @param hints - Client hints used to format email subject lines and times
 * @param userId - Optional editor user id, used to skip notifying the actor
 * @returns The deleted booking row (with the includes needed for email
 *          rendering and the post-tx caller).
 * @throws {ShelfError} 404 if the booking does not exist; otherwise wraps
 *          any underlying Prisma/email failure.
 */
export async function deleteBooking(
  booking: Pick<Booking, "id" | "organizationId">,
  hints: ClientHint,
  userId?: string
) {
  const { id, organizationId } = booking;
  const currentBooking = await db.booking.findUnique({
    where: { id, organizationId },
    include: {
      bookingAssets: {
        include: {
          asset: {
            select: {
              id: true,
              assetKits: { select: { kitId: true } },
            },
          },
        },
      },
    },
  });

  if (!currentBooking) {
    throw new ShelfError({
      cause: null,
      message:
        "The booking you are trying to delete does not exist or has already been deleted.",
      label,
      status: 404,
      shouldBeCaptured: false,
    });
  }

  try {
    const activeBooking =
      currentBooking &&
      (currentBooking.status === BookingStatus.OVERDUE ||
        currentBooking.status === BookingStatus.ONGOING)
        ? currentBooking
        : null;

    const activeBookingAssets =
      activeBooking?.bookingAssets.map((ba) => ba.asset) ?? [];
    /**
     * Kits to release, from live membership AND the booking's own slices.
     * A kit released redundantly is a no-op write; a kit missed stays stuck.
     */
    const deleteSliceKitIds = activeBooking
      ? await getKitIdsByBookingSlices({
          slices: activeBooking.bookingAssets,
          organizationId,
        })
      : new Map<string, Set<string>>();
    const uniqueKitIds = new Set([
      ...getKitIdsByAssets(activeBookingAssets),
      ...deleteSliceKitIds.keys(),
    ]);
    const hasKits = uniqueKitIds.size > 0;

    // Capture the active asset IDs BEFORE entering the tx: `Booking.delete`
    // cascades and wipes the `BookingAsset` rows, so once the delete commits
    // there is no way to recover the list. The reconcile helper needs them
    // to scope its per-asset count + updateMany queries.
    const activeAssetIds =
      activeBooking?.bookingAssets.map((ba) => ba.asset.id) ?? [];

    /**
     * Single transaction wraps the booking delete and (when applicable) the
     * per-asset reconciliation. See the function-level JSDoc for the full
     * atomicity rationale.
     */
    const b = await db.$transaction(async (tx) => {
      const deleted = await tx.booking.delete({
        where: { id, organizationId },
        include: {
          ...BOOKING_COMMON_INCLUDE,
          ...BOOKING_INCLUDE_FOR_EMAIL,
          bookingAssets: {
            include: {
              asset: { select: { id: true } },
            },
          },
        },
      });

      /** Assets that were checked out on an ONGOING/OVERDUE booking need
       * terminal-status reconciliation, NOT a blanket flip to AVAILABLE.
       * The cascade above has already removed this booking's
       * `BookingAsset` rows, so each asset's correct status is the
       * strongest commitment it still has elsewhere — another active
       * booking (CHECKED_OUT), a custody row (IN_CUSTODY), or nothing
       * (AVAILABLE). See bug #99.
       */
      if (activeBooking) {
        await reconcileAssetStatusForBookingExit({
          tx,
          assetIds: activeAssetIds,
          excludeBookingIds: [activeBooking.id],
          organizationId,
        });
      }

      return deleted;
    });

    // Resolve notification recipients and send personalized emails
    const recipients = await getBookingNotificationRecipients({
      booking: b,
      eventType: "DELETE",
      organizationId,
      editorUserId: userId,
    });

    if (recipients.length > 0) {
      const custodian = b.custodianUser
        ? resolveUserDisplayName(b.custodianUser)
        : b.custodianTeamMember?.name ?? "";

      await sendBookingEmailToAllRecipients({
        recipients,
        booking: b,
        subject: `🗑️ Booking deleted (${b.name}) - shelf.nu`,
        buildText: (prefs) =>
          deletedBookingEmailContent({
            bookingName: b.name,
            assetsCount: b._count.bookingAssets,
            custodian,
            from: b.from as Date,
            to: b.to as Date,
            bookingId: b.id,
            prefs,
            customEmailFooter: b.organization.customEmailFooter,
          }),
        buildHeading: () => `Your booking has been deleted: "${b.name}"`,
        hints,
        templateProps: {
          hideViewButton: true,
        },
      });
    }

    // Kit blanket flip — out of the tx on purpose. Kit status is a coarser
    // indicator than asset status; the singular cancel path treats it the
    // same way and the bug #99 atomicity fix is intentionally scoped to
    // assets.
    if (activeBooking && hasKits) {
      await updateBookingKitStates({
        kitIds: [...uniqueKitIds],
        status: KitStatus.AVAILABLE,
        organizationId,
      });
    }

    await cancelScheduler(
      currentBooking ?? {
        id: b.id,
        activeSchedulerReference: b.activeSchedulerReference,
      }
    );

    return b;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while deleting the booking. Please try again or contact support.",
      additionalData: { booking, hints },
      label,
    });
  }
}

/**
 * Builds the organization-scoping `where` clause for a single-booking lookup:
 * the booking must belong to the caller's active org, or to another org the
 * caller is a member of (so cross-org booking links keep working). Shared by
 * {@link getBooking} and {@link getBookingHeaderData} so their authorization is
 * provably identical.
 *
 * @see .claude/rules/org-scope-user-supplied-ids.md
 */
function bookingOrgScopeWhere({
  id,
  organizationId,
  userOrganizations,
}: {
  id: Booking["id"];
  organizationId: Booking["organizationId"];
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
}): Prisma.BookingWhereInput {
  return {
    OR: [
      { id, organizationId },
      ...(userOrganizations?.length
        ? [
            {
              id,
              organizationId: {
                in: userOrganizations.map((org) => org.organizationId),
              },
            },
          ]
        : []),
    ],
  };
}

/**
 * Enforces the cross-org access rule after a scoped booking lookup: if the
 * booking belongs to a different org that the caller can only reach via
 * membership (not their active org), throw a 404 carrying redirect info. Shared
 * by {@link getBooking} and {@link getBookingHeaderData} so the cross-org
 * behavior cannot drift between them.
 *
 * @throws {ShelfError} 404 with cross-org redirect data
 */
function assertBookingInActiveOrg({
  bookingFound,
  organizationId,
  userOrganizations,
  request,
}: {
  bookingFound: Pick<Booking, "organizationId">;
  organizationId: Booking["organizationId"];
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
}): void {
  if (
    userOrganizations?.length &&
    bookingFound.organizationId !== organizationId &&
    userOrganizations.some(
      (org) => org.organizationId === bookingFound.organizationId
    )
  ) {
    const redirectTo =
      typeof request !== "undefined"
        ? getRedirectUrlFromRequest(request)
        : undefined;

    throw new ShelfError({
      cause: null,
      title: "Booking not found",
      message: "",
      additionalData: {
        model: "booking",
        organization: userOrganizations.find(
          (org) => org.organizationId === bookingFound.organizationId
        ),
        redirectTo,
      },
      label,
      status: 404,
      shouldBeCaptured: false,
    });
  }
}

export async function getBooking<T extends Prisma.BookingInclude | undefined>(
  booking: Pick<Booking, "id" | "organizationId"> & {
    userOrganizations?: Pick<UserOrganization, "organizationId">[];
    request: Request;
    extraInclude?: T;
  }
) {
  try {
    const { id, organizationId, userOrganizations, request, extraInclude } =
      booking;

    /**
     * Asset search-filtering and sorting are intentionally NOT applied here.
     * They are page concerns handled in-memory by the consuming route (the
     * overview loader and the PDF export) via `filterBookingAssets` and
     * `groupAndSortAssetsByKit`. Keeping them out of this shared fetch means
     * every caller (manage-assets, duplicate, cal.ics, activity, the layout,
     * …) receives the booking's FULL asset list in the stable `createdAt asc`
     * base order defined on `BOOKING_WITH_ASSETS_INCLUDE.assets.orderBy` —
     * previously the page's `?s=` / `?orderBy=` leaked into all of them.
     *
     * @see docs/superpowers/specs/2026-06-01-booking-asset-search-in-memory-design.md
     */
    const mergedInclude = {
      ...BOOKING_WITH_ASSETS_INCLUDE,
      ...extraInclude,
    } as MergeInclude<typeof BOOKING_WITH_ASSETS_INCLUDE, T>;

    const bookingFound = (await db.booking.findFirstOrThrow({
      where: bookingOrgScopeWhere({ id, organizationId, userOrganizations }),
      include: mergedInclude,
    })) as BookingWithExtraInclude<T>;

    /* User is accessing the booking in the wrong organization. */
    assertBookingInActiveOrg({
      bookingFound,
      organizationId,
      userOrganizations,
      request,
    });

    return bookingFound;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      title: "Booking not found",
      message:
        "The booking you are trying to access does not exist or you do not have permission to access it.",
      additionalData: {
        ...booking,
        ...(isShelfError ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: isShelfError
        ? cause.shouldBeCaptured
        : !isNotFoundError(cause),
    });
  }
}

/**
 * Lightweight booking fetch for the booking layout header.
 *
 * Returns only the scalar fields the header needs — it does NOT load the
 * booking's assets/relations — but applies the EXACT same organization-scoping
 * and cross-org redirect behavior as {@link getBooking}, so authorization is
 * identical. Use this instead of `getBooking` anywhere the full asset list is
 * not needed (e.g. the `bookings.$bookingId` layout route, which previously
 * loaded every booking asset just to render the title/status).
 *
 * @param args.id - The booking id (from route params)
 * @param args.organizationId - The caller's active organization id
 * @param args.userOrganizations - The caller's org memberships, to allow
 *   viewing a booking from another org the user belongs to (cross-org link)
 * @param args.request - The request, used to build the cross-org redirect URL
 * @returns The booking's header fields (id, name, status, from, to,
 *   custodianUserId, organizationId)
 * @throws {ShelfError} 404 when the booking is not found or not accessible
 */
export async function getBookingHeaderData({
  id,
  organizationId,
  userOrganizations,
  request,
}: {
  id: Booking["id"];
  organizationId: Booking["organizationId"];
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
}) {
  try {
    const bookingFound = await db.booking.findFirstOrThrow({
      // Same org-scoping as getBooking (shared helper), but a minimal select.
      where: bookingOrgScopeWhere({ id, organizationId, userOrganizations }),
      select: {
        id: true,
        name: true,
        status: true,
        from: true,
        to: true,
        custodianUserId: true,
        organizationId: true,
      },
    });

    /* User is accessing the booking in the wrong organization. */
    assertBookingInActiveOrg({
      bookingFound,
      organizationId,
      userOrganizations,
      request,
    });

    return bookingFound;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      title: "Booking not found",
      message:
        "The booking you are trying to access does not exist or you do not have permission to access it.",
      additionalData: {
        id,
        organizationId,
        ...(isShelfError ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: isShelfError
        ? cause.shouldBeCaptured
        : !isNotFoundError(cause),
    });
  }
}

export async function getBookingsForCalendar(params: {
  request: Request;
  organizationId: Organization["id"];
  userId: string;
  canSeeAllBookings: boolean;
  canSeeAllCustody: boolean;
}) {
  const {
    request,
    organizationId,
    userId,
    canSeeAllBookings,
    canSeeAllCustody,
  } = params;

  const { searchParams, search, status, teamMemberIds, tags, selfServiceData } =
    await getBookingsFilterData({
      request,
      canSeeAllBookings,
      organizationId,
      userId,
    });

  const start = searchParams.get("start") as string;
  const end = searchParams.get("end") as string;

  // If start and end are not provided, default to current month
  let startDate: Date;
  let endDate: Date;

  if (start && end) {
    startDate = new Date(start);
    endDate = new Date(end);
  } else {
    // Default to current month
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1); // First day of current month
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
  }

  try {
    const { bookings } = await getBookings({
      organizationId,
      page: 1,
      search,
      userId,
      ...(status && {
        // If status is in the params, we filter based on it
        statuses: [status],
      }),
      bookingFrom: startDate,
      bookingTo: endDate,
      custodianTeamMemberIds: teamMemberIds,
      ...selfServiceData,
      tags,
      // Calendar events carry no asset data — the mapping below projects
      // booking scalars, two names and the tags — so the per-booking asset
      // subtree is pure transfer cost here.
      includeAssets: false,
      // Only `bookings` is read below; skip the COUNT companion query.
      skipCount: true,
      extraInclude: {
        // Narrow selects: the mapping reads `name` off the team member and
        // the display-name fields + picture off the two users. `true` pulled
        // whole `User` rows (every column, per booking, per request).
        custodianTeamMember: { select: { id: true, name: true } },
        custodianUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            profilePicture: true,
          },
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            profilePicture: true,
          },
        },
        tags: TAG_WITH_COLOR_SELECT,
      },
      // Every booking in the window, not a page of them. `takeAll` ignores
      // `perPage`, which is why the old `perPage: 1000` was already dead.
      takeAll: true,
    });

    const events = bookings
      .filter((booking) => booking.from && booking.to)
      .map((booking) => {
        const custodianName = booking?.custodianUser
          ? resolveUserDisplayName(booking.custodianUser)
          : booking.custodianTeamMember?.name;

        let title = booking.name;
        if (canSeeAllCustody) {
          title += ` | ${custodianName}`;
        }
        return {
          title,
          start: (booking.from as Date).toISOString(),
          end: (booking.to as Date).toISOString(),
          classNames: [
            `bookingId-${booking.id}`,
            ...getStatusClasses(
              booking.status,
              isOneDayEvent(booking.from as Date, booking.to as Date)
            ),
          ],
          extendedProps: {
            url: `/bookings/${booking.id}`,
            status: booking.status,
            id: booking.id,
            name: booking.name,
            description: booking.description,
            start: (booking.from as Date).toISOString(),
            end: (booking.to as Date).toISOString(),
            custodian: {
              name: custodianName,
              // Named field by field rather than spread: the loaded row is a
              // full `User`, and this payload is serialized to the calendar
              // client. `displayName` belongs on the list — it outranks the
              // legal-name halves wherever this custodian is rendered.
              user: booking.custodianUser
                ? {
                    id: booking.custodianUserId,
                    firstName: booking.custodianUser?.firstName,
                    lastName: booking.custodianUser?.lastName,
                    displayName: booking.custodianUser?.displayName,
                    profilePicture: booking.custodianUser?.profilePicture,
                  }
                : undefined,
            },
            creator: {
              name: booking.creator
                ? resolveUserDisplayName(booking.creator)
                : "Unknown",
              user: booking.creator
                ? {
                    id: booking.creator.id,
                    firstName: booking.creator.firstName,
                    lastName: booking.creator.lastName,
                    displayName: booking.creator.displayName,
                    profilePicture: booking.creator.profilePicture,
                  }
                : null,
            },
            tags: booking.tags,
          },
        };
      });

    return events;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the bookings for the calendar. Please try again or contact support.",
      additionalData: { ...params },
      label,
    });
  }
}

/**
 * A booking shaped for the iCal feed: scalars + custodian + asset titles.
 * The literal `include` keeps the Prisma payload type precise for the route.
 * Assets are reached through the `bookingAssets` pivot (`ba.asset.title`).
 */
export type ICalFeedBooking = Prisma.BookingGetPayload<{
  include: {
    custodianUser: true;
    custodianTeamMember: true;
    bookingAssets: { select: { asset: { select: { title: true } } } };
  };
}>;

/**
 * Fetches the bookings to render into a member's subscribable iCal feed.
 *
 * Scoping (minus unconfirmed DRAFTs): members who can see all bookings get the
 * whole workspace; self-service/base members are restricted to their own —
 * matched by custodian user OR their linked team member — which can only ever
 * *narrow* visibility to this member, never widen it. DRAFT, ARCHIVED and
 * CANCELLED bookings are excluded, and results are windowed (~last month → next
 * year) so the feed stays bounded.
 *
 * @param params.organizationId - Workspace the feed belongs to
 * @param params.userId - The subscribing member
 * @param params.canSeeAllBookings - Derived from the member's role + org settings
 * @returns Bookings with custodian + asset titles for VEVENT rendering
 * @throws {ShelfError} If a restricted member has no team-member record, or on a DB error
 */
export async function getBookingsForICalFeed(params: {
  organizationId: Organization["id"];
  userId: string;
  canSeeAllBookings: boolean;
}): Promise<ICalFeedBooking[]> {
  const { organizationId, userId, canSeeAllBookings } = params;

  // Bounded window: recent past through ~1 year out.
  const now = new Date();
  const bookingFrom = new Date(now);
  bookingFrom.setMonth(bookingFrom.getMonth() - 1);
  const bookingTo = new Date(now);
  bookingTo.setFullYear(bookingTo.getFullYear() + 1);

  // Members without the "see all bookings" override only get their own bookings,
  // matched by custodian user OR their linked team member (the documented legacy
  // case in getBookingsFilterData where a booking is assigned to the team member
  // but custodianUserId is null). Both halves describe this one member, so they
  // travel together as a single restriction that getBookings ANDs into the
  // query — it can only ever narrow visibility to this member, never widen it.
  let custodianScope: {
    userId: string;
    teamMemberIds: string[];
  } | null = null;
  if (!canSeeAllBookings) {
    custodianScope = await resolveCustodianScope({ userId, organizationId });
    if (!custodianScope.teamMemberIds.length) {
      throw new ShelfError({
        cause: null,
        title: "Team member not found",
        message:
          "You are not part of a team in this organization. Please contact your organization admin to resolve this.",
        label,
        shouldBeCaptured: false,
      });
    }
  }

  try {
    const { bookings } = await getBookings({
      organizationId,
      userId,
      page: 1,
      // Return every matching booking in the window (takeAll ignores perPage).
      // Bounded by the ~13-month window for a single workspace, and the public
      // feed route is rate-limited per feed (calendarFeedRateLimit, keyed by the
      // secret-token path — not by IP, since calendar providers share rotating
      // egress IPs), so this is not an amplification vector. Revisit with
      // windowed pagination only if a workspace ever has an impractically large
      // booking volume.
      takeAll: true,
      // The feed renders rows only; skip the wasted COUNT companion query.
      skipCount: true,
      custodianScope,
      statuses: [
        BookingStatus.RESERVED,
        BookingStatus.ONGOING,
        BookingStatus.OVERDUE,
        BookingStatus.COMPLETE,
      ],
      bookingFrom,
      bookingTo,
      // Assets come through the `bookingAssets` pivot; a tight nested select
      // (title only) overrides getBookings' heavier default assets payload.
      extraInclude: {
        custodianUser: true,
        custodianTeamMember: true,
        bookingAssets: { select: { asset: { select: { title: true } } } },
      },
    });

    // `getBookings`' declared return type is computed from its literal
    // `include`, not the `extraInclude` we pass, so the runtime shape (custodian
    // relations + title-only bookingAssets) is narrower/wider than the static
    // type in ways TS can't reconcile with a direct assertion. Cast through
    // `unknown` — the `extraInclude` above is what actually guarantees the
    // ICalFeedBooking shape at runtime.
    return bookings as unknown as ICalFeedBooking[];
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the bookings for the calendar feed.",
      additionalData: { organizationId, userId },
      label,
    });
  }
}

type AssetWithKitId = Pick<Asset, "id"> & {
  assetKits: { kitId: string }[];
};

export function getKitIdsByAssets(assets: AssetWithKitId[]) {
  // Defensive `?.` on `assetKits` tolerates fixtures / payloads where the
  // pivot relation isn't projected (older mocks, narrower selects).
  const allKitIds = assets
    .map((a) => a.assetKits?.[0]?.kitId)
    .filter((id): id is string => Boolean(id));

  const uniqueKitIds = new Set(allKitIds);

  return [...uniqueKitIds];
}

/**
 * One `BookingAsset` row's kit provenance.
 *
 * Both provenance fields are REQUIRED, deliberately. `getKitIdsByAssets` above
 * tolerates an unprojected relation with a defensive `?.`, which lets a narrow
 * `select` resolve silently to zero kits. Here that silence is the failure mode
 * being designed out: with required props, a caller that forgets to project
 * them is a type error rather than a no-op that leaves a kit stuck.
 */
type BookingSliceKitProvenance = {
  assetId: string;
  assetKitId: string | null;
  sourceKitId: string | null;
};

/**
 * The `AssetKit -> Kit` hop for rows written before `sourceKitId` existed.
 *
 * Shared by the two slice resolvers below so the org-scoped lookup and its
 * deliberate tolerance of a missing row live in one place. Rows carrying
 * `sourceKitId` need no lookup at all, which is why the query is skipped when
 * there are no legacy rows.
 */
async function resolveKitIdByAssetKitId({
  slices,
  organizationId,
  client,
}: {
  slices: Array<{ assetKitId: string | null; sourceKitId: string | null }>;
  organizationId: Organization["id"];
  client: Pick<ExtendedPrismaClient, "assetKit">;
}): Promise<Map<string, string>> {
  // Truthiness rather than `!== null`: test fixtures hand us rows whose
  // provenance columns are absent entirely, and `undefined !== null` is true.
  const legacyAssetKitIds = slices
    .filter((s) => !s.sourceKitId && Boolean(s.assetKitId))
    .map((s) => s.assetKitId as string);

  if (legacyAssetKitIds.length === 0) return new Map();

  // Deliberately not `assertAssetKitsBelongToOrg`: that throws a 400 when a
  // row is missing, and a concurrent detach makes a row legitimately vanish
  // between these two reads — the very operation these resolvers exist for.
  // A missing row means "no kit to release", not "reject the check-in".
  const rows = await client.assetKit.findMany({
    where: { id: { in: legacyAssetKitIds }, organizationId },
    select: { id: true, kitId: true },
  });
  return new Map(rows.map((r) => [r.id, r.kitId]));
}

/**
 * Release-path sibling of {@link getKitIdsByAssets}: resolves kits from the
 * BOOKING's own rows rather than from the assets' current membership.
 *
 * A kit whose member was detached while the booking was live is invisible to
 * membership-based resolution, so nothing releases it and `Kit.status` stays
 * CHECKED_OUT with nothing out. The booking's rows still remember which kit the
 * slice came from, so they can answer where membership cannot.
 *
 * Two legs, mirroring {@link computeBookingKitDrift}: `sourceKitId` is the
 * durable pointer that survives the detach, and `assetKitId` resolved through
 * `AssetKit` is the legacy fallback. Keep both. The
 * "assetKitId non-null implies sourceKitId non-null" invariant is enforced by
 * code alone with no CHECK constraint, and the migration lands before the code,
 * so a rolling deploy can still write a kit-driven row with a NULL
 * `sourceKitId`.
 *
 * Returns kit id to the asset ids this booking took from that kit. That grain
 * answers "which kits did this booking touch", not "which kit does THIS row
 * belong to" — a QUANTITY_TRACKED asset's several rows all collapse to one
 * asset id here. A gate that must keep them apart wants
 * {@link getKitIdsBySlice}.
 *
 * @param client Pass the active `tx` when called inside a transaction.
 *
 * ALWAYS UNION the result with {@link getKitIdsByAssets}, never substitute it.
 * A standalone slice carries no provenance by design even when its asset is a
 * live kit member, and the acquire paths stamp that kit CHECKED_OUT from
 * membership — so provenance alone would leave exactly those kits stuck.
 * Never use on an acquire path: it names kits the asset has already left.
 */
export async function getKitIdsByBookingSlices({
  slices,
  organizationId,
  client = db,
}: {
  slices: BookingSliceKitProvenance[];
  organizationId: Organization["id"];
  client?: Pick<typeof db, "assetKit">;
}): Promise<Map<string, Set<string>>> {
  const kitIdByAssetKitId = await resolveKitIdByAssetKitId({
    slices,
    organizationId,
    client,
  });

  const assetIdsByKitId = new Map<string, Set<string>>();
  for (const slice of slices) {
    const kitId =
      slice.sourceKitId ??
      (slice.assetKitId ? kitIdByAssetKitId.get(slice.assetKitId) : undefined);
    if (!kitId) continue;
    const bucket = assetIdsByKitId.get(kitId) ?? new Set<string>();
    bucket.add(slice.assetId);
    assetIdsByKitId.set(kitId, bucket);
  }

  return assetIdsByKitId;
}

/**
 * One `BookingAsset` row, with everything needed to name the kits it is part
 * of.
 *
 * Every field is REQUIRED for the reason spelled out on
 * {@link BookingSliceKitProvenance}: a caller that forgets to project one is a
 * type error rather than a silent resolution to zero kits. `assetKits` earns
 * that treatment too — dropping it makes every standalone slice look like it
 * belongs to no kit, and the release gate stops seeing it as something a kit
 * still owes.
 */
type BookingSliceKitAttribution = {
  /** `BookingAsset.id` — the grain this resolver answers at. */
  id: string;
  assetKitId: string | null;
  sourceKitId: string | null;
  /** LIVE kit membership of this slice's asset (`Asset.assetKits`). */
  assetKits: { kitId: string }[];
};

/**
 * Slice-grained sibling of {@link getKitIdsByBookingSlices}: the kits a SINGLE
 * `BookingAsset` row is part of.
 *
 * `getKitIdsByBookingSlices` collapses to `kitId -> assetIds`, which answers
 * which kits a booking touches. The release gate asks the other question — does
 * kit K still have something out — and at asset grain that cannot be answered:
 * a QUANTITY_TRACKED asset holds a standalone slice plus one slice per kit it
 * belongs to on the same booking (the two partial uniques on `BookingAsset`),
 * and collapsed to one asset id, returning kit A's slice reads as returning kit
 * B's.
 *
 * A kit-driven slice belongs to exactly the kit it was booked under:
 * `sourceKitId`, the durable pointer that survives a detach, or the
 * `assetKitId -> AssetKit.kitId` hop for rows written before that column. It
 * does NOT belong to its asset's other kits — the slice names its own.
 *
 * A standalone slice carries no provenance by design, so it belongs to its
 * asset's LIVE kits: the acquire paths stamp those CHECKED_OUT from membership
 * ({@link getKitIdsByAssets}), and a release gate that ignored them would let a
 * kit go AVAILABLE with a member's free-pool units still out. This is where the
 * union {@link getKitIdsByBookingSlices}'s callers perform by hand lives
 * instead — per slice, inside the resolver.
 *
 * EVERY live membership counts here, not just the first. `getKitIdsByAssets`
 * reads `assetKits[0]` alone, so the acquire side stamps one kit where an asset
 * sits in several. Taking all of them on the release side can only add
 * obligations, never drop one, and over-release is the worse failure.
 *
 * A sibling rather than a new shape for {@link getKitIdsByBookingSlices}: five
 * of its six callers read `.keys()` only, and both shapes are `Map<string,
 * Set<string>>`, so repointing the value from asset ids to slice ids would
 * compile everywhere and silently redefine what the remaining caller reads.
 *
 * @param client Pass the active `tx` when called inside a transaction.
 *   `Pick<ExtendedPrismaClient, …>` rather than `Pick<typeof db, …>` for the
 *   reason given on `CheckoutRemainingTxClient`: the interactive-tx client does
 *   not reduce to `Prisma.TransactionClient`, but satisfies this structurally.
 * @returns `BookingAsset.id` to the kit ids that slice is part of. A slice
 *   belonging to no kit is absent from the map.
 */
export async function getKitIdsBySlice({
  slices,
  organizationId,
  client = db,
}: {
  slices: BookingSliceKitAttribution[];
  organizationId: Organization["id"];
  client?: Pick<ExtendedPrismaClient, "assetKit">;
}): Promise<Map<string, Set<string>>> {
  const kitIdByAssetKitId = await resolveKitIdByAssetKitId({
    slices,
    organizationId,
    client,
  });

  const kitIdsBySliceId = new Map<string, Set<string>>();
  for (const slice of slices) {
    const kitIds = new Set<string>();
    if (slice.sourceKitId || slice.assetKitId) {
      const kitId =
        slice.sourceKitId ??
        (slice.assetKitId
          ? kitIdByAssetKitId.get(slice.assetKitId)
          : undefined);
      if (kitId) kitIds.add(kitId);
    } else {
      for (const membership of slice.assetKits ?? []) {
        if (membership?.kitId) kitIds.add(membership.kitId);
      }
    }
    if (kitIds.size > 0) kitIdsBySliceId.set(slice.id, kitIds);
  }

  return kitIdsBySliceId;
}

export async function getBookingFlags(
  booking: Pick<Booking, "id" | "from" | "to"> & {
    assetIds: Asset["id"][];
    /**
     * Count of outstanding `BookingModelRequest` rows on this booking.
     * A booking with no concrete `BookingAsset` rows but at least one
     * model-level reservation is still a valid thing to reserve/check
     * out. Without this, the Reserve button stays disabled on pure
     * book-by-model bookings.
     */
    modelRequestCount?: number;
    /** Caller's validated org — scopes the asset lookup (cross-org IDOR guard) */
    organizationId: string;
  }
) {
  const assets = await db.asset.findMany({
    // why: organizationId scoping prevents flag computation from reading
    // assets that belong to another tenant.
    where: {
      id: { in: booking.assetIds },
      organizationId: booking.organizationId,
    },
    // why: `select`, not `include`. This function returns only booleans, so the
    // row shape is private to it — and the previous `include` fetched every
    // Asset scalar plus `category` and `custody` relations that no flag below
    // reads (`hasAssetsInCustody` is derived from `status`, not the relation).
    // On a large booking that payload is paid on every Reserve tap.
    select: {
      id: true,
      type: true,
      status: true,
      availableToBook: true,
      assetKits: { select: { kitId: true } },
      bookingAssets: {
        where: {
          booking: {
            ...(booking.from && booking.to
              ? {
                  id: { not: booking.id }, // Exclude current booking
                  OR: [
                    // Rule 1: RESERVED bookings always conflict
                    {
                      status: "RESERVED",
                      OR: [
                        {
                          from: { lte: booking.to },
                          to: { gte: booking.from },
                        },
                        {
                          from: { gte: booking.from },
                          to: { lte: booking.to },
                        },
                      ],
                    },
                    // Rule 2: ONGOING/OVERDUE bookings (filtered by asset status in logic below)
                    {
                      status: { in: ["ONGOING", "OVERDUE"] },
                      OR: [
                        {
                          from: { lte: booking.to },
                          to: { gte: booking.from },
                        },
                        {
                          from: { gte: booking.from },
                          to: { lte: booking.to },
                        },
                      ],
                    },
                  ],
                }
              : { id: { not: booking.id } }),
          },
        },
        select: {
          booking: {
            select: { id: true, status: true },
          },
        },
      },
    },
  });

  const hasAssets = assets.length > 0;

  const hasUnavailableAssets = assets.some((asset) => !asset.availableToBook);

  /**
   * QUANTITY_TRACKED assets are exempt from the `CHECKED_OUT` /
   * "already booked" conflict flags. For a qty-tracked asset,
   * `Asset.status = CHECKED_OUT` only means at least ONE unit is out
   * somewhere — the rest of the pool is still allocatable. The
   * per-booking quantity availability is enforced at the service layer
   * via `computeBookingAvailableQuantity()` when assets are added /
   * quantities adjusted. Matches the logic in `hasAssetBookingConflicts`
   * which already returns false for qty-tracked.
   */
  const hasCheckedOutAssets = assets.some(
    (asset) =>
      asset.type !== AssetType.QUANTITY_TRACKED &&
      asset.status === AssetStatus.CHECKED_OUT
  );

  const hasAlreadyBookedAssets = assets.some((asset) => {
    if (asset.type === AssetType.QUANTITY_TRACKED) return false;
    if (!asset.bookingAssets || asset.bookingAssets.length === 0) return false;

    return asset.bookingAssets.some((ba) => {
      const conflictingBooking = ba.booking;
      // RESERVED bookings always conflict
      if (conflictingBooking.status === "RESERVED") return true;

      // For ONGOING/OVERDUE bookings, only conflict if asset is actually CHECKED_OUT
      if (
        conflictingBooking.status === "ONGOING" ||
        conflictingBooking.status === "OVERDUE"
      ) {
        return asset.status === AssetStatus.CHECKED_OUT;
      }

      return false;
    });
  });

  // QUANTITY_TRACKED row-level IN_CUSTODY just means *some* units are
  // operator-allocated; the remaining pool is still bookable. Only
  // INDIVIDUAL custody blocks the checkout button. Mirrors the
  // server-side guards in `checkoutBooking`.
  const hasAssetsInCustody = assets.some(
    (asset) =>
      !isQuantityTracked(asset) && asset.status === AssetStatus.IN_CUSTODY
  );

  const hasKits = assets.some((asset) => (asset.assetKits ?? []).length > 0);
  const hasModelRequests = (booking.modelRequestCount ?? 0) > 0;

  return {
    hasAssets,
    hasUnavailableAssets,
    hasCheckedOutAssets,
    hasAlreadyBookedAssets,
    hasAssetsInCustody,
    hasKits,
    hasModelRequests,
  };
}

export async function bulkDeleteBookings({
  bookingIds,
  organizationId,
  userId,
  hints,
  currentSearchParams,
  role,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  userId: User["id"];
  hints: ClientHint;
  currentSearchParams?: string | null;
  /** Caller's effective role — decides whether ownership scoping applies */
  role: OrganizationRoles;
}) {
  try {
    /**
     * Scopes to the filters the user had applied AND to the bookings they are
     * allowed to act on. Without the ownership half, a restricted caller could
     * delete every booking in the workspace with one request.
     */
    const where = getBulkBookingsWhereInput({
      bookingIds,
      organizationId,
      currentSearchParams,
      role,
      userId,
    });

    const [bookings, user] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          ...BOOKING_INCLUDE_FOR_EMAIL,
          bookingAssets: {
            include: {
              asset: {
                select: {
                  id: true,
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
        },
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

    /** If some booking was OVERDUE or ONGOING, we have to make their assets and kits available */
    const overdueOrOngoingBookings = bookings.filter(
      (booking) => booking.status === "OVERDUE" || booking.status === "ONGOING"
    );

    /**
     * Resolved before the transaction opens: the legacy provenance hop is a
     * read, and holding a transaction open across it buys nothing.
     */
    const bulkDeleteSliceKitIds = await getKitIdsByBookingSlices({
      slices: overdueOrOngoingBookings.flatMap((b) => b.bookingAssets),
      organizationId,
    });

    /** We have to cancel scheduler for the bookings */
    const bookingsWithSchedulerReference = bookings.filter(
      (booking) => !!booking.activeSchedulerReference
    );

    await db.$transaction(async (tx) => {
      /** Deleting all selected bookings */
      await tx.booking.deleteMany({
        where: {
          id: { in: bookings.map((booking) => booking.id) },
          organizationId,
        },
      });

      /** Making assets and kits available */
      if (overdueOrOngoingBookings.length > 0) {
        const allAssets = overdueOrOngoingBookings.flatMap((booking) =>
          booking.bookingAssets.map((ba) => ba.asset)
        );

        // Union of live membership and booking-slice provenance — a kit whose
        // member was detached mid-booking is invisible to membership alone.
        const uniqueKitIds = new Set([
          ...getKitIdsByAssets(allAssets),
          ...bulkDeleteSliceKitIds.keys(),
        ]);

        /**
         * Per asset, never a blanket flip. An asset on one of these bookings
         * can also sit on a live booking outside the selection, or be held by
         * a Custody row, and writing AVAILABLE across the set strips those
         * signals — putting an asset someone is still holding back into the
         * pool for anyone to book.
         *
         * Runs after the `deleteMany` above, so the selection's own pivot rows
         * are already gone; passing their ids keeps the exclusion explicit
         * rather than resting on that ordering.
         */
        await reconcileAssetStatusForBookingExit({
          tx,
          assetIds: allAssets.map((asset) => asset.id),
          excludeBookingIds: bookings.map((booking) => booking.id),
          organizationId,
        });

        await tx.kit.updateMany({
          where: { id: { in: [...uniqueKitIds] }, organizationId },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      /** Making notes for all the assets */
      const notesData = bookings
        .map((booking) =>
          booking.bookingAssets.map((ba) => ({
            userId,
            assetId: ba.asset.id,
            content: `**${stripMarkdocDelimiters(
              resolveUserDisplayName(user)
            )}** deleted booking **${stripMarkdocDelimiters(booking.name)}**.`,
            type: "UPDATE" as const,
          }))
        )
        .flat() satisfies Prisma.NoteCreateManyInput[];

      await tx.note.createMany({ data: notesData });
    });

    /** Cancelling scheduler */
    await Promise.all(
      bookingsWithSchedulerReference.map((booking) => cancelScheduler(booking))
    );

    // Resolve notification recipients and send personalized emails for each deleted booking
    for (const b of bookings) {
      const recipients = await getBookingNotificationRecipients({
        booking: b,
        eventType: "DELETE",
        organizationId,
        editorUserId: userId,
      });

      if (recipients.length > 0) {
        const custodian =
          resolveUserDisplayName(b.custodianUser) ||
          b.custodianTeamMember?.name ||
          "";

        await sendBookingEmailToAllRecipients({
          recipients,
          booking: b,
          subject: `🗑️ Booking deleted (${b.name}) - shelf.nu`,
          buildText: (prefs) =>
            deletedBookingEmailContent({
              bookingName: b.name,
              assetsCount: b.bookingAssets.length,
              custodian,
              from: b.from as Date,
              to: b.to as Date,
              bookingId: b.id,
              prefs,
            }),
          buildHeading: () => `Your booking has been deleted: "${b.name}"`,
          hints,
          templateProps: {
            hideViewButton: true,
          },
        });
      }
    }
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk deleting bookings.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { bookingIds, organizationId },
      label,
    });
  }
}

export async function bulkArchiveBookings({
  bookingIds,
  organizationId,
  userId,
  currentSearchParams,
  role,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  /**
   * Optional actor user ID — attributed on the per-booking
   * `BOOKING_ARCHIVED` activity events so reports can surface "who
   * archived these bookings". When absent, events are recorded as
   * system-initiated.
   */
  userId?: User["id"];
  currentSearchParams?: string | null;
  /** Caller's effective role — decides whether ownership scoping applies */
  role: OrganizationRoles;
}) {
  try {
    /**
     * Scopes to the filters the user had applied AND to the bookings they are
     * allowed to act on. Without the ownership half, a restricted caller could
     * delete every booking in the workspace with one request.
     */
    const where = getBulkBookingsWhereInput({
      bookingIds,
      organizationId,
      currentSearchParams,
      role,
      userId,
    });

    const bookings = await db.booking.findMany({
      where,
      select: {
        id: true,
        status: true,
        to: true,
        custodianUserId: true,
        activeSchedulerReference: true,
      },
    });

    /**
     * Archivable = COMPLETE (returned) or a past-due RESERVED booking (a
     * reservation whose window elapsed without checkout). All-or-nothing: if
     * any selected booking is ineligible we reject the whole batch, mirroring
     * the UI which only enables Archive when every selected row qualifies.
     * @see {@link isBookingArchivable}
     */
    const ineligibleBookings = bookings.filter(
      (b) => !isBookingArchivable({ status: b.status, to: b.to })
    );

    if (ineligibleBookings.length > 0) {
      throw new ShelfError({
        cause: null,
        message:
          "Some selected bookings can't be archived. You can only archive completed bookings, or reserved bookings whose end date has passed.",
        label,
        additionalData: {
          bookings: ineligibleBookings,
          organizationId,
          bookingIds,
        },
      });
    }

    /**
     * Bookings archived straight from RESERVED were never checked in — flag them
     * so return-behaviour reports (Booking Compliance) exclude them; COMPLETE
     * bookings keep the default `false`. Two scoped updateMany statements (each
     * atomic on its own, no interactive transaction) so the flag lands only on
     * the never-returned rows.
     *
     * These are plain `db.booking.updateMany` calls, NOT wrapped in an
     * interactive `$transaction` — a prior `$transaction` wrapper here added no
     * atomicity (the per-booking notes below write via the global `db`, not a
     * passed `tx`) and on large selections held the interactive connection open
     * long enough to trip Prisma's 5s default → P2028 (Sentry SHELF-WEBAPP-1KQ). */
    const reservedIds = bookings
      .filter((b) => b.status === BookingStatus.RESERVED)
      .map((b) => b.id);
    const completeIds = bookings
      .filter((b) => b.status === BookingStatus.COMPLETE)
      .map((b) => b.id);

    let archivedCompleteCount = 0;
    if (completeIds.length > 0) {
      const { count } = await db.booking.updateMany({
        // status guard: only rows still COMPLETE are archived, in case one was
        // transitioned between the findMany above and this write.
        where: {
          id: { in: completeIds },
          organizationId,
          status: BookingStatus.COMPLETE,
        },
        data: { status: BookingStatus.ARCHIVED },
      });
      archivedCompleteCount = count;
    }

    let archivedReservedCount = 0;
    if (reservedIds.length > 0) {
      const { count } = await db.booking.updateMany({
        // status guard: a reservation checked out between the findMany above and
        // this write is no longer RESERVED, so it is skipped — its now
        // checked-out assets keep their active booking (no orphaned custody).
        where: {
          id: { in: reservedIds },
          organizationId,
          status: BookingStatus.RESERVED,
        },
        data: { status: BookingStatus.ARCHIVED, archivedWithoutCheckin: true },
      });
      archivedReservedCount = count;
    }

    /**
     * Reconcile the follow-up writes (activity events, transition notes,
     * scheduler cleanup) against the rows the status-guarded updateMany
     * ACTUALLY flipped — not the rows originally fetched. If a booking's status
     * changed between the findMany and the guarded write (e.g. a RESERVED
     * booking was checked out mid-batch), its row is skipped by the guard;
     * without this we'd log a phantom "archived" note + BOOKING_ARCHIVED event
     * for a booking that is still ONGOING, and cancel a scheduler it still
     * needs. Every eligible booking is COMPLETE or past-due RESERVED (asserted
     * above), so the candidate count equals `bookings.length`; when the archived
     * count matches, no row was skipped and we reuse `bookings` without an extra
     * read. Only the rare concurrent-transition case pays the reconciling query.
     */
    const archivedCount = archivedCompleteCount + archivedReservedCount;
    let archivedBookings = bookings;
    if (archivedCount !== completeIds.length + reservedIds.length) {
      const archivedRows = await db.booking.findMany({
        where: {
          id: { in: bookings.map((b) => b.id) },
          organizationId,
          status: BookingStatus.ARCHIVED,
        },
        select: { id: true },
      });
      const archivedIds = new Set(archivedRows.map((b) => b.id));
      archivedBookings = bookings.filter((b) => archivedIds.has(b.id));
    }

    /**
     * One BOOKING_ARCHIVED activity event per booking ACTUALLY archived —
     * parity with the single `archiveBooking` path so reports counting
     * BOOKING_ARCHIVED treat bulk + single archival identically. Best-effort:
     * the updateMany already committed, so a recordEvents failure can't undo it.
     * `recordEvents([])` is a no-op, so an all-skipped batch writes nothing. */
    await recordEvents(
      archivedBookings.map((booking) => ({
        organizationId,
        actorUserId: userId ?? null,
        action: "BOOKING_ARCHIVED" as const,
        entityType: "BOOKING" as const,
        entityId: booking.id,
        bookingId: booking.id,
      }))
    );

    /** Create booking status transition notes for each archived booking.
     *
     * Done AFTER the status update, NOT inside an interactive transaction:
     * `createStatusTransitionNote` writes via the global `db` (not a passed
     * `tx`), so the previous `$transaction` never made these notes atomic with
     * the status change. It only held the interactive-tx connection open across
     * N sequential note writes, which on large selections blew past Prisma's
     * 5s default and aborted the commit with P2028 (Sentry SHELF-WEBAPP-1KQ). */
    for (const booking of archivedBookings) {
      await createStatusTransitionNote({
        bookingId: booking.id,
        organizationId,
        fromStatus: booking.status,
        toStatus: BookingStatus.ARCHIVED,
        userId,
        custodianUserId: booking.custodianUserId || undefined,
      });
    }

    /** Cancel active schedulers only for the bookings actually archived. */
    await Promise.all(archivedBookings.map((b) => cancelScheduler(b)));
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Something went wrong while archiving bookings.",
      additionalData: isShelfError
        ? cause.additionalData
        : {
            bookingIds,
            organizationId,
          },
      label,
    });
  }
}

export async function bulkCancelBookings({
  bookingIds,
  organizationId,
  userId,
  hints,
  currentSearchParams,
  role,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  userId: User["id"];
  hints: ClientHint;
  currentSearchParams?: string | null;
  /** Caller's effective role — decides whether ownership scoping applies */
  role: OrganizationRoles;
}) {
  try {
    /**
     * Scopes to the filters the user had applied AND to the bookings they are
     * allowed to act on. Without the ownership half, a restricted caller could
     * delete every booking in the workspace with one request.
     */
    const where = getBulkBookingsWhereInput({
      bookingIds,
      organizationId,
      currentSearchParams,
      role,
      userId,
    });

    const [bookings, user] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          ...BOOKING_INCLUDE_FOR_EMAIL,
          bookingAssets: {
            include: {
              asset: {
                select: {
                  id: true,
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
        },
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

    /** Bookings with any of these statuses cannot be cancelled */
    const unavailableBookingStatus: BookingStatus[] = [
      BookingStatus.ARCHIVED,
      BookingStatus.CANCELLED,
      BookingStatus.COMPLETE,
      BookingStatus.DRAFT,
    ];

    const someUnavailableToCancelBookings = bookings.some((b) =>
      unavailableBookingStatus.includes(b.status)
    );

    if (someUnavailableToCancelBookings) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable to cancel booking selected. Please make sure you are selecting the booking which are allowed to cancel.",
        label,
        additionalData: {
          bookings,
          organizationId,
          bookingIds,
        },
      });
    }

    /** We have to make all the assets and kits available if the booking as ongoing or overdue */
    const ongoingOrOverdueBookings = bookings.filter(
      (b) => b.status === "ONGOING" || b.status === "OVERDUE"
    );

    /**
     * Resolved before the transaction opens: the legacy provenance hop is a
     * read, and holding a transaction open across it buys nothing.
     */
    const bulkCancelSliceKitIds = await getKitIdsByBookingSlices({
      slices: ongoingOrOverdueBookings.flatMap((b) => b.bookingAssets),
      organizationId,
    });

    /** We have to cancel scheduler for the bookings */
    const bookingsWithSchedulerReference = bookings.filter(
      (booking) => !!booking.activeSchedulerReference
    );

    await db.$transaction(async (tx) => {
      /** Updating status of bookings to CANCELLED */
      await tx.booking.updateMany({
        where: { id: { in: bookings.map((b) => b.id) }, organizationId },
        data: { status: BookingStatus.CANCELLED },
      });

      /** Updating status of assets and kits  */
      if (ongoingOrOverdueBookings.length > 0) {
        const allAssets = ongoingOrOverdueBookings.flatMap((b) =>
          b.bookingAssets.map((ba) => ba.asset)
        );
        // Union of live membership and booking-slice provenance — a kit whose
        // member was detached mid-booking is invisible to membership alone.
        const uniqueKitIds = new Set([
          ...getKitIdsByAssets(allAssets),
          ...bulkCancelSliceKitIds.keys(),
        ]);

        /**
         * Per asset, never a blanket flip. An asset on one of these bookings
         * can also sit on a live booking outside the selection, or be held by
         * a Custody row, and writing AVAILABLE across the set strips those
         * signals — putting an asset someone is still holding back into the
         * pool for anyone to book.
         *
         * Runs after the status write above, so the selection is already
         * CANCELLED and out of the ONGOING/OVERDUE count; passing the ids keeps
         * the exclusion explicit rather than resting on that ordering.
         */
        await reconcileAssetStatusForBookingExit({
          tx,
          assetIds: allAssets.map((a) => a.id),
          excludeBookingIds: bookings.map((b) => b.id),
          organizationId,
        });

        /** Making kits available */
        await tx.kit.updateMany({
          where: { id: { in: [...uniqueKitIds] }, organizationId },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      /** Making notes for all the assets */
      const actor = wrapUserLinkForNote({ ...user, id: userId });
      const notesData = bookings
        .map((b) =>
          b.bookingAssets.map((ba) => ({
            assetId: ba.asset.id,
            content: `${actor} cancelled booking.`,
            userId,
            type: "UPDATE" as const,
          }))
        )
        .flat() satisfies Prisma.NoteCreateManyInput[];

      await tx.note.createMany({ data: notesData });

      /** Create booking status transition notes for each booking */
      for (const booking of bookings) {
        await createStatusTransitionNote({
          bookingId: booking.id,
          organizationId,
          fromStatus: booking.status,
          toStatus: BookingStatus.CANCELLED,
          userId,
          custodianUserId: booking.custodianUserId || undefined,
        });
      }

      /**
       * Per-booking lifecycle event — mirrors the single
       * `cancelBooking` emission so reports treat bulk + single
       * cancellation identically. Inside the same tx so a rollback
       * wipes both the status flips and the events together. The bulk
       * path has no per-booking cancellation reason, so `meta` is
       * omitted (the single-cancel path includes it when supplied).
       */
      await recordEvents(
        bookings.map((booking) => ({
          organizationId,
          actorUserId: userId,
          action: "BOOKING_CANCELLED" as const,
          entityType: "BOOKING" as const,
          entityId: booking.id,
          bookingId: booking.id,
        })),
        tx
      );
    });

    /** Cancelling scheduler */
    await Promise.all(
      bookingsWithSchedulerReference.map((booking) => cancelScheduler(booking))
    );

    // Resolve notification recipients and send personalized cancellation emails
    for (const b of bookings) {
      const recipients = await getBookingNotificationRecipients({
        booking: b,
        eventType: "CANCEL",
        organizationId,
        editorUserId: userId,
      });

      if (recipients.length > 0) {
        const custodian =
          resolveUserDisplayName(b.custodianUser) ||
          b.custodianTeamMember?.name ||
          "";

        await sendBookingEmailToAllRecipients({
          recipients,
          booking: b,
          subject: `❌ Booking cancelled (${b.name}) - shelf.nu`,
          buildText: (prefs) =>
            cancelledBookingEmailContent({
              bookingName: b.name,
              assetsCount: b._count.bookingAssets,
              custodian,
              from: b.from as Date,
              to: b.to as Date,
              bookingId: b.id,
              prefs,
              customEmailFooter: b.organization.customEmailFooter,
            }),
          buildHeading: () => `Your booking has been cancelled: "${b.name}"`,
          hints,
        });
      }
    }
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Something went wrong while bulk cancelling bookings.",
      additionalData: isShelfError
        ? cause.additionalData
        : { bookingIds, organizationId, userId },
      label,
    });
  }
}

/**
 * Helper function to create booking notes and asset notes for scanned assets and kits
 */
async function createNotesForScannedAssetsAndKits({
  booking,
  assetIds,
  kitIds,
  organizationId,
  userId,
}: {
  booking: { id: string; name: string };
  assetIds: string[];
  kitIds: string[];
  organizationId: string;
  userId: string;
}) {
  // Fetch assets and kits in parallel for better performance.
  // type+unitOfMeasure widen the select so per-asset notes can prefix
  // a qty-tracked unit count via wrapAssetWithCountForNote.
  const [assets, kits, bookedRows] = await Promise.all([
    db.asset.findMany({
      where: { id: { in: assetIds }, organizationId },
      select: {
        id: true,
        title: true,
        type: true,
        unitOfMeasure: true,
      },
    }),
    kitIds.length > 0
      ? db.kit.findMany({
          where: { id: { in: kitIds }, organizationId },
          select: {
            id: true,
            name: true,
            assetKits: { select: { assetId: true } },
          },
        })
      : Promise.resolve([]),
    // Snapshot the BookingAsset rows that were just persisted for this
    // call's asset ids — used to source per-asset booked quantity for
    // the asset-timeline notes below (sum across slices for the same
    // asset on this booking).
    assetIds.length > 0
      ? db.bookingAsset.findMany({
          where: { bookingId: booking.id, assetId: { in: assetIds } },
          select: { assetId: true, quantity: true },
        })
      : Promise.resolve([] as Array<{ assetId: string; quantity: number }>),
  ]);

  // Per-asset booked quantity (sum across all matching slices). Feeds the
  // qty-tracked "added N units of {asset}" phrasing; INDIVIDUAL is unchanged.
  const bookedQtyByAssetId = new Map<string, number>();
  for (const row of bookedRows) {
    bookedQtyByAssetId.set(
      row.assetId,
      (bookedQtyByAssetId.get(row.assetId) ?? 0) + row.quantity
    );
  }
  const assetById = new Map(assets.map((a) => [a.id, a]));

  // Create a map of asset ID to kit name for assets that came from kits
  const assetIdToKitName = new Map<string, string>();
  kits.forEach((kit) => {
    kit.assetKits.forEach((ak) => {
      assetIdToKitName.set(ak.assetId, kit.name);
    });
  });

  // Separate standalone assets from kit assets for booking notes
  const standaloneAssetIds = assetIds.filter((id) => !assetIdToKitName.has(id));
  const standaloneAssets = assets.filter((asset) =>
    standaloneAssetIds.includes(asset.id)
  );

  // Get user info for note attribution
  const user = await getUserByID(userId, {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
    } satisfies Prisma.UserSelect,
  });
  const userForNotes = { ...user, id: userId };

  // Create booking notes
  // why: out of this rule — multi-asset popover, per-asset qty deferred.
  // These booking-level summary notes use the popover; per-asset qty
  // surfaces on the asset-timeline notes below.
  const hasKits = kits.length > 0;
  const hasAssets = standaloneAssets.length > 0;

  if (hasKits && hasAssets) {
    // Both kits and assets added - create combined booking note
    const kitContent = wrapKitsWithDataForNote(
      kits.map((kit) => ({ id: kit.id, name: kit.name })),
      "added"
    );
    const assetContent = wrapAssetsWithDataForNote(standaloneAssets, "added");

    await createSystemBookingNote({
      bookingId: booking.id,
      organizationId,
      content: `${wrapUserLinkForNote(
        userForNotes
      )} added ${kitContent} and ${assetContent} to booking.`,
    });
  } else if (hasKits) {
    // Only kits added - create booking note
    const kitContent = wrapKitsWithDataForNote(
      kits.map((kit) => ({ id: kit.id, name: kit.name })),
      "added"
    );

    await createSystemBookingNote({
      bookingId: booking.id,
      organizationId,
      content: `${wrapUserLinkForNote(
        userForNotes
      )} added ${kitContent} to booking.`,
    });
  } else if (hasAssets) {
    // Only assets added - create booking note
    const assetContent = wrapAssetsWithDataForNote(standaloneAssets, "added");

    await createSystemBookingNote({
      bookingId: booking.id,
      organizationId,
      content: `${wrapUserLinkForNote(
        userForNotes
      )} added ${assetContent} to booking.`,
    });
  }

  // Create notes on assets themselves with dynamic messages
  const bookingLink = wrapLinkForNote(`/bookings/${booking.id}`, booking.name);

  // Group assets by whether they came from a kit or not
  const standaloneAssetIdsSet = new Set(standaloneAssetIds);
  const kitAssetIds = assetIds.filter((id) => !standaloneAssetIdsSet.has(id));

  // Create notes for standalone assets — one per asset so qty-tracked
  // can carry its own unit count ("added 50 units of {asset} to
  // {booking}"). INDIVIDUAL renders the bare asset link, so the legacy
  // "added asset to {booking}" wording is preserved byte-for-byte.
  if (standaloneAssetIds.length > 0) {
    for (const assetId of standaloneAssetIds) {
      const asset = assetById.get(assetId);
      const qty = bookedQtyByAssetId.get(assetId);
      // Only switch to the qty-aware phrasing when we have title+type;
      // otherwise fall back to the legacy "added asset to {booking}" so
      // the byte-for-byte INDIVIDUAL contract is preserved when the
      // asset metadata fetch returns only ids.
      const content =
        asset?.title && asset?.type
          ? `${wrapUserLinkForNote(
              userForNotes
            )} added ${wrapAssetWithCountForNote(
              asset,
              qty
            )} to ${bookingLink}.`
          : `${wrapUserLinkForNote(
              userForNotes
            )} added asset to ${bookingLink}.`;
      await createNotes({
        content,
        type: "UPDATE",
        userId,
        assetIds: [assetId],
        organizationId,
      });
    }
  }

  // Create notes for assets added via kits (grouped by kit; one note per
  // asset so qty-tracked rows can prefix their unit count).
  if (kitAssetIds.length > 0) {
    // Group asset IDs by kit name
    const assetsByKit = new Map<string, string[]>();
    kitAssetIds.forEach((assetId) => {
      const kitName = assetIdToKitName.get(assetId);
      if (kitName) {
        if (!assetsByKit.has(kitName)) {
          assetsByKit.set(kitName, []);
        }
        assetsByKit.get(kitName)!.push(assetId);
      }
    });

    // Create notes for each kit's assets
    for (const [kitName, kitAssetIds] of assetsByKit.entries()) {
      const kit = kits.find((k) => k.name === kitName);
      if (kit) {
        const kitLink = wrapLinkForNote(`/kits/${kit.id}`, kit.name);
        for (const assetId of kitAssetIds) {
          const asset = assetById.get(assetId);
          const qty = bookedQtyByAssetId.get(assetId);
          // Same fallback guard as the standalone branch above.
          const content =
            asset?.title && asset?.type
              ? `${wrapUserLinkForNote(
                  userForNotes
                )} added ${wrapAssetWithCountForNote(
                  asset,
                  qty
                )} via ${kitLink} to ${bookingLink}.`
              : `${wrapUserLinkForNote(
                  userForNotes
                )} added asset via ${kitLink} to ${bookingLink}.`;
          await createNotes({
            content,
            type: "UPDATE",
            userId,
            assetIds: [assetId],
            organizationId,
          });
        }
      }
    }
  }
}

/**
 * Transaction-body helper shared by {@link addScannedAssetsToBooking} and
 * {@link fulfilModelRequestsAndCheckout}.
 *
 * Performs the pure write-side of "add scanned assets":
 *   1. Calls {@link fulfilModelRequestsForAssets} so any outstanding
 *      `BookingModelRequest` for a scanned asset's model is decremented.
 *      `updateBookingAssets` calls the same helper, so scanning and picking
 *      from a list discharge reservations identically. Failures here roll the
 *      whole transaction back — the caller never ends up with concrete
 *      `BookingAsset` rows alongside a stale request count.
 *   2. Creates the `BookingAsset` rows on the booking, stamping
 *      `bookingModelRequestId` on the row that discharged each reservation.
 *   3. If the booking is already ONGOING/OVERDUE, syncs the newly added
 *      asset + kit rows to CHECKED_OUT status so they reflect reality.
 *
 * This extraction exists so `fulfilModelRequestsAndCheckout` can run this
 * logic inside the SAME transaction as the subsequent checkout body,
 * guaranteeing atomicity: if availability validation fails after
 * materialisation, all the scanned writes roll back together. The
 * externally-exported `addScannedAssetsToBooking` wraps this helper in its
 * own `$transaction` and adds post-commit activity notes, preserving its
 * contract byte-for-byte.
 *
 * @param tx - Prisma transaction client (must be a real `$transaction` tx)
 * @param args.assetIds - IDs of directly-scanned (standalone) assets to add
 * @param args.kitSlices - Kit-driven slice specs (one per AssetKit membership)
 * @param args.kitIds - Optional kit IDs. Retained on the contract for callers; no longer read here (assets are added AVAILABLE — progressive checkout — so there is no kit status to sync at add time).
 * @param args.bookingId - Booking being modified
 * @param args.organizationId - Organization scope for the booking + assets
 * @param args.userId - User performing the scan (attributed on materialized logs)
 * @returns `{ id, name, status }` of the updated booking
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function addScannedAssetsToBookingWithinTx(
  tx: any,
  {
    assetIds,
    bookingId,
    organizationId,
    userId,
    quantities = {},
    kitSlices = [],
  }: {
    /** Directly-scanned (standalone) asset IDs — written with `assetKitId = null`. */
    assetIds: Asset["id"][];
    /**
     * Optional kit IDs. Retained on the contract for callers, but no longer
     * read here: assets are added AVAILABLE (progressive checkout), so there is
     * no kit status to sync at add time.
     */
    kitIds?: string[];
    bookingId: Booking["id"];
    organizationId: Booking["organizationId"];
    userId: string;
    /**
     * Per-asset quantity for standalone QUANTITY_TRACKED scans. Missing
     * entries fall back to `BookingAsset.quantity`'s schema default (1)
     * — keeps callers that don't supply quantities (mobile, fulfil
     * flow) working unchanged.
     */
    quantities?: Record<Asset["id"], number>;
    /**
     * Kit-driven slice specs — one element per `AssetKit` membership
     * scanned (the drawer resolves the `AssetKit.id` for each member of
     * a scanned kit's QR). Each spec produces a `BookingAsset` row with
     * `assetKitId` set so the booking UI groups it under the kit. An
     * asset scanned via TWO kits yields TWO slices (distinct
     * `assetKitId`), each a legal row under the `(bookingId, assetKitId)`
     * partial unique. The slice's quantity defaults to the kit's
     * `AssetKit.quantity` when omitted.
     */
    kitSlices?: ScannedKitSliceSpec[];
  }
) {
  // The deduped union of standalone + kit-slice asset ids. Model-request
  // materialisation, events, and status flips operate on this set so a
  // kit-only scan still materialises requests and records events for its
  // member assets.
  const allScannedAssetIds = Array.from(
    new Set([...assetIds, ...kitSlices.map((s) => s.assetId)])
  );

  // Cross-org guards (request-supplied ids). The materialisation loop
  // below silently skips assets it can't find in-org, and the
  // `bookingAssets.create` would otherwise create rows for any globally-
  // existing id (FK satisfied) — so prove BOTH the asset ids and the
  // kit-slice assetKitIds belong to this org BEFORE any writes, throwing
  // (not silently dropping) on a foreign id. Mirrors the count-guard
  // `updateBookingAssets` performs.
  await assertAssetsBelongToOrg(
    { assetIds: allScannedAssetIds, organizationId },
    tx
  );
  await assertAssetKitsBelongToOrg(
    // Filter falsy ids: the kit-qty resolution below (line ~7557) already
    // tolerates slices with no assetKitId, so the guard must too — otherwise
    // a non-kit slice would surface a confusing "Invalid kits" 400.
    {
      assetKitIds: kitSlices.map((s) => s.assetKitId).filter(Boolean),
      organizationId,
    },
    tx
  );

  // This path had NO booking-status check anywhere — not in the route action,
  // not here. The scan-assets loader computes `canUserManageBookingAssets`,
  // but that only decides what to render, so a direct POST could add assets to
  // a COMPLETE, ARCHIVED or CANCELLED booking. (detail.dev D097)
  //
  // Locked rather than merely re-read: this runs inside the caller's
  // transaction, and a plain SELECT there takes no lock under READ COMMITTED.
  const scanTargetStatus = await lockBookingForStatusCheck(
    tx,
    bookingId,
    organizationId
  );
  assertBookingIsOpen({
    status: scanTargetStatus,
    operation: "add scanned items to",
    bookingId,
  });

  /**
   * Conflict guard (mirrors the reserve/checkout guards): reject the add
   * when any scanned asset (standalone OR kit-driven) is already RESERVED
   * or CHECKED_OUT on a DIFFERENT booking whose window OVERLAPS this
   * booking's from/to. Runs inside the same tx as the writes below so the
   * read-then-write is atomic against concurrent reservations.
   *
   * Adapted from the main-side guard that previously lived inline in
   * `addScannedAssetsToBooking` (resolved during 2026-06-25 merge): we
   * already have `allScannedAssetIds` (union of standalone + kit-driven),
   * so we skip main's `tx.asset.findMany({where: {kitId: ...}})` expansion
   * — pre-pivot main relied on `Asset.kitId`, which Phase 4a removed.
   */
  if (allScannedAssetIds.length > 0) {
    const conflictBooking = await tx.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { from: true, to: true },
    });

    if (conflictBooking?.from && conflictBooking?.to) {
      const candidates = await tx.asset.findMany({
        where: { id: { in: allScannedAssetIds }, organizationId },
        select: {
          id: true,
          title: true,
          status: true,
          // Post-Phase-3a: bookings reach assets through the BookingAsset
          // pivot. `hasAssetBookingConflicts` reads `asset.bookingAssets`
          // (not `asset.bookings`) — the conflict-conditions helper now
          // returns `Prisma.Asset$bookingAssetsArgs` accordingly.
          bookingAssets: {
            ...createBookingConflictConditions({
              currentBookingId: bookingId,
              fromDate: conflictBooking.from,
              toDate: conflictBooking.to,
            }),
            select: {
              booking: { select: { id: true, status: true } },
            },
          },
        },
      });

      // Typed locally because `tx` is `any` (the dynamic extended Prisma
      // client's tx type doesn't reduce to `Prisma.TransactionClient`).
      type ConflictCandidate = {
        id: string;
        title: string;
        status: string;
        bookingAssets: Array<{ booking: { id: string; status: string } }>;
      };
      const conflicted = (candidates as ConflictCandidate[]).filter((asset) =>
        hasAssetBookingConflicts(asset, bookingId)
      );

      if (conflicted.length > 0) {
        const conflictedNames = conflicted
          .slice(0, 3)
          .map((asset) => asset.title)
          .join(", ");
        const additionalCount =
          conflicted.length > 3 ? conflicted.length - 3 : 0;
        const additionalText =
          additionalCount > 0 ? ` and ${additionalCount} more` : "";

        throw new ShelfError({
          cause: null,
          label,
          title: "Booking conflict",
          message: `Cannot add to booking. Some assets are already booked or checked out for an overlapping period: ${conflictedNames}${additionalText}. Please remove them and try again.`,
          status: 400,
          shouldBeCaptured: false,
        });
      }
    }
  }

  /**
   * Pre-fetch metadata for the scanned assets so we can run the
   * model-request materialization loop — each scanned asset that
   * matches an outstanding `BookingModelRequest` for its model
   * decrements that request. Assets without a matching request (or
   * with no model at all) fall through to the "direct BookingAsset
   * create" path below.
   *
   * Uses the tx client so the read participates in the same
   * snapshot as the writes that follow.
   */
  // Shape pinned explicitly because `tx` is typed `any` (extended Prisma
  // client tx type is incompatible with `Prisma.TransactionClient`).
  // `unitOfMeasure` widens the select so BOOKING_ASSETS_ADDED events
  // emitted below can carry `meta.quantity` for QUANTITY_TRACKED assets
  // (no-op for INDIVIDUAL).
  type ScannedAssetMeta = Pick<
    Asset,
    "id" | "title" | "type" | "assetModelId" | "unitOfMeasure"
  >;
  const scannedAssetsMeta: ScannedAssetMeta[] =
    allScannedAssetIds.length > 0
      ? await tx.asset.findMany({
          where: { id: { in: allScannedAssetIds }, organizationId },
          select: {
            id: true,
            title: true,
            type: true,
            assetModelId: true,
            unitOfMeasure: true,
          },
        })
      : [];
  const scannedAssetsMetaById = new Map<string, ScannedAssetMeta>(
    scannedAssetsMeta.map((a) => [a.id, a])
  );

  /**
   * Which scanned assets already hold a STANDALONE row on this booking.
   *
   * Same rule as `updateBookingAssets`: a reservation promises LOOSE units, so
   * only a NEW standalone row discharges one. Passing every scanned id let the
   * same reservation be discharged twice for one physical asset — scan a kit
   * whose member is a match (kit row, 1 of 2), then scan that member's own QR
   * (standalone row). The two partial uniques let both rows coexist, so it
   * decremented again to 2/2, the check-out guard passed, and the booking left
   * with one camera where two were promised. The mobile
   * `bookings.add-scanned-assets` endpoint reaches this same code, so it was
   * reachable from the app too.
   */
  const preExistingStandaloneRows: { assetId: string; quantity: number }[] =
    allScannedAssetIds.length > 0
      ? await tx.bookingAsset.findMany({
          where: {
            bookingId,
            assetId: { in: allScannedAssetIds },
            assetKitId: null,
          },
          // `quantity` feeds the availability guard below: what this booking
          // will hold after the scan is what competes for the pool, and its
          // own existing rows are excluded from `bookable`.
          select: { assetId: true, quantity: true },
        })
      : [];

  const preExistingStandaloneScannedIds = new Set<string>(
    preExistingStandaloneRows.map((row) => row.assetId)
  );

  /**
   * Quantity-tracked standalone scans draw on the shared pool, and nothing
   * above measures it: the conflict guard is INDIVIDUAL semantics — one asset
   * can be in one booking at a time — whereas a quantity-tracked asset
   * legitimately sits in many at once, bounded only by the sum of their
   * quantities. Without this the same units can be promised twice.
   *
   * Kit slices are deliberately excluded, matching `updateBookingAssets`: a
   * kit-driven row is committed to its kit and bounded on the separate kit
   * axis, not the loose pool.
   */
  const qtScannedAssetIds = [
    ...new Set(
      assetIds.filter(
        (assetId) =>
          scannedAssetsMetaById.get(assetId)?.type ===
          AssetType.QUANTITY_TRACKED
      )
    ),
  ];

  if (qtScannedAssetIds.length > 0) {
    const bookingWindow = await tx.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { from: true, to: true },
    });

    const preExistingQtyByAssetId = new Map<string, number>(
      preExistingStandaloneRows.map((row) => [row.assetId, row.quantity])
    );

    // Sorted so two transactions touching the same assets acquire them in
    // one global order and cannot deadlock by taking them in opposite ones.
    // Mirrors `updateBookingAssets` and the checkout guard.
    for (const assetId of [...qtScannedAssetIds].sort()) {
      await lockAssetForQuantityUpdate(tx, assetId, organizationId);
    }

    await assertAssetQuantitiesAvailable(
      qtScannedAssetIds.map((assetId) => {
        const meta = scannedAssetsMetaById.get(assetId);
        return {
          assetId,
          // `bookable` excludes this booking, so the figure measured against
          // it is everything this booking will hold once the scan lands —
          // the units already on it plus the ones being added now.
          requestedQuantity:
            (preExistingQtyByAssetId.get(assetId) ?? 0) +
            (quantities[assetId] ?? 1),
          assetTitle: meta?.title ?? "",
          unitOfMeasure: meta?.unitOfMeasure,
        };
      }),
      {
        organizationId,
        tx,
        window:
          bookingWindow?.from && bookingWindow?.to
            ? { from: bookingWindow.from, to: bookingWindow.to }
            : null,
        excludeBookingId: bookingId,
      }
    );
  }

  /**
   * Provenance for the rows created below: which reservation each asset
   * discharged. At most one request per asset, incremented by exactly one
   * unit, so exactly ONE of the rows created for that asset may carry the
   * stamp — see the `stampedAssetIds` guard at the create site.
   *
   * Candidates are the standalone scans only (`assetIds`), minus any that
   * already have a standalone row. Kit slices are excluded: a kit-driven row
   * is committed to its kit, not a loose unit, and
   * `BookingAsset.bookingModelRequestId` is documented as null for assets
   * pulled in via a kit.
   *
   * Assets missing from `scannedAssetsMetaById` aren't in this org; they are
   * skipped here and rejected by the FK on the create below.
   */
  const modelRequestIdByAssetId = await fulfilModelRequestsForAssets({
    bookingId,
    assets: [...new Set(assetIds)]
      .filter((assetId) => !preExistingStandaloneScannedIds.has(assetId))
      .map((assetId) => scannedAssetsMetaById.get(assetId))
      .filter((meta): meta is ScannedAssetMeta => meta !== undefined),
    organizationId,
    userId,
    tx,
  });

  /**
   * Resolve the slice quantity for kit-driven scans. When a kit QR is
   * scanned, the drawer attributes each member to its `AssetKit` via
   * `kitSlices` but may not pass an explicit slice quantity — so a
   * QUANTITY_TRACKED member would otherwise default to 1 instead of the
   * kit's `AssetKit.quantity` (e.g. 33 batteries booked as 1). Fetch
   * the AssetKit rows for the referenced ids and use their quantity as
   * the fallback. An explicit `slice.quantity` (when the caller already
   * resolved it) still wins.
   *
   * The same rows also give us the authoritative owning `kitId` for
   * `BookingAsset.sourceKitId` at no extra round-trip. We prefer it over the
   * client-supplied `slice.kitId` on purpose: `assetKitId` has already been
   * proven in-org by `assertAssetKitsBelongToOrg` above, whereas `kitId`
   * arrives straight from the scan drawer's JSON payload and is written to a
   * column whose FK accepts ANY kit — including another org's.
   */
  const referencedAssetKitIds = Array.from(
    new Set(kitSlices.map((s) => s.assetKitId).filter(Boolean))
  );
  const assetKitById = new Map<string, { quantity: number; kitId: string }>(
    referencedAssetKitIds.length > 0
      ? (
          await tx.assetKit.findMany({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `referencedAssetKitIds` come from the org-scoped booking assets loaded earlier in this flow
            where: { id: { in: referencedAssetKitIds } },
            select: { id: true, quantity: true, kitId: true },
          })
        ).map((ak: { id: string; quantity: number; kitId: string }) => [
          ak.id,
          { quantity: ak.quantity, kitId: ak.kitId },
        ])
      : []
  );

  /**
   * Assets whose stamp has already been spent. One matched request unit means
   * exactly one stamped row: an asset arriving as a standalone scan AND via
   * two kits creates three rows but discharged a single unit, so stamping all
   * three would make "which assets fulfilled this reservation?" over-count by
   * two.
   *
   * Only the STANDALONE row is ever eligible — a kit-driven row is committed
   * to its kit rather than being a loose unit, and only standalone arrivals
   * are handed to `fulfilModelRequestsForAssets` above, so a kit slice could
   * never legitimately carry a stamp anyway.
   */
  const stampedAssetIds = new Set<string>();

  /** Consumes the stamp for `assetId`, returning it at most once. */
  function takeModelRequestId(assetId: string): string | null {
    if (stampedAssetIds.has(assetId)) return null;
    const requestId = modelRequestIdByAssetId.get(assetId);
    if (!requestId) return null;
    stampedAssetIds.add(assetId);
    return requestId;
  }

  const booking = await tx.booking.update({
    where: { id: bookingId, organizationId },
    data: {
      bookingAssets: {
        // One row per standalone scan + one row per kit slice. An asset
        // scanned via TWO kits yields TWO kit-driven rows with distinct
        // `assetKitId`; the standalone bucket stays independent of an
        // asset's incidental kit memberships.
        create: [
          // Standalone scans: `assetKitId = null`. Quantity precedence:
          // explicit per-row qty input → 1 (schema default).
          ...assetIds.map((id) => ({
            assetId: id,
            quantity: quantities[id] ?? 1,
            assetKitId: null,
            // No kit provenance for a standalone scan — kept explicit so the
            // "assetKitId null ⇔ sourceKitId null" invariant reads locally.
            sourceKitId: null,
            bookingModelRequestId: takeModelRequestId(id),
          })),
          // Kit-driven slices: `assetKitId` set, plus `sourceKitId` — the
          // durable owning-kit pointer that survives the membership row's
          // deletion. Quantity precedence: explicit slice qty → kit's
          // `AssetKit.quantity` → 1.
          //
          // Kit precedence: the org-validated `AssetKit.kitId` ALWAYS wins;
          // `slice.kitId` is only a fallback. `||` (not `??`) because a
          // pre-deploy client that never learned to send `kitId` arrives as
          // the empty string — writing that would violate the FK, so it
          // normalizes to NULL. Both falling through is unreachable: a missing
          // `AssetKit` row means `assetKitId` below fails the FK first.
          ...kitSlices.map((slice) => ({
            assetId: slice.assetId,
            quantity:
              slice.quantity ??
              assetKitById.get(slice.assetKitId)?.quantity ??
              1,
            assetKitId: slice.assetKitId,
            sourceKitId:
              assetKitById.get(slice.assetKitId)?.kitId || slice.kitId || null,
            // Never stamped: a kit-driven row does not discharge a reservation.
            bookingModelRequestId: null,
          })),
        ],
      },
    },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });

  /**
   * Per-asset event for each newly attached asset. Mirrors the
   * `BOOKING_ASSETS_ADDED` emission in `updateBookingAssets` so the
   * scanner-driven path produces the same audit-trail rows as the
   * manage-assets dialog. Inside the tx — rolls back together with
   * the BookingAsset row creates above. One event per distinct asset.
   * `meta.quantity` (qty-tracked only) sums the standalone scan qty
   * (from `quantities` map, default 1) plus every kit-driven slice qty
   * for the same asset created on this call.
   */
  if (allScannedAssetIds.length > 0) {
    const addedQtyByAssetId = new Map<string, number>();
    for (const sid of assetIds) {
      addedQtyByAssetId.set(
        sid,
        (addedQtyByAssetId.get(sid) ?? 0) + (quantities[sid] ?? 1)
      );
    }
    for (const slice of kitSlices) {
      const sliceQty =
        slice.quantity ?? assetKitById.get(slice.assetKitId)?.quantity ?? 1;
      addedQtyByAssetId.set(
        slice.assetId,
        (addedQtyByAssetId.get(slice.assetId) ?? 0) + sliceQty
      );
    }

    await recordEvents(
      allScannedAssetIds.map((assetId) => {
        const asset = scannedAssetsMetaById.get(assetId);
        return {
          organizationId,
          actorUserId: userId,
          action: "BOOKING_ASSETS_ADDED" as const,
          entityType: "BOOKING" as const,
          entityId: bookingId,
          bookingId,
          assetId,
          meta: asset
            ? assetQtyMeta(asset, addedQtyByAssetId.get(assetId))
            : {},
        };
      }),
      tx
    );
  }

  /**
   * Progressive checkout: scanning assets into an ONGOING/OVERDUE booking adds
   * them as line items but leaves them AVAILABLE — consistent with every other
   * add surface. They are checked out purposefully via the progressive-checkout
   * flow ({@link partialCheckoutBooking}), never as a side-effect of scanning.
   */

  return booking;
}

/**
 * Adds scanned assets (and optionally kits) to a booking.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string[]} params.assetIds - Array of directly-scanned (standalone) asset IDs to add.
 * @param {Array} [params.kitSlices] - Kit-driven slice specs (one per AssetKit membership). An asset scanned via two kits yields two slices.
 * @param {string[]} [params.kitIds] - Optional array of kit IDs. Used to differentiate kit vs. standalone asset additions when creating notes. If not provided, only standalone assets are added.
 * @param {string} params.bookingId - The ID of the booking to update.
 * @param {string} params.organizationId - The organization ID associated with the booking.
 * @param {string} params.userId - The ID of the user performing the action.
 */
export async function addScannedAssetsToBooking({
  assetIds,
  kitIds = [],
  bookingId,
  organizationId,
  userId,
  quantities = {},
  kitSlices = [],
}: {
  assetIds: Asset["id"][];
  kitIds?: string[];
  bookingId: Booking["id"];
  organizationId: Booking["organizationId"];
  userId: string;
  /**
   * Per-asset quantity for standalone QUANTITY_TRACKED scans. Missing
   * entries default `BookingAsset.quantity` to 1.
   */
  quantities?: Record<Asset["id"], number>;
  /**
   * Kit-driven slice specs — one per `AssetKit` membership scanned.
   * See the within-tx helper for full semantics.
   */
  kitSlices?: ScannedKitSliceSpec[];
}) {
  try {
    /**
     * Step 1: Add assets to booking inside a transaction so we can mirror the
     * status-sync behaviour used in manage-assets. The pure-tx body lives in
     * {@link addScannedAssetsToBookingWithinTx} so the fulfil-and-checkout
     * flow can reuse the same writes under a shared transaction. The
     * overlap-conflict guard main added inline here was moved INTO the helper
     * so both call sites get it atomically with the writes.
     */
    const updatedBooking = await db.$transaction(async (tx) =>
      addScannedAssetsToBookingWithinTx(tx, {
        assetIds,
        kitIds,
        bookingId,
        organizationId,
        userId,
        quantities,
        kitSlices,
      })
    );

    /**
     * Step 2: Create activity notes. The notes helper derives standalone
     * vs kit-driven attribution from `kitIds` membership, so it needs the
     * full union of standalone + kit-slice asset ids.
     */
    const allAddedAssetIds = Array.from(
      new Set([...assetIds, ...kitSlices.map((s) => s.assetId)])
    );
    await createNotesForScannedAssetsAndKits({
      booking: updatedBooking,
      assetIds: allAddedAssetIds,
      kitIds,
      organizationId,
      userId,
    });

    return updatedBooking;
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while adding scanned assets to booking.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { assetIds, kitIds, bookingId, organizationId, userId },
      label,
    });
  }
}

/**
 * Loads minimal details for an existing booking when adding assets/kits to it.
 *
 * `organizationId` is required and scopes the lookup so a caller cannot read
 * another tenant's booking status or asset titles by id (cross-org IDOR).
 *
 * @param bookingId - Target booking id (from request input)
 * @param organizationId - Caller's validated organization id
 * @throws {ShelfError} if the booking is missing, cross-org, or not DRAFT/RESERVED
 */
export async function getExistingBookingDetails(
  bookingId: string,
  organizationId: string
) {
  try {
    // why: findFirst + organizationId (findUnique can't take a non-unique org
    // filter) prevents cross-org booking disclosure. We null-check explicitly
    // instead of findFirstOrThrow so a cross-org/missing id returns a clean
    // 404 "Booking not found." rather than leaking a raw Prisma error string.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        status: true,
        // Needed so callers can enforce per-user ownership (SELF_SERVICE/BASE
        // may only add to bookings they created or are custodian of).
        creatorId: true,
        custodianUserId: true,
        bookingAssets: {
          include: {
            asset: { select: { id: true, title: true } },
          },
        },
      },
    });

    if (!booking) {
      throw new ShelfError({
        cause: null,
        message: "Booking not found.",
        status: 404,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    // Bookings that accept new items: DRAFT/RESERVED (not yet started) plus
    // ONGOING/OVERDUE (active — progressive checkout). Added items stay
    // AVAILABLE until purposefully checked out; the CHECKED_OUT guard for
    // active bookings lives in the callers/processBooking. COMPLETE, ARCHIVED
    // and CANCELLED bookings are terminal and reject additions.
    const addableStatuses: BookingStatus[] = [
      BookingStatus.DRAFT,
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
    ];
    if (!addableStatuses.includes(booking.status!)) {
      throw new ShelfError({
        cause: null,
        message:
          "Items can only be added to Draft, Reserved, Ongoing or Overdue bookings.",
        status: 400,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    return booking;
  } catch (cause: ShelfError | any) {
    throw new ShelfError({
      cause,
      message:
        cause?.message ||
        "Something went wrong while getting existing booking details.",
      additionalData: { bookingId },
      label: "Booking",
    });
  }
}

/**
 * Resolves the subset of the given asset IDs that can be added to a booking.
 *
 * INDIVIDUAL assets that belong to a kit are rejected — they live entirely
 * inside their kit, so kits are added as a unit rather than as loose assets.
 *
 * QUANTITY_TRACKED kit members are ACCEPTED: each `AssetKit` row claims only a
 * slice of the pool (`AssetKit.quantity`) and a QT asset may sit in several
 * kits at once while keeping free-pool units, which are legitimately bookable
 * on their own. That's the same rule the booking page's asset picker already
 * applies. Over-allocation is caught downstream by the windowed availability
 * guard in `updateBookingAssets`. See `isDirectBookingBlockedByKit`.
 *
 * @param assetIds - Asset IDs sourced from request/form input
 * @param organizationId - The caller's validated organization ID. Scopes the
 *   lookup so foreign-org asset IDs are silently excluded (they simply won't
 *   be returned), preventing a cross-org IDOR where an attacker in Org A could
 *   add Org B's assets to a booking.
 * @returns The IDs of the assets that exist in `organizationId` and are not
 *   blocked by kit membership
 * @throws {ShelfError} If any selected INDIVIDUAL asset belongs to a kit
 */
export async function getAvailableAssetsIdsForBooking(
  assetIds: Asset["id"][],
  organizationId: string
): Promise<string[]> {
  try {
    const selectedAssets = await db.asset.findMany({
      // SECURITY (cross-org IDOR): scope by organizationId so an attacker
      // cannot resolve / attach assets that live in another workspace.
      where: { id: { in: assetIds }, organizationId },
      select: {
        status: true,
        id: true,
        // `type` decides whether kit membership actually blocks the add —
        // only INDIVIDUAL members are exclusive to their kit.
        type: true,
        assetKits: { select: { kitId: true } },
      },
    });

    if (selectedAssets.some(isDirectBookingBlockedByKit)) {
      // User-input validation, not a server fault: adding INDIVIDUAL kit-member
      // assets directly is disallowed (kits are added as a unit). A 400 keeps
      // this out of the Sentry error pipeline (handled client error). The outer
      // catch re-wraps but inherits status/shouldBeCaptured from this cause. See
      // SHELF-WEBAPP-21Y.
      throw new ShelfError({
        cause: null,
        message: "Cannot add assets that belong to a kit.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    return selectedAssets.map((asset) => asset.id);
  } catch (cause: ShelfError | any) {
    throw new ShelfError({
      cause: cause,
      message: cause?.message
        ? cause.message
        : "Something went wrong while getting available assets.",
      label: "Assets",
    });
  }
}

/**
 * Checks which of the given assets are available and returns them together
 * with the existing booking info.
 *
 * @param bookingId - The booking the assets are being added to
 * @param assetIds - Asset IDs sourced from request/form input
 * @param organizationId - The caller's validated organization ID. Forwarded to
 *   {@link getAvailableAssetsIdsForBooking} so foreign-org assets cannot be
 *   added to the booking (cross-org IDOR protection).
 * @param auth - The acting user's id and org role. Used to enforce per-user
 *   booking ownership: `booking:create/update` is granted org-wide to
 *   SELF_SERVICE/BASE, so without this a non-owner could add items to another
 *   user's booking (cross-user IDOR). ADMIN/OWNER are unrestricted.
 * @returns The resolved (org-scoped) asset IDs and the booking details
 * @throws {ShelfError} If no assets are available, the booking lookup fails, or
 *   the caller does not own the booking
 */
export async function processBooking(
  bookingId: string,
  assetIds: string[],
  organizationId: string,
  auth: { userId: string; role: OrganizationRoles }
) {
  try {
    const [finalAssetIds, bookingInfo] = await Promise.all([
      getAvailableAssetsIdsForBooking(assetIds, organizationId),
      getExistingBookingDetails(bookingId, organizationId),
    ]);

    // Cross-user IDOR guard: SELF_SERVICE/BASE may only add to bookings they
    // created or are custodian of. No-op for ADMIN/OWNER. Runs before any
    // mutation-shaping logic below.
    validateBookingOwnership({
      booking: {
        creatorId: bookingInfo.creatorId,
        custodianUserId: bookingInfo.custodianUserId,
      },
      userId: auth.userId,
      role: auth.role,
      action: "add items to",
    });

    if (!finalAssetIds.length) {
      throw new ShelfError({
        cause: null,
        message: "No assets available.",
        status: 400,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    // Progressive-checkout guard (parity with the manage-assets route): assets
    // that are physically CHECKED_OUT on ANOTHER active booking cannot be added
    // to an ONGOING/OVERDUE booking — there is nothing available to stage. New
    // assets otherwise stay AVAILABLE. This only fires for active bookings;
    // DRAFT/RESERVED targets still accept checked-out assets (they'll be
    // available by the time that booking starts).
    //
    // Assets ALREADY on this booking are excluded from the check: their
    // CHECKED_OUT status can be owned by this same booking (progressive
    // checkout), and re-submitting them is handled downstream by the
    // duplicate / "add only the rest" flow — not by this guard.
    if (
      bookingInfo.status === BookingStatus.ONGOING ||
      bookingInfo.status === BookingStatus.OVERDUE
    ) {
      const existingAssetIds = new Set(
        bookingInfo.bookingAssets.map((ba) => ba.assetId)
      );
      const newAssetIdsToCheck = finalAssetIds.filter(
        (id) => !existingAssetIds.has(id)
      );

      const checkedOutAssets =
        newAssetIdsToCheck.length > 0
          ? await db.asset.findMany({
              where: {
                id: { in: newAssetIdsToCheck },
                organizationId,
                status: AssetStatus.CHECKED_OUT,
              },
              select: { id: true, title: true },
            })
          : [];

      if (checkedOutAssets.length > 0) {
        throw new ShelfError({
          cause: null,
          title: "Not allowed. Assets already checked out",
          message: `The following assets are already checked out and cannot be added to the booking: ${checkedOutAssets
            .map((asset) => asset.title)
            .join(", ")}`,
          additionalData: { checkedOutAssets, bookingId },
          status: 400,
          label: "Booking",
          shouldBeCaptured: false,
        });
      }
    }

    return {
      finalAssetIds,
      bookingInfo,
    };
  } catch (cause) {
    let message = "Something went wrong while processing the booking.";
    if (isLikeShelfError(cause)) {
      message = cause.message;
    }

    throw new ShelfError({
      cause: cause,
      message,
      label: "Booking",
    });
  }
}

/**
 * Guards the "add kits to an existing booking" flow: a kit that is physically
 * CHECKED_OUT on ANOTHER active booking cannot be added to an ONGOING/OVERDUE
 * booking — there is nothing available to stage. Kits added to an active booking
 * otherwise stay AVAILABLE until purposefully checked out (progressive
 * checkout). This is the kit counterpart of the asset guard inside
 * {@link processBooking}.
 *
 * No-op for DRAFT/RESERVED targets — they accept checked-out kits, which become
 * available by the time the booking starts.
 *
 * Kits already represented on the target booking are excluded: their
 * CHECKED_OUT status can be owned by this same booking, and re-adding only
 * attaches newly-added members ({@link buildKitSlicesForBooking} skips existing
 * memberships).
 *
 * NOTE: the manage-kits route keeps its own richer, partial-checkin-aware guard
 * ({@link isKitPartiallyCheckedIn}) because it operates on kits already loaded
 * with their memberships/status and must permit re-checkout of kits that are
 * partially checked in within that booking — semantics that don't apply when
 * adding genuinely-new kits here.
 *
 * @param params.kitIds - Org-scoped kit ids the caller wants to add.
 * @param params.existingAssetKitIds - AssetKit ids already on the target
 *   booking (from its `bookingAssets[].assetKitId`), used to skip kits that are
 *   already represented.
 * @param params.bookingStatus - Current status of the target booking.
 * @param params.bookingId - Target booking id (for the error payload).
 * @param params.organizationId - Caller's validated organization id; scopes
 *   every query so foreign-org kits/memberships can't influence the check.
 * @throws {ShelfError} 400 if any newly-added kit is checked out elsewhere.
 */
export async function assertKitsAddableToActiveBooking({
  kitIds,
  existingAssetKitIds,
  bookingStatus,
  bookingId,
  organizationId,
}: {
  kitIds: string[];
  existingAssetKitIds: Set<string>;
  bookingStatus: BookingStatus;
  bookingId: string;
  organizationId: string;
}): Promise<void> {
  // Only active bookings gate on checked-out status.
  if (
    bookingStatus !== BookingStatus.ONGOING &&
    bookingStatus !== BookingStatus.OVERDUE
  ) {
    return;
  }

  // Kit ids that already have at least one membership on this booking — their
  // checked-out status can belong to this same booking, so they're excluded.
  const kitIdsAlreadyOnBooking = new Set(
    existingAssetKitIds.size > 0
      ? (
          await db.assetKit.findMany({
            where: {
              id: { in: [...existingAssetKitIds] },
              kitId: { in: kitIds },
              organizationId,
            },
            select: { kitId: true },
          })
        ).map((ak) => ak.kitId)
      : []
  );

  const kitIdsToGuard = kitIds.filter((id) => !kitIdsAlreadyOnBooking.has(id));
  if (kitIdsToGuard.length === 0) {
    return;
  }

  const checkedOutKits = await db.kit.findMany({
    where: {
      id: { in: kitIdsToGuard },
      organizationId,
      status: KitStatus.CHECKED_OUT,
    },
    select: { id: true, name: true },
  });

  if (checkedOutKits.length > 0) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed. Kits already checked out",
      message: `The following kits are already checked out and cannot be added to the booking: ${checkedOutKits
        .map((kit) => kit.name)
        .join(", ")}`,
      additionalData: { checkedOutKits, bookingId },
      status: 400,
      label,
      shouldBeCaptured: false,
    });
  }
}

/**
 * Shared function to load booking data for both assets and kits routes for add-to-existing-booking
 * @param params - Parameters required for loading bookings
 * @returns Formatted booking data response
 */
export async function loadBookingsData({
  request,
  organizationId,
  userId,
  role,
  canSeeAllBookings,
  ids,
}: {
  request: Request;
  organizationId: string;
  userId: string;
  /**
   * Effective role, from `requirePermission`. Drives the WRITE restriction —
   * these pickers choose a mutation target, so they may only offer bookings
   * the submitting action will accept.
   */
  role: OrganizationRoles;
  /**
   * Standard booking READ visibility, from `requirePermission`. Gating on the
   * role alone ignored the workspace's `selfServiceCanSeeBookings` /
   * `baseUserCanSeeBookings` overrides, so these pickers stayed restricted even
   * when the workspace had switched the setting on.
   */
  canSeeAllBookings: boolean;
  ids?: string[];
}): Promise<BookingLoaderResponse> {
  // Get search parameters and pagination settings
  const searchParams = getCurrentSearchParams(request);
  const { page, search } = getParamsValues(searchParams);
  const perPage = 20;

  // Fetch bookings with filters. Includes ONGOING/OVERDUE so assets/kits can be
  // added to active bookings (they stay AVAILABLE — progressive checkout), not
  // just to not-yet-started DRAFT/RESERVED ones.
  // TWO independent restrictions, both server-derived, both AND-ed. They must
  // be computed identically here and in `/api/model-filters`, which takes over
  // the moment the user types into the picker — a rule applied on only one of
  // the two makes the list change mid-search.
  //
  // 1. READ — the standard booking-visibility rule. Resolve the FULL custodian
  //    scope (user link + every team-member link) so legacy rows aren't hidden
  //    here while showing on the index.
  const custodianScope = !canSeeAllBookings
    ? await resolveCustodianScope({ userId, organizationId })
    : undefined;

  const { bookings, bookingCount } = await getBookings({
    organizationId,
    page,
    perPage,
    search,
    userId,
    statuses: ADDABLE_BOOKING_STATUSES,
    ...(custodianScope && { custodianScope }),
    // 2. WRITE — what `validateBookingOwnership` will accept on submit. Kept
    //    separate from the read rule because the workspace visibility toggle
    //    does NOT grant write: without this, enabling it offers a restricted
    //    user bookings the action then rejects with a 403.
    writableBy: { userId, role },
  });

  // Set up header and model name
  const header: HeaderData = {
    title: "Bookings",
  };

  const modelName = {
    singular: "booking",
    plural: "bookings",
  };

  const totalPages = Math.ceil(bookingCount / perPage);
  const hints = getClientHint(request);

  return {
    showModal: true,
    header,
    bookings,
    search,
    page,
    bookingCount,
    totalPages,
    perPage,
    modelName,
    ids,
    hints,
  };
}

/**
 * Per-asset summary for an entry appearing under "added" / "removed" in a
 * kit's drift snapshot. Carries enough to render the drift modal without a
 * second loader round-trip.
 */
export type BookingKitDriftAsset = {
  assetId: string;
  title: string;
  type: AssetType;
  /**
   * AssetKit.quantity for "added" entries (so the modal can show
   * "× 50" for a QT addition). For "removed" entries the corresponding
   * AssetKit row is gone, so callers should not rely on a quantity there
   * — we set it to the source BookingAsset.quantity for parity.
   */
  quantity: number;
};

/**
 * Per-kit "membership drift" between the kit's CURRENT contents and the
 * snapshot the source booking carries. `added` = kit members not in the
 * snapshot; `removed` = snapshot members no longer in the kit.
 */
export type BookingKitDrift = {
  kitId: string;
  kitName: string;
  added: BookingKitDriftAsset[];
  removed: BookingKitDriftAsset[];
};

/**
 * Compute per-kit membership drift for a booking, comparing the booking's
 * kit-sourced `BookingAsset` snapshot against each kit's CURRENT `AssetKit`
 * rows.
 *
 * **Why this exists.** `BookingAsset` rows are a snapshot taken at the moment
 * a kit was added to a booking. If a kit's contents change later (e.g. a QT
 * asset is added to the kit after the booking was created), a duplicate that
 * naively copies the snapshot will inherit a stale member list. This helper
 * tells the duplicate-confirmation modal exactly what will differ so the user
 * acknowledges the change explicitly before confirming.
 *
 * **The snapshot is keyed on PROVENANCE, not live membership.** Removing an
 * asset from a kit `SET NULL`s the booking slice's `assetKitId`, so a snapshot
 * built from `assetKitId IS NOT NULL` structurally could not contain a removed
 * asset — `removed` was unreachable and the modal's "Removed since the
 * original" section never rendered. `sourceKitId` survives the detach, so
 * selecting on it is what makes that half of the comparison work.
 *
 * Returns one entry per kit that actually drifted (added or removed non-empty);
 * kits with no drift are omitted. Returns `[]` when the booking has no
 * kit-sourced slices at all.
 *
 * Org-scope: validates that every kit referenced by the booking belongs to
 * `organizationId` before issuing the AssetKit lookup. This is defence-in-
 * depth — the caller's `requirePermission` already scopes the request — but
 * follows the project rule that any ID derived from request input is
 * org-checked before being read. It is load-bearing here rather than merely
 * belt-and-braces: `sourceKitId`'s FK accepts a `Kit` in ANY org.
 *
 * **Caller:** the duplicate route loader
 * (`bookings.$bookingId.overview.duplicate.tsx`) to render the modal. This is
 * a read-only, display-side helper — `duplicateBooking` does NOT call it and
 * re-resolves kit membership independently.
 *
 * @param args.bookingId - The source booking to inspect
 * @param args.organizationId - The caller's organization id (for org-scope)
 * @returns Array of per-kit drift entries; empty when no drift.
 * @throws {ShelfError} If a referenced kit is missing or in another org.
 */
export async function computeBookingKitDrift({
  bookingId,
  organizationId,
}: {
  bookingId: Booking["id"];
  organizationId: Organization["id"];
}): Promise<BookingKitDrift[]> {
  try {
    // Fetch only what we need: every slice this booking took from a kit.
    const kitSourcedSlices = await db.bookingAsset.findMany({
      // Org-scope at the source: a foreign-org `bookingId` will not match
      // any rows, so no slice data (incl. asset titles) is loaded into
      // memory before the downstream `assertKitsBelongToOrg` check fires.
      // Defence-in-depth per .claude/rules/org-scope-user-supplied-ids.md.
      where: {
        bookingId,
        booking: { organizationId },
        /**
         * Provenance, not live membership.
         *
         * `sourceKitId` is the durable pointer and matches BOTH live
         * kit-driven slices and detached residue (`assetKitId` `SET NULL`'d
         * when the asset left the kit) — the residue is exactly the "removed"
         * case this function exists to report, so filtering on `assetKitId`
         * alone made `removed` unreachable.
         *
         * The `assetKitId` leg is the LEGACY fallback, and it is NOT
         * redundant: "assetKitId non-null ⇒ sourceKitId non-null" is enforced
         * by code alone (no CHECK constraint), and the migration necessarily
         * lands before the new code, so during a rolling deploy an older
         * instance can still write a kit-driven row with a NULL
         * `sourceKitId`. Dropping such a row here would hide its whole kit
         * from the drift result while `duplicateBooking` — which keeps the
         * same fallback — still re-resolves that kit, silently changing the
         * duplicate's contents with NO warning in the modal.
         */
        OR: [{ sourceKitId: { not: null } }, { assetKitId: { not: null } }],
      },
      select: {
        assetId: true,
        quantity: true,
        assetKitId: true,
        sourceKitId: true,
        asset: {
          select: {
            id: true,
            title: true,
            type: true,
          },
        },
      },
    });

    if (kitSourcedSlices.length === 0) return [];

    /**
     * Legacy fallback ONLY: resolve `assetKitId -> kitId` for rows written
     * before `sourceKitId` existed. Rows written by current code carry their
     * own provenance, so this query is skipped entirely once the deploy window
     * closes. Prisma's `BookingAsset` model deliberately omits the `assetKit`
     * relation accessor at the schema level (TS recursion limit, see the schema
     * comment on `BookingAsset.assetKitId`), so this cannot be an `include`.
     */
    const legacyAssetKitIds = kitSourcedSlices
      .filter((s) => s.sourceKitId === null)
      .map((s) => s.assetKitId)
      .filter((id): id is string => id !== null);

    let kitIdByAssetKitId = new Map<string, string>();
    if (legacyAssetKitIds.length > 0) {
      const assetKitRows = await db.assetKit.findMany({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: legacyAssetKitIds were fetched above from BookingAsset rows scoped to bookingId; the booking itself is org-validated by the caller (the duplicate route loader runs this after requirePermission). Pure read of an id->id map, and every kitId it resolves still passes assertKitsBelongToOrg below before any kit data is read.
        where: { id: { in: legacyAssetKitIds } },
        select: { id: true, kitId: true },
      });
      kitIdByAssetKitId = new Map(assetKitRows.map((ak) => [ak.id, ak.kitId]));
    }

    /**
     * Group the source slices by the kit they came from, deduping by asset id
     * within each kit.
     *
     * A booking can hold two slices for the same (kit, asset) pair: detached
     * residue from an earlier membership (`assetKitId` NULL) plus a live slice
     * from a later re-add (`assetKitId` set). Normally that pair is harmless
     * here — the live `AssetKit` puts the asset in `currentAssetIds`, so it is
     * reported zero times under "removed". The dedupe covers the race where
     * that `AssetKit` is deleted BETWEEN the `bookingAsset` read above and the
     * `kit.findMany` read below: both rows are then absent from
     * `currentAssetIds` and would be emitted as two "removed" entries for one
     * asset, which the modal renders with duplicate React keys.
     *
     * Two residue rows for the same pair cannot occur — the
     * `BookingAsset_manual_unique (bookingId, assetId) WHERE assetKitId IS
     * NULL` partial unique permits only one.
     *
     * Which row survives is DB order, so the surviving `quantity` is
     * arbitrary. That is acceptable: `BookingKitDriftAsset.quantity` already
     * documents "removed" quantities as indicative only.
     */
    const sliceByKitId = new Map<string, Map<string, BookingKitDriftAsset>>();
    for (const slice of kitSourcedSlices) {
      // Prefer the durable provenance; fall back to the legacy AssetKit hop.
      const kitId =
        slice.sourceKitId ??
        (slice.assetKitId
          ? kitIdByAssetKitId.get(slice.assetKitId)
          : undefined);
      // Reachable for a legacy row whose `AssetKit` was deleted between the two
      // reads above (the FK `SET NULL` had not landed when we read the slice).
      // Nothing meaningful to compare against, and `duplicateBooking` drops it
      // for the same reason.
      if (!kitId) continue;
      const bucket =
        sliceByKitId.get(kitId) ?? new Map<string, BookingKitDriftAsset>();
      if (!bucket.has(slice.assetId)) {
        bucket.set(slice.assetId, {
          assetId: slice.assetId,
          title: slice.asset.title,
          type: slice.asset.type,
          quantity: slice.quantity,
        });
      }
      sliceByKitId.set(kitId, bucket);
    }

    const kitIds = [...sliceByKitId.keys()];
    if (kitIds.length === 0) return [];

    // Defence-in-depth: every kit id we're about to query must belong to the
    // caller's org. `getBooking` already scoped the source booking, but the
    // AssetKit.kitId came out of joined rows so we re-validate.
    await assertKitsBelongToOrg({ kitIds, organizationId });

    // Pull each referenced kit's CURRENT membership + name in one round trip.
    const kits = await db.kit.findMany({
      where: { id: { in: kitIds }, organizationId },
      select: {
        id: true,
        name: true,
        assetKits: {
          select: {
            assetId: true,
            quantity: true,
            asset: {
              select: { id: true, title: true, type: true },
            },
          },
        },
      },
    });

    const kitsById = new Map(kits.map((k) => [k.id, k]));

    const drifts: BookingKitDrift[] = [];

    for (const kitId of kitIds) {
      /**
       * A kit deleted since the booking was created cannot reach this loop:
       * `sourceKitId` is `ON DELETE SET NULL` to `Kit`, and deleting a kit
       * cascade-deletes its `AssetKit` rows which in turn `SET NULL`s
       * `assetKitId` — so both legs of the snapshot predicate go NULL and the
       * slices degrade to loose assets, matching pre-provenance behaviour.
       * `assertKitsBelongToOrg` above has also already proven every id here
       * exists in this org, so the guard only covers a delete racing between
       * the two reads.
       */
      const kit = kitsById.get(kitId);
      if (!kit) continue;

      const snapshotForKit = [...(sliceByKitId.get(kitId)?.values() ?? [])];
      const snapshotAssetIds = new Set(snapshotForKit.map((s) => s.assetId));

      const currentAssetIds = new Set(kit.assetKits.map((ak) => ak.assetId));

      const added: BookingKitDriftAsset[] = kit.assetKits
        .filter((ak) => !snapshotAssetIds.has(ak.assetId))
        .map((ak) => ({
          assetId: ak.assetId,
          title: ak.asset.title,
          type: ak.asset.type,
          quantity: ak.quantity,
        }));

      // Already `BookingKitDriftAsset`-shaped — the bucket stores the drift
      // entry directly, so no re-mapping is needed here.
      const removed: BookingKitDriftAsset[] = snapshotForKit.filter(
        (s) => !currentAssetIds.has(s.assetId)
      );

      if (added.length === 0 && removed.length === 0) continue;

      drifts.push({
        kitId,
        kitName: kit.name,
        added,
        removed,
      });
    }

    return drifts;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while computing booking kit drift.",
      label,
      additionalData: { bookingId, organizationId },
    });
  }
}

/**
 * Duplicate a booking, copying its asset selection, tags, custodian and
 * notification recipients into a fresh DRAFT booking owned by `userId`.
 *
 * **Kit re-resolution.** Kit-driven `BookingAsset` rows are NOT copied
 * verbatim from the source. Instead, the duplicate's kit-driven slices are
 * rebuilt from each referenced kit's CURRENT `AssetKit` rows so the
 * duplicate reflects the kit's current contents (not a stale snapshot).
 * Only GENUINE standalone slices (`assetKitId` AND `sourceKitId` both NULL)
 * are copied verbatim, including per-row `quantity`. A slice whose
 * `assetKitId` was `SET NULL` by a kit removal but which still carries
 * `sourceKitId` is detached kit residue and is DROPPED — the kit it came
 * from is re-resolved to its current membership instead. The
 * duplicate-confirmation modal surfaces the resulting drift via
 * {@link computeBookingKitDrift} so the user acknowledges the change before
 * confirming.
 *
 * **Booking window.** The new booking's `from`/`to` are taken from the
 * caller-provided dates rather than being derived here, so the duplicate
 * dialog controls the window (timezone normalization happens upstream).
 *
 * @param args.bookingId - The source booking
 * @param args.organizationId - The caller's organization
 * @param args.userId - The user creating the duplicate (becomes the creator)
 * @param args.from - Start date for the new booking
 * @param args.to - End date for the new booking
 * @param args.request - The incoming request, forwarded to `getBooking` for
 *   client-hint resolution and ownership checks
 * @returns The newly created booking row
 * @throws {ShelfError} If anything in the transaction fails
 */
export async function duplicateBooking({
  bookingId,
  organizationId,
  userId,
  from,
  to,
  request,
}: {
  bookingId: Booking["id"];
  organizationId: Organization["id"];
  userId: User["id"];
  from: Date;
  to: Date;
  request: Request;
}) {
  try {
    const bookingToDuplicate = await getBooking({
      id: bookingId,
      organizationId,
      request,
      extraInclude: {
        notificationRecipients: { select: { id: true } },
      },
    });

    // Three-way split of the source's snapshot:
    //  - genuine standalone (BOTH pointers null) -> copied verbatim. A user
    //    deliberately added these by hand; dropping them loses real intent.
    //  - detached kit residue (`sourceKitId` set, `assetKitId` null) -> DROPPED.
    //    `assetKitId` is `ON DELETE SET NULL`, so removing an asset from a kit
    //    silently demotes the booking's kit-driven slice to a standalone one.
    //    Copying it would re-add a swapped-out asset to the duplicate as a
    //    loose asset (the reported customer bug); the kit's CURRENT contents
    //    are re-resolved below instead.
    //  - kit-driven (`assetKitId` non-null) -> not copied; rebuilt from the
    //    kit's CURRENT `AssetKit` rows.
    const standaloneSourceSlices = bookingToDuplicate.bookingAssets.filter(
      (ba) => ba.assetKitId == null && ba.sourceKitId == null
    );

    // Every kit the source booking referenced, whether or not its slices are
    // still kit-driven. Iterating ALL slices (not just kit-driven ones) is what
    // keeps a kit whose members were ALL removed since in the duplicate — it
    // gets re-resolved to its current contents instead of vanishing.
    const distinctKitIds = new Set<string>();
    for (const slice of bookingToDuplicate.bookingAssets) {
      /**
       * `sourceKitId` is the durable provenance and is preferred. The legacy
       * `assetKitId -> AssetKit -> kitId` hop is the FALLBACK, kept because the
       * "assetKitId non-null ⇒ sourceKitId non-null" invariant is enforced by
       * code alone (no CHECK constraint): the migration necessarily lands
       * before the new code, so during a rolling deploy an older instance can
       * still write a kit-driven row with a NULL `sourceKitId`. Without the
       * fallback such a row is in neither bucket and its whole kit silently
       * vanishes from the duplicate (a kit-only booking would copy to an EMPTY
       * one). Costs no extra query — `asset.assetKits` is already selected by
       * `BOOKING_WITH_ASSETS_INCLUDE`.
       *
       * This cannot resurrect detached residue: residue rows have
       * `assetKitId === null`, so the `find` never matches for them.
       */
      const kitId =
        slice.sourceKitId ??
        slice.asset.assetKits.find((ak) => ak.id === slice.assetKitId)?.kitId;
      if (kitId) distinctKitIds.add(kitId);
    }

    // Resolve the kits' current membership BEFORE the tx — read-only, no need
    // to keep inside the write transaction (matches the kit-add path which
    // also resolves slices ahead of the write).
    const kitIdsList = [...distinctKitIds];
    let kitDrivenCreateRows: Array<{
      assetId: string;
      quantity: number;
      assetKitId: string;
      /** Owning kit, persisted to `BookingAsset.sourceKitId`. */
      kitId: string;
      asset: { type: AssetType; unitOfMeasure: string | null };
    }> = [];

    if (kitIdsList.length > 0) {
      await assertKitsBelongToOrg({
        kitIds: kitIdsList,
        organizationId,
      });

      // `kitId` costs nothing extra here — the query is already filtered by
      // `kitId IN (...)`, so selecting it just carries the org-proven owning
      // kit through to `sourceKitId` (same pattern as
      // `buildKitSlicesForBooking`). It is read off the `AssetKit` row rather
      // than taken from any caller input: every id in `kitIdsList` came from
      // the org-scoped source booking and passed `assertKitsBelongToOrg` above.
      const currentKitAssets = await db.assetKit.findMany({
        where: { kitId: { in: kitIdsList } },
        select: {
          id: true,
          assetId: true,
          quantity: true,
          kitId: true,
          asset: {
            select: { type: true, unitOfMeasure: true },
          },
        },
      });

      kitDrivenCreateRows = currentKitAssets.map((ak) => ({
        assetId: ak.assetId,
        quantity: ak.quantity,
        assetKitId: ak.id,
        kitId: ak.kitId,
        asset: ak.asset,
      }));
    }

    // The final create payload: standalone (verbatim) + kit-driven (current).
    // Each kit-driven row carries a non-null `assetKitId`, so even an asset
    // present as both a standalone slice AND a kit-driven slice stays
    // distinct on the `(bookingId, assetId) WHERE assetKitId IS NULL`
    // partial unique (the standalone is the only NULL row for that asset).
    const createSlices = [
      ...standaloneSourceSlices.map((ba) => ({
        assetId: ba.assetId,
        quantity: ba.quantity,
        // Explicit nulls rather than `ba.assetKitId` / `ba.sourceKitId`: this
        // bucket is genuine standalone by construction (both pointers null),
        // so the "assetKitId null ⇔ sourceKitId null" invariant reads locally.
        assetKitId: null,
        sourceKitId: null,
      })),
      ...kitDrivenCreateRows.map((row) => ({
        assetId: row.assetId,
        quantity: row.quantity,
        assetKitId: row.assetKitId,
        // Durable provenance — survives the AssetKit row being deleted, which
        // is what stops a future detach from turning this into loose residue.
        sourceKitId: row.kitId,
      })),
    ];

    /**
     * Wrap creation + activity events in a transaction so the events
     * commit atomically with the booking row (matches `createBooking`).
     * `duplicateBooking` doesn't delegate to `createBooking` because it
     * needs to copy across more fields (per-asset quantities, tags,
     * notification recipients), so we mirror the emission pattern here.
     */
    const newBooking = await db.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          name: bookingToDuplicate.name + " (Copy)",
          description: bookingToDuplicate.description,
          from,
          to,
          organizationId,
          creatorId: userId,
          status: BookingStatus.DRAFT,
          custodianTeamMemberId: bookingToDuplicate.custodianTeamMemberId,
          custodianUserId: bookingToDuplicate.custodianUserId,
          bookingAssets: {
            /**
             * Genuine standalone slices (`assetKitId` and `sourceKitId` both
             * NULL) are copied verbatim so per-row `quantity` is preserved
             * for QUANTITY_TRACKED assets. Kit-driven slices are rebuilt from
             * each referenced kit's CURRENT `AssetKit` rows so the duplicate
             * reflects the kit's current contents, not the snapshot the
             * source carried — and detached kit residue is dropped rather
             * than copied in as a loose asset.
             *
             * Polish-6 allows multiple BookingAsset rows per asset (one
             * standalone + N kit-driven). Each kit-driven row carries a
             * non-null `assetKitId`, so an asset present as both a
             * standalone slice AND a kit-driven slice stays distinct on
             * the `BookingAsset_manual_unique (bookingId, assetId) WHERE
             * assetKitId IS NULL` partial unique.
             *
             * The duplicate starts in DRAFT and availability is re-validated
             * at checkout, so an over-reservation here is surfaced to the
             * user at the right time instead of being silently truncated.
             */
            create: createSlices,
          },
          tags: {
            connect: bookingToDuplicate.tags.map((tag) => ({ id: tag.id })),
          },
          // Copy per-booking notification recipients from the original
          ...(bookingToDuplicate.notificationRecipients?.length
            ? {
                notificationRecipients: {
                  connect: bookingToDuplicate.notificationRecipients.map(
                    (tm: { id: string }) => ({ id: tm.id })
                  ),
                },
              }
            : {}),
        },
      });

      /**
       * Lifecycle event for the duplicated booking. Mirrors `createBooking`
       * so reports treat the duplicate as a fresh draft just like any
       * other newly created booking. `assetCount` uses the NEW slice count
       * (which may differ from the source by the kit-drift delta).
       */
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "BOOKING_CREATED",
          entityType: "BOOKING",
          entityId: created.id,
          bookingId: created.id,
          meta: {
            assetCount: createSlices.length,
            duplicatedFromBookingId: bookingToDuplicate.id,
          },
        },
        tx
      );

      // One BOOKING_ASSETS_ADDED event per newly-created BookingAsset row.
      // Per-row `meta.quantity` (qty-tracked only) sourced from the
      // duplicated row's own quantity — multi-row qty-tracked yields one
      // event per slice, each carrying that slice's count. We iterate the
      // same create payload (standalone source rows + kit-driven current
      // rows) so the events reflect what was actually inserted.
      if (createSlices.length > 0) {
        const eventRows: Array<{
          assetId: string;
          quantity: number;
          asset: { type: AssetType; unitOfMeasure: string | null };
        }> = [
          ...standaloneSourceSlices.map((ba) => ({
            assetId: ba.assetId,
            quantity: ba.quantity,
            asset: ba.asset,
          })),
          ...kitDrivenCreateRows.map((row) => ({
            assetId: row.assetId,
            quantity: row.quantity,
            asset: row.asset,
          })),
        ];

        await recordEvents(
          eventRows.map((row) => ({
            organizationId,
            actorUserId: userId,
            action: "BOOKING_ASSETS_ADDED" as const,
            entityType: "BOOKING" as const,
            entityId: created.id,
            bookingId: created.id,
            assetId: row.assetId,
            meta: assetQtyMeta(row.asset, row.quantity),
          })),
          tx
        );
      }

      return created;
    });

    return newBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while duplicating booking.",
      label,
    });
  }
}

/**
 * Helper functions for partial check-in tracking
 */

/**
 * Check if a booking has any partial check-ins
 */
export async function hasPartialCheckins(bookingId: string): Promise<boolean> {
  const count = await db.partialBookingCheckin.count({
    where: { bookingId },
  });
  return count > 0;
}

/**
 * Get partial check-in history for a booking
 */
export function getPartialCheckinHistory(bookingId: string) {
  return db.partialBookingCheckin.findMany({
    where: { bookingId },
    include: {
      checkedInBy: {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
          email: true,
        },
      },
    },
    orderBy: { checkinTimestamp: "desc" },
  });
}

/**
 * Get total assets checked in via partial check-ins for a booking
 */
export async function getTotalPartialCheckinCount(
  bookingId: string
): Promise<number> {
  const result = await db.partialBookingCheckin.aggregate({
    where: { bookingId },
    _sum: { checkinCount: true },
  });
  return result._sum.checkinCount || 0;
}

/**
 * Get all unique asset IDs that have been checked in via partial check-ins
 */
export async function getPartiallyCheckedInAssetIds(
  bookingId: string
): Promise<string[]> {
  const partialCheckins = await db.partialBookingCheckin.findMany({
    where: { bookingId },
    select: { assetIds: true },
  });

  // Flatten all asset ID arrays and get unique values
  const allAssetIds = partialCheckins.flatMap((pc) => pc.assetIds);
  return [...new Set(allAssetIds)];
}

/**
 * Get detailed partial check-in data with user and date information for each asset
 * Returns both the asset IDs and the detailed check-in data in one query
 */
export async function getDetailedPartialCheckinData(bookingId: string) {
  const partialCheckins = await db.partialBookingCheckin.findMany({
    where: { bookingId },
    include: {
      checkedInBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          profilePicture: true,
        },
      },
    },
    orderBy: { checkinTimestamp: "asc" },
  });

  // Create a record of asset ID to its check-in details
  const assetCheckinRecord: Record<
    string,
    {
      checkinDate: Date;
      checkedInBy: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        displayName: string | null;
        profilePicture: string | null;
      };
    }
  > = {};

  // Collect all unique asset IDs
  const checkedInAssetIds: string[] = [];

  partialCheckins.forEach((checkin) => {
    checkin.assetIds.forEach((assetId) => {
      // Only store the first (earliest) check-in for each asset
      if (!assetCheckinRecord[assetId]) {
        assetCheckinRecord[assetId] = {
          checkinDate: checkin.checkinTimestamp,
          checkedInBy: checkin.checkedInBy,
        };
        checkedInAssetIds.push(assetId);
      }
    });
  });

  return {
    checkedInAssetIds,
    partialCheckinDetails: assetCheckinRecord,
  };
}

export type PartialCheckinDetailsType = Record<
  string,
  {
    checkinDate: Date | string;
    checkedInBy: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
      profilePicture: string | null;
    };
  }
>;

export async function checkinAssets({
  formData,
  request,
  bookingId,
  organizationId,
  userId,
  authSession,
}: {
  formData: FormData;
  request: Request;
  bookingId: string;
  organizationId: string;
  userId: string;
  authSession: AuthSession;
}) {
  const { assetIds, checkins, checkinIntentChoice, returnJson } = parseData(
    formData,
    partialCheckinAssetsSchema.extend({
      checkinIntentChoice: z.nativeEnum(CheckinIntentEnum).optional(),
      returnJson: z
        .string()
        .optional()
        .transform((val) => val === "true"),
    })
  );

  /**
   * At least one of `assetIds` (legacy) or `checkins` (per-asset
   * dispositions) must be present. The drawer sends one of the two
   * depending on whether the booking has qty-tracked assets in play.
   */
  if (
    (!assetIds || assetIds.length === 0) &&
    (!checkins || checkins.length === 0)
  ) {
    throw new ShelfError({
      cause: null,
      status: 400,
      label,
      message: "No assets provided for check-in.",
      shouldBeCaptured: false,
    });
  }

  const hints = getClientHint(request);

  const result = await partialCheckinBooking({
    id: bookingId,
    organizationId,
    assetIds,
    checkins,
    userId,
    hints,
    intentChoice: checkinIntentChoice,
  });

  /** Effective count of assets touched in this session — for toast messaging. */
  const touchedCount = checkins?.length ?? assetIds?.length ?? 0;
  const plural = touchedCount === 1 ? "" : "s";

  const notificationMessage = result.isComplete
    ? `Successfully checked in ${touchedCount} asset${plural} and completed the booking.`
    : `Successfully checked in ${touchedCount} asset${plural} from booking.`;

  sendNotification({
    title: result.isComplete ? "Booking completed" : "Assets checked in",
    message: notificationMessage,
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  // Return JSON if requested by bulk dialog, otherwise redirect
  if (returnJson) {
    return payload({
      success: true,
      message: `Successfully checked in ${touchedCount} asset${plural}`,
    });
  }

  return redirect(`/bookings/${bookingId}`);
}

/**
 * Get all unique asset IDs that have been checked out via partial check-outs
 * for a booking. Mirrors {@link getPartiallyCheckedInAssetIds} for the checkout
 * direction; this is the per-booking source of truth for what has been scanned
 * out so far (progress bar + completion detection).
 *
 * Org-scoped: the query filters on `booking.organizationId` via the relation so
 * a caller can only read partial-checkout records whose booking belongs to the
 * supplied organization (cross-org IDOR guard enforced in the query itself, not
 * by caller convention).
 *
 * @param params.bookingId - Booking id to read partial check-out records for
 * @param params.organizationId - Caller's validated organization id; the
 *   booking must belong to it for any records to be returned
 * @returns Deduplicated list of asset ids checked out for this booking
 */
export async function getPartiallyCheckedOutAssetIds({
  bookingId,
  organizationId,
}: {
  bookingId: string;
  organizationId: string;
}): Promise<string[]> {
  const partialCheckouts = await db.partialBookingCheckout.findMany({
    where: { bookingId, booking: { organizationId } },
    select: { assetIds: true },
  });

  // Flatten all asset ID arrays and get unique values
  const allAssetIds = partialCheckouts.flatMap((pc) => pc.assetIds);
  return [...new Set(allAssetIds)];
}

/**
 * Get detailed partial check-out data with user and date information for each
 * asset. Mirrors {@link getDetailedPartialCheckinData}. Returns both the asset
 * IDs and the detailed check-out data in one query.
 *
 * Org-scoped: the query filters on `booking.organizationId` via the relation so
 * a caller can only read partial-checkout records whose booking belongs to the
 * supplied organization (cross-org IDOR guard enforced in the query itself).
 *
 * @param params.bookingId - Booking id to read partial check-out records for
 * @param params.organizationId - Caller's validated organization id; the
 *   booking must belong to it for any records to be returned
 * @returns checkedOutAssetIds + a record of assetId → { checkoutDate, checkedOutBy }
 */
export async function getDetailedPartialCheckoutData({
  bookingId,
  organizationId,
}: {
  bookingId: string;
  organizationId: string;
}) {
  const partialCheckouts = await db.partialBookingCheckout.findMany({
    where: { bookingId, booking: { organizationId } },
    include: {
      checkedOutBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          profilePicture: true,
        },
      },
    },
    orderBy: { checkoutTimestamp: "asc" },
  });

  // Create a record of asset ID to its check-out details
  const assetCheckoutRecord: Record<
    string,
    {
      checkoutDate: Date;
      checkedOutBy: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        displayName: string | null;
        profilePicture: string | null;
      };
    }
  > = {};

  // Collect all unique asset IDs
  const checkedOutAssetIds: string[] = [];

  partialCheckouts.forEach((checkout) => {
    checkout.assetIds.forEach((assetId) => {
      // Only store the first (earliest) check-out for each asset
      if (!assetCheckoutRecord[assetId]) {
        assetCheckoutRecord[assetId] = {
          checkoutDate: checkout.checkoutTimestamp,
          checkedOutBy: checkout.checkedOutBy,
        };
        checkedOutAssetIds.push(assetId);
      }
    });
  });

  return {
    checkedOutAssetIds,
    partialCheckoutDetails: assetCheckoutRecord,
  };
}

/**
 * Per-asset progressive check-OUT detail, keyed by asset id. Mirrors
 * {@link PartialCheckinDetailsType}. Produced by
 * {@link getDetailedPartialCheckoutData} and consumed by the booking detail
 * page to render the "Checked out on / by" columns and decide the per-asset
 * "Returned" badge. `checkoutDate` is the earliest checkout timestamp for the
 * asset; `checkedOutBy` is the user who performed that checkout.
 */
export type PartialCheckoutDetailsType = Record<
  string,
  {
    checkoutDate: Date | string;
    checkedOutBy: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
      profilePicture: string | null;
    };
  }
>;

/**
 * Action wrapper for progressive (partial) check-OUT, mirroring
 * {@link checkinAssets}. Parses the scanned asset ids from form data, runs
 * {@link partialCheckoutBooking}, sends a notification, and either returns JSON
 * (bulk dialog) or redirects back to the booking.
 *
 * @param formData - Submitted form data (assetIds + optional intent/returnJson)
 * @param request - Incoming request (for client hints)
 * @param bookingId - Booking being checked out
 * @param organizationId - Caller's active organization
 * @param userId - Acting user
 * @param authSession - Auth session (notification sender)
 * @returns JSON payload (when returnJson) or a redirect to the booking page
 */
export async function checkoutAssets({
  formData,
  request,
  bookingId,
  organizationId,
  userId,
  authSession,
}: {
  formData: FormData;
  request: Request;
  bookingId: string;
  organizationId: string;
  userId: string;
  authSession: AuthSession;
}) {
  const { assetIds, checkouts, checkoutIntentChoice, returnJson } = parseData(
    formData,
    partialCheckoutAssetsSchema.extend({
      checkoutIntentChoice: z.nativeEnum(CheckoutIntentEnum).optional(),
      returnJson: z
        .string()
        .optional()
        .transform((val) => val === "true"),
    })
  );

  /**
   * At least one of `assetIds` (legacy) or `checkouts` (per-asset
   * quantity-tracked dispositions) must be present. The drawer sends one of
   * the two depending on whether the booking has qty-tracked assets in play.
   */
  if (
    (!assetIds || assetIds.length === 0) &&
    (!checkouts || checkouts.length === 0)
  ) {
    throw new ShelfError({
      cause: null,
      status: 400,
      label,
      message: "No assets provided for check-out.",
      shouldBeCaptured: false,
    });
  }

  const hints = getClientHint(request);

  const result = await partialCheckoutBooking({
    id: bookingId,
    organizationId,
    assetIds,
    checkouts,
    userId,
    hints,
    intentChoice: checkoutIntentChoice,
  });

  return respondToPartialCheckout({
    result,
    bookingId,
    authSession,
    returnJson,
  });
}

/**
 * Build the notification + HTTP response shared by the partial check-out entry
 * points — {@link checkoutAssets} (scan / bulk dialog) and
 * {@link checkoutRemainingAssets} (booking-header "Check out remaining").
 *
 * Reports the count the service ACTUALLY checked out, which can be fewer than
 * the submitted/resolved assets when the batch contains already-recorded
 * (idempotent) assets — otherwise the UI would overstate the count.
 *
 * @param result - Outcome of {@link partialCheckoutBooking}
 * @param bookingId - Booking being checked out (for the redirect target)
 * @param authSession - Auth session (notification sender)
 * @param returnJson - When true, return a JSON payload instead of redirecting
 * @returns A JSON payload (bulk dialog) or a redirect to the booking page
 */
function respondToPartialCheckout({
  result,
  bookingId,
  authSession,
  returnJson,
}: {
  result: Awaited<ReturnType<typeof partialCheckoutBooking>>;
  bookingId: string;
  authSession: AuthSession;
  returnJson: boolean;
}) {
  const count = result.checkedOutAssetCount;
  const notificationMessage = result.isComplete
    ? `Successfully checked out ${count} asset${
        count > 1 ? "s" : ""
      } and checked out the booking.`
    : `Successfully checked out ${count} asset${
        count > 1 ? "s" : ""
      } from booking.`;

  sendNotification({
    title: result.isComplete ? "Booking checked out" : "Assets checked out",
    message: notificationMessage,
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  // Return JSON if requested by bulk dialog, otherwise redirect
  if (returnJson) {
    return payload({
      success: true,
      message: `Successfully checked out ${count} asset${count > 1 ? "s" : ""}`,
    });
  }

  return redirect(`/bookings/${bookingId}`);
}

/**
 * Resolve the still-checkout-eligible asset ids for a booking — the assets in
 * the "Booked" bucket that can be checked out right now. An asset is eligible
 * when it belongs to the booking, is currently `AVAILABLE` (so neither already
 * `CHECKED_OUT` nor `IN_CUSTODY`), and has not been returned via a partial
 * check-in. Backs {@link checkoutRemainingAssets} so the "Check out remaining"
 * action never has to enumerate asset ids on the client.
 *
 * @param bookingId - Booking to inspect
 * @param organizationId - Caller's active organization (org-scopes the lookup)
 * @returns The ids of assets still eligible for check-out (possibly empty)
 * @throws {ShelfError} If the booking is not found in the organization
 */
export async function getRemainingCheckoutAssetIds({
  bookingId,
  organizationId,
}: {
  bookingId: string;
  organizationId: string;
}): Promise<string[]> {
  const booking = await db.booking
    .findUniqueOrThrow({
      where: { id: bookingId, organizationId },
      select: {
        // Post-pivot: assets live behind the BookingAsset pivot. Project the
        // narrow shape needed for the eligibility filter via the pivot.
        bookingAssets: {
          select: {
            asset: { select: { id: true, status: true } },
          },
        },
        partialCheckins: { select: { assetIds: true } },
      },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        status: 404,
        label,
        message:
          "Booking not found, are you sure it exists in current workspace?",
        shouldBeCaptured: !isNotFoundError(cause),
      });
    });

  // Assets returned via partial check-in are AVAILABLE again but must NOT be
  // re-checked out, so exclude them explicitly.
  const checkedInAssetIds = new Set(
    booking.partialCheckins.flatMap((checkin) => checkin.assetIds)
  );

  // Dedup by asset id since qty-tracked assets may have multiple pivot rows.
  const uniqueAssets = new Map<string, { id: string; status: AssetStatus }>();
  for (const ba of booking.bookingAssets) {
    if (!uniqueAssets.has(ba.asset.id)) {
      uniqueAssets.set(ba.asset.id, ba.asset);
    }
  }

  return [...uniqueAssets.values()]
    .filter(
      (asset) =>
        asset.status === AssetStatus.AVAILABLE &&
        !checkedInAssetIds.has(asset.id)
    )
    .map((asset) => asset.id);
}

/**
 * Resolve the still-checkout-eligible payload for a booking, split across the
 * two shapes {@link partialCheckoutBooking} accepts:
 *
 * - `assetIds[]` — INDIVIDUAL assets that are AVAILABLE (implicit qty=1).
 * - `checkouts[]` — QUANTITY_TRACKED slices with a positive remaining-to-
 *   check-out count, attributed per `BookingAsset` row so kit-driven and
 *   standalone slices of the same asset top off independently (Polish-7b
 *   per-slice attribution, mirror of the check-in side).
 *
 * Backs {@link checkoutRemainingAssets} so the booking-header "Check out
 * remaining" action tops off partially-checked-out QT slices instead of
 * falling back to the implicit qty=1 path.
 *
 * Per-slice loops over `computeBookingAssetSliceRemainingToCheckOut` are
 * bounded by the booking's QT slice count (same N+1 shape as the
 * checkout-assets loader).
 *
 * @param bookingId - Booking to inspect
 * @param organizationId - Caller's active organization (org-scopes the lookup)
 * @returns Split payload (`assetIds` + `checkouts`) for {@link partialCheckoutBooking}
 * @throws {ShelfError} If the booking is not found in the organization
 */
export async function getRemainingCheckoutPayload({
  bookingId,
  organizationId,
}: {
  bookingId: string;
  organizationId: string;
}): Promise<{ assetIds: string[]; checkouts: CheckoutDispositionInput[] }> {
  const booking = await db.booking
    .findUniqueOrThrow({
      where: { id: bookingId, organizationId },
      select: {
        // Post-pivot: assets live behind the BookingAsset pivot. Project the
        // narrow shape needed for the eligibility filter via the pivot — plus
        // the pivot row id so QT slices can be attributed per `BookingAsset`.
        bookingAssets: {
          select: {
            id: true,
            asset: { select: { id: true, status: true, type: true } },
          },
        },
        partialCheckins: { select: { assetIds: true } },
      },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        status: 404,
        label,
        message:
          "Booking not found, are you sure it exists in current workspace?",
        shouldBeCaptured: !isNotFoundError(cause),
      });
    });

  // Assets returned via partial check-in are AVAILABLE again but must NOT be
  // re-checked out, so exclude them explicitly.
  const checkedInAssetIds = new Set(
    booking.partialCheckins.flatMap((checkin) => checkin.assetIds)
  );

  const individualAssetIds: string[] = [];
  const seenIndividual = new Set<string>();
  const checkouts: CheckoutDispositionInput[] = [];

  for (const ba of booking.bookingAssets) {
    if (checkedInAssetIds.has(ba.asset.id)) continue;

    if (ba.asset.type === AssetType.QUANTITY_TRACKED) {
      // QT: enumerate each slice and ask the per-slice OUT-side remaining
      // helper. A single asset can span multiple BookingAsset rows (e.g. kit
      // slice + standalone slice); each slice tops off independently. The
      // OUT-side helper subtracts already-claimed PartialBookingCheckout
      // units from the slice cap — NOT the IN-side helper, which would
      // return the full booked qty for a slice that has never been checked
      // in and then trip `partialCheckoutBooking`'s per-asset cap.
      // The asset's live `status` does NOT gate inclusion here — QT assets
      // can be IN_CUSTODY with some units still outstanding on the booking.
      const sliceRemaining = await computeBookingAssetSliceRemainingToCheckOut(
        db,
        bookingId,
        ba.id
      );
      if (sliceRemaining > 0) {
        checkouts.push({
          assetId: ba.asset.id,
          bookingAssetId: ba.id,
          quantity: sliceRemaining,
        });
      }
      continue;
    }

    // INDIVIDUAL: eligibility matches getRemainingCheckoutAssetIds — must be
    // AVAILABLE (so neither already CHECKED_OUT nor IN_CUSTODY). Dedup since
    // the pivot can carry the same asset across multiple rows.
    if (ba.asset.status !== AssetStatus.AVAILABLE) continue;
    if (seenIndividual.has(ba.asset.id)) continue;
    seenIndividual.add(ba.asset.id);
    individualAssetIds.push(ba.asset.id);
  }

  return { assetIds: individualAssetIds, checkouts };
}

/**
 * Action wrapper for "Check out remaining": check out every asset still in the
 * booking's "Booked" bucket in one go, without the client enumerating ids.
 * Mirrors {@link checkoutAssets} but resolves the eligible payload server-side
 * via {@link getRemainingCheckoutPayload} before delegating to
 * {@link partialCheckoutBooking}. Surfaced from the booking header dropdown for
 * ONGOING/OVERDUE bookings so users aren't forced to scan the rest one-by-one.
 *
 * QT slices that are partially checked out top off to their remaining count
 * via `checkouts[]`; INDIVIDUAL assets flow through `assetIds[]` (implicit
 * qty=1). Without the split payload, QT slices would silently fall back to
 * qty=1 and "Check out remaining" would leave units behind.
 *
 * @param formData - Submitted form data (optional checkoutIntentChoice/returnJson)
 * @param request - Incoming request (for client hints)
 * @param bookingId - Booking being checked out
 * @param organizationId - Caller's active organization
 * @param userId - Acting user
 * @param authSession - Auth session (notification sender)
 * @returns JSON payload (when returnJson) or a redirect to the booking page
 * @throws {ShelfError} If no eligible assets remain to check out
 */
export async function checkoutRemainingAssets({
  formData,
  request,
  bookingId,
  organizationId,
  userId,
  authSession,
}: {
  formData: FormData;
  request: Request;
  bookingId: string;
  organizationId: string;
  userId: string;
  authSession: AuthSession;
}) {
  const { checkoutIntentChoice, returnJson } = parseData(
    formData,
    z.object({
      checkoutIntentChoice: z.nativeEnum(CheckoutIntentEnum).optional(),
      returnJson: z
        .string()
        .optional()
        .transform((val) => val === "true"),
    })
  );

  const { assetIds, checkouts } = await getRemainingCheckoutPayload({
    bookingId,
    organizationId,
  });

  if (assetIds.length === 0 && checkouts.length === 0) {
    throw new ShelfError({
      cause: null,
      status: 400,
      label,
      message: "There are no remaining items to check out for this booking.",
      shouldBeCaptured: false,
    });
  }

  const hints = getClientHint(request);

  const result = await partialCheckoutBooking({
    id: bookingId,
    organizationId,
    assetIds,
    checkouts,
    userId,
    hints,
    intentChoice: checkoutIntentChoice,
  });

  return respondToPartialCheckout({
    result,
    bookingId,
    authSession,
    returnJson,
  });
}

export async function getOngoingBookingForAsset({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
}) {
  try {
    const booking = await db.booking.findFirst({
      where: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId,
        bookingAssets: { some: { assetId } },
        partialCheckins: { none: { assetIds: { has: assetId } } }, // Exclude bookings where this asset has been partially checked in
      },
    });

    return booking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while getting ongoing booking for asset.",
    });
  }
}

/**
 * Replaces the per-booking notification recipients with the given team
 * member IDs. Uses Prisma's `set` operation, so the caller must provide
 * the complete desired list — any previously connected team members not
 * in `teamMemberIds` will be disconnected.
 *
 * These per-booking recipients are resolved in step 6 of
 * `getBookingNotificationRecipients()` and receive emails with the
 * `"booking_recipient"` reason label.
 *
 * @param bookingId - The booking to update
 * @param organizationId - Scoping to ensure the booking belongs to this org
 * @param teamMemberIds - Complete list of team member IDs. Pass `[]` to clear.
 */
export async function updateBookingNotificationRecipients({
  bookingId,
  organizationId,
  teamMemberIds,
}: {
  bookingId: string;
  organizationId: string;
  teamMemberIds: string[];
}) {
  try {
    // Validate that all provided team member IDs belong to this organization
    // and have a valid email, preventing cross-org data injection.
    const validTeamMembers = await db.teamMember.findMany({
      where: {
        id: { in: teamMemberIds },
        organizationId,
        user: { isNot: null },
      },
      select: { id: true },
    });
    const validTeamMemberIds = validTeamMembers.map((m) => m.id);

    return await db.booking.update({
      where: { id: bookingId, organizationId },
      data: {
        notificationRecipients: {
          set: validTeamMemberIds.map((id) => ({ id })),
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update booking notification recipients",
      additionalData: { bookingId, organizationId, teamMemberIds },
      label,
    });
  }
}
