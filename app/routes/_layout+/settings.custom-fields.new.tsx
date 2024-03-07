import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";

import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import {
  CustomFieldForm,
  NewCustomFieldFormSchema,
} from "~/components/custom-fields/form";
import Header from "~/components/layout/header";

import { createCustomField } from "~/modules/custom-field";
import { assertUserCanCreateMoreCustomFields } from "~/modules/tier";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

const title = "New Custom Field";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = await context.getSession();

  const { organizationId, organizations } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.customField,
    action: PermissionAction.create,
  });

  await assertUserCanCreateMoreCustomFields({ organizations, organizationId });

  const header = {
    title,
  };

  return json({
    header,
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data?.header?.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ context, request }: LoaderFunctionArgs) {
  const authSession = await context.getSession();

  const { organizationId, organizations } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.customField,
    action: PermissionAction.create,
  });
  await assertUserCanCreateMoreCustomFields({
    organizations,
    organizationId,
  });

  const formData = await request.formData();
  const result = await NewCustomFieldFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      {
        status: 400,
      }
    );
  }

  const { name, helpText, required, type, active, options } = result.data;

  const rsp = await createCustomField({
    name,
    helpText,
    required,
    type,
    active,
    organizationId,
    userId: authSession.userId,
    options,
  });

  if (rsp.error) {
    return json(
      {
        errors: { name: rsp.error },
      },
      {
        status: 400,
      }
    );
  }

  sendNotification({
    title: "Custom Field created",
    message: "Your Custom Field has been created successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/settings/custom-fields`);
}

export default function NewCustomFieldPage() {
  const title = useAtomValue(dynamicTitleAtom);

  return (
    <>
      <Header
        hideBreadcrumbs
        title={title ? title : "Untitled custom field"}
        classNames="-mt-5"
      />
      <div>
        <CustomFieldForm />
      </div>
    </>
  );
}
