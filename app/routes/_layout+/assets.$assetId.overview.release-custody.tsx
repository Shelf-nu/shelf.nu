import { OrganizationRoles, type Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { UserXIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { releaseCustody } from "~/modules/custody/service.server";
import { createNote } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import {
  wrapCustodianForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

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

    const custody = await db.custody
      .findUnique({
        where: { assetId },
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
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching custody. Please try again or contact support.",
          additionalData: { userId, assetId },
          label: "Assets",
        });
      });

    if (!custody) {
      return redirect(`/assets/${assetId}`);
    }

    const asset = await db.asset
      .findUniqueOrThrow({
        where: { id: params.assetId as string },
        select: {
          title: true,
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

    return json(
      payload({
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

    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } satisfies Prisma.UserSelect,
    });

    const custodyRecord = await db.custody.findUnique({
      where: { assetId },
      select: {
        custodian: {
          select: {
            id: true,
            name: true,
            userId: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (isSelfService) {
      if (custodyRecord?.custodian?.userId !== user.id) {
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

    const asset = await releaseCustody({ assetId, organizationId });

    if (!asset.custody) {
      const formData = await request.formData();
      const { custodianName } = parseData(
        formData,
        z.object({
          custodianName: z.string(),
        }),
        {
          additionalData: { userId, assetId },
        }
      );

      const custodianDisplayName =
        custodyRecord?.custodian?.name?.trim() || custodianName.trim();
      const custodianDisplay = custodyRecord?.custodian
        ? wrapCustodianForNote({
            teamMember: {
              name: custodianDisplayName,
              user: custodyRecord.custodian.user
                ? {
                    id: custodyRecord.custodian.user.id,
                    firstName: custodyRecord.custodian.user.firstName,
                    lastName: custodyRecord.custodian.user.lastName,
                  }
                : null,
            },
          })
        : `**${custodianDisplayName}**`;
      const actor = wrapUserLinkForNote({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      const content = isSelfService
        ? `${actor} released their custody.`
        : `${actor} released ${custodianDisplay}'s custody.`;

      /** Once the asset is updated, we create the note */
      await createNote({
        content,
        type: "UPDATE",
        userId: asset.userId,
        assetId: asset.id,
      });

      sendNotification({
        title: `‘${asset.title}’ is no longer in custody of ‘${custodianDisplayName}’`,
        message: "This asset is available again.",
        icon: { name: "success", variant: "success" },
        senderId: userId,
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
