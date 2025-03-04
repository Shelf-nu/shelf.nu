import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => <Link to="/receipts">Receipts</Link>,
};

export default function ReceiptsLayout() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
