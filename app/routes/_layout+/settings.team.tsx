import { useMemo } from "react";
import type { Custody, TeamMember } from "@prisma/client";
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
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { isPersonalOrg as checkIsPersonalOrg } from "~/utils/organization";
import { partition } from "~/utils/partition";

export async function loader({ request }: LoaderFunctionArgs) {
  const { organizationId } = await requireAuthSession(request);
  const organization = await db.organization.findFirst({
    where: {
      id: organizationId,
    },
    include: {
      owner: true,
      members: {
        include: {
          custodies: true,
          user: true,
          receivedInvites: {
            select: {
              id: true,
              teamMemberId: true,
              inviteeEmail: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  // const teamMembers = organization.members.filter((member) => {
  //   console.log(member);
  // });

  const [teamMembersWithUserOrInvite, teamMembers] = partition(
    organization.members,
    (item) => item.userId === null && item.receivedInvites.length > 0
  );

  const header: HeaderData = {
    title: `Settings - ${organization.name}`,
  };

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
  await requireAuthSession(request);

  const formData = await request.formData();
  const teamMemberId = formData.get("teamMemberId") as string;

  await db.teamMember.delete({
    where: {
      id: teamMemberId,
    },
  });
  return redirect(`/settings/team`);
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
