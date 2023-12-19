import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import { requireAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/bookings">Bookings</Link>,
};

export default function BookingsPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
