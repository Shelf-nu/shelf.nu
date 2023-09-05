import { OrganizationType, type CustomField } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { ActionsDropdown } from "~/components/custom-fields/actions-dropdown";
import { ErrorBoundryComponent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { getFilteredAndPaginatedCustomFields } from "~/modules/custom-field";
import { getOrganizationByUserId } from "~/modules/organization";
import {
  getCurrentSearchParams,
  getParamsValues,
  generatePageMeta,
  isDelete,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

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
  });
}

export const action = async ({ request }: ActionArgs) => {
  await requireAuthSession(request);

  if (isDelete(request)) {
    const formData = await request.formData();
    const customFieldId = formData.get("customFieldId") as string;

    await db.customField.delete({
      where: {
        id: customFieldId,
      },
    });
    return redirect(`/settings/custom-fields`);
  }
};

export default function CustomFieldsIndexPage() {
  return (
    <>
      <div className="mb-2.5 flex items-center justify-between bg-white md:rounded-[12px] md:border md:border-gray-200 md:px-6 md:py-5">
        <h2 className=" text-lg text-gray-900">Custom Fields</h2>
        <Button
          to="new"
          role="link"
          aria-label={`new custom field`}
          icon="plus"
          data-test-id="createNewCustomField"
        >
          New Custom Field
        </Button>
      </div>
      <List ItemComponent={TeamMemberRow} />
    </>
  );
}
function TeamMemberRow({ item }: { item: CustomField }) {
  return (
    <>
      <Td className="w-full">
        <div className="flex items-center justify-between">
          <div>
            <Link
              to={`${item.id}/edit`}
              className="block text-text-sm font-medium text-gray-900"
            >
              {item.name}
            </Link>
            <span className="lowercase text-gray-600">{item.type}</span>
          </div>
          <ActionsDropdown customField={item} />
        </div>
      </Td>
    </>
  );
}
