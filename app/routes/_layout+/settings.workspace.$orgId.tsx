import type { Custody, TeamMember } from "@prisma/client";
import { json } from "@remix-run/node";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { Button } from "~/components/shared";
import { Td } from "~/components/table";
import { ActionsDropdown } from "~/components/workspace/actions-dropdown";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { getPaginatedAndFilterableTeamMembers } from "~/modules/team-member";
import { getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { organizationId } = await requireAuthSession(request);
  const id = getRequiredParam(params, "orgId");
  const organization = await db.organization.findFirst({
    where: {
      id,
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

export const handle = {
  breadcrumb: () => "single",
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.organization.name) : "" },
];
export const ErrorBoundary = () => <ErrorBoundryComponent />;

export default function WorkspacePage() {
  const { organization, currentOrganizationId } =
    useLoaderData<typeof loader>();
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
        <Button variant="primary" to={`${currentOrganizationId}/add-member`}>
          Add team member
        </Button>
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
          <Filters />
          <List
            ItemComponent={TeamMemberRow}
            customEmptyStateContent={{
              title: "No team members on database",
              text: "What are you waiting for? Add your first team member now!",
              newButtonRoute: `${currentOrganizationId}/add-member`,
              newButtonContent: "Add team member",
            }}
          />
        </div>
      </div>
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
          <ActionsDropdown teamMember={item} />
        </div>
      </Td>
    </>
  );
}
