import { CopyIcon } from "@radix-ui/react-icons";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import Input from "~/components/forms/input";
import { SendRotatedIcon, ShareAssetIcon } from "~/components/icons";
import { Button } from "~/components/shared";
import { db } from "~/database";
import styles from "~/styles/layout/custom-modal.css";
import { isFormProcessing } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { organizationId } = await requirePermision({
    userId,
    request,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });

  const assetId = params.assetId as string;
  const asset = await db.asset.findUnique({
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
                  email: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!asset) {
    return redirect("/assets");
  }

  const template = asset.custody?.template;
  const custodianName = asset.custody?.custodian?.name;

  if (!template)
    throw new ShelfStackError({
      message:
        "Template not found. Please refresh and if the issue persists contact support.",
    });

  if (!custodianName)
    throw new ShelfStackError({
      message:
        "Custodian not found. Please refresh and if the issue persists contact support.",
    });

  return json({
    showModal: true,
    template,
    custodianName,
    assetId,
    assetName: asset.title,
    custodianEmail: asset.custody?.custodian?.user?.email,
  });
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const formData = await request.formData();
  const assetId = params.assetId as string;
  const assetName = formData.get("assetName") as string;
  const templateName = formData.get("templateName") as string;
  const email = formData.get("email") as string;

  sendNotification({
    title: "Sending email...",
    message: "Sending a link to the custodian to sign the template.",
    icon: { name: "spinner", variant: "primary" },
    senderId: userId,
  });

  await sendEmail({
    to: email,
    subject: `Custody of ${assetName} shared with you`,
    text: `You have been given the custody of ${assetName}. To claim the custody, you must sign the ${templateName} document. Click on this link to sign the document: https://app.shelf.nu/sign/${assetId}`,
  });

  sendNotification({
    title: "Asset shared",
    message: "An email has been sent to the custodian.",
    icon: { name: "success", variant: "success" },
    senderId: userId,
  });

  return redirect(`/assets/${assetId}`);
};

export default function ShareTemplate() {
  const { template, custodianName, assetId, assetName, custodianEmail } =
    useLoaderData<typeof loader>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  return (
    <div className="modal-content-wrapper">
      <div className="mb-3">
        <ShareAssetIcon />
      </div>
      <div className="flex flex-col">
        <h4>{template.name}</h4>
        <p className="mt-1 text-gray-600">
          This PDF template page has been published.{" "}
          <span className="font-semibold">{custodianName}</span> will receive an
          email and will be able to visit this page to read (and sign) the
          document. You can visit the asset page to open this modal in case you
          need to acquire the share link or re-send the email.{" "}
        </p>
        <div className="mt-5 font-semibold text-gray-600">Share link</div>
        <div className="mb-5 mt-1 flex items-end gap-x-2">
          <Input
            className="cursor-text"
            value={`https://app.shelf.nu/sign/${assetId}`}
            disabled
            label={""}
          />
          <Button
            onClick={() =>
              navigator.clipboard.writeText(
                `https://app.shelf.nu/sign/${assetId}`
              )
            }
            variant="secondary"
            className="h-fit p-3"
          >
            <CopyIcon />
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
        <Link to={`..`}>
          <Button variant="secondary" className="h-fit w-full">
            Close
          </Button>
        </Link>
      </div>
    </div>
  );
}
