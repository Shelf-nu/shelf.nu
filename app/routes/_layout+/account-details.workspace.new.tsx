import { Currency } from "@prisma/client";
import {
  MaxFileSizeExceededError,
  parseFormData,
} from "@remix-run/form-data-parser";
import { invariant } from "framer-motion";
import { useAtomValue } from "jotai";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect } from "react-router";
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
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
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

    return payload({
      header,
      currentOrganizationId: organizationId,
      curriences: Object.keys(Currency),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

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

    let formDataFile: FormData;
    try {
      formDataFile = await parseFormData(request, {
        maxFileSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
      });
    } catch (parseError) {
      if (parseError instanceof MaxFileSizeExceededError) {
        const reason = new ShelfError({
          cause: parseError,
          message: `Image size exceeds maximum allowed size of ${
            DEFAULT_MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024)
          }MB`,
          status: 400,
          label: "Organization",
          additionalData: { userId, field: "image" },
          shouldBeCaptured: false,
        });
        return data(error(reason), { status: reason.status });
      }

      const reason = makeShelfError(parseError, { userId });
      return data(error(reason), { status: reason.status });
    }

    const file = formDataFile.get("image") as File | null;

    invariant(file instanceof File, "file not the right type");

    // Validate file size
    if (file && file.size > DEFAULT_MAX_IMAGE_UPLOAD_SIZE) {
      throw new ShelfError({
        cause: null,
        message: `Image size exceeds maximum allowed size of ${
          DEFAULT_MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024)
        }MB`,
        status: 400,
        label: "Organization",
        additionalData: { userId, field: "image" },
        shouldBeCaptured: false,
      });
    }

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
    // File size errors are now handled in the validation above
    return data(error(reason), { status: reason.status });
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
