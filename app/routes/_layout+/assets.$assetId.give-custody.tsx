import { useState } from "react";
import { AssetStatus, BookingStatus, TemplateType } from "@prisma/client";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useAtom } from "jotai";
import { assignCustodyUser } from "~/atoms/assign-custody-user";

import CustodianSelect from "~/components/custody/custodian-select";
import TemplateSelect from "~/components/custody/template-select";
import { Switch } from "~/components/forms/switch";
import { UserIcon } from "~/components/icons";
import { Button } from "~/components/shared/button";
import { CustomTooltip } from "~/components/shared/custom-tooltip";
import { WarningBox } from "~/components/shared/warning-box";
import { db } from "~/database";
import { createNote } from "~/modules/asset";
import {
  assetCustodyAssignedEmailText,
  assetCustodyAssignedWithTemplateEmailText,
} from "~/modules/invite/helpers";
import { getUserByID } from "~/modules/user";
import styles from "~/styles/layout/custom-modal.css";
import { isFormProcessing } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import type { AssetWithBooking } from "./bookings.$bookingId.add-assets";

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
    where: { id: assetId },
    select: {
      custody: {
        select: {
          id: true,
        },
      },
      bookings: {
        where: {
          status: {
            in: [BookingStatus.RESERVED],
          },
        },
        select: {
          id: true,
        },
      },
    },
  });
  /** If the asset already has a custody, this page should not be visible */
  if (asset && asset.custody) {
    return redirect(`/assets/${assetId}`);
  }

  /** We get all the team members that are part of the user's personal organization */
  const teamMembers = await db.teamMember.findMany({
    where: {
      deletedAt: null,
      organizationId,
    },
    include: {
      user: true,
    },
    orderBy: {
      userId: "asc",
    },
  });

  // We need to fetch all the templates that belong to the user's current organization
  // and the template type is CUSTODY
  const templates = await db.template.findMany({
    where: {
      organizationId,
      type: TemplateType.CUSTODY,
    },
  });

  return json({
    showModal: true,
    teamMembers,
    templates,
    asset,
  });
};

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  await requirePermision({
    userId,
    request,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });

  const formData = await request.formData();
  const assetId = params.assetId as string;
  const custodian = formData.get("custodian");
  const user = await getUserByID(userId);
  const addTemplateEnabled = formData.get("addTemplateEnabled");
  const template = formData.get("template");

  if (!user)
    throw new ShelfStackError({
      message:
        "User not found. Please refresh and if the issue persists contact support.",
    });

  if (!custodian)
    return json(
      { error: "Please select a custodian", type: "CUSTODIAN" },
      { status: 400 }
    );

  if (addTemplateEnabled && !template)
    return json(
      { error: "Please select a template", type: "TEMPLATE" },
      { status: 400 }
    );

  let templateId = null,
    templateObj = null;

  if (addTemplateEnabled) {
    templateId = JSON.parse(template as string).id;

    templateObj = await db.template.findUnique({
      where: { id: templateId as string },
    });

    if (!templateObj)
      throw new ShelfStackError({
        message:
          "Template not found. Please refresh and if the issue persists contact support.",
      });
  }

  /** We send the data from the form as a json string, so we can easily have both the name and id
   * ID is used to connect the asset to the custodian
   * Name is used to create the note
   */
  const {
    id: custodianId,
    name: custodianName,
    email: custodianEmail,
    userId: custodianUserId,
  } = JSON.parse(custodian as string);

  let asset = null;

  /**
   * We consider 2 cases:
   * 1. We assign a template for signature
   * 2. We don't assign a template for signature
   */
  if (addTemplateEnabled) {
    /**
     * In this case, we do the following:
     * 1. We check if the signature is required by the template
     * 2. If yes, the the asset status is "AVAILABLE", else "IN_CUSTODY"
     * 3. We create a new custody record for that specific asset and the template
     * 4. We link it to the custodian
     */
    asset = await db.asset.update({
      where: { id: assetId },
      data: {
        status: templateObj!.signatureRequired
          ? AssetStatus.AVAILABLE
          : AssetStatus.IN_CUSTODY,
        custody: {
          create: {
            custodian: { connect: { id: custodianId as string } },
            template: { connect: { id: templateId as string } },
          },
        },
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  } else {
    /**
     * In this case, we do the following:
     * 1. We update the asset status
     * 2. We create a new custody record for that specific asset
     * 3. We link it to the custodian
     */
    asset = await db.asset.update({
      where: { id: assetId },
      data: {
        status: AssetStatus.IN_CUSTODY,
        custody: {
          create: {
            custodian: { connect: { id: custodianId as string } },
          },
        },
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  // If the template was specified, and signature was required
  if (addTemplateEnabled && templateObj) {
    if (templateObj.signatureRequired) {
      await createNote({
        content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${custodianName?.trim()}** custody over **${asset.title?.trim()}**. **${custodianName?.trim()}** needs to sign the **${templateObj!.name?.trim()}** template before receiving custody.`,
        type: "UPDATE",
        userId: userId,
        assetId: asset.id,
      });

      sendNotification({
        title: `‘${asset.title}’ would go in custody of ${custodianName}`,
        message:
          "This asset will stay available until the custodian signs the PDF template. After that, the asset will be unavailable until custody is manually released.",
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      sendEmail({
        to: custodianEmail,
        subject: `You have been assigned custody over ${asset.title}.`,
        text: assetCustodyAssignedWithTemplateEmailText({
          assetName: asset.title,
          assignerName: user.firstName + " " + user.lastName,
          assetId: asset.id,
          templateId: templateObj!.id,
          assigneeId: custodianUserId,
        }),
      });
    } else {
      await createNote({
        content: `**${user.firstName} ${user.lastName}** has given **${custodianName}** custody over **${asset.title}**`,
        type: "UPDATE",
        userId: userId,
        assetId: asset.id,
      });

      sendNotification({
        title: `‘${asset.title}’ is now in custody of ${custodianName}`,
        message:
          "Remember, this asset will be unavailable until custody is manually released.",
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      sendEmail({
        to: custodianEmail,
        subject: `You have been assigned custody over ${asset.title}`,
        text: assetCustodyAssignedEmailText({
          assetName: asset.title,
          assignerName: user.firstName + " " + user.lastName,
          assetId: asset.id,
        }),
      });
    }
  } else {
    // If the template was not specified
    await createNote({
      content: `**${user.firstName} ${user.lastName}** has given **${custodianName}** custody over **${asset.title}**`,
      type: "UPDATE",
      userId: userId,
      assetId: asset.id,
    });

    sendNotification({
      title: `‘${asset.title}’ is now in custody of ${custodianName}`,
      message:
        "Remember, this asset will be unavailable until custody is manually released.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    sendEmail({
      to: custodianEmail,
      subject: `You have been assigned custody over ${asset.title}`,
      text: assetCustodyAssignedEmailText({
        assetName: asset.title,
        assignerName: user.firstName + " " + user.lastName,
        assetId: asset.id,
      }),
    });
  }

  return redirect(`/assets/${assetId}`);
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const actionData = useActionData<{
    error: string;
    type: "CUSTODIAN" | "TEMPLATE";
  } | null>();
  const { asset } = useLoaderData<typeof loader>();
  const hasBookings = (asset?.bookings?.length ?? 0) > 0 || false;
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const [assignCustody] = useAtom(assignCustodyUser);
  const [addTemplateEnabled, setAddTemplateEnabled] = useState(false);

  return (
    <>
      <Form method="post">
        <div className="modal-content-wrapper">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-gray-50 bg-gray-100 p-2 text-gray-600">
            <UserIcon />
          </div>
          <div className="mb-5">
            <h4>Give Custody</h4>
            <p>
              This asset is currently available. You&apos;re about to give
              custody to one of your team members.
            </p>
          </div>
          <div className=" relative z-50 mb-5">
            <CustodianSelect />
            {actionData?.type && actionData?.type === "CUSTODIAN" && (
              <div className="text-sm text-error-500">{actionData.error}</div>
            )}
          </div>
          {assignCustody == null || assignCustody?.userId === null ? (
            <CustomTooltip
              content={
                <TooltipContent
                  variant={
                    assignCustody === null
                      ? "USER_NOT_SELECTED"
                      : "NON_COMPATIBLE_USER_SELECTED"
                  }
                />
              }
            >
              <div className="flex gap-x-2">
                <Switch required={false} disabled={true} />
                <div className="flex flex-col gap-y-1">
                  <div className="text-md font-semibold text-gray-600">
                    Add PDF Template
                  </div>
                  <p className="text-sm text-gray-500">
                    Custodian needs to read (and sign) a document before
                    receiving custody.{" "}
                    <Link className="text-gray-700 underline" to="#">
                      Learn more
                    </Link>
                  </p>
                </div>
              </div>
            </CustomTooltip>
          ) : (
            <div className="mb-5 flex gap-x-2">
              <Switch
                name="addTemplateEnabled"
                onClick={() => setAddTemplateEnabled((prev) => !prev)}
                defaultChecked={addTemplateEnabled}
                required={false}
                disabled={disabled}
              />
              <div className="flex flex-col gap-y-1">
                <div className="text-md font-semibold text-gray-600">
                  Add PDF Template
                </div>
                <p className="text-sm text-gray-500">
                  Custodian needs to read (and sign) a document before receiving
                  custody.{" "}
                  <Link className="text-gray-700 underline" to="#">
                    Learn more
                  </Link>
                </p>
              </div>
            </div>
          )}

          {addTemplateEnabled && (
            <div className="mt-5">
              <TemplateSelect />
              {actionData?.type && actionData?.type === "TEMPLATE" && (
                <div className="text-sm text-error-500">{actionData.error}</div>
              )}
            </div>
          )}

          {hasBookings ? (
            <WarningBox className="-mt-4 mb-8">
              <>
                Asset is part of an{" "}
                <Link
                  to={`/bookings/${(asset as AssetWithBooking).bookings[0].id}`}
                  className="underline"
                  target="_blank"
                >
                  upcoming booking
                </Link>
                . You will not be able to check-out your booking if this asset
                has custody.
              </>
            </WarningBox>
          ) : null}

          <div className="mt-8 flex gap-3">
            <Button
              to=".."
              variant="secondary"
              width="full"
              disabled={disabled}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              width="full"
              type="submit"
              disabled={disabled}
            >
              Confirm
            </Button>
          </div>
        </div>
      </Form>
    </>
  );
}

function TooltipContent({
  variant,
}: {
  variant: "USER_NOT_SELECTED" | "NON_COMPATIBLE_USER_SELECTED";
}) {
  return (
    <div>
      {variant === "USER_NOT_SELECTED" && (
        <div>
          <div className="text-md mb-2 font-semibold text-gray-700">
            Please select a custodian
          </div>
          <div className="text-sm text-gray-500">
            You need to select a custodian before you can add a PDF template.
          </div>
        </div>
      )}
      {variant === "NON_COMPATIBLE_USER_SELECTED" && (
        <div>
          <div className="text-md mb-2 font-semibold text-gray-700">
            Custodian needs to be a registered user
          </div>
          <div className="text-sm text-gray-500">
            Signing PDFs is not allowed for NRM and non-users.
          </div>
        </div>
      )}
    </div>
  );
}
