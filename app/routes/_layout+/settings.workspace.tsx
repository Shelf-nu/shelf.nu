import type { Custody, TeamMember } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import ContextualModal from "~/components/layout/contextual-modal";
import { Filters, List } from "~/components/list";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import ProfilePicture from "~/components/user/profile-picture";
import { ActionsDropdown } from "~/components/workspace/actions-dropdown";
import { db } from "~/database";
import { useUserData } from "~/hooks";
import { requireAuthSession } from "~/modules/auth";
import {
  getPaginatedAndFilterableTeamMembers,
  getUserPersonalOrganizationData,
} from "~/modules/organization";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { userPrefs } from "~/utils/cookies.server";
import { ShelfStackError } from "~/utils/error";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { userId } = await requireAuthSession(request);
  const { organization, totalAssets, totalLocations } =
    await getUserPersonalOrganizationData({ userId });
  if (!organization)
    throw new ShelfStackError({ message: "Organization not found" });

  const {
    page,
    perPage,
    search,
    prev,
    next,
    teamMembers,
    totalTeamMembers,
    totalPages,
    cookie,
  } = await getPaginatedAndFilterableTeamMembers({
    request,
    organizationId: organization.id,
  });

  const modelName = {
    singular: "Team member",
    plural: "Team Members",
  };

  return json(
    {
      organization,
      totalAssets,
      totalLocations,
      search,
      items: teamMembers,
      page,
      totalItems: totalTeamMembers,
      perPage,
      totalPages,
      next,
      prev,
      modelName,
      title: "Workspace",
    },
    {
      headers: {
        "Set-Cookie": await userPrefs.serialize(cookie),
      },
    }
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAuthSession(request);

  const formData = await request.formData();
  const teamMemberId = formData.get("teamMemberId") as string;

  await db.teamMember.delete({
    where: {
      id: teamMemberId,
    },
  });
  return redirect(`/settings/workspace`);
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const ErrorBoundary = () => <ErrorBoundryComponent />;

export const handle = {
  breadcrumb: () => <Link to="/settings/workspace">Workspace</Link>,
};

export default function WorkspacePage() {
  const {
    organization,
    totalAssets,
    totalLocations,
    totalItems: totalMembers,
  } = useLoaderData<typeof loader>();
  const user = useUserData();
  return (
    <div>
      <div className="mb-6 flex justify-between border-b pb-5">
        <div>
          <h3 className="text-text-lg font-semibold">Workspace</h3>
          <p className="text-sm text-gray-600">Manage your workspace.</p>
        </div>
      </div>
      <div className="mb-6 lg:flex lg:gap-16">
        <div className="mb-4 lg:mb-0 lg:w-1/4">
          <div className="text-text-sm font-medium text-gray-700">
            Workspace
          </div>
          <p className="text-sm text-gray-600">
            Currently it’s only possible to have a single workspace per account.
          </p>
        </div>
        <div className="flex-1 rounded-[12px] border">
          <div className="border-b px-6 py-3 md:py-4">
            <span className="text-text-xs font-medium">Name</span>
          </div>
          <div className="px-6 py-3">
            <div className="flex items-center gap-3">
              <div>
                <span className="text-text-sm font-medium text-gray-900">
                  {organization.name}
                </span>
                <p className="text-sm text-gray-600">
                  {totalAssets} assets - {totalLocations} locations - 1 admin -{" "}
                  {totalMembers} team members
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mb-10 lg:flex lg:gap-16">
        <div className="mb-4 lg:mb-0 lg:w-1/4">
          <div className="text-text-sm font-medium text-gray-700">Admins</div>
          <p className="text-sm text-gray-600">
            Currently it’s only possible to have a single admin account per
            workspace. Need multiple admins? Talk to sales.
          </p>
        </div>
        <div className="flex-1 rounded-[12px] border">
          <div className="border-b px-6 py-3 md:py-4">
            <span className="text-text-xs font-medium">Name</span>
          </div>
          <div className="px-6 py-3">
            <div className="flex items-center gap-3">
              <ProfilePicture className="h-12 w-12" />

              <div>
                <span className="block text-text-sm font-medium text-gray-900">
                  {user?.firstName} {user?.lastName}
                </span>
                <span className="text-sm text-gray-600">{user?.email}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mb-6 border-b pb-5 md:flex md:items-center md:justify-between md:gap-3">
        <div className="mb-4 md:mb-0">
          <h3 className="text-text-lg font-semibold">Team</h3>
          <p className="text-sm text-gray-600">
            Manage your existing team and give team members custody to certain
            assets.
          </p>
        </div>
        <Button
          variant="primary"
          to={`${organization.id}/add-member`}
          className="shrink-0"
        >
          Add team member
        </Button>
      </div>
      <div className="mb-6 lg:flex lg:gap-16">
        <div className="mb-4 lg:mb-0 lg:w-1/4">
          <div className="text-text-sm font-medium text-gray-700">
            Team members
          </div>
          <p className="text-sm text-gray-600">
            Team members are part of your workspace but do not have an account.
          </p>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Filters />
          <List
            ItemComponent={TeamMemberRow}
            customEmptyStateContent={{
              title: "No team members on database",
              text: "What are you waiting for? Add your first team member now!",
              newButtonRoute: `${organization.id}/add-member`,
              newButtonContent: "Add team member",
            }}
          />
        </div>
      </div>
      <ContextualModal />
    </div>
  );
}

export interface TeamMemberWithCustodies extends TeamMember {
  custodies: Custody[];
}

function TeamMemberRow({ item }: { item: TeamMemberWithCustodies }) {
  return (
    <>
      <Td className="w-full">
        <div className="flex items-center justify-between">
          <span className="text-text-sm font-medium text-gray-900">
            {item.name}
          </span>
          <ActionsDropdown teamMember={item} />
        </div>
      </Td>
    </>
  );
}
