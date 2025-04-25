import { KitStatus, OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { UserXIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";

import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { releaseCustody } from "~/modules/custody/service.server";
import { assetCustodyRevokedEmailText } from "~/modules/invite/helpers";
import { createNote } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";

import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams, parseData } from "~/utils/http.server";
import { validEmail } from "~/utils/misc";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

/** @TODO this needs review */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    const asset = await db.asset
      .findUniqueOrThrow({
        where: { id: params.assetId as string },
        select: {
          title: true,
          kit: { select: { status: true } },
          custody: {
            select: {
              custodian: {
                select: {
                  id: true,
                  name: true,
                  user: {
                    select: {
                      firstName: true,
                      lastName: true,
                      profilePicture: true,
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
          message: "We couldn't find the asset you were looking for.",
          additionalData: { userId, assetId },
          label: "Assets",
        });
      });

    const custody = asset.custody;
    if (!custody) {
      return redirect(`/assets/${assetId}`);
    }

    /**
     * If the custody was via kit then user is not allowed to release it's custody
     * individually.
     */
    if (
      asset.kit &&
      (asset.kit.status === KitStatus.IN_CUSTODY ||
        asset.kit.status === KitStatus.SIGNATURE_PENDING)
    ) {
      throw new ShelfError({
        cause: null,
        label: "Custody",
        message: "Custody assigned via cannot be released individually.",
      });
    }

    return json(
      data({
        showModal: true,
        custody,
        asset,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
  }
}

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { role, organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const user = await getUserByID(userId);

    if (isSelfService) {
      const custody = await db.custody.findUnique({
        where: { assetId },
        select: {
          custodian: {
            select: { id: true, userId: true },
          },
        },
      });

      if (custody?.custodian?.userId !== user.id) {
        throw new ShelfError({
          cause: null,
          title: "Action not allowed",
          message:
            "Self service user can only release custody of assets assigned to their user.",
          additionalData: { userId, assetId },
          label: "Assets",
        });
      }
    }

    const assetFound = await db.asset
      .findFirstOrThrow({
        where: { id: assetId, organizationId },
        select: { id: true, kit: { select: { status: true } } },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label: "Custody",
          message:
            "Asset not found. Are you sure it exists in the current workspace.",
        });
      });

    /**
     * If the custody was assigned via kit, then user is not allowed to release
     * the custody of asset individually.
     */
    if (
      assetFound.kit &&
      (assetFound.kit.status === KitStatus.IN_CUSTODY ||
        assetFound.kit.status === KitStatus.SIGNATURE_PENDING)
    ) {
      throw new ShelfError({
        cause: null,
        label: "Custody",
        message: "Custody assigned via cannot be released individually.",
      });
    }

    const asset = await releaseCustody({ assetId, organizationId });

    const formData = await request.formData();
    const { custodianName, custodianEmail } = parseData(
      formData,
      z.object({
        custodianName: z.string(),
        custodianEmail: z
          .string()
          .transform((email) => email?.toLowerCase())
          .refine(
            (email) => {
              if (!email) {
                return true;
              }

              return validEmail(email);
            },
            () => ({
              message: "Custodian email is invalid",
            })
          )
          .optional(),
      }),
      {
        additionalData: { userId, assetId },
      }
    );

    await createNote({
      content: `**${user.firstName?.trim()} ${user.lastName}** has released ${
        isSelfService ? "their" : `**${custodianName.trim()}'s**`
      } custody over **${asset.title.trim()}**`,
      type: "UPDATE",
      userId: asset.userId,
      assetId: asset.id,
    });

    sendNotification({
      title: `‘${asset.title}’ is no longer in custody of ‘${custodianName}’`,
      message: "This asset is available again.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    if (custodianEmail) {
      sendEmail({
        to: custodianEmail,
        subject: `Your custody over ${asset.title} has been revoked`,
        text: assetCustodyRevokedEmailText({
          assetName: asset.title,
          assignerName: user.firstName + " " + user.lastName,
          assetId: asset.id,
        }),
      });
    }

    return redirect(`/assets/${assetId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return json(error(reason), { status: reason.status });
  }
};

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const { custody, asset } = useLoaderData<typeof loader>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  const { isSelfService } = useUserRoleHelper();

  return (
    <>
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
          <UserXIcon />
        </div>
        <div className="mb-5">
          <h4>Release custody of asset</h4>
          <p>
            Are you sure you want to release{" "}
            {isSelfService ? (
              "your"
            ) : (
              <span className="font-medium">
                {resolveTeamMemberName(custody?.custodian)}'s'
              </span>
            )}{" "}
            custody over <span className="font-medium">{asset.title}</span>?
          </p>
        </div>
        <div className="">
          <Form method="post" className="flex w-full gap-3">
            <input
              type="hidden"
              name="custodianName"
              value={resolveTeamMemberName(custody?.custodian)}
            />
            <input
              type="hidden"
              name="custodianEmail"
              value={custody?.custodian.user?.email}
            />
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
          </Form>
        </div>
      </div>
    </>
  );
}
