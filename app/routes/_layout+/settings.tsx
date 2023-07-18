import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import Header from "~/components/layout/header";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { requireAuthSession } from "~/modules/auth";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const handle = {
  breadcrumb: () => <Link to="/settings">Settings</Link>,
};

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);
  const title = "Settings";
  const subHeading = "Manage your preferences here.";
  const header = {
    title,
    subHeading,
  };
  return json({ header });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const shouldRevalidate = () => false;

export default function SettingsPage() {
  const items = [
    { to: "user", content: "My details" },
    { to: "workspaces", content: "Workspaces" },
  ];
  return (
    <>
      <Header />
      <div>
        <HorizontalTabs items={items} />
        <div>
          <Outlet />
        </div>
      </div>
    </>
  );
}
