import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { UserXIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { createNote } from "~/modules/asset/service.server";
import { releaseCustody } from "~/modules/custody/service.server";
import { getUserByID } from "~/modules/user/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
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
      action: PermissionAction.update,
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
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const user = await getUserByID(userId);

    const asset = await releaseCustody({ assetId });

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

      /** Once the asset is updated, we create the note */
      await createNote({
        content: `**${user.firstName?.trim()} ${
          user.lastName
        }** has released **${custodianName?.trim()}'s** custody over **${asset.title?.trim()}**`,
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
  return (
    <>
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
          <UserXIcon />
        </div>
        <div className="mb-5">
          <h4>Check in asset</h4>
          <p>
            Are you sure you want to release{" "}
            <span className="font-medium">
              {resolveTeamMemberName(custody?.custodian)}’s
            </span>{" "}
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
