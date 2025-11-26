import { data, redirect, type LoaderFunctionArgs } from "react-router";
import { ErrorContent } from "~/components/errors";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * We are not going to render anything on /settings/team route
 * instead we are going to redirect user to /settings/team/users
 */
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    const { currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.read,
    });
    const isPersonalOrg = currentOrganization.type === "PERSONAL";
    return redirect(
      isPersonalOrg ? "/settings/team/nrm" : "/settings/team/users"
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
};

export const shouldRevalidate = () => false;
export const ErrorBoundary = () => <ErrorContent />;
