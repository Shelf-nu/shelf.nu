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

import { createTemplate, updateTemplatePDF } from "~/modules/template";
import { assertUserCanCreateMoreTemplates } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import { getActionMethod, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

const title = "New Template";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  await assertUserCanCreateMoreTemplates({ userId });

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
  const method = getActionMethod(request);

  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    switch (method) {
      case "POST":
        {
          await assertUserCanCreateMoreTemplates({
            userId: authSession.userId,
          });

          const { organizationId } = await requirePermission({
            userId: authSession.userId,
            request,
            entity: PermissionEntity.template,
            action: PermissionAction.create,
          });

          const clonedData = request.clone();

          const { name, type, description, signatureRequired, pdf } = parseData(
            await request.formData(),
            NewTemplateFormSchema
          );

          // @TODO - this is not the correct way to check for file should be handled in schema
          if (pdf.type === "application/octet-stream") {
            return json(
              {
                errors: [
                  {
                    code: "custom",
                    message: "File is required.",
                  },
                ],
              },
              {
                status: 400,
              }
            );
          }

          const { id } = await createTemplate({
            name,
            type,
            description: description ?? "",
            signatureRequired: signatureRequired ?? false,
            userId: authSession.userId,
            organizationId,
          });

          await updateTemplatePDF({
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

        throw notAllowedMethod(method);
    }
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
      <div>
        <TemplateForm />
      </div>
    </>
  );
}
