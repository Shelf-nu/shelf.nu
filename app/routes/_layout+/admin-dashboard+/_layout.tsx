import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, json } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";

import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

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
  {
    to: "users",
    content: "Users",
    isActive: (pathname: string) =>
      pathname.includes("admin-dashboard") &&
      (pathname.includes("users") ||
        pathname.includes("members") ||
        pathname.includes("assets") ||
        pathname.includes("qr-codes")),
  },
  { to: "qrs", content: "QR codes" },
  { to: "announcements", content: "Announcements" },
  { to: "updates", content: "Updates" },
  { to: "move-location-images", content: "Move location images" },
  { to: "generate-locations", content: "Generate locations" },
  { to: "test-supabase-rls", content: "Test Supabase RLS" },
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
