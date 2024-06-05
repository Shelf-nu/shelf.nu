import type { MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useRouteLoaderData } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import type { loader as layoutLoader } from "~/routes/_layout+/_layout";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { data } from "~/utils/http.server";

export const handle = {
  breadcrumb: () => <Link to="/account-details">Account Details</Link>,
};

export function loader() {
  const title = "Account Details";
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

export default function AccountDetailsPage() {
  let items = [
    { to: "general", content: "General" },
    { to: "workspace", content: "Workspaces" },
  ];

  const userIsSelfService = useUserIsSelfService();
  /** If user is self service, remove the extra items */
  if (userIsSelfService) {
    items = items.filter((item) => !["general"].includes(item.to));
  }

  const enablePremium = useRouteLoaderData<typeof layoutLoader>(
    "routes/_layout+/_layout"
  )?.enablePremium;

  if (enablePremium && !userIsSelfService) {
    items.push({ to: "subscription", content: "Subscription" });
  }

  return (
    <>
      <Header hidePageDescription />
      <HorizontalTabs items={items} />
      <div>
        <Outlet />
      </div>
    </>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
