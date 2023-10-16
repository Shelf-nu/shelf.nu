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
import { EmptyState } from "~/components/list/empty-state";
import { ListHeader } from "~/components/list/list-header";
import { ListItem } from "~/components/list/list-item";
import { Button } from "~/components/shared";
import { Table, Td, Th } from "~/components/table";
import { ActionsDropdown } from "~/components/workspace/actions-dropdown";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { getPaginatedAndFilterableTeamMembers } from "~/modules/team-member";
import { tw } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderFunctionArgs) {
  const { organizationId } = await requireAuthSession(request);
  const organization = await db.organization.findFirst({
    where: {
      id: organizationId,
    },
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  const {
    page,
    perPage,
    search,
    prev,
    next,
    teamMembers,
    totalPages,
    totalTeamMembers,
    cookie,
  } = await getPaginatedAndFilterableTeamMembers({
    request,
    organizationId: organization.id,
  });

  const header: HeaderData = {
    title: `Settings - ${organization.name}`,
  };

  return json({
    currentOrganizationId: organizationId,
    organization,
    header,
    modelName: {
      singular: "team member",
      plural: "team members",
    },
    page,
    perPage,
    search,
    prev,
    next,
    items: teamMembers,
    totalPages,
    totalItems: totalTeamMembers,
    cookie,
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
  const { organization, items } = useLoaderData<typeof loader>();
  const hasItems = items.length > 0;

  return organization ? (
    <div>
      <h1>{organization.name} workspace</h1>
      <div className="my-6 flex justify-between border-b pb-5">
        <div>
          <h3 className="text-text-lg font-semibold">Team</h3>
          <p className="text-sm text-gray-600">
            Manage your existing team and give team members custody to certain
            assets.
          </p>
        </div>
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
        <div className="flex flex-1 flex-col gap-2">
          <div
            className={tw(
              "-mx-4 overflow-x-auto border border-gray-200  bg-white md:mx-0 md:rounded-[12px]"
            )}
          >
            {!hasItems ? (
              <EmptyState
                customContent={{
                  title: "No team members on database",
                  text: "What are you waiting for? Add your first team member now!",
                  newButtonRoute: `add-member`,
                  newButtonContent: "Add team member",
                }}
              />
            ) : (
              <>
                <Table>
                  <ListHeader
                    children={
                      <>
                        <Th className="hidden md:table-cell">
                          <Button variant="primary" to={`add-member`}>
                            <span className=" whitespace-nowrap">
                              Add team member
                            </span>
                          </Button>
                        </Th>
                      </>
                    }
                  />
                  <tbody>
                    {items.map((item) => (
                      <ListItem item={item} key={item.id}>
                        <TeamMemberRow
                          item={item as unknown as TeamMemberWithCustodies}
                        />
                      </ListItem>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </div>
        </div>
      </div>
      <ContextualModal />
    </div>
  ) : null;
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
        </div>
      </Td>
      <Td className="text-right">
        <ActionsDropdown teamMember={item} />
      </Td>
    </>
  );
}
