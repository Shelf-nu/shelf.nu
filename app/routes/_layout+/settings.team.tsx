import { useMemo } from "react";
import {
  OrganizationRoles,
  type Custody,
  type Invite,
  InviteStatuses,
  type TeamMember,
} from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import ContextualModal from "~/components/layout/contextual-modal";
import type { HeaderData } from "~/components/layout/header/types";
import { TeamMembersTable } from "~/components/workspace/team-members-table";
import { UsersTable } from "~/components/workspace/users-table";
import { db } from "~/database";
import { createInvite } from "~/modules/invite";
import { revokeAccessEmailText } from "~/modules/invite/helpers";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { revokeAccessToOrganization } from "~/modules/user";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import { isPersonalOrg as checkIsPersonalOrg } from "~/utils/organization";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

type ActionIntent = "delete" | "revoke" | "resend" | "invite";
export type UserFriendlyRoles = "Administrator" | "Owner" | "Self service";
const organizationRolesMap: Record<string, UserFriendlyRoles> = {
  [OrganizationRoles.ADMIN]: "Administrator",
  [OrganizationRoles.OWNER]: "Owner",
  [OrganizationRoles.SELF_SERVICE]: "Self service",
};
export interface TeamMembersWithUserOrInvite {
  name: string;
  img: string;
  email: string;
  status: InviteStatuses;
  role: UserFriendlyRoles;
  userId: string | null;
}

type InviteWithTeamMember = Pick<
  Invite,
  "id" | "teamMemberId" | "inviteeEmail" | "status" | "roles"
> & {
  inviteeTeamMember: {
    name: string;
  };
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.teamMember,
    action: PermissionAction.read,
  });

  const { organizationId } = await requireOrganisationId({
    userId: authSession.userId,
    request,
  });
  const [organization, userMembers, invites, teamMembers] =
    await db.$transaction([
      /** Get the org */
      db.organization.findFirst({
        where: {
          id: organizationId,
        },
        include: {
          owner: true,
        },
      }),
      /** Get Users */
      db.userOrganization.findMany({
        where: {
          organizationId,
        },
        select: {
          user: true,
          roles: true,
        },
      }),
      /** Get the invites */
      db.invite.findMany({
        where: {
          organizationId,
          status: {
            in: [InviteStatuses.PENDING],
          },
          inviteeEmail: {
            not: "",
          },
        },
        distinct: ["inviteeEmail"],
        select: {
          id: true,
          teamMemberId: true,
          inviteeEmail: true,
          status: true,
          inviteeTeamMember: {
            select: {
              name: true,
            },
          },
          roles: true,
        },
      }),
      /** Get the teamMembers */
      /**
       * 1. Don't have any invites(userId:null)
       * 2. If they have invites, they should not be pending(userId!=null which mean invite is accepted so we only need to worry about pending ones)
       */
      db.teamMember.findMany({
        where: {
          deletedAt: null,
          organizationId,
          userId: null,
          receivedInvites: {
            none: {
              status: {
                in: [InviteStatuses.PENDING],
              },
            },
          },
        },
        include: {
          _count: {
            select: {
              custodies: true,
            },
          },
        },
      }),
    ]);
  if (!organization) {
    throw new Error("Organization not found");
  }

  const header: HeaderData = {
    title: `Settings - ${organization.name}`,
  };

  /** Create a structure for the users org members and merge it with invites */
  const teamMembersWithUserOrInvite: TeamMembersWithUserOrInvite[] =
    userMembers.map((um) => ({
      name: `${um.user.firstName ? um.user.firstName : ""} ${
        um.user.lastName ? um.user.lastName : ""
      }`,
      img: um.user.profilePicture || "/static/images/default_pfp.jpg",
      email: um.user.email,
      status: "ACCEPTED",
      role: organizationRolesMap[um.roles[0]],
      userId: um.user.id,
    }));

  /** Create the same structure for invites */
  for (const invite of invites as InviteWithTeamMember[]) {
    teamMembersWithUserOrInvite.push({
      name: invite.inviteeTeamMember.name,
      img: "/static/images/default_pfp.jpg",
      email: invite.inviteeEmail,
      status: invite.status,
      role: organizationRolesMap[invite?.roles[0]],
      userId: null,
    });
  }

  return json({
    currentOrganizationId: organizationId,
    organization,
    header,
    owner: organization.owner,
    teamMembers,
    teamMembersWithUserOrInvite,
  });
}

export const action = async ({ context, request }: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  // @TODO shouldnt we require permissions here
  const { organizationId } = await requireOrganisationId({
    userId: userId,
    request,
  });

  const formData = await request.formData();
  const intent = formData.get("intent") as ActionIntent;
  const teamMemberId = formData.get("teamMemberId") as string;

  switch (intent) {
    case "delete":
      await db.teamMember.update({
        where: {
          id: teamMemberId,
        },
        data: {
          deletedAt: new Date(),
        },
      });
      return redirect(`/settings/team`);
    case "revoke":
      const targetUserId = formData.get("userId") as string;
      const user = await revokeAccessToOrganization({
        userId: targetUserId,
        organizationId,
      });

      if (!user) {
        throw new ShelfStackError({
          message: "User not found",
        });
      }

      const org = await db.organization.findUnique({
        where: {
          id: organizationId,
        },
        select: {
          name: true,
        },
      });

      if (!org) {
        throw new ShelfStackError({
          message: "Organization not found",
        });
      }

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
      return redirect("/settings/team");
    case "resend":
      const invite = await createInvite({
        organizationId,
        inviteeEmail: formData.get("email") as string,
        teamMemberName: formData.get("name") as string,
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
      return null;
    default:
      throw new ShelfStackError({ message: "Invalid action" });
  }
};

export const handle = {
  breadcrumb: () => "single",
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.organization.name) : "" },
];
export const ErrorBoundary = () => <ErrorBoundryComponent />;

export default function WorkspacePage() {
  const { organization } = useLoaderData<typeof loader>();
  const isPersonalOrg = useMemo(
    () => checkIsPersonalOrg(organization),
    [organization]
  );

  return organization ? (
    <div className="mb-2.5 flex flex-col justify-between bg-white md:rounded md:border md:border-gray-200 md:px-6 md:py-8">
      <div className="mb-6 flex justify-between border-b pb-5">
        <div>
          <h3 className="text-text-lg font-semibold">
            {isPersonalOrg ? "Team" : `${organization.name}'s team`}
          </h3>
          <p className="text-sm text-gray-600">
            Manage your existing team and give team members custody to certain
            assets.
          </p>
        </div>
      </div>
      {!isPersonalOrg ? <UsersTable /> : null}
      <TeamMembersTable />
      <ContextualModal />
    </div>
  ) : null;
}

export interface TeamMemberWithCustodies extends TeamMember {
  custodies: Custody[];
}
