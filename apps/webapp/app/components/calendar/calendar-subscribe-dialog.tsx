/**
 * Calendar subscribe dialog.
 *
 * Lets a member subscribe their external calendar (Google / Apple / Outlook) to
 * a live feed of their Shelf bookings via a secret URL, and copy / regenerate /
 * revoke that URL. Mirrors the `CreateBookingDialog` trigger pattern so it sits
 * in the calendar page header.
 *
 * @see {@link file://./../../routes/api+/calendar-subscription.ts}
 * @see {@link file://./../../routes/api+/calendar.feed.$token[.ics].ts}
 */
import { type ReactElement, cloneElement, useState } from "react";
import { CheckIcon, CopyIcon, LinkIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { Dialog, DialogPortal } from "../layout/dialog";

type CalendarSubscribeDialogProps = {
  /** The member's current feed URL, or `null` until they generate one. */
  calendarFeedUrl: string | null;
  /** Element that opens the dialog; its `onClick` is wired here. */
  trigger: ReactElement<{ onClick: () => void }>;
};

/**
 * Calendar subscribe dialog. Shows the member's secret feed URL with copy,
 * `webcal://` add, regenerate and revoke actions — or a "generate" button when
 * no feed exists yet. Mutations go through `/api/calendar-subscription` via a
 * fetcher, whose result overrides the loader-seeded URL.
 *
 * @param props.calendarFeedUrl - The member's current feed URL, or `null` if not generated yet.
 * @param props.trigger - Element that opens the dialog; its `onClick` is wired here.
 * @returns The subscribe dialog UI.
 */
export default function CalendarSubscribeDialog({
  calendarFeedUrl,
  trigger,
}: CalendarSubscribeDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Two-step confirm for "Stop sharing" so an accidental click can't silently
  // break an already-subscribed external calendar.
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const fetcher = useFetcher<
    { calendarFeedUrl: string | null } | { error: { message: string } }
  >();
  const disabled = useDisabled(fetcher);

  // A completed fetcher (generate/regenerate/revoke) overrides the loader value.
  // Revoke returns null, so check for presence of the key rather than truthiness.
  const url =
    fetcher.data && "calendarFeedUrl" in fetcher.data
      ? fetcher.data.calendarFeedUrl
      : calendarFeedUrl;
  const webcalUrl = url ? url.replace(/^https?:\/\//, "webcal://") : null;

  // Server-side failures return an error payload; surface it inline so the
  // dialog never looks like a no-op when a mutation fails (client-side fallback
  // to the toast that the action already fires).
  const fetcherError =
    fetcher.data && "error" in fetcher.data
      ? fetcher.data.error?.message
      : null;

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The Clipboard API can reject (non-secure context / denied permission).
      // The URL input is selectable as a manual fallback, so fail quietly.
    }
  }

  return (
    <>
      {cloneElement(trigger, { onClick: () => setIsOpen(true) })}

      <DialogPortal>
        <Dialog
          className="overflow-auto py-0 md:max-h-[85vh] lg:w-[600px]"
          open={isOpen}
          onClose={() => {
            setIsOpen(false);
            setConfirmingRevoke(false);
          }}
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

            {url ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="calendar-feed-url" className="sr-only">
                    Calendar feed URL
                  </label>
                  <input
                    id="calendar-feed-url"
                    readOnly
                    value={url}
                    onFocus={(event) => event.currentTarget.select()}
                    className="grow truncate rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={copyUrl}
                    aria-label="Copy calendar link"
                  >
                    {copied ? (
                      <CheckIcon className="size-4" />
                    ) : (
                      <CopyIcon className="size-4" />
                    )}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {webcalUrl ? (
                    <Button to={webcalUrl} variant="primary">
                      Add to calendar
                    </Button>
                  ) : null}
                  <fetcher.Form
                    method="post"
                    action="/api/calendar-subscription"
                  >
                    <input type="hidden" name="intent" value="regenerate" />
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={disabled}
                    >
                      {disabled ? "Working…" : "Regenerate"}
                    </Button>
                  </fetcher.Form>
                  {confirmingRevoke ? (
                    <fetcher.Form
                      method="post"
                      action="/api/calendar-subscription"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="intent" value="revoke" />
                      <span className="text-sm text-gray-600">
                        Stop updating this link?
                      </span>
                      <Button
                        type="submit"
                        variant="danger"
                        disabled={disabled}
                      >
                        {disabled ? "Stopping…" : "Yes, stop"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setConfirmingRevoke(false)}
                        disabled={disabled}
                      >
                        Cancel
                      </Button>
                    </fetcher.Form>
                  ) : (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => setConfirmingRevoke(true)}
                    >
                      Stop sharing
                    </Button>
                  )}
                </div>

                <p className="text-xs text-gray-500">
                  In Google Calendar:{" "}
                  <strong>Other calendars → From URL</strong>, then paste the
                  link. Regenerating creates a new link and stops the old one —
                  use it if the link is ever shared by mistake.
                </p>
              </div>
            ) : (
              <fetcher.Form method="post" action="/api/calendar-subscription">
                <input type="hidden" name="intent" value="generate" />
                <Button type="submit" variant="primary" disabled={disabled}>
                  {disabled ? "Generating…" : "Generate calendar link"}
                </Button>
              </fetcher.Form>
            )}

            {fetcherError ? (
              <p role="alert" className="mt-3 text-sm text-error-500">
                {fetcherError}
              </p>
            ) : null}
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
