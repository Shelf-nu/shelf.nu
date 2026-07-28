/**
 * Booking reminder plan — the pure heart of the local-reminders feature.
 *
 * Given a booking's identity and due time, decide WHICH reminders should
 * exist and WHEN they fire. Everything else in the feature (scheduling,
 * cancelling, reconciling) treats this function's output as the single
 * source of truth, so every future change to reminder behaviour — new
 * reminder types, different lead times, quiet hours — is an edit HERE and
 * nowhere else.
 *
 * Deliberately dependency-free (no expo imports, no storage, no Date.now()
 * calls — `now` is a parameter) so it can be unit-tested and reasoned about
 * in isolation.
 *
 * @see {@link file://./service.ts} the runtime that schedules/cancels this plan
 */

/** Lead time for the "due soon" heads-up before a booking's due instant. */
export const DUE_SOON_LEAD_MS = 60 * 60 * 1000; // 1 hour

/** Discriminates the two v1 reminder types. */
export type ReminderType = "due-soon" | "due-now";

/** One reminder to schedule: an absolute fire time plus display strings. */
export type PlannedReminder = {
  type: ReminderType;
  /**
   * Absolute instant to fire. Always scheduled as a fixed date (never
   * calendar components) so DST shifts and timezone travel cannot move it
   * relative to the booking's real due instant.
   */
  fireAt: Date;
  title: string;
  body: string;
  /**
   * Payload delivered on tap, used to deep-link into the booking. Carries
   * `orgId` because the booking may belong to a workspace other than the
   * one active when the reminder fires — the tap handler switches first.
   */
  data: { type: ReminderType; bookingId: string; orgId: string };
};

/** The minimal booking shape the planner needs. */
export type PlannableBooking = {
  id: string;
  name: string;
  /** ISO due instant (`Booking.to`). Null/empty → no reminders. */
  to: string | null | undefined;
  /** Concrete assets on the booking, for the notification body. */
  assetCount?: number;
  /** Workspace the booking lives in, embedded in the tap payload. */
  orgId: string;
};

/**
 * Compute the reminders that should exist for a checked-out booking.
 *
 * Rules (decided in the launch spec, in this order):
 * - No due time → no reminders.
 * - Due instant unparsable → no reminders (defensive; server sends ISO).
 * - Already past due at planning time → no reminders. The booking is
 *   already visibly overdue in-app; firing a reminder for a moment that has
 *   gone reads as noise, not help.
 * - Due within the lead window → only "due-now" (a "due soon" whose fire
 *   time is already in the past must not fire immediately on checkout).
 * - Otherwise → "due-soon" at `to - lead` and "due-now" at `to`.
 *
 * @param booking - The booking to plan for.
 * @param now - The current instant (injected for testability).
 * @returns Reminders to schedule, soonest first. Possibly empty.
 */
export function computeReminderPlan(
  booking: PlannableBooking,
  now: Date
): PlannedReminder[] {
  if (!booking.to) return [];

  const due = new Date(booking.to);
  if (Number.isNaN(due.getTime())) return [];
  if (due.getTime() <= now.getTime()) return [];

  const itemsSuffix = formatItemsSuffix(booking.assetCount);
  const plan: PlannedReminder[] = [];

  const dueSoonAt = new Date(due.getTime() - DUE_SOON_LEAD_MS);
  if (dueSoonAt.getTime() > now.getTime()) {
    plan.push({
      type: "due-soon",
      fireAt: dueSoonAt,
      title: `"${booking.name}" is due back in 1 hour`,
      body: itemsSuffix ?? "Tap to open the booking",
      data: { type: "due-soon", bookingId: booking.id, orgId: booking.orgId },
    });
  }

  plan.push({
    type: "due-now",
    fireAt: due,
    title: `"${booking.name}" is due back now`,
    body: itemsSuffix ? `${itemsSuffix} still out` : "Tap to open the booking",
    data: { type: "due-now", bookingId: booking.id, orgId: booking.orgId },
  });

  return plan;
}

/**
 * "6 items" / "1 item" body fragment, or null when the count is unknown or
 * zero (a zero-asset booking can still be checked out via model requests,
 * but "0 items" in a notification reads broken).
 */
function formatItemsSuffix(assetCount: number | undefined): string | null {
  if (!assetCount || assetCount < 1) return null;
  return assetCount === 1 ? "1 item" : `${assetCount} items`;
}
