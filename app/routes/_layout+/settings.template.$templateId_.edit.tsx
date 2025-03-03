import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import {
  NewAgreementFormSchema,
  AgreementForm,
} from "~/components/agreements/form";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import {
  getCustodyAgreementById,
  updateCustodyAgreement,
  createCustodyAgreementRevision,
  getLatestCustodyAgreementFile,
} from "~/modules/custody-agreement";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  data,
  error,
  getActionMethod,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  try {
    const authSession = context.getSession();
    const { userId } = authSession;

    const { templateId: id } = getParams(
      params,
      z.object({ templateId: z.string() }),
      {
        additionalData: { userId },
      }
    );

    await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.update,
    });

    if (!id) {
      throw new ShelfError({
        cause: null,
        message: "Template ID is required",
        status: 400,
        label: "Custody Agreement",
        additionalData: {
          userId,
          params,
        },
      });
    }

    const template = await getCustodyAgreementById(id);
    const latestTemplateFileRevision = await getLatestCustodyAgreementFile(id);

    const header: HeaderData = {
      title: `Edit | ${template.name}`,
    };

    return json(
      data({
        template,
        latestTemplateFileRevision,
        header,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Edit",
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { userId } = context.getSession();

        const id = getParams(
          params,
          z.object({ templateId: z.string() })
        ).templateId;

        const { organizationId } = await requirePermission({
          userId,
          request,
          entity: PermissionEntity.custodyAgreement,
          action: PermissionAction.update,
        });

        const clonedData = request.clone();

        const { name, description, signatureRequired, pdf } = parseData(
          await request.formData(),
          NewAgreementFormSchema
        );

        await updateCustodyAgreement({
          id,
          name,
          description: description ?? "",
          signatureRequired: signatureRequired ?? false,
          userId,
          organizationId,
        });

        await createCustodyAgreementRevision({
          pdfName: pdf.name,
          pdfSize: pdf.size,
          request: clonedData,
          custodyAgreementId: id,
          organizationId,
        });

        sendNotification({
          title: "Template updated",
          message: "Your template has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return redirect("/settings/template");
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}

export default function TemplateEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  const { template, latestTemplateFileRevision } =
    useLoaderData<typeof loader>();

  return (
    <>
      <Header
        title={hasName ? name : template.name}
        hideBreadcrumbs
        classNames="-mt-5"
      />
      <div className="flex justify-between">
        <AgreementForm
          isEdit
          name={template.name || name}
          description={template.description}
          type={template.type}
          signatureRequired={template.signatureRequired}
          pdfUrl={latestTemplateFileRevision!.url}
          pdfSize={latestTemplateFileRevision!.size}
          pdfName={latestTemplateFileRevision!.name}
          version={latestTemplateFileRevision!.revision}
        />
      </div>
    </>
  );
}
