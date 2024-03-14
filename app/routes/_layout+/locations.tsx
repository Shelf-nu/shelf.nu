import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  await requirePermission({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.location,
    action: PermissionAction.read,
  });

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/locations">Locations</Link>,
};

export default function LocationsPage() {
  return <Outlet />;
}

// export const ErrorBoundary = () => <ErrorBoundryComponent />;
