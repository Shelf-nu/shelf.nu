import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, Outlet, redirect, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import Header from "~/components/layout/header";
import { AbsolutePositionedHeaderActions } from "~/components/layout/header/absolute-positioned-header-actions";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import type { Item } from "~/components/layout/horizontal-tabs/types";
import { TeamUsersActionsDropdown } from "~/components/workspace/users-actions-dropdown";
import { db } from "~/database/db.server";
import { revokeAccessEmailText } from "~/modules/invite/helpers";
import {
  getUserByID,
  revokeAccessToOrganization,
} from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import { sendEmail } from "~/emails/mail.server";
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

export const loader = async ({
  request,
  context,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    const { currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMemberProfile,
      action: PermissionAction.read,
    });

    const { userId: selectedUserId } = params;
    const user = await getUserByID(selectedUserId);
    const userName =
      (user.firstName ? user.firstName.trim() : "") +
      " " +
      (user.lastName ? user.lastName.trim() : "");
    const header = {
      title: userName,
    };

    return json(
      data({
        isPersonalOrg: currentOrganization.type === "PERSONAL",
        orgName: currentOrganization.name,
        header,
        user,
        userName,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
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
              className="size-14 rounded mr-4"
            />
          ),
        }}
        subHeading={user.email}
        classNames="-mt-5"
      ></Header>
      <AbsolutePositionedHeaderActions className="hidden md:flex w-full">
        <TeamUsersActionsDropdown
          userId={user.id}
          email={user.email}
          inviteStatus="ACCEPTED"
        />
      </AbsolutePositionedHeaderActions>
      <HorizontalTabs items={TABS} />

      <Outlet />
    </>
  );
}
