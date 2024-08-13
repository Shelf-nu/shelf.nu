import { useMemo } from "react";
import { InviteStatuses, OrganizationRoles } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, Link, redirect } from "@remix-run/react";
import { z } from "zod";
import { StatusFilter } from "~/components/booking/status-filter";
import { ChevronRight } from "~/components/icons/library";
import ContextualModal from "~/components/layout/contextual-modal";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { Td, Th } from "~/components/table";
import { TeamUsersActionsDropdown } from "~/components/workspace/users-actions-dropdown";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { revokeAccessEmailText } from "~/modules/invite/helpers";
import { createInvite } from "~/modules/invite/service.server";
import type { TeamMembersWithUserOrInvite } from "~/modules/settings/service.server";
import { getPaginatedAndFilterableSettingUsers } from "~/modules/settings/service.server";
import { revokeAccessToOrganization } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

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
      await getPaginatedAndFilterableSettingUsers({
        organizationId,
        request,
      });

    const header: HeaderData = {
      title: `Settings - ${organization.name}`,
    };

    const modelName = {
      singular: "user",
      plural: "users",
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

    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({
        intent: z.enum(["delete", "revokeAccess", "resend", "cancelInvite"]),
      }),
      {
        additionalData: {
          organizationId,
        },
      }
    );

    switch (intent) {
      case "delete": {
        const { teamMemberId } = parseData(
          formData,
          z.object({
            teamMemberId: z.string(),
          }),
          {
            additionalData: {
              organizationId,
              intent,
            },
          }
        );

        await db.teamMember
          .update({
            where: {
              id: teamMemberId,
            },
            data: {
              deletedAt: new Date(),
            },
          })
          .catch((cause) => {
            throw new ShelfError({
              cause,
              message: "Failed to delete team member",
              additionalData: { teamMemberId, userId, organizationId },
              label: "Team",
            });
          });

        return redirect(`/settings/team/users`);
      }
      case "revokeAccess": {
        const { userId: targetUserId } = parseData(
          formData,
          z.object({
            userId: z.string(),
          }),
          {
            additionalData: {
              organizationId,
              intent,
            },
          }
        );

        const user = await revokeAccessToOrganization({
          userId: targetUserId,
          organizationId,
        });

        const org = await db.organization
          .findUniqueOrThrow({
            where: {
              id: organizationId,
            },
            select: {
              name: true,
            },
          })
          .catch((cause) => {
            throw new ShelfError({
              cause,
              message: "Organization not found",
              additionalData: { organizationId },
              label: "Team",
            });
          });

        await sendEmail({
          to: user.email,
          subject: `Access to ${org.name} has been revoked`,
          text: revokeAccessEmailText({ orgName: org.name }),
        });

        sendNotification({
          title: `Access revoked`,
          message: `User with email ${user.email} no longer has access to this organization`,
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return redirect("/settings/team/users");
      }
      case "cancelInvite": {
        const { email: inviteeEmail } = parseData(
          formData,
          z.object({
            email: z.string(),
          }),
          {
            additionalData: {
              organizationId,
              intent,
            },
          }
        );

        await db.invite
          .updateMany({
            where: {
              inviteeEmail,
              organizationId,
              status: InviteStatuses.PENDING,
            },
            data: {
              status: InviteStatuses.INVALIDATED,
            },
          })
          .catch((cause) => {
            throw new ShelfError({
              cause,
              message: "Failed to cancel invites",
              additionalData: { userId, organizationId, inviteeEmail },
              label: "Team",
            });
          });

        sendNotification({
          title: "Invitation cancelled",
          message: "The invitation has successfully been cancelled.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return null;
      }
      case "resend": {
        const {
          email: inviteeEmail,
          name: teamMemberName,
          teamMemberId,
        } = parseData(
          formData,
          z.object({
            email: z.string(),
            name: z.string(),
            teamMemberId: z.string(),
          }),
          {
            additionalData: {
              organizationId,
              intent,
            },
          }
        );

        const invite = await createInvite({
          organizationId,
          inviteeEmail,
          teamMemberName,
          teamMemberId,
          inviterId: userId,
          roles: [OrganizationRoles.ADMIN],
          userId,
        });

        if (invite) {
          sendNotification({
            title: "Successfully invited user",
            message:
              "They will receive an email in which they can complete their registration.",
            icon: { name: "success", variant: "success" },
            senderId: userId,
          });
        }

        return json(data(null));
      }
      default: {
        throw new ShelfError({
          cause: null,
          message: "Invalid action",
          additionalData: { intent },
          label: "Team",
        });
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

const STATUS_FILTERS = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
};

export default function UserTeamSetting() {
  return (
    <div>
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
        <Filters
          slots={{
            "left-of-search": <StatusFilter statusItems={STATUS_FILTERS} />,
          }}
        >
          <Button
            variant="primary"
            to="invite-user"
            className="mt-2 w-full md:mt-0 md:w-max"
          >
            <span className=" whitespace-nowrap">Invite a user</span>
          </Button>
        </Filters>

        <List
          className="overflow-x-visible md:overflow-x-auto"
          ItemComponent={UserRow}
          headerChildren={
            <>
              <Th className="hidden md:table-cell">Role</Th>
              <Th className="hidden md:table-cell">Status</Th>
              <Th className="hidden md:table-cell">Actions</Th>
            </>
          }
        />
      </ListContentWrapper>

      <ContextualModal />
    </div>
  );
}

function UserRow({ item }: { item: TeamMembersWithUserOrInvite }) {
  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        {item.status === "ACCEPTED" ? (
          <Link to={`${item.id}/assets`}>
            <TeamMemberDetails details={item} />
          </Link>
        ) : (
          <TeamMemberDetails details={item} />
        )}
      </Td>
      <Td className="hidden md:table-cell">{item.role}</Td>
      <Td className="hidden md:table-cell">
        <InviteStatusBadge status={item.status} />
      </Td>
      <Td className="hidden text-right md:table-cell">
        {item.role !== "Owner" ? (
          <TeamUsersActionsDropdown
            inviteStatus={item.status}
            userId={item.userId}
            name={item.name}
            email={item.email} // In this case we can assume that inviteeEmail is defined because we only render this dropdown for existing users
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

    <button className="block md:hidden">
      <ChevronRight />
    </button>
  </div>
);
