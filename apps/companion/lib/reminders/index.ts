/**
 * Booking reminders — public surface (consumed exports only).
 *
 * Local due-back notifications for bookings checked out from this device:
 * scheduled on checkout, cancelled on check-in/cancel/archive/delete and
 * sign-out, and re-derived from the server on every app foreground so they
 * can never nag about gear that is already back.
 *
 * The pure planner and the reconcile/init internals are deliberately NOT
 * re-exported here — the hook consumes them directly from ./service and
 * ./plan, and an unused public surface is just dead API to maintain.
 *
 * @see {@link file://./plan.ts} pure planner (what fires, when)
 * @see {@link file://./service.ts} runtime (schedule/cancel/reconcile)
 * @see {@link file://./use-booking-reminders.ts} app wiring hook
 */
export {
  cancelBookingReminders,
  loadRemindersPreference,
  setRemindersEnabled,
  syncBookingReminders,
} from "./service";
export { useBookingReminders } from "./use-booking-reminders";
// NOTE: clearAllBookingReminders is deliberately not re-exported here — its
// one consumer (auth-context) deep-imports ./service to avoid a require
// cycle through the org-context-using hook this barrel pulls in.
