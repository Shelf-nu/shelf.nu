import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, Outlet, useLoaderData } from "react-router";
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
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getUserProfileForOrg } from "~/modules/user/service.server";
import { resolveUserAction } from "~/modules/user/utils.server";
import { getUserContactForDisplay } from "~/modules/user-contact/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import {
  ROLE_LABELS,
  isWorkspaceOwner,
  resolveRole,
} from "~/utils/permissions/role-access";
import { requirePermission } from "~/utils/roles.server";
import { resolveUserDisplayName } from "~/utils/user";

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

    const user = await getUserProfileForOrg({
      id: selectedUserId,
      organizationId,
      userOrganizations,
      request,
    });

    const userContact = await getUserContactForDisplay(user.id);

    const userName = resolveUserDisplayName(user);
    const header = {
      title: userName,
    };

    return payload({
      isPersonalOrg: currentOrganization.type === "PERSONAL",
      orgName: currentOrganization.name,
      organizationId,
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
    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.update,
    });

    return await resolveUserAction(request, organizationId, userId, access);
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
  const { user, organizationId } = useLoaderData<typeof loader>();
  const { roles } = useUserRoleHelper();

  /* Notes tab is only visible to ADMIN/OWNER roles.
   * BASE and SELF_SERVICE users will never see it.
   * Server-side permission check in the notes route loader provides a second layer of protection. */
  const canReadUserNotes = userHasPermission({
    roles,
    entity: PermissionEntity.teamMemberNote,
    action: PermissionAction.read,
  });

  /* Changing, revoking or re-inviting this member is a team-member update. */
  const canUpdateTeamMembers = userHasPermission({
    roles,
    entity: PermissionEntity.teamMember,
    action: PermissionAction.update,
  });

  const TABS: Item[] = [
    { to: "assets", content: "Assets" },
    { to: "bookings", content: "Bookings" },
    ...(canReadUserNotes ? [{ to: "notes", content: "Notes" }] : []),
  ];
  /**
   * We find the user's role in the current organization
   * by matching the organizationId, instead of assuming
   * the first organization is the correct one
   */
  const currentOrgMembership = user.userOrganizations.find(
    (uo) => uo.organizationId === organizationId
  );
  const membershipRoles =
    currentOrgMembership?.roles ?? user.userOrganizations[0]?.roles ?? [];
  /** The member's effective role: the one every policy decision reads. */
  const userOrgRoleEnum = resolveRole(membershipRoles);
  const userOrgRole = ROLE_LABELS[userOrgRoleEnum];
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

      <When truthy={canUpdateTeamMembers && !isWorkspaceOwner(membershipRoles)}>
        <AbsolutePositionedHeaderActions className="hidden w-full md:flex">
          <TeamUsersActionsDropdown
            userId={user.id}
            email={user.email}
            teamMemberId={user.teamMembers?.[0]?.id}
            inviteStatus={user?.teamMembers?.[0]?.receivedInvites?.[0]?.status}
            isSSO={user.sso}
            customTrigger={(disabled) => (
              <Button
                type="button"
                variant="secondary"
                width="full"
                disabled={disabled}
              >
                Actions
              </Button>
            )}
            role={userOrgRole}
            roleEnum={userOrgRoleEnum}
            roles={membershipRoles}
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
