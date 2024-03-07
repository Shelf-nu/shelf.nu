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
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import {
  NewWorkspaceFormSchema,
  WorkspaceForm,
} from "~/components/workspace/form";

import { getOrganization, updateOrganization } from "~/modules/organization";
import { assertIsPost, getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import { MAX_SIZE } from "./settings.workspace.new";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = await context.getSession();

  await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.workspace,
    action: PermissionAction.update,
  });
  const id = getRequiredParam(params, "workspaceId");

  const organization = await getOrganization({
    id,
    userId: authSession.userId,
  });
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
  breadcrumb: () => <span>Edit</span>,
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const authSession = await context.getSession();

  await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.workspace,
    action: PermissionAction.update,
  });

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

  return redirect("/settings/workspace");
}

export default function WorkspaceEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "Untitled workspace";
  const { organization } = useLoaderData<typeof loader>();

  return (
    <>
      <Header
        title={hasName ? name : organization.name}
        hideBreadcrumbs
        classNames="-mt-5"
      />
      <div className=" items-top flex justify-between">
        <WorkspaceForm
          name={organization.name || name}
          currency={organization.currency}
        />
      </div>
    </>
  );
}
