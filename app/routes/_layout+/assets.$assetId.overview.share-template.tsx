import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { z } from "zod";
import Input from "~/components/forms/input";
import { SendRotatedIcon, ShareAssetIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const loader = async ({
  request,
  params,
  context,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });
  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.template,
      action: PermissionAction.read,
    });
    const asset = await db.asset
      .findUniqueOrThrow({
        where: { id: assetId, organizationId },
        select: {
          title: true,
          custody: {
            include: {
              template: true,
              custodian: {
                select: {
                  name: true,
                  user: {
                    select: {
                      id: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching the asset. Please try again or contact support.",
          additionalData: { userId, assetId, organizationId },
          label: "Template",
        });
      });

    const template = asset.custody?.template;
    const custodianName = asset.custody?.custodian?.name;

    if (!template)
      throw new ShelfError({
        cause: null,
        message:
          "Template not found. Please refresh and if the issue persists contact support.",
        label: "Assets",
      });

    if (!custodianName)
      throw new ShelfError({
        cause: null,
        message:
          "Custodian not found. Please refresh and if the issue persists contact support.",
        label: "Assets",
      });

    const signUrl = `${SERVER_URL}/sign/${template.id}?assigneeId=${asset.custody?.custodian?.user?.id}&assetId=${assetId}`;

    return json(
      data({
        showModal: true,
        template,
        custodianName,
        assetId,
        assetName: asset.title,
        custodianEmail: asset.custody?.custodian?.user?.email,
        signUrl,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
  }
};

export const action = async ({
  request,
  context,
  params,
}: ActionFunctionArgs) => {
  try {
    const authSession = context.getSession();

    const assetId = getParams(params, z.object({ assetId: z.string() }));
    const { assetName, templateName, email } = parseData(
      await request.formData(),
      z.object({
        assetName: z.string(),
        templateName: z.string(),
        email: z.string().email(),
      })
    );

    sendNotification({
      title: "Sending email...",
      message: "Sending a link to the custodian to sign the template.",
      icon: { name: "spinner", variant: "primary" },
      senderId: authSession.userId,
    });

    sendEmail({
      to: email,
      subject: `Custody of ${assetName} shared with you`,
      text: `You have been given the custody of ${assetName}. To claim the custody, you must sign the ${templateName} document. Click on this link to sign the document: https://app.shelf.nu/sign/${assetId}`,
    });

    sendNotification({
      title: "Asset shared",
      message: "An email has been sent to the custodian.",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/assets/${assetId}`);
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
};

export default function ShareTemplate() {
  const { template, custodianName, assetName, custodianEmail, signUrl } =
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

      <h4 className="mb-1">{template.name}</h4>
      <p className="mb-5 text-gray-600">
        This PDF template page has been published.{" "}
        <span className="font-semibold">{custodianName}</span> will receive an
        email and will be able to visit this page to read (and sign) the
        document. You can visit the asset page to open this modal in case you
        need to acquire the share link or re-send the email.{" "}
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

        <Form method="post">
          <input hidden name="assetName" value={assetName} />
          <input hidden name="templateName" value={template.name} />
          <input hidden name="email" value={custodianEmail} />
          <Button
            disabled={disabled}
            type={"submit"}
            variant="secondary"
            className="h-fit p-[9px]"
          >
            <SendRotatedIcon />
          </Button>
        </Form>
      </div>

      <div className="flex flex-col">
        <Button to=".." variant="secondary" className="h-fit w-full">
          Close
        </Button>
      </div>
    </div>
  );
}
