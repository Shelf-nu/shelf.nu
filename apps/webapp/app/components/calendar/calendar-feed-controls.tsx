/**
 * Calendar feed controls.
 *
 * The reusable body of the "subscribe to your booking calendar" experience:
 * shows the member's secret feed URL with copy / `webcal://` add / regenerate
 * / revoke actions, or a "generate" CTA when no feed exists yet. Shared by
 * {@link CalendarSubscribeDialog} (the calendar page header trigger) and the
 * upcoming Calendars settings tab, so the feed lifecycle only lives in one
 * place.
 *
 * Mutations go through `/api/calendar-subscription` via this component's own
 * `useFetcher`; the fetcher result overrides the `calendarFeedUrl` prop the
 * caller seeds from its loader. The action is workspace-scoped, so every
 * form submission carries the caller-supplied `organizationId` alongside the
 * `intent`.
 *
 * @see {@link file://./calendar-subscribe-dialog.tsx}
 * @see {@link file://./../../routes/api+/calendar-subscription.ts}
 * @see {@link file://./../../routes/api+/calendar.feed.$token[.ics].ts}
 */
import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";

type CalendarFeedControlsProps = {
  /** Workspace whose feed these controls manage. */
  organizationId: string;
  /** The member's current feed URL for this workspace, or null. */
  calendarFeedUrl: string | null;
  /**
   * Whether to render the "how to subscribe" help under the actions. The
   * dialog shows it (self-contained); the settings tab hides it per-card and
   * shows a single shared line at the bottom instead. Defaults to `true`.
   */
  showHelp?: boolean;
};

/**
 * Renders the calendar feed lifecycle UI (generate / copy / add / regenerate
 * / revoke) for a single workspace.
 *
 * @param props.organizationId - Workspace whose feed these controls manage.
 *   Sent as a hidden field on every mutation so the action can scope the
 *   member's feed to this org (a member can belong to several).
 * @param props.calendarFeedUrl - The member's current feed URL for this
 *   workspace, or `null` if not generated yet. Used until a fetcher mutation
 *   (generate/regenerate/revoke) returns a fresher value.
 * @returns The feed controls UI.
 */
export default function CalendarFeedControls({
  organizationId,
  calendarFeedUrl,
  showHelp = true,
}: CalendarFeedControlsProps) {
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

  // Reset the "Stop sharing" confirm whenever there's no active link (e.g. right
  // after a successful revoke). In the settings tab this component persists
  // across generate→revoke→generate, so without this a freshly generated link
  // would show the revoke confirm prematurely. (In the dialog it remounts per
  // open, so this is a no-op there.)
  useEffect(() => {
    if (!url) setConfirmingRevoke(false);
  }, [url]);

  // Server-side failures return an error payload; surface it inline so the
  // controls never look like a no-op when a mutation fails (client-side
  // fallback to the toast that the action already fires).
  const fetcherError =
    fetcher.data && "error" in fetcher.data
      ? fetcher.data.error?.message
      : null;

  /** Copies the current feed URL to the clipboard, with a manual fallback. */
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
              <Button to={webcalUrl} variant="secondary">
                Add to calendar
              </Button>
            ) : null}
            <fetcher.Form method="post" action="/api/calendar-subscription">
              <input
                type="hidden"
                name="organizationId"
                value={organizationId}
              />
              <input type="hidden" name="intent" value="regenerate" />
              <Button type="submit" variant="secondary" disabled={disabled}>
                {disabled ? "Working…" : "Regenerate"}
              </Button>
            </fetcher.Form>
            {confirmingRevoke ? (
              <fetcher.Form
                method="post"
                action="/api/calendar-subscription"
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="hidden"
                  name="organizationId"
                  value={organizationId}
                />
                <input type="hidden" name="intent" value="revoke" />
                <span className="text-sm text-gray-600">
                  Stop updating this link?
                </span>
                <Button type="submit" variant="danger" disabled={disabled}>
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

          {showHelp ? (
            <p className="text-xs text-gray-500">
              In Google Calendar: <strong>Other calendars → From URL</strong>,
              then paste the link. Regenerating creates a new link and stops the
              old one — use it if the link is ever shared by mistake.
            </p>
          ) : null}
        </div>
      ) : (
        <fetcher.Form method="post" action="/api/calendar-subscription">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="intent" value="generate" />
          <Button type="submit" variant="secondary" disabled={disabled}>
            {disabled ? "Generating…" : "Generate calendar link"}
          </Button>
        </fetcher.Form>
      )}

      {fetcherError ? (
        <p role="alert" className="mt-3 text-sm text-error-500">
          {fetcherError}
        </p>
      ) : null}
    </>
  );
}
