import { json } from "@remix-run/node";
import { List } from "~/components/list";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import { ActionsDropdown } from "~/components/workspace/actions-dropdown";

export async function loader() {
  const members = [
    {
      id: 1,
      name: "Phoenix Baker",
    },
    {
      id: 2,
      name: "Carlos Virreira",
    },
    {
      id: 3,
      name: "Lana Steiner",
    },
    {
      id: 4,
      name: "Demi Wilkinson",
    },
    {
      id: 5,
      name: "Candice Wu",
    },
  ];

  const modelName = {
    singular: "Team member",
    plural: "Team Members",
  };

  return json({
    items: members,
    page: 1,
    totalItems: members.length,
    perPage: 5,
    totalPages: 1,
    next: null,
    prev: null,
    modelName,
  });
}

export default function WorkspacePage() {
  return (
    <div>
      <div className="mb-6 flex justify-between border-b pb-5">
        <div>
          <h3 className="text-text-lg font-semibold">Workspace</h3>
          <p className="text-sm text-gray-600">Manage your workspace.</p>
        </div>
        <Button variant="primary">Save</Button>
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
              <img
                src="/images/asset-placeholder.jpg"
                alt="img"
                className="h-12 w-12 rounded"
              />
              <div>
                <span className="text-text-sm font-medium text-gray-900">
                  Whale Agency
                </span>
                <p className="text-sm text-gray-600">
                  64 assets - 4 locations - 1 user - 5 team members
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
              <img
                src="/images/asset-placeholder.jpg"
                alt="img"
                className="h-12 w-12 rounded"
              />
              <div>
                <span className="block text-text-sm font-medium text-gray-900">
                  Carlos Virreira
                </span>
                <a
                  href="mailto:carlos@whale-agency.com"
                  className="text-sm text-gray-600"
                >
                  carlos@whale-agency.com
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

function TeamMemberRow({ item }: { item: { id: string; name: string } }) {
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
