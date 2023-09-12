import { OrganizationType, type CustomField } from "@prisma/client";
import { json } from "@remix-run/node";
import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ActionsDropdown } from "~/components/custom-fields/actions-dropdown";
import { ErrorBoundryComponent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Badge } from "~/components/shared";
import { PremiumFeatureButton } from "~/components/subscription/premium-feature-button";
import { Td, Th } from "~/components/table";
import { requireAuthSession } from "~/modules/auth";
import { getFilteredAndPaginatedCustomFields } from "~/modules/custom-field";
import { getOrganizationByUserId } from "~/modules/organization";
import { getUserTierLimit } from "~/modules/tier";

import {
  getCurrentSearchParams,
  getParamsValues,
  generatePageMeta,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { canCreateMoreCustomFields } from "~/utils/subscription";

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const ErrorBoundary = () => <ErrorBoundryComponent />;

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const searchParams = getCurrentSearchParams(request);
  const { page, perPage, search } = getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);
  const organization = await getOrganizationByUserId({
    userId,
    orgType: OrganizationType.PERSONAL,
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  const { customFields, totalCustomFields } =
    await getFilteredAndPaginatedCustomFields({
      organizationId: organization.id,
      page,
      perPage,
      search,
    });

  const tierLimit = await getUserTierLimit(userId);

  const totalPages = Math.ceil(totalCustomFields / perPage);

  const header: HeaderData = {
    title: "Custom Fields",
  };
  const modelName = {
    singular: "custom fields",
    plural: "custom Fields",
  };
  return json({
    header,
    items: customFields,
    search,
    page,
    totalItems: totalCustomFields,
    totalPages,
    perPage,
    prev,
    next,
    modelName,
    canCreateMoreCustomFields: canCreateMoreCustomFields({
      tierLimit,
      totalCustomFields,
    }),
  });
}

export default function CustomFieldsIndexPage() {
  const { canCreateMoreCustomFields } = useLoaderData<typeof loader>();
  return (
    <>
      <div className="mb-2.5 flex items-center justify-between bg-white md:rounded-[12px] md:border md:border-gray-200 md:px-6 md:py-5">
        <h2 className=" text-lg text-gray-900">Custom Fields</h2>
        <PremiumFeatureButton
          canUseFeature={canCreateMoreCustomFields}
          buttonContent={{
            title: "New Custom Field",
            message:
              "You are not able to create more custom fields within your current plan.",
          }}
          buttonProps={{
            to: "new",
            role: "link",
            icon: "plus",
            "aria-label": `new custom field`,
            "data-test-id": "createNewCustomField",
            variant: "primary",
          }}
        />
      </div>
      <List
        ItemComponent={TeamMemberRow}
        headerChildren={
          <>
            <Th>Required</Th>
            <Th>Status</Th>
            <Th>Actions</Th>
          </>
        }
      />
    </>
  );
}
function TeamMemberRow({ item }: { item: CustomField }) {
  return (
    <>
      <Td className="w-full">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1">
            <Link
              to={`${item.id}/edit`}
              className="block text-text-sm font-medium text-gray-900"
            >
              {item.name}
            </Link>
            <span className="lowercase text-gray-600">{item.type}</span>
          </div>
        </div>
      </Td>
      <Td>
        <span className="text-text-sm font-medium lowercase text-gray-600">
          {item.required}
        </span>
      </Td>
      <Td>
        {!item.active && (
          <Badge color="#dc2626" withDot={false}>
            inactive
          </Badge>
        )}
      </Td>
      <Td>
        <ActionsDropdown customField={item} />
      </Td>
    </>
  );
}
