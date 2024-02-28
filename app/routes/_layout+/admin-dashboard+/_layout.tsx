import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";

import HorizontalTabs from "~/components/layout/horizontal-tabs";

import { requireAdmin } from "~/utils/roles.server";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  await requireAdmin(authSession.userId);

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/admin-dashboard">Admin dashboard</Link>,
};

const items = [
  { to: "users", content: "Users" },
  { to: "announcements", content: "Announcements" },
];

export default function Area51Page() {
  return (
    <div>
      <HorizontalTabs items={items} />
      <div>
        <Outlet />
      </div>
    </div>
  );
}

// export const ErrorBoundary = () => <ErrorBoundryComponent />;
