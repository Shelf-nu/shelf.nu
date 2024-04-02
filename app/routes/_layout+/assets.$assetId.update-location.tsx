import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { LocationMarkerIcon } from "~/components/icons";
import { LocationSelect } from "~/components/location";
import { Button } from "~/components/shared/button";
import {
  getAllEntriesForCreateAndEdit,
  getAsset,
  updateAsset,
} from "~/modules/asset";
import styles from "~/styles/layout/custom-modal.css";
import {
  assertIsPost,
  getParams,
  error,
  isFormProcessing,
  makeShelfError,
  parseData,
} from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const { locations } = await getAllEntriesForCreateAndEdit({
      organizationId,
      request,
    });

    const asset = await getAsset({ userId, id });

    return json({
      asset,
      locations,
      showModal: true,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, params, id });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    assertIsPost(request);

    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const { newLocationId, currentLocationId } = parseData(
      await request.formData(),
      z.object({
        newLocationId: z.string().optional(),
        currentLocationId: z.string().optional(),
      })
    );

    await updateAsset({
      id,
      newLocationId,
      currentLocationId,
      userId: authSession.userId,
    });

    sendNotification({
      title: "Location updated",
      message: "Your asset's location has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return redirect(`/assets/${id}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  return (
    <>
      <Form method="post">
        <div className="modal-content-wrapper">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-gray-50 bg-gray-100 p-2 text-gray-600">
            <LocationMarkerIcon />
          </div>
          <div className="mb-5">
            <h4>Update location</h4>
            <p>Adjust the location of this asset.</p>
          </div>
          <div className=" relative z-50 mb-8">
            <LocationSelect />
          </div>

          <div className="flex gap-3">
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
