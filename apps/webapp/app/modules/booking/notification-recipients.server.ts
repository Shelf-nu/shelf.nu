/**
 * Booking Notification Recipient Resolver
 *
 * Central module for determining who should receive email notifications
 * for any booking-related event. All booking notification paths (immediate
 * actions, scheduled jobs, and update emails) funnel through this resolver
 * to ensure consistent recipient selection and deduplication.
 *
 * Resolution order (first-match wins for dedup):
 *   1. Custodian (always included)
 *   2. Booking creator (if org setting enabled)
 *   3. Organization admins (RESERVATION events only, if org setting enabled)
 *   4. Always-notify team members (org-level setting)
 *   5. Per-booking notification recipients
 *
 * After resolution, the editor (user performing the action) is excluded
 * from non-scheduled notifications so they don't email themselves.
 */
import type { BookingForEmail } from "~/emails/types";
import { getBookingNotificationSettingsForOrg } from "~/modules/booking-settings/service.server";
import { getOrganizationAdminsForNotification } from "~/modules/organization/service.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/**
 * Discriminated set of booking lifecycle events that trigger notifications.
 *
 * - `RESERVATION` — a new booking is confirmed / reserved
 * - `CHECKOUT_REMINDER` — scheduled reminder before checkout time
 * - `CHECKIN_REMINDER` — scheduled reminder before checkin time
 * - `CHECKIN` — booking assets have been checked in (completed)
 * - `OVERDUE` — booking has passed its end date without checkin
 * - `CANCEL` — booking was cancelled by a user
 * - `EXTEND` — booking end date was extended
 * - `DELETE` — booking was permanently deleted
 * - `UPDATE` — booking fields or assets were modified
 */
export type BookingEventType =
  | "RESERVATION"
  | "CHECKOUT_REMINDER"
  | "CHECKIN_REMINDER"
  | "CHECKIN"
  | "OVERDUE"
  | "CANCEL"
  | "EXTEND"
  | "DELETE"
  | "UPDATE";

/**
 * A resolved notification recipient with contextual reason.
 *
 * @property email - Recipient's email address
 * @property firstName - Recipient's first name (nullable for team-member-only users)
 * @property lastName - Recipient's last name (nullable for team-member-only users)
 * @property userId - The user's database ID, used for editor exclusion matching
 * @property reason - Why this person receives the notification; drives the
 *   personalized footer in the email template (see `NotificationReasonFooter`)
 */
export type NotificationRecipient = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  userId: string;
  reason:
    | "custodian"
    | "creator"
    | "admin"
    | "always_notify"
    | "booking_recipient";
};

/**
 * Resolves the list of recipients who should receive an email notification
 * for a given booking event.
 *
 * **Deduplication strategy:** Recipients are collected into a `Map` keyed by
 * email address. The first entry for a given email wins, so the order of
 * resolution (custodian -> creator -> admins -> always-notify -> per-booking)
 * determines which `reason` label a user gets if they appear in multiple
 * categories.
 *
 * **Editor exclusion:** The user who triggered the action (`editorUserId`)
 * is removed from the final list for immediate (non-scheduled) notifications,
 * so they don't receive an email for their own action. This exclusion is
 * skipped for scheduled jobs (`isScheduledJob: true`) because there is no
 * human editor in that context.
 *
 * **Error handling:** Returns an empty array on failure to avoid blocking
 * the booking flow. Errors are logged via `Logger.error`.
 *
 * @param booking - The booking with included relations (custodianUser, creator, etc.)
 * @param eventType - The booking event triggering the notification
 * @param organizationId - Used to fetch org-level notification settings and admins
 * @param editorUserId - The user performing the action; excluded from recipients
 *   unless this is a scheduled job
 * @param isScheduledJob - When true, skips editor exclusion (no human editor)
 * @returns Deduplicated list of recipients with valid email addresses
 */
export async function getBookingNotificationRecipients({
  booking,
  eventType,
  organizationId,
  editorUserId,
  isScheduledJob,
  isSelfServiceOrBase,
}: {
  booking: BookingForEmail;
  eventType: BookingEventType;
  organizationId: string;
  editorUserId?: string;
  isScheduledJob?: boolean;
  /** When true, the booking was created by a base/self-service user.
   *  Admin broadcast only fires for reservations made by these roles
   *  (preserving current behavior where admins are alerted to "pickup"
   *  requests from lower-role users). */
  isSelfServiceOrBase?: boolean;
}): Promise<NotificationRecipient[]> {
  try {
    const recipients = new Map<string, NotificationRecipient>();

    // 1. Custodian is always notified — added first so they get the
    //    "custodian" reason label even if they're also an admin or creator.
    if (booking.custodianUser?.email) {
      recipients.set(booking.custodianUser.email, {
        email: booking.custodianUser.email,
        firstName: booking.custodianUser.firstName ?? null,
        lastName: booking.custodianUser.lastName ?? null,
        userId: booking.custodianUser.id,
        reason: "custodian",
      });
    }

    // 2. Fetch org-level booking notification settings
    const settings = await getBookingNotificationSettingsForOrg(organizationId);

    // 3. Optionally add the booking creator
    if (settings.notifyBookingCreator && booking.creator?.email) {
      if (!recipients.has(booking.creator.email)) {
        recipients.set(booking.creator.email, {
          email: booking.creator.email,
          firstName: booking.creator.firstName ?? null,
          lastName: booking.creator.lastName ?? null,
          userId: booking.creator.id,
          reason: "creator",
        });
      }
    }

    // 4. Notify admins only on reservation requests from base/self-service
    //    users. This is the "pickup" broadcast — admins are alerted so someone
    //    can handle the request. Admins reserving their own bookings don't
    //    trigger this broadcast (preserving current behavior).
    if (
      settings.notifyAdminsOnNewBooking &&
      eventType === "RESERVATION" &&
      isSelfServiceOrBase
    ) {
      const admins = await getOrganizationAdminsForNotification({
        organizationId,
      });

      for (const admin of admins) {
        if (admin.email && !recipients.has(admin.email)) {
          recipients.set(admin.email, {
            email: admin.email,
            firstName: admin.firstName ?? null,
            lastName: admin.lastName ?? null,
            userId: admin.id,
            reason: "admin",
          });
        }
      }
    }

    // 5. Add always-notify team members from org settings
    for (const tm of settings.alwaysNotifyTeamMembers) {
      if (tm.user?.email && !recipients.has(tm.user.email)) {
        recipients.set(tm.user.email, {
          email: tm.user.email,
          firstName: tm.user.firstName ?? null,
          lastName: tm.user.lastName ?? null,
          userId: tm.user.id,
          reason: "always_notify",
        });
      }
    }

    // 6. Add per-booking notification recipients
    if (booking.notificationRecipients) {
      for (const tm of booking.notificationRecipients) {
        if (tm.user?.email && !recipients.has(tm.user.email)) {
          recipients.set(tm.user.email, {
            email: tm.user.email,
            firstName: tm.user.firstName ?? null,
            lastName: tm.user.lastName ?? null,
            userId: tm.user.id,
            reason: "booking_recipient",
          });
        }
      }
    }

    // 7. Exclude the editor from immediate (non-scheduled) notifications.
    //    Scheduled jobs (reminders, overdue) have no human editor, so
    //    skipping this step ensures all relevant parties are notified.
    //    Exception: the "creator" reason means the user explicitly opted in
    //    via the workspace setting — don't exclude them even if they're the
    //    editor, because the whole point is to stay informed about bookings
    //    they create for others.
    if (editorUserId && !isScheduledJob) {
      for (const [email, recipient] of recipients) {
        if (
          recipient.userId === editorUserId &&
          recipient.reason !== "creator" &&
          recipient.reason !== "custodian"
        ) {
          recipients.delete(email);
        }
      }
    }

    // 8. Return only entries with valid emails
    return Array.from(recipients.values()).filter(
      (r) => r.email && r.email.length > 0
    );
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message:
          "Failed to resolve booking notification recipients. Returning empty list to avoid blocking the booking flow.",
        additionalData: { organizationId, eventType },
        label: "Booking",
      })
    );
    return [];
  }
}

/**
 * Resolves recipients for the UI preview panel (e.g., the booking form
 * sidebar that shows "Who will be notified").
 *
 * Uses the `RESERVATION` event type because it produces the broadest
 * recipient set (includes admins), giving users the most complete preview.
 * No `editorUserId` is passed so nobody is excluded from the preview.
 *
 * @param booking - The booking (may be a draft with partial data)
 * @param organizationId - Used to look up org-level notification settings
 * @returns The full list of recipients that would be notified
 */
export async function resolveRecipientsForPreview({
  booking,
  organizationId,
}: {
  booking: BookingForEmail;
  organizationId: string;
}): Promise<NotificationRecipient[]> {
  return getBookingNotificationRecipients({
    booking,
    eventType: "RESERVATION",
    organizationId,
  });
}
