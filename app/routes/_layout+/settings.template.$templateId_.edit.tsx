import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import {
  NewTemplateFormSchema,
  TemplateForm,
} from "~/components/templates/form";
import {
  getTemplateById,
  updateTemplate,
  updateTemplatePDF,
} from "~/modules/template";

import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  // @TODO - not the correct way to get params
  const id = params.templateId;

  try {
    await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.template,
      action: PermissionAction.update,
    });

    if (!id) {
      throw new ShelfError({
        cause: null,
        message: "Template ID is required",
        status: 400,
        label: "Template",
        additionalData: {
          userId,
          params,
        },
      });
    }

    const template = await getTemplateById({ id });

    // @TODO - this is not correct. The error has to be caught inside getTemplateById
    if (!template) {
      throw new ShelfError({
        cause: null,
        message: "Template not found",
        status: 404,
        label: "Template",
        additionalData: {
          userId,
          params,
        },
      });
    }

    const header: HeaderData = {
      title: `Edit | ${template.name}`,
    };

    // @TODO - not correct way to return
    return json({
      template,
      header,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  // @QUESTION This isn't working for some reason - because you are not returning the data correctly in the loader?
  // { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Edit",
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  // @TODO - this is outdated. Use getActionMethod and handle in try/catch
  // assertIsPost(request);

  const authSession = context.getSession();
  const { userId } = authSession;

  // @TODO - not the correct way to get params
  const id = params.templateId;

  try {
    // @TODO - this is not needed if the params are handled correctly above
    if (!id) {
      throw new ShelfError({
        cause: null,
        message: "Template ID is required",
        status: 400,
        label: "Template",
        additionalData: {
          userId,
          params,
        },
      });
    }

    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.template,
      action: PermissionAction.update,
    });

    const clonedData = request.clone();
    const formData = await request.formData();
    // @TODO - this is not the correct way to parse form data. We haev the new parseData function
    const result = await NewTemplateFormSchema.safeParseAsync(
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
        }
      );
    }

    const { name, description, signatureRequired, pdf } = result.data;

    // @TODO - service needs to be updated to properly catch errors
    await updateTemplate({
      id,
      name,
      description: description ?? "",
      signatureRequired: signatureRequired ?? false,
      userId: authSession.userId,
    });

    await updateTemplatePDF({
      pdfName: pdf.name,
      pdfSize: pdf.size,
      request: clonedData,
      templateId: id,
      organizationId,
    });

    sendNotification({
      title: "Template updated",
      message: "Your template has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect("/settings/template");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function TemplateEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  // @QUESTION How do i fix this? - You are not returning the data correctly in the loader
  // @ts-ignore
  const { template } = useLoaderData<typeof loader>();

  return (
    <>
      <Header
        title={hasName ? name : template.name}
        hideBreadcrumbs
        classNames="-mt-5"
      />
      <div className=" items-top flex justify-between">
        <TemplateForm
          isEdit
          name={template.name || name}
          description={template.description}
          type={template.type}
          signatureRequired={template.signatureRequired}
          pdfUrl={template.pdfUrl}
          pdfSize={template.pdfSize}
          pdfName={template.pdfName}
        />
      </div>
    </>
  );
}
