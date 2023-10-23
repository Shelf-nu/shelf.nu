import { useMemo } from "react";
import type {
  Custody,
  Invite,
  InviteStatuses,
  TeamMember,
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
import { requireAuthSession } from "~/modules/auth";
import { revokeAccessToOrganization } from "~/modules/user";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";
import { isPersonalOrg as checkIsPersonalOrg } from "~/utils/organization";

type ActionIntent = "delete" | "revoke" | "resend" | "invite";
export interface TeamMembersWithUserOrInvite {
  name: string;
  img: string;
  email: string;
  status: InviteStatuses;
  role: "Administrator" | "Owner";
  userId: string | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { organizationId } = await requireAuthSession(request);

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
        },
      }),
      /** Get the invites */
      db.invite.findMany({
        where: {
          organizationId,
          status: {
            not: "ACCEPTED",
          },
        },
        select: {
          id: true,
          teamMemberId: true,
          inviteeEmail: true,
          status: true,
        },
      }),
      /** Get the teamMembers */
      db.teamMember.findMany({
        where: {
          organizations: {
            some: {
              id: organizationId,
            },
          },
          userId: null,
          receivedInvites: {
            none: {},
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
      name: `${um.user.firstName} ${um.user.lastName}`,
      img: um.user.profilePicture || "/images/default_pfp.jpg",
      email: um.user.email,
      status: "ACCEPTED",
      role: um.user.id === organization.userId ? "Owner" : "Administrator",
      userId: um.user.id,
    }));

  /** Create the same structure for invites */
  for (const invite of invites as Pick<
    Invite,
    "id" | "teamMemberId" | "inviteeEmail" | "status"
  >[]) {
    teamMembersWithUserOrInvite.push({
      name: invite.inviteeEmail,
      img: "/images/default_pfp.jpg",
      email: invite.inviteeEmail,
      status: invite.status,
      role: "Administrator",
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { organizationId } = await requireAuthSession(request);

  const formData = await request.formData();
  const intent = formData.get("intent") as ActionIntent;
  const teamMemberId = formData.get("teamMemberId") as string;

  switch (intent) {
    case "delete":
      await db.teamMember.delete({
        where: {
          id: teamMemberId,
        },
      });
      return redirect(`/settings/team`);
    case "revoke":
      const userId = formData.get("userId") as string;
      const user = await revokeAccessToOrganization({
        userId,
        organizationId,
      });

      if (!user) {
        throw new ShelfStackError({
          message: "User not found",
        });
      }

      sendNotification({
        title: `Access revoked`,
        message: `User with email ${user.email} no longer has access to this organization`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });
      return redirect("/settings/team");
    case "resend":
    // return handleResend(teamMemberId);
    case "invite":
    // return handleInvite(teamMemberId);
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
    <div>
      <div className="my-6 flex justify-between border-b pb-5">
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
