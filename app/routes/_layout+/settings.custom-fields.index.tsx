import type { CustomField } from "@prisma/client";
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ActionsDropdown } from "~/components/custom-fields/actions-dropdown";
import { ErrorBoundryComponent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Badge } from "~/components/shared";
import { ControlledActionButton } from "~/components/shared/controlled-action-button";
import { Td, Th } from "~/components/table";
import {
  countAcviteCustomFields,
  getFilteredAndPaginatedCustomFields,
} from "~/modules/custom-field";
import { getOrganizationTierLimit } from "~/modules/tier";

import { getCurrentSearchParams, getParamsValues } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { updateCookieWithPerPage, userPrefs } from "~/utils/cookies.server";
import { FIELD_TYPE_NAME } from "~/utils/custom-fields";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import { canCreateMoreCustomFields } from "~/utils/subscription";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const ErrorBoundary = () => <ErrorBoundryComponent />;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = await context.getSession();
  const { organizationId, organizations } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.customField,
    action: PermissionAction.read,
  });

  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  const { customFields, totalCustomFields } =
    await getFilteredAndPaginatedCustomFields({
      organizationId,
      page,
      perPage,
      search,
    });

  const tierLimit = await getOrganizationTierLimit({
    organizationId,
    organizations,
  });

  const totalPages = Math.ceil(totalCustomFields / perPageParam);

  const header: HeaderData = {
    title: "Custom Fields",
  };
  const modelName = {
    singular: "custom fields",
    plural: "custom Fields",
  };

  return json(
    {
      header,
      items: customFields,
      search,
      page,
      totalItems: totalCustomFields,
      totalPages,
      perPage,
      modelName,
      canCreateMoreCustomFields: canCreateMoreCustomFields({
        tierLimit,
        totalCustomFields: await countAcviteCustomFields({ organizationId }),
      }),
    },
    {
      headers: {
        "Set-Cookie": await userPrefs.serialize(cookie),
      },
    }
  );
}

export default function CustomFieldsIndexPage() {
  const { canCreateMoreCustomFields } = useLoaderData<typeof loader>();
  return (
    <>
      <div className="mb-2.5 flex items-center justify-between bg-white md:rounded md:border md:border-gray-200 md:px-6 md:py-5">
        <h2 className=" text-lg text-gray-900">Custom Fields</h2>
        <ControlledActionButton
          canUseFeature={canCreateMoreCustomFields}
          buttonContent={{
            title: "New Custom Field",
            message:
              "You are not able to create more active custom fields within your current plan.",
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
        <Link
          to={`${item.id}/edit`}
          className="block text-text-sm font-medium text-gray-900"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <span className="block">{item.name}</span>
              <span className="text-gray-600">
                {FIELD_TYPE_NAME[item.type]}
              </span>
            </div>
          </div>
        </Link>
      </Td>
      <Td>
        <span className="text-text-sm font-medium capitalize text-gray-600">
          {item.required ? "Yes" : "No"}
        </span>
      </Td>
      <Td>
        {!item.active ? (
          <Badge color="#dc2626" withDot={false}>
            Inactive
          </Badge>
        ) : (
          <Badge color="#059669" withDot={false}>
            Active
          </Badge>
        )}
      </Td>
      <Td>
        <ActionsDropdown customField={item} />
      </Td>
    </>
  );
}
