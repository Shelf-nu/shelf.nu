import { CopyIcon } from "@radix-ui/react-icons";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import { ca } from "date-fns/locale";
import Input from "~/components/forms/input";
import { SendRotatedIcon, ShareAssetIcon } from "~/components/icons";
import { Button } from "~/components/shared";
import { db } from "~/database";
import styles from "~/styles/layout/custom-modal.css";
import { ShelfError, error, isFormProcessing, makeShelfError } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { sendEmail } from "~/utils/mail.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermission } from "~/utils/roles.server";

export const loader = async ({
  request,
  context,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { organizationId } = await requirePermission({
    userId,
    request,
    entity: PermissionEntity.asset,
    action: PermissionAction.read,
  });

  try {
    const assetId = params.assetId as string;
    const asset = await db.asset
      .findUnique({
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
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to load asset",
          status: 500,
          label: "Assets",
          additionalData: { userId, assetId },
        });
      });

    if (!asset) {
      return redirect("/assets");
    }

    const template = asset.custody?.template;
    const custodianName = asset.custody?.custodian?.name;

    if (!template)
      throw new ShelfError({
        cause: null,
        message: "Template not found",
        status: 404,
        label: "Template",
        additionalData: { userId, assetId },
      });

    if (!custodianName)
      throw new ShelfError({
        cause: null,
        message: "Custodian not found",
        status: 404,
        label: "Assets",
        additionalData: { userId, assetId },
      });
    return json({
      showModal: true,
      template,
      custodianName,
      assetId,
      assetName: asset.title,
      custodianEmail: asset.custody?.custodian?.user?.email,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export const action = async ({
  request,
  context,
  params,
}: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const formData = await request.formData();
  const assetId = params.assetId as string;
  const assetName = formData.get("assetName") as string;
  const templateName = formData.get("templateName") as string;
  const email = formData.get("email") as string;

  sendNotification({
    title: "Sending email...",
    message: "Sending a link to the custodian to sign the template.",
    icon: { name: "spinner", variant: "primary" },
    senderId: authSession.userId,
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
    senderId: authSession.userId,
  });

  return redirect(`/assets/${assetId}`);
};

export default function ShareTemplate() {
  // @QUESTION This isn't working for some reason
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
