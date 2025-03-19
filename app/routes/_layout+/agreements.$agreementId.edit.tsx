import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import {
  AgreementForm,
  NewAgreementFormSchema,
} from "~/components/agreements/form";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import {
  canUserUpdateAgreementFile,
  updateAgreementFile,
  getCustodyAgreementById,
  getLatestCustodyAgreementFile,
  updateCustodyAgreement,
} from "~/modules/custody-agreement";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
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
    const { userId } = context.getSession();

    const { agreementId } = getParams(
      params,
      z.object({ agreementId: z.string() }),
      { additionalData: { userId } }
    );

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.update,
    });

    const agreement = await getCustodyAgreementById({
      id: agreementId,
      organizationId,
    });

    const agreementFile = await getLatestCustodyAgreementFile(agreementId);

    const canUpdateAgreementFile = await canUserUpdateAgreementFile({
      agreementId: agreement.id,
      organizationId,
    });

    const header: HeaderData = {
      title: `Edit | ${agreement.name}`,
    };

    return json(
      data({
        agreement,
        agreementFile,
        canUpdateAgreementFile,
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

        const { agreementId } = getParams(
          params,
          z.object({ agreementId: z.string() })
        );

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
          id: agreementId,
          name,
          description: description ?? "",
          signatureRequired: signatureRequired ?? false,
          userId,
          organizationId,
        });

        if (pdf) {
          await updateAgreementFile({
            pdfName: pdf.name,
            pdfSize: pdf.size,
            request: clonedData,
            custodyAgreementId: agreementId,
            organizationId,
          });
        }

        sendNotification({
          title: "Agreement updated",
          message: "Your agreement has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return redirect("/agreements");
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}

export default function EditAgreement() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";

  const { agreement, agreementFile, canUpdateAgreementFile } =
    useLoaderData<typeof loader>();

  return (
    <>
      <Header classNames="mb-4" title={hasName ? name : agreement.name} />

      <AgreementForm
        className="rounded-md border bg-white p-4"
        isEdit
        name={agreement.name || name}
        description={agreement.description}
        type={agreement.type}
        signatureRequired={agreement.signatureRequired}
        pdfUrl={agreementFile!.url}
        pdfSize={agreementFile!.size}
        pdfName={agreementFile!.name}
        canUpdateAgreementFile={canUpdateAgreementFile}
      />
    </>
  );
}
