import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermision(
    request,
    PermissionEntity.location,
    PermissionAction.read
  );

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/locations">Locations</Link>,
};

export default function LocationsPage() {
  return <Outlet />;
}

// export const ErrorBoundary = () => <ErrorBoundryComponent />;
