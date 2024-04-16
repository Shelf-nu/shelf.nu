import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";

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

const title = "New Template";

export async function loader({ request }: LoaderFunctionArgs) {
  // @ts-expect-error @TODO update to use new method
  const { userId } = await requireAuthSession(request);

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

export async function action({ request }: LoaderFunctionArgs) {
  // @ts-expect-error @TODO update to use new method
  const authSession = await requireAuthSession(request);

  // @ts-expect-error @TODO update to use new method
  const { organizationId } = await requireOrganisationId(authSession, request);

  // @ts-expect-error @TODO update to use new method
  assertIsPost(request);
  await assertUserCanCreateMoreTemplates({ userId: authSession.userId });

  const clonedData = request.clone();
  const formData = await request.formData();
  const result = await NewTemplateFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      {
        status: 400,
        headers: {
          // @ts-expect-error @TODO update to use new method
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }
  const { name, type, description, signatureRequired, pdf } = result.data;

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
        headers: {
          // @ts-expect-error @TODO update to use new method
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }

  // @TODO update to use new method - throw errors inside the function
  const { id } = await createTemplate({
    name,
    type,
    description: description ?? "",
    signatureRequired: signatureRequired ?? false,
    userId: authSession.userId,
    organizationId,
  });

  // @TODO update to use new method - throw errors inside the function
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

  return redirect(`/settings/template`, {
    headers: {
      // @ts-expect-error @TODO update to use new method
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
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
