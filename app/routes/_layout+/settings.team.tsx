import { OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { Outlet, useLoaderData, useParams } from "react-router";
import { ErrorContent } from "~/components/errors";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import type { Item } from "~/components/layout/horizontal-tabs/types";
import When from "~/components/when/when";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export type UserFriendlyRoles =
  | "Administrator"
  | "Owner"
  | "Base"
  | "Self service";

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
    return payload({
      isPersonalOrg: currentOrganization.type === "PERSONAL",
      orgName: currentOrganization.name,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
};

export const organizationRolesMap: Record<string, UserFriendlyRoles> = {
  [OrganizationRoles.ADMIN]: "Administrator",
  [OrganizationRoles.OWNER]: "Owner",
  [OrganizationRoles.BASE]: "Base",
  [OrganizationRoles.SELF_SERVICE]: "Self service",
};

export default function TeamSettings() {
  const { isPersonalOrg, orgName } = useLoaderData<typeof loader>();

  const TABS: Item[] = [
    ...(!isPersonalOrg
      ? [
          { to: "users", content: "Users" },
          { to: "invites", content: "Invites" },
        ]
      : []),
    { to: "nrm", content: "Non-registered members" },
  ];

  const params = useParams();

  return (
    <>
      <When truthy={!params.userId}>
        <div className="rounded border bg-white p-4 md:px-10 md:py-8">
          <h1 className="text-[18px] font-semibold">
            {isPersonalOrg ? "Team" : `${orgName}’s team`}
          </h1>
          <p className="mb-6 text-sm text-gray-600">
            Manage your existing team and give team members custody to certain
            assets.
          </p>
          <HorizontalTabs items={TABS} />
          <Outlet />
        </div>
      </When>
      <When truthy={!!params?.userId?.length}>
        <Outlet />
      </When>
    </>
  );
}
export const ErrorBoundary = () => <ErrorContent />;
