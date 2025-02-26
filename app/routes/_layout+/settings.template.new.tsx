import { error } from "console";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useAtomValue } from "jotai";

import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import Header from "~/components/layout/header";

import {
  NewTemplateFormSchema,
  TemplateForm,
} from "~/components/templates/form";

import { createTemplate, createTemplateRevision } from "~/modules/template";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import { data, getActionMethod, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanCreateMoreTemplates } from "~/utils/subscription.server";

const title = "New Template";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    await assertUserCanCreateMoreTemplates(userId);

    const header = {
      title,
    };

    return json(
      data({
        header,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data?.header?.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ context, request }: LoaderFunctionArgs) {
  const method = getActionMethod(request);

  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    switch (method) {
      case "POST": {
        await assertUserCanCreateMoreTemplates(userId);

        const { organizationId } = await requirePermission({
          userId: authSession.userId,
          request,
          entity: PermissionEntity.template,
          action: PermissionAction.create,
        });

        const clonedData = request.clone();

        const { name, description, signatureRequired, pdf } = parseData(
          await request.formData(),
          NewTemplateFormSchema
        );

        const { id } = await createTemplate({
          name,
          description: description ?? "",
          signatureRequired: signatureRequired ?? false,
          userId: authSession.userId,
          organizationId,
        });

        await createTemplateRevision({
          pdfName: pdf.name,
          pdfSize: pdf.size,
          request: clonedData,
          templateId: id,
          organizationId,
        });

        sendNotification({
          title: "Template created",
          message: "Your template has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return redirect(`/settings/template`);
      }
    }
    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function AddTemplatePage() {
  const title = useAtomValue(dynamicTitleAtom);

  return (
    <>
      <Header
        hideBreadcrumbs
        title={title ? title : "Untitled template"}
        classNames="-mt-5"
      />

      <TemplateForm />
    </>
  );
}
