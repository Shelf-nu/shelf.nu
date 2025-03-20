import { json, redirect } from "@remix-run/node";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import {
  NewAgreementFormSchema,
  AgreementForm,
} from "~/components/agreements/form";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import {
  createCustodyAgreement,
  updateAgreementFile,
} from "~/modules/custody-agreement";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import { data, error, getActionMethod, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import {
  assertUserCanCreateMoreAgreements,
  isMaxActiveAgreementsLimitReached,
} from "~/utils/subscription.server";

const title = "New Agreement";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.create,
    });

    await assertUserCanCreateMoreAgreements({ organizationId, organizations });

    const header: HeaderData = { title };

    return json(data({ header }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
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
        const { organizationId, organizations } = await requirePermission({
          request,
          userId,
          entity: PermissionEntity.custodyAgreement,
          action: PermissionAction.create,
        });

        await assertUserCanCreateMoreAgreements({
          organizationId,
          organizations,
        });

        const clonedData = request.clone();

        const { name, description, signatureRequired, pdf } = parseData(
          await request.formData(),
          NewAgreementFormSchema
        );

        /**
         * If user has reached the limit of maxActiveAgreements then we will create the inactive agreement only
         */
        const isMaxActiveAgreementsReached =
          await isMaxActiveAgreementsLimitReached({
            organizationId,
            organizations,
          });

        const { id } = await createCustodyAgreement({
          name,
          description: description ?? "",
          signatureRequired: signatureRequired ?? false,
          userId: authSession.userId,
          organizationId,
          isActive: !isMaxActiveAgreementsReached,
        });

        if (pdf) {
          await updateAgreementFile({
            pdfName: pdf.name,
            pdfSize: pdf.size,
            request: clonedData,
            custodyAgreementId: id,
            organizationId,
          });
        }

        sendNotification({
          title: "Agreement created",
          message: "Your agreement has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return redirect("/agreements");
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function NewAgreement() {
  const title = useAtomValue(dynamicTitleAtom);

  return (
    <>
      <Header classNames="mb-4" title={title ? title : "Untitled agreement"} />

      <AgreementForm className="rounded-md border bg-white p-4" />
    </>
  );
}
