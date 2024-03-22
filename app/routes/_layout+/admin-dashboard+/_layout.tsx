import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, json } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";

import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { requireAdmin } from "~/utils/roles.server";
import { data, error } from "~/utils/http.server";
import { makeShelfError } from "~/utils/error";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
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

export const ErrorBoundary = () => <ErrorContent />;
