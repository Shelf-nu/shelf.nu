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
import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import {
  createTemplate,
  updateTemplatePDF,
} from "~/modules/template/template.server";
import { assertUserCanCreateMoreTemplates } from "~/modules/tier";

import { assertIsPost } from "~/utils";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";

const title = "New Template";

export async function loader({ request }: LoaderFunctionArgs) {
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
  const authSession = await requireAuthSession(request);
  assertIsPost(request);
  await assertUserCanCreateMoreTemplates({ userId: authSession.userId });

  const formData = await request.formData();
  const clonedData = request.clone();
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
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }
  const { name, type, description, signatureRequired } = result.data;

  await createTemplate({
    name,
    type,
    description: description ?? "",
    signatureRequired: signatureRequired ?? false,
    userId: authSession.userId,
  });

  await updateTemplatePDF({
    request: clonedData,
    templateId: authSession.userId,
    userId: authSession.userId,
  });

  sendNotification({
    title: "Template created",
    message: "Your template has been created successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/settings/template`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function AddTemplatePage() {
  const title = useAtomValue(dynamicTitleAtom);

  return (
    <>
      <Header title={title ? title : "Untitled template"} />
      <div>
        <TemplateForm />
      </div>
    </>
  );
}
