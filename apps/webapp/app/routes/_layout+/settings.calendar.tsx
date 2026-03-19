import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { ErrorContent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { useDisabled } from "~/hooks/use-disabled";
import {
  createCalendarFeed,
  getCalendarFeedForOrganization,
  regenerateCalendarFeed,
  revokeCalendarFeed,
} from "~/modules/calendar-feed/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { SERVER_URL } from "~/utils/env";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    const feed = await getCalendarFeedForOrganization({
      userId,
      organizationId,
    });

    const feedUrl =
      feed && feed.active ? `${SERVER_URL}/api/ical/${feed.token}` : null;

    const header: HeaderData = {
      title: "Calendar",
    };

    return payload({
      header,
      feedUrl,
      feedActive: feed?.active ?? false,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => "Calendar",
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const ErrorBoundary = () => <ErrorContent />;

const IntentSchema = z.object({
  intent: z.enum(["generate", "regenerate", "revoke"]),
});

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    const formData = await request.formData();
    const { intent } = parseData(formData, IntentSchema, {
      additionalData: { userId, organizationId },
    });

    switch (intent) {
      case "generate": {
        await createCalendarFeed({ userId, organizationId });
        sendNotification({
          title: "Calendar feed created",
          message:
            "Your calendar feed URL has been generated. " +
            "Add it to your calendar app to subscribe.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });
        return payload({ success: true });
      }
      case "regenerate": {
        await regenerateCalendarFeed({ userId, organizationId });
        sendNotification({
          title: "Calendar feed regenerated",
          message:
            "Your calendar feed URL has been regenerated. " +
            "Update the URL in your calendar app.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });
        return payload({ success: true });
      }
      case "revoke": {
        await revokeCalendarFeed({ userId, organizationId });
        sendNotification({
          title: "Calendar feed revoked",
          message:
            "Your calendar feed has been disabled. " +
            "External calendars will no longer sync.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });
        return payload({ success: true });
      }
      default: {
        throw new ShelfError({
          cause: null,
          message: "Invalid action",
          additionalData: { intent },
          label: "Settings",
        });
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function CalendarSettingsPage() {
  const { feedUrl, feedActive } = useLoaderData<typeof loader>();

  return (
    <div className="mb-2.5 flex flex-col justify-between">
      <Card className="my-0">
        <div className="mb-4 border-b pb-4">
          <h3 className="text-text-lg font-semibold">Calendar export (iCal)</h3>
          <p className="text-sm text-gray-600">
            Subscribe to your bookings from external calendar apps like Google
            Calendar, Outlook, or Apple Calendar. The feed is read-only and
            updates automatically.
          </p>
        </div>

        {feedUrl ? (
          <ActiveFeedSection feedUrl={feedUrl} />
        ) : (
          <InactiveFeedSection wasRevoked={feedActive === false} />
        )}
      </Card>

      <Card>
        <div className="mb-2">
          <h3 className="text-text-lg font-semibold">How it works</h3>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>
            Generate a unique feed URL below and add it to your calendar app as
            a subscription
          </li>
          <li>
            Your calendar will automatically sync your bookings (custodian or
            creator) from this workspace
          </li>
          <li>
            The feed includes RESERVED, ONGOING, OVERDUE, and COMPLETE bookings
          </li>
          <li>Calendar apps typically refresh every 12-24 hours</li>
          <li>
            Treat the feed URL like a password — anyone with it can view your
            booking schedule
          </li>
          <li>
            If you suspect your URL was compromised, regenerate it to invalidate
            the old one
          </li>
        </ul>
      </Card>
    </div>
  );
}

function ActiveFeedSection({ feedUrl }: { feedUrl: string }) {
  const fetcher = useFetcher();
  const disabled = useDisabled(fetcher);

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="calendar-feed-url"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Your feed URL
        </label>
        <div className="flex items-center gap-2">
          <input
            id="calendar-feed-url"
            type="text"
            readOnly
            value={feedUrl}
            className="w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-600"
            onFocus={(e) => e.target.select()}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(feedUrl);
            }}
          >
            Copy
          </Button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Add this URL as a calendar subscription in your calendar app.
        </p>
      </div>

      <div className="flex gap-2 border-t pt-4">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="regenerate" />
          <Button type="submit" variant="secondary" disabled={disabled}>
            {disabled ? "Regenerating..." : "Regenerate URL"}
          </Button>
        </fetcher.Form>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="revoke" />
          <Button type="submit" variant="danger" disabled={disabled}>
            {disabled ? "Revoking..." : "Revoke feed"}
          </Button>
        </fetcher.Form>
      </div>
    </div>
  );
}

function InactiveFeedSection({ wasRevoked }: { wasRevoked: boolean }) {
  const disabled = useDisabled();

  return (
    <div>
      {wasRevoked && (
        <p className="mb-3 text-sm text-gray-500">
          Your calendar feed was revoked. Generate a new one to re-enable
          syncing.
        </p>
      )}
      <Form method="post">
        <input type="hidden" name="intent" value="generate" />
        <Button type="submit" disabled={disabled}>
          {disabled ? "Generating..." : "Generate feed URL"}
        </Button>
      </Form>
    </div>
  );
}
