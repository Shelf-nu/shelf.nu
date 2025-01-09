import { useMemo } from "react";
import type { InviteStatuses } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, Link, Outlet, redirect, useMatches } from "@remix-run/react";
import ContextualModal from "~/components/layout/contextual-modal";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import InviteUserDialog from "~/components/settings/invite-user-dialog";
import { Button } from "~/components/shared/button";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import { Td, Th } from "~/components/table";
import { TeamUsersActionsDropdown } from "~/components/workspace/users-actions-dropdown";
import { db } from "~/database/db.server";

import { getPaginatedAndFilterableSettingInvites } from "~/modules/invite/service.server";
import type { TeamMembersWithUserOrInvite } from "~/modules/settings/service.server";
import { resolveUserAction } from "~/modules/user/utils.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import type { RouteHandleWithName } from "./bookings";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.read,
    });

    /** Get the organization */
    const organization = await db.organization.findFirst({
      where: { id: organizationId },
      include: { owner: true },
    });

    if (!organization) {
      throw new ShelfError({
        cause: null,
        message: "Organization not found",
        additionalData: { organizationId, userId },
        label: "Team",
      });
    }

    /** Cannot manage users for PERSONAL organization */
    if (organization?.type === "PERSONAL") {
      return redirect("/settings/general");
    }

    const { page, perPage, search, items, totalItems, totalPages } =
      await getPaginatedAndFilterableSettingInvites({
        organizationId,
        request,
      });

    const header: HeaderData = {
      title: `Settings - ${organization.name}`,
    };

    const modelName = {
      singular: "pending invite",
      plural: "pending invites",
    };

    return {
      header,
      items,
      totalItems,
      page,
      perPage,
      search,
      totalPages,
      modelName,
      organization,
    };
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

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
    return json(error(reason), { status: reason.status });
  }
}

export const handle = {
  name: "settings.team.users",
  breadcrumb: () => <Link to="/settings/team">Team</Link>,
};

export default function UserInvitesSetting() {
  /**
   * We have 4 cases when we should render index:
   * 1. When we are on the index route
   * 2. When we are on the .new route - the reason we do this is because we want to have the .new modal overlaying the index.
   * 3. When we are on the assets.$assetId.bookings page
   * 4. When we are on the settings.team.users.$userId.bookings
   */
  const matches = useMatches();
  const currentRoute: RouteHandleWithName = matches[matches.length - 1];
  const allowedRoutes = [
    "settings.team.users", // users index
    "settings.team.invites.invite-user", // invite user modal
  ];

  const shouldRenderIndex = allowedRoutes.includes(currentRoute?.handle?.name);

  return shouldRenderIndex ? (
    <div>
      <ContextualModal />

      <p className="mb-6 text-xs text-gray-600">
        Users by default have a mail registered in shelf and can get reminders,
        log in or perform other actions. Read more about our{" "}
        <Link
          to="https://www.shelf.nu/knowledge-base/user-roles-and-their-permissions"
          target="_blank"
          className="underline"
        >
          permissions here
        </Link>
        .
      </p>

      <ListContentWrapper>
        <Filters>
          <InviteUserDialog
            trigger={
              <Button
                variant="primary"
                className="mt-2 w-full md:mt-0 md:w-max"
              >
                <span className=" whitespace-nowrap">Invite a user</span>
              </Button>
            }
          />
        </Filters>

        <List
          className="overflow-x-visible md:overflow-x-auto"
          ItemComponent={UserRow}
          headerChildren={
            <>
              <Th>
                <div className="flex items-center gap-1 [&_svg]:size-[15px]">
                  Custodies{" "}
                  <InfoTooltip content="Custodies count includes only direct asset custodies and doesn't count any assets assigned via bookings." />
                </div>
              </Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </>
          }
        />
      </ListContentWrapper>
    </div>
  ) : (
    <Outlet />
  );
}

function UserRow({ item }: { item: TeamMembersWithUserOrInvite }) {
  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <TeamMemberDetails details={item} />
      </Td>
      <Td>{item.custodies || 0}</Td>
      <Td>{item.role}</Td>
      <Td>
        <InviteStatusBadge status={item.status} />
      </Td>
      <Td className="text-right">
        {item.role !== "Owner" ? (
          <TeamUsersActionsDropdown
            inviteStatus={item.status}
            userId={item.userId}
            name={item.name}
            email={item.email} // In this case we can assume that inviteeEmail is defined because we only render this dropdown for existing users
            isSSO={item.sso || false}
            role={item.role}
          />
        ) : null}
      </Td>
    </>
  );
}

const InviteStatusBadge = ({ status }: { status: InviteStatuses }) => {
  const colorClasses = useMemo(() => {
    switch (status) {
      case "PENDING":
        return "bg-gray-200 text-gray-700";
      case "ACCEPTED":
        return "bg-success-50 text-success-700";
      case "REJECTED":
        return "bg-error-50 text-error-700";
      default:
        return "bg-gray-200 text-gray-700";
    }
  }, [status]);

  return (
    <span
      className={tw(
        "inline-flex justify-center rounded-2xl bg-gray-100 px-2 py-[2px] text-center text-[12px] font-medium text-gray-700",
        colorClasses
      )}
    >
      <span>{status}</span>
    </span>
  );
};

const TeamMemberDetails = ({
  details,
}: {
  details: TeamMembersWithUserOrInvite;
}) => (
  <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
    <div className="flex items-center gap-3">
      <div className="flex size-12 shrink-0 items-center justify-center">
        <img src={details.img} alt="custodian" className="size-10 rounded" />
      </div>
      <div className="min-w-[130px]">
        <span className="word-break mb-1 block font-medium">
          {details.name}
        </span>
        <div>{details.email}</div>
      </div>
    </div>
  </div>
);
