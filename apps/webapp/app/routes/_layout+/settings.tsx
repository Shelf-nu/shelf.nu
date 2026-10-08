import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, Link, Outlet, useLoaderData, useMatches } from "react-router";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import When from "~/components/when/when";
import type { RouteHandleWithName } from "~/modules/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  SETTINGS_LAYOUT_GATES,
  visibleSettingsTabs,
} from "~/utils/permissions/settings-tabs";
import { requireAnyPermission } from "~/utils/roles.server";

export const handle = {
  breadcrumb: () => <Link to="/settings">Settings</Link>,
};

/**
 * Settings layout. Admits a member who can see at least one settings tab and
 * hands the component the tabs they may see.
 *
 * Each settings page keeps its own gate, so this layout grants nothing by
 * itself: hiding a tab never stands in for the page's own check.
 *
 * @see {@link file://../../utils/permissions/settings-tabs.ts}
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { currentOrganization, roles } = await requireAnyPermission({
      userId,
      request,
      anyOf: SETTINGS_LAYOUT_GATES,
    });

    const _isPersonalOrg = isPersonalOrg(currentOrganization);
    const tabs = visibleSettingsTabs({
      roles,
      isPersonalOrg: _isPersonalOrg,
    }).map(({ to, content }) => ({ to, content }));

    if (tabs.length === 0) {
      // A permission that opens a tab only in team workspaces (Bookings,
      // Emails) admits no one to a personal workspace's settings.
      throw new ShelfError({
        cause: null,
        title: "Unauthorized",
        message: "You have no permission to perform this action",
        additionalData: { userId },
        status: 403,
        label: "Permission",
        shouldBeCaptured: false,
      });
    }

    return payload({
      header: {
        title: "Settings",
        subHeading: "Manage your preferences here.",
      },
      _isPersonalOrg,
      tabs,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const shouldRevalidate = () => false;

export default function SettingsPage() {
  const { tabs } = useLoaderData<typeof loader>();

  const matches = useMatches();
  const currentRoute: RouteHandleWithName = matches[matches.length - 1];
  return (
    <>
      <Header hidePageDescription />
      <When
        truthy={
          !["$userId.assets", "$userId.bookings", "$userId.notes"].includes(
            currentRoute?.handle?.name
          )
        }
      >
        <HorizontalTabs items={tabs} />
      </When>
      <Outlet />
    </>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
