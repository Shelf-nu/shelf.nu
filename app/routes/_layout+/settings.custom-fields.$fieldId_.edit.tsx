import { OrganizationType } from "@prisma/client";
import { json } from "@remix-run/node";
import type { ActionArgs, V2_MetaFunction, LoaderArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { titleAtom } from "~/atoms/custom-fields.new";
import {
  CustomFieldForm,
  NewCustomFieldFormSchema,
} from "~/components/custom-fields/form";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { getCustomField, updateCustomField } from "~/modules/custom-field";
import { getOrganizationByUserId } from "~/modules/organization/service.server";
import { assertIsPost, getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export async function loader({ request, params }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);

  const id = getRequiredParam(params, "fieldId");

  const organization = await getOrganizationByUserId({
    userId,
    orgType: OrganizationType.PERSONAL,
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  const organizationId = organization.id;

  const { customField } = await getCustomField({ organizationId, id });
  if (!customField) {
    throw new Response("Not Found", { status: 404 });
  }

  const header: HeaderData = {
    title: `Edit | ${customField.name}`,
  };

  return json({
    customField,
    header,
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Edit",
};

export async function action({ request, params }: ActionArgs) {
  assertIsPost(request);
  const authSession = await requireAuthSession(request);

  const id = getRequiredParam(params, "fieldId");
  const formData = await request.formData();
  const result = await NewCustomFieldFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        errors: result.error,
        success: false,
      },
      {
        status: 400,
        headers: {
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }

  const { name, helpText, type, active, required } = result.data;

  await updateCustomField({
    id,
    name,
    helpText,
    type,
    active,
    required,
  });

  sendNotification({
    title: "Custom field updated",
    message: "Your custom field  has been updated successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return json(
    { success: true },
    {
      headers: {
        "Set-Cookie": await commitAuthSession(request, { authSession }),
      },
    }
  );
}

export default function AssetEditPage() {
  const name = useAtomValue(titleAtom);
  const hasName = name !== "Untitled custom field";
  const { customField } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={hasName ? name : customField.name} />
      <div>{name}</div>
      <div className=" items-top flex justify-between">
        <CustomFieldForm
          name={customField.name || name}
          helpText={customField.helpText}
          required={customField.required}
          type={customField.type}
          active={customField.active}
        />
      </div>
    </>
  );
}
