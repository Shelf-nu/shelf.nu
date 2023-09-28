import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  Outlet,
  useLocation,
} from "@remix-run/react";
import Header from "~/components/layout/header";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { useMatchesData } from "~/hooks";
import { requireAuthSession } from "~/modules/auth";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";


export const handle = {
  breadcrumb: () => <Link to="/settings">Settings</Link>,
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);
  const title = "Settings";
  const subHeading = "Manage your preferences here.";
  const header = {
    title,
    subHeading,
  };
  return json({ header });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const shouldRevalidate = () => false;

export default function SettingsPage() {
  const items = [
    { to: "user", content: "My details" },
    { to: "custom-fields", content: "Custom fields" },
    { to: "workspace", content: "Workspace" },
  ];

  /**
   * We check the location because based on our design,
   * the view /new should not inherit from the parent layouts
   * */
  const location = useLocation();
  const isCustomFieldsNew = location.pathname === "/settings/custom-fields/new";
  const enablePremium = useMatchesData<{ enablePremium: boolean }>("routes/_layout+/_layout")?.enablePremium;

  if (enablePremium) {
    items.push({ to: "subscription", content: "Subscription" });
  }

  return (
    <>
      {isCustomFieldsNew ? null : <Header />}
      <div>
        {isCustomFieldsNew ? null : <HorizontalTabs items={items} />}
        <div>
          <Outlet />
        </div>
      </div>
    </>
  );
}
