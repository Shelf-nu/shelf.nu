import type { TeamMember } from "@prisma/client";
import { json, type LoaderArgs, type V2_MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import { List } from "~/components/list";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import ProfilePicture from "~/components/user/profile-picture";
import { ActionsDropdown } from "~/components/workspace/actions-dropdown";
import { useUserData } from "~/hooks";
import { requireAuthSession } from "~/modules/auth";
import { getUserPersonalOrganizationData } from "~/modules/organization";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);
  const { organization, totalAssets, totalLocations } =
    await getUserPersonalOrganizationData({ userId });

  if (!organization) throw new Error("Organization not found");

  const modelName = {
    singular: "Team member",
    plural: "Team Members",
  };

  return json({
    organization,
    totalAssets,
    totalLocations,

    items: organization.members,
    page: 1,
    totalItems: organization.members.length,
    perPage: 5,
    totalPages: 1,
    next: null,
    prev: null,
    modelName,
    title: "Workspace",
  });
};

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];
export const ErrorBoundary = () => <ErrorBoundryComponent />;

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
      <div className="mb-6 flex gap-16">
        <div className="w-1/4">
          <div className="text-text-sm font-medium text-gray-700">
            Workspace
          </div>
          <p className="text-sm text-gray-600">
            Currently it’s only possible to have a single workspace per account.
          </p>
        </div>
        <div className="flex-1 rounded-[12px] border">
          <div className="border-b px-6 py-4">
            <span className="text-text-xs font-medium">Name</span>
          </div>
          <div className="px-6 py-3">
            <div className="flex items-center gap-3">
              <div>
                <span className="text-text-sm font-medium text-gray-900">
                  {organization.name}
                </span>
                <p className="text-sm text-gray-600">
                  {totalAssets} assets - {totalLocations} locations - 1 user -{" "}
                  {totalMembers} team members
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mb-10 flex gap-16">
        <div className="w-1/4">
          <div className="text-text-sm font-medium text-gray-700">Admins</div>
          <p className="text-sm text-gray-600">
            Currently it’s only possible to have a single admin account per
            workspace. Need multiple admins? Talk to sales.
          </p>
        </div>
        <div className="flex-1 rounded-[12px] border">
          <div className="border-b px-6 py-4">
            <span className="text-text-xs font-medium">Name</span>
          </div>
          <div className="px-6 py-3">
            <div className="flex items-center gap-3">
              <ProfilePicture className="h-12 w-12" />

              <div>
                <span className="block text-text-sm font-medium text-gray-900">
                  {user?.firstName} {user?.lastName}
                </span>
                <a
                  href="mailto:carlos@whale-agency.com"
                  className="text-sm text-gray-600"
                >
                  {user?.email}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mb-6 flex justify-between border-b pb-5">
        <div>
          <h3 className="text-text-lg font-semibold">Team</h3>
          <p className="text-sm text-gray-600">
            Manage your existing team and give team members custody to certain
            assets.
          </p>
        </div>
        <Button variant="primary">Add team member</Button>
      </div>
      <div className="mb-6 flex gap-16">
        <div className="w-1/4">
          <div className="text-text-sm font-medium text-gray-700">
            Team members
          </div>
          <p className="text-sm text-gray-600">
            Team members are part of your workspace but do not have an account.
          </p>
        </div>
        <div className="flex-1">
          <List ItemComponent={TeamMemberRow} />
        </div>
      </div>
    </div>
  );
}

function TeamMemberRow({ item }: { item: TeamMember }) {
  return (
    <>
      <Td className="w-full">
        <div className="flex items-center justify-between">
          <span className="text-text-sm font-medium text-gray-900">
            {item.name}
          </span>
          <ActionsDropdown />
        </div>
      </Td>
    </>
  );
}
