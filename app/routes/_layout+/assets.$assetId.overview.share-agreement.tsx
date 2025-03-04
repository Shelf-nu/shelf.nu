import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { z } from "zod";
import Input from "~/components/forms/input";
import { SendRotatedIcon, ShareAssetIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import When from "~/components/when/when";
import { sendEmail } from "~/emails/mail.server";
import { getAgreementByAssetIdWithCustodian } from "~/modules/custody-agreement";
import { assetCustodyAssignedWithAgreementEmailText } from "~/modules/invite/helpers";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

    const { custody, custodyAgreement, custodian } =
      await getAgreementByAssetIdWithCustodian({
        assetId,
        organizationId,
      });

    const signUrl = `${SERVER_URL}/sign/${custody.id}`;
    const isCustodianNrm = !custodian.user;

    return json(
      data({
        showModal: true,
        custodyAgreement,
        custodian,
        signUrl,
        isCustodianNrm,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

    const { asset, custodian, custody } =
      await getAgreementByAssetIdWithCustodian({
        assetId,
        organizationId,
      });

    if (!custodian.user) {
      throw new ShelfError({
        cause: null,
        message: "Email cannot be send to non-registered members.",
        label: "Custody Agreement",
      });
    }

    sendNotification({
      title: "Sending email...",
      message: "Sending a link to the custodian to sign the agreement.",
      icon: { name: "spinner", variant: "primary" },
      senderId: authSession.userId,
    });

    sendEmail({
      to: custodian?.user?.email ?? "",
      subject: `You have been assigned custody over ${asset.title}.`,
      text: assetCustodyAssignedWithAgreementEmailText({
        assetName: asset.title,
        assignerName: resolveTeamMemberName(custodian),
        assetId: asset.id,
        custodyId: custody.id,
      }),
    });

    sendNotification({
      title: "Asset shared",
      message: "An email has been sent to the custodian.",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/assets/${assetId}/overview`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function ShareAgreement() {
  const { custodyAgreement, custodian, signUrl, isCustodianNrm } =
    useLoaderData<typeof loader>();
  const [isCopied, setIsCopied] = useState(false);

  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  async function handleCopy() {
    await navigator.clipboard.writeText(signUrl).then(() => {
      setIsCopied(true);

      setTimeout(() => {
        setIsCopied(false);
      }, 1000);
    });
  }

  return (
    <div className="modal-content-wrapper">
      <ShareAssetIcon className="mb-3" />

      <h4 className="mb-1">{custodyAgreement.name}</h4>
      <p className="mb-5 text-gray-600">
        This PDF agreement page has been published.{" "}
        <span className="font-semibold">
          {resolveTeamMemberName(custodian)}
        </span>{" "}
        will receive an email and will be able to visit this page to read (and
        sign) the document. You can visit the asset page to open this modal in
        case you need to acquire the share link or re-send the email.{" "}
      </p>
      <div className="font-semibold text-gray-600">Share link</div>

      <div className="mb-5 flex items-end gap-x-2">
        <Input
          readOnly
          className="flex-1 cursor-text"
          value={signUrl}
          disabled
          label=""
        />

        <Button onClick={handleCopy} variant="secondary" className="h-fit p-3">
          {isCopied ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
        </Button>

        <When truthy={!isCustodianNrm}>
          <Form method="post">
            <Button
              disabled={disabled}
              type="submit"
              variant="secondary"
              className="h-fit p-[9px]"
            >
              <SendRotatedIcon />
            </Button>
          </Form>
        </When>
      </div>

      <Button to=".." variant="secondary" className="h-fit w-full">
        Close
      </Button>
    </div>
  );
}
