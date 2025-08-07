import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { LocationMarkerIcon } from "~/components/icons/library";
import { LocationSelect } from "~/components/location/location-select";
import { Button } from "~/components/shared/button";
import {
  getAsset,
  getLocationsForCreateAndEdit,
  updateAsset,
} from "~/modules/asset/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { assertIsPost, getParams, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });
    const asset = await getAsset({
      organizationId,
      id,
      userOrganizations,
      request,
    });

    const { locations } = await getLocationsForCreateAndEdit({
      organizationId,
      request,
      defaultLocation: asset.locationId,
    });

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

    const { organizationId } = await requirePermission({
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
      organizationId,
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

  const { asset } = useLoaderData<typeof loader>();

  return (
    <>
      <Form method="post">
        <div className="modal-content-wrapper">
          <div className="mb-2 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
            <LocationMarkerIcon />
          </div>
          <div className="mb-5">
            <h4>Update location</h4>
            <p>Adjust the location of this asset.</p>
          </div>
          <div className=" relative z-50 mb-8">
            <LocationSelect locationId={asset.locationId} isBulk={false} />
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
