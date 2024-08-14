import { Currency } from "@prisma/client";
import {
  json,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { invariant } from "framer-motion";
import { useAtomValue } from "jotai";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import SuccessfulSubscriptionModal from "~/components/subscription/successful-subscription-modal";
import {
  NewWorkspaceFormSchema,
  WorkspaceForm,
} from "~/components/workspace/form";

import {
  getSelectedOrganisation,
  setSelectedOrganizationIdCookie,
} from "~/modules/organization/context.server";
import { createOrganization } from "~/modules/organization/service.server";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import { assertUserCanCreateMoreOrganizations } from "~/utils/subscription.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await getSelectedOrganisation({
      userId,
      request,
    });

    await assertUserCanCreateMoreOrganizations(userId);

    const header: HeaderData = {
      title: `New workspace`,
    };

    return json(
      data({
        header,
        currentOrganizationId: organizationId,
        curriences: Object.keys(Currency),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const MAX_SIZE = 1024 * 1024 * 4; // 4MB

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    await assertUserCanCreateMoreOrganizations(userId);

    /** Here we need to clone the request as we need 2 different streams:
     * 1. Access form data for creating asset
     * 2. Access form data via upload handler to be able to upload the file
     *
     * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
     */
    const clonedRequest = request.clone();

    const formData = await clonedRequest.formData();

    const payload = parseData(formData, NewWorkspaceFormSchema, {
      additionalData: { userId },
    });

    const { name, currency } = payload;
    /** This checks if tags are passed and build the  */

    const formDataFile = await unstable_parseMultipartFormData(
      request,
      unstable_createMemoryUploadHandler({ maxPartSize: MAX_SIZE })
    );

    const file = formDataFile.get("image") as File | null;

    invariant(file instanceof File, "file not the right type");

    const newOrg = await createOrganization({
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

    return redirect(`/account-details/workspace/`, {
      headers: [setCookie(await setSelectedOrganizationIdCookie(newOrg.id))],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
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
        <SuccessfulSubscriptionModal />

        <WorkspaceForm />
      </div>
    </div>
  );
}
