import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import { ShelfStackError } from "~/utils/error";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import { canUseBookings } from "~/utils/subscription";

export async function loader({ request }: LoaderFunctionArgs) {
  const { currentOrganization } = await requirePermision(
    request,
    PermissionEntity.booking,
    PermissionAction.read
  );

  if (!canUseBookings(currentOrganization)) {
    throw new ShelfStackError({
      message:
        "You do not have access to this feature. Consider upgrading to a Team workspace to use bookings",
      status: 403,
    });
  }

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/bookings">Bookings</Link>,
};

export default function BookingsPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
