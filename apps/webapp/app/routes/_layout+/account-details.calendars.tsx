/**
 * Calendars settings tab.
 *
 * Central place for a member to manage their subscribable iCal booking feed
 * across every workspace they belong to, instead of hunting for the
 * "Subscribe" control on each workspace's `/calendar` page individually. Each
 * eligible workspace gets its own card with the shared
 * {@link CalendarFeedControls} lifecycle UI (generate / copy / regenerate /
 * stop sharing).
 *
 * @see {@link file://./../../modules/calendar-subscription/service.server.ts}
 * @see {@link file://./../../components/calendar/calendar-feed-controls.tsx}
 * @see {@link file://./account-details.tsx}
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useLoaderData } from "react-router";
import CalendarFeedControls from "~/components/calendar/calendar-feed-controls";
import { ErrorContent } from "~/components/errors";
import { Card } from "~/components/shared/card";
import { GrayBadge } from "~/components/shared/gray-badge";
import { getMemberCalendarFeeds } from "~/modules/calendar-subscription/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Loads the calling member's calendar feeds across all of their eligible
 * workspaces (those entitled to bookings, excluding an SSO user's personal
 * workspace).
 *
 * @throws {ShelfError} If the caller lacks read permission on their own user
 *   data (via `requirePermission`).
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.userData,
      action: PermissionAction.read,
    });

    const title = "Calendars";
    const feeds = await getMemberCalendarFeeds({ userId });

    return payload({ title, feeds });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const handle = {
  breadcrumb: () => "Calendars",
};

/**
 * Renders a single card holding an intro, then a divided list of the member's
 * eligible workspaces (each with its own feed controls), with a shared
 * "how to subscribe" footer. Shows an empty state when the member has no
 * workspace with bookings enabled yet.
 */
export default function CalendarsSettings() {
  const { feeds } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-6">
      {/* One card, split into full-bleed sections by dividers. `p-0` clears the
          Card's default padding so each section owns its own padding. */}
      <Card className="my-0 p-0">
        {/* Intro: what calendar feeds are + the privacy warning. */}
        <div className="border-b border-gray-200 px-4 py-5 md:px-6">
          <h3 className="text-text-lg font-semibold text-gray-900">
            Calendars
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Subscribe your external calendar (Google, Apple or Outlook) to a
            live feed of your Shelf bookings, per workspace. Calendars refresh
            on their app’s own schedule (often a few hours). Keep these links
            private — anyone with one can see those bookings.
          </p>
        </div>

        {/* Workspaces: one row per workspace that can have a booking calendar. */}
        <section className="px-4 py-5 md:px-6">
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            Workspaces
          </h4>

          {feeds.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">
              You don’t have any workspaces with bookings yet.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {feeds.map((feed) => (
                <div
                  key={feed.organizationId}
                  className="rounded border border-gray-200 p-4"
                >
                  <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-3">
                    <h5 className="text-sm font-semibold text-gray-900">
                      {feed.name}
                    </h5>
                    <GrayBadge>
                      {feed.role.toLowerCase().replace("_", " ")}
                    </GrayBadge>
                  </div>
                  <CalendarFeedControls
                    organizationId={feed.organizationId}
                    calendarFeedUrl={feed.feedUrl}
                    showHelp={false}
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* One shared "how to subscribe" note for the whole list. */}
        {feeds.length > 0 ? (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 md:px-6">
            <p className="text-xs text-gray-500">
              In Google Calendar: <strong>Other calendars → From URL</strong>,
              then paste a link. Regenerating creates a new link and stops the
              old one.
            </p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
