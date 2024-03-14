import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
// import { ErrorBoundryComponent } from "~/components/errors";

import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  await requirePermission({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.customField,
    action: PermissionAction.read,
  });

  return null;
}

export const handle = {
  breadcrumb: () => <Link to="/settings/custom-fields">Custom Fields</Link>,
};

// export const shouldRevalidate = () => false;

export default function CustomFieldsPage() {
  return <Outlet />;
}

// export const ErrorBoundary = () => <ErrorBoundryComponent />;
