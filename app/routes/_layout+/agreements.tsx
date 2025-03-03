import type { LoaderFunctionArgs } from "@remix-run/node";
import { data, Link, Outlet } from "@remix-run/react";
import { json } from "react-router";
import { ErrorContent } from "~/components/errors";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
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
  breadcrumb: () => <Link to="/agreements">Agreements</Link>,
};

export default function AgreementsLayout() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
