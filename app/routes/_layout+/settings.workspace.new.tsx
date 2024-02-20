import {
  json,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
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

import { createOrganization } from "~/modules/organization";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { assertUserCanCreateMoreOrganizations } from "~/modules/tier";
import { assertIsPost } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { organizationId } = await requireOrganisationId({
    userId: authSession.userId,
    request,
  });
  const { userId } = authSession;
  assertUserCanCreateMoreOrganizations(userId);

  const header: HeaderData = {
    title: `New workspace`,
  };

  return json({ header, currentOrganizationId: organizationId });
}

export const MAX_SIZE = 1024 * 1024 * 4; // 4MB

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  assertIsPost(request);
  assertUserCanCreateMoreOrganizations(authSession.userId);

  /** Here we need to clone the request as we need 2 different streams:
   * 1. Access form data for creating asset
   * 2. Access form data via upload handler to be able to upload the file
   *
   * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
   */
  const clonedRequest = request.clone();

  const formData = await clonedRequest.formData();

  const result = await NewWorkspaceFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      {
        status: 400,
      }
    );
  }

  const { name, currency } = result.data;
  /** This checks if tags are passed and build the  */

  const formDataFile = await unstable_parseMultipartFormData(
    request,
    unstable_createMemoryUploadHandler({ maxPartSize: MAX_SIZE })
  );

  const file = formDataFile.get("image") as File | null;
  invariant(file instanceof File, "file not the right type");

  await createOrganization({
    name,
    userId: authSession.userId,
    image: file || null,
    currency,
  });

  sendNotification({
    title: "Workspace created",
    message: "Your workspace has been created successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/settings/workspace/`);
}

export const handle = {
  breadcrumb: () => "New workspace",
};

export default function NewWorkspace() {
  const title = useAtomValue(dynamicTitleAtom);

  return (
    <div>
      <Header title={title} hideBreadcrumbs classNames="-mt-5" />
      <div>
        <WorkspaceForm />
      </div>
    </div>
  );
}
