/**
 * Notifications settings tab.
 *
 * Lets a person choose which push notifications reach their phones: one
 * master switch and one switch per `PushCategory`. Each switch saves on its
 * own as soon as it flips. The switches silence push only; emails are
 * unchanged. The companion app edits the same switches through
 * `/api/mobile/notification-preferences`.
 *
 * @see {@link file://./../../modules/push/preferences.server.ts}
 * @see {@link file://./../api+/mobile+/notification-preferences.ts}
 * @see {@link file://./account-details.tsx}
 */
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import { Switch } from "~/components/forms/switch";
import { Card } from "~/components/shared/card";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "~/modules/push/preferences.server";
import type { NotificationPreferenceKey } from "~/modules/push/types";
import { NOTIFICATION_PREFERENCE_KEYS } from "~/modules/push/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { error, parseData, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { filterOrganizationsWithPush } from "~/utils/subscription.server";

/** One switch change, as each switch submits it. */
const UpdatePreferenceSchema = z.object({
  preference: z.enum(NOTIFICATION_PREFERENCE_KEYS),
  enabled: z.enum(["on", "off"]).transform((value) => value === "on"),
});

/** The name and the one-sentence explanation shown for each switch. */
const SWITCH_COPY: Record<
  NotificationPreferenceKey,
  { label: string; help: string }
> = {
  pushEnabled: {
    label: "Push notifications",
    help: "Turn this off to pause every push to your phones; your choices below are kept for when you turn it back on.",
  },
  bookings: {
    label: "Bookings",
    help: "Updates and reminders about bookings you are the custodian of, such as check-out and check-in reminders and overdue notices.",
  },
  audits: {
    label: "Audits",
    help: "Audits assigned to you, with reminders before they are due, and a notice when an audit you are assigned to or created is overdue.",
  },
  stockAndReminders: {
    label: "Stock and reminders",
    help: "Asset reminders that you are included in, when they are due.",
  },
};

/** Reads the switches and whether any of the person's workspaces has push. */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.userData,
      action: PermissionAction.read,
    });

    const [preferences, organizationsWithPush] = await Promise.all([
      getNotificationPreferences(userId),
      filterOrganizationsWithPush(organizations.map(({ id }) => id)),
    ]);

    return payload({
      title: "Notifications",
      preferences,
      pushAvailable: organizationsWithPush.length > 0,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

/** Saves the one switch a row submitted. */
export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.userData,
      action: PermissionAction.update,
    });

    const { preference, enabled } = parseData(
      await request.formData(),
      UpdatePreferenceSchema,
      { additionalData: { userId } }
    );

    const preferences = await updateNotificationPreferences(userId, {
      [preference]: enabled,
    });

    return payload({ preferences });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const handle = {
  breadcrumb: () => "Notifications",
};

/**
 * One card: what push is and where it arrives, a plan note when none of the
 * person's workspaces includes push, then one row per switch.
 */
export default function NotificationSettings() {
  const { preferences, pushAvailable } = useLoaderData<typeof loader>();

  return (
    <Card className="my-0 p-0">
      <div className="border-b border-gray-200 px-4 py-5 md:px-6">
        <h3 className="text-text-lg font-semibold text-gray-900">
          Push notifications
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Push arrives on phones where you are signed in to the Shelf app.
        </p>
        {pushAvailable ? null : (
          <p className="mt-4 rounded border border-warning-300 bg-warning-25 p-4 text-sm text-warning-700">
            Push notifications are not included in your workspaces' plans.
          </p>
        )}
      </div>

      <ul className="px-4 md:px-6">
        {NOTIFICATION_PREFERENCE_KEYS.map((preference) => (
          <PreferenceSwitch
            key={preference}
            preference={preference}
            enabled={preferences[preference]}
          />
        ))}
      </ul>
    </Card>
  );
}

/**
 * A labelled switch that saves its own value when flipped. It shows the
 * submitted value while the save is in flight and falls back to the saved
 * value afterwards, so a rejected save flips it back. Server errors show
 * under the help text and are announced. Its fetcher key starts with
 * `notification-preference-`, which keeps the global progress bar still:
 * the switch itself already shows the change.
 *
 * @param props.preference - The switch this row controls
 * @param props.enabled - The saved value from the loader
 */
function PreferenceSwitch({
  preference,
  enabled,
}: {
  preference: NotificationPreferenceKey;
  enabled: boolean;
}) {
  const fetcher = useFetcher<DataOrErrorResponse>({
    key: `notification-preference-${preference}`,
  });
  const { label, help } = SWITCH_COPY[preference];
  const id = `notification-${preference}`;

  const submitted = fetcher.formData?.get("enabled");
  const checked = submitted ? submitted === "on" : enabled;

  const validationErrors = getValidationErrors<typeof UpdatePreferenceSchema>(
    fetcher.data?.error
  );
  const errorMessage =
    validationErrors?.enabled?.message ??
    validationErrors?.preference?.message ??
    fetcher.data?.error?.message;

  return (
    <li className="flex items-start justify-between gap-6 border-b border-gray-200 py-5 last:border-b-0">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-gray-900">
          {label}
        </label>
        <p id={`${id}-help`} className="mt-1 text-sm text-gray-600">
          {help}
        </p>
        {errorMessage ? (
          <p
            id={`${id}-error`}
            role="alert"
            className="mt-1 text-sm text-error-600"
          >
            {errorMessage}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(next) => {
          void fetcher.submit(
            { preference, enabled: next ? "on" : "off" },
            { method: "post" }
          );
        }}
        aria-describedby={
          errorMessage ? `${id}-help ${id}-error` : `${id}-help`
        }
      />
    </li>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
