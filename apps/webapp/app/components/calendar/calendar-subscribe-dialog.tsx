/**
 * Calendar subscribe dialog.
 *
 * Lets a member subscribe their external calendar (Google / Apple / Outlook) to
 * a live feed of their Shelf bookings via a secret URL, and copy / regenerate /
 * revoke that URL.
 *
 * Controlled by the caller — the calendar page owns the open state and opens it
 * from the "Subscribe" button in the calendar toolbar. The feed lifecycle UI
 * itself lives in {@link CalendarFeedControls}, shared with the Calendars
 * settings tab; this dialog only owns the open/close chrome (portal, header
 * icon, title/description).
 *
 * @see {@link file://./calendar-feed-controls.tsx}
 * @see {@link file://./../../routes/_layout+/calendar.tsx}
 * @see {@link file://./../../routes/api+/calendar-subscription.ts}
 */
import { LinkIcon } from "lucide-react";
import CalendarFeedControls from "~/components/calendar/calendar-feed-controls";
import { Dialog, DialogPortal } from "../layout/dialog";

type CalendarSubscribeDialogProps = {
  /** Workspace whose feed these controls manage. */
  organizationId: string;
  /** The member's current feed URL, or `null` until they generate one. */
  calendarFeedUrl: string | null;
  /** Whether the dialog is open (controlled by the caller). */
  open: boolean;
  /** Called when the dialog requests to close (backdrop / escape / close). */
  onClose: () => void;
};

/**
 * Controlled subscribe dialog. Shows the member's secret feed URL with copy,
 * `webcal://` add, regenerate and revoke actions — or a "generate" button when
 * no feed exists yet — via the shared {@link CalendarFeedControls}.
 *
 * @param props.organizationId - Workspace whose feed these controls manage.
 * @param props.calendarFeedUrl - The member's current feed URL, or `null` if not generated yet.
 * @param props.open - Whether the dialog is currently open.
 * @param props.onClose - Called when the dialog requests to close.
 * @returns The subscribe dialog UI.
 */
export default function CalendarSubscribeDialog({
  organizationId,
  calendarFeedUrl,
  open,
  onClose,
}: CalendarSubscribeDialogProps) {
  return (
    <DialogPortal>
      <Dialog
        className="overflow-auto py-0 md:max-h-[85vh] lg:w-[600px]"
        open={open}
        onClose={onClose}
        title={
          <div className="mt-4 inline-flex items-center justify-center rounded-full border-4 border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
            <LinkIcon />
          </div>
        }
      >
        <div className="px-6 py-4">
          <div className="mb-5">
            <h4>Subscribe to your booking calendar</h4>
            <p className="text-gray-600">
              Add a live calendar to Google, Apple or Outlook and your Shelf
              bookings appear automatically. Subscribed calendars refresh on
              your calendar app&apos;s own schedule (often a few hours), so
              updates are not instant. Keep this link private — anyone with it
              can see these bookings.
            </p>
          </div>

          {/* Render only while open so the child's "Stop sharing" confirm state
              resets each time the dialog is reopened. */}
          {open ? (
            <CalendarFeedControls
              organizationId={organizationId}
              calendarFeedUrl={calendarFeedUrl}
            />
          ) : null}
        </div>
      </Dialog>
    </DialogPortal>
  );
}
