import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermision(
    request,
    PermissionEntity.booking,
    PermissionAction.read
  );

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/bookings">Bookings</Link>,
};

export default function BookingsPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
