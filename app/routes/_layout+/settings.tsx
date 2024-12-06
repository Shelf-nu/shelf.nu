import type { MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useMatches } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import When from "~/components/when/when";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { data } from "~/utils/http.server";

export const handle = {
  breadcrumb: () => <Link to="/settings">Settings</Link>,
};

export function loader() {
  const title = "Settings";
  const subHeading = "Manage your preferences here.";
  const header = {
    title,
    subHeading,
  };

  return json(data({ header }));
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const shouldRevalidate = () => false;

export default function SettingsPage() {
  let items = [
    { to: "general", content: "General" },
    { to: "custom-fields", content: "Custom fields" },
    { to: "team", content: "Team" },
  ];

  const { isBaseOrSelfService } = useUserRoleHelper();
  /** If user is self service, remove the extra items */
  if (isBaseOrSelfService) {
    items = items.filter(
      (item) => !["custom-fields", "team", "general"].includes(item.to)
    );
  }

  const matches = useMatches();
  const currentRoute = matches.at(-1);
  return (
    <>
      <Header hidePageDescription />
      <When
        truthy={
          !["$userId.assets", "$userId.bookings"].includes(
            // @ts-expect-error
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
