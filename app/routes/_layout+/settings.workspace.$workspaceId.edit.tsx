import {
  json,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { invariant } from "framer-motion";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { titleAtom } from "~/atoms/workspace.new";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import {
  NewWorkspaceFormSchema,
  WorkspaceForm,
} from "~/components/workspace/form";

import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { getOrganization, updateOrganization } from "~/modules/organization";
import { assertIsPost, getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { MAX_SIZE } from "./settings.workspace.new";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = getRequiredParam(params, "workspaceId");

  const organization = await getOrganization({ id });
  if (!organization) {
    throw new Response("Not Found", { status: 404 });
  }

  const header: HeaderData = {
    title: `Edit | ${organization.name}`,
  };

  return json({
    organization,
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

  const id = getRequiredParam(params, "workspaceId");
  const clonedRequest = request.clone();
  const formData = await clonedRequest.formData();
  const result = await NewWorkspaceFormSchema.safeParseAsync(
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
        headers: {
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }

  const { name, currency } = result.data;
  const formDataFile = await unstable_parseMultipartFormData(
    request,
    unstable_createMemoryUploadHandler({ maxPartSize: MAX_SIZE })
  );

  const file = formDataFile.get("image") as File | null;
  invariant(file instanceof File, "file not the right type");

  await updateOrganization({
    id,
    name,
    image: file || null,
    userId: authSession.userId,
    currency,
  });

  sendNotification({
    title: "Workspace updated",
    message: "Your workspace  has been updated successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect("/settings/workspace", {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function WorkspaceEditPage() {
  const name = useAtomValue(titleAtom);
  const hasName = name !== "Untitled workspace";
  const { organization } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={hasName ? name : organization.name} />
      <div className=" items-top flex justify-between">
        <WorkspaceForm
          name={organization.name || name}
          currency={organization.currency}
        />
      </div>
    </>
  );
}
