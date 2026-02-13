import type { Prisma } from "@prisma/client";
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

import { sendEmail } from "~/emails/mail.server";
import { linkAuditAddonToOrganization } from "~/modules/audit/addon.server";
import {
  getSelectedOrganization,
  setSelectedOrganizationIdCookie,
} from "~/modules/organization/context.server";
import { createOrganization } from "~/modules/organization/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ADMIN_EMAIL } from "~/utils/env";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import { getOrCreateCustomerId } from "~/utils/stripe.server";
import { assertUserCanCreateMoreOrganizations } from "~/utils/subscription.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await getSelectedOrganization({
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

    // Link audit addon to new org if checkout included audits.
    // This must not block workspace creation — if it fails, we log,
    // notify the admin, and let the user continue.
    const url = new URL(request.url);
    const includesAudits = url.searchParams.get("includesAudits") === "true";
    let auditLinkFailed = false;

    if (includesAudits) {
      try {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            customerId: true,
          } satisfies Prisma.UserSelect,
        });
        const customerId = await getOrCreateCustomerId(user);
        await linkAuditAddonToOrganization({
          customerId,
          organizationId: newOrg.id,
        });
      } catch (cause) {
        auditLinkFailed = true;

        Logger.error(
          new ShelfError({
            cause,
            message:
              "Failed to link audit addon to new organization during workspace creation",
            additionalData: { userId, organizationId: newOrg.id },
            label: "Stripe",
          })
        );

        // Notify admin so they can resolve manually
        void sendEmail({
          to: ADMIN_EMAIL,
          subject: "ACTION REQUIRED: Audit addon linking failed",
          text: [
            "A user created a workspace with an audit addon subscription,",
            "but the addon could not be linked automatically.",
            "",
            `User ID: ${userId}`,
            `Organization ID: ${newOrg.id}`,
            "",
            "Please link the audit addon to this organization manually.",
          ].join("\n"),
        });
      }
    }

    sendNotification({
      title: "Workspace created",
      message: auditLinkFailed
        ? "Your workspace was created, but we couldn't activate the audit addon. An admin will contact you shortly to resolve this."
        : "Your workspace has been created successfully",
      icon: auditLinkFailed
        ? { name: "trash", variant: "error" }
        : { name: "success", variant: "success" },
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
