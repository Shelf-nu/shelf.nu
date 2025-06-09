import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useMatches } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import When from "~/components/when/when";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { RouteHandleWithName } from "~/modules/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const handle = {
  breadcrumb: () => <Link to="/settings">Settings</Link>,
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { currentOrganization } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.generalSettings,
      action: PermissionAction.read,
    });

    const title = "Settings";
    const subHeading = "Manage your preferences here.";
    const header = {
      title,
      subHeading,
    };

    return json(
      data({ header, _isPersonalOrg: isPersonalOrg(currentOrganization) })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const shouldRevalidate = () => false;

export default function SettingsPage() {
  const { _isPersonalOrg } = useLoaderData<typeof loader>();
  let items = [
    { to: "general", content: "General" },
    ...(!_isPersonalOrg
      ? [{ to: "working-hours", content: "Working hours" }]
      : []),
    { to: "custom-fields", content: "Custom fields" },
    { to: "team", content: "Team" },
  ];

  const { isBaseOrSelfService } = useUserRoleHelper();
  /** If user is self service, remove the extra items */
  if (isBaseOrSelfService) {
    items = items.filter(
      (item) =>
        !["custom-fields", "team", "general", "working-hours"].includes(item.to)
    );
  }

  const matches = useMatches();
  const currentRoute: RouteHandleWithName = matches[matches.length - 1];
  return (
    <>
      <Header hidePageDescription />
      <When
        truthy={
          !["$userId.assets", "$userId.bookings"].includes(
            currentRoute?.handle?.name
          )
        }
      >
        <HorizontalTabs items={items} />
      </When>
      <Outlet />
    </>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
