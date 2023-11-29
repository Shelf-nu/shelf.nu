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
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import {
  getTemplateById,
  updateTemplate,
  updateTemplatePDF,
} from "~/modules/template/template.server";
import { assertIsPost, getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { userId } = authSession;
  const id = getRequiredParam(params, "templateId");

  const template = await getTemplateById({ userId, id });
  if (!template) {
    throw new Response("Not Found", { status: 404 });
  }

  const header: HeaderData = {
    title: `Edit | ${template.name}`,
  };

  return json({
    template,
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

  const id = getRequiredParam(params, "templateId");
  const clonedData = request.clone();
  const formData = await request.formData();
  const result = await NewTemplateFormSchema.safeParseAsync(
    parseFormAny(formData)
  );
  console.log(result);

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

  const { name, description, signatureRequired } = result.data;

  await updateTemplate({
    id,
    name,
    description: description ?? "",
    signatureRequired: signatureRequired ?? false,
    userId: authSession.userId,
  });
  await updateTemplatePDF({
    request: clonedData,
    templateId: id,
    userId: authSession.userId,
  });

  sendNotification({
    title: "Template updated",
    message: "Your template has been updated successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return null;
  // return redirect("/settings/template", {
  //   headers: {
  //     "Set-Cookie": await commitAuthSession(request, { authSession }),
  //   },
  // });
}

export default function TemplateEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  const { template } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={hasName ? name : template.name} />
      <div className=" items-top flex justify-between">
        <TemplateForm
          isEdit
          name={template.name || name}
          description={template.description}
          type={template.type}
          signatureRequired={template.signatureRequired}
          pdfUrl={template.pdfUrl}
          pdfSize={template.pdfSize}
        />
      </div>
    </>
  );
}
