import { json } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import {
  CustomFieldForm,
  NewCustomFieldFormSchema,
} from "~/components/custom-fields/form";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { getCustomField, updateCustomField } from "~/modules/custom-field";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { assertIsPost, getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const id = getRequiredParam(params, "fieldId");

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

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Edit",
};

export async function action({ request, params }: ActionFunctionArgs) {
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

  const { name, helpText, active, required, options } = result.data;

  const rsp = await updateCustomField({
    id,
    name,
    helpText,
    active,
    required,
    options,
  });

  if (rsp.error) {
    return json(
      {
        errors: { name: rsp.error },
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

  sendNotification({
    title: "Custom field updated",
    message: "Your custom field  has been updated successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return json(
    { success: true, errors: null },
    {
      headers: {
        "Set-Cookie": await commitAuthSession(request, { authSession }),
      },
    }
  );
}

export default function CustomFieldEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  const { customField } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={hasName ? name : customField.name} />
      <div className=" items-top flex justify-between">
        <CustomFieldForm
          isEdit
          name={customField.name || name}
          helpText={customField.helpText}
          required={customField.required}
          type={customField.type}
          active={customField.active}
          options={customField.options}
        />
      </div>
    </>
  );
}
