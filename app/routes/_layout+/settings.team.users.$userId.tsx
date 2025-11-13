import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data , Outlet, useLoaderData } from "react-router";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import { AbsolutePositionedHeaderActions } from "~/components/layout/header/absolute-positioned-header-actions";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import type { Item } from "~/components/layout/horizontal-tabs/types";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { UserSubheading } from "~/components/user/user-subheading";
import When from "~/components/when/when";
import { TeamUsersActionsDropdown } from "~/components/workspace/users-actions-dropdown";
import { getUserFromOrg } from "~/modules/user/service.server";
import { resolveUserAction } from "~/modules/user/utils.server";
import { getUserContactById } from "~/modules/user-contact/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { organizationRolesMap } from "./settings.team";

export const loader = async ({
  request,
  context,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    const { currentOrganization, organizationId, userOrganizations } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.teamMemberProfile,
        action: PermissionAction.read,
      });

    const { userId: selectedUserId } = getParams(
      params,
      z.object({ userId: z.string() }),
      {
        additionalData: { userId },
      }
    );

    const user = await getUserFromOrg({
      id: selectedUserId,
      organizationId,
      userOrganizations,
      request,
      extraInclude: {
        teamMembers: {
          where: { organizationId },
          include: {
            receivedInvites: {
              where: { organizationId },
            },
          },
        },
      },
    });

    const userContact = await getUserContactById(user.id);

    const userName =
      (user.firstName ? user.firstName.trim() : "") +
      " " +
      (user.lastName ? user.lastName.trim() : "");
    const header = {
      title: userName,
    };

    return payload({
      isPersonalOrg: currentOrganization.type === "PERSONAL",
      orgName: currentOrganization.name,
      header,
      user: {
        ...user,
        contact: userContact,
      },
      userName,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
};

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.update,
    });

    return await resolveUserAction(request, organizationId, userId);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => "single",
};
export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export default function UserPage() {
  const { user } = useLoaderData<typeof loader>();
  const TABS: Item[] = [
    { to: "assets", content: "Assets" },
    { to: "bookings", content: "Bookings" },
  ];
  /**
   * We assume that the user has only one role in the organization
   * and we get the first role
   * We get the first organization as in the query it was already scoped to the current organization
   */
  const userOrgRole = organizationRolesMap[user.userOrganizations[0].roles[0]];
  return (
    <>
      <Header
        hideBreadcrumbs
        slots={{
          "left-of-title": (
            <img
              src={
                user.profilePicture
                  ? user.profilePicture
                  : "/static/images/asset-placeholder.jpg"
              }
              alt="team-member"
              className="mr-4 size-14 rounded"
            />
          ),
          "append-to-title": (
            <Badge color={"#808080"} withDot={false}>
              {userOrgRole}
            </Badge>
          ),
        }}
        subHeading={<UserSubheading user={user} />}
      />

      <When truthy={userOrgRole !== "Owner"}>
        <AbsolutePositionedHeaderActions className="hidden w-full md:flex">
          <TeamUsersActionsDropdown
            userId={user.id}
            email={user.email}
            teamMemberId={user.teamMembers[0].id}
            inviteStatus={user?.teamMembers?.[0]?.receivedInvites?.[0]?.status}
            isSSO={user.sso}
            customTrigger={(disabled) => (
              <Button variant="secondary" width="full" disabled={disabled}>
                Actions
              </Button>
            )}
            role={userOrgRole}
          />
        </AbsolutePositionedHeaderActions>
      </When>

      <HorizontalTabs items={TABS} className="mb-0" />

      <Outlet />
    </>
  );
}

export const ErrorBoundary = () => (
  <ErrorContent className="h-[calc(100vh_-_100px)]" />
);
