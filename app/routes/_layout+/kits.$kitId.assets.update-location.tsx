import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { MapPinIcon } from "lucide-react";
import { z } from "zod";
import { LocationSelect } from "~/components/location/location-select";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { getLocationsForCreateAndEdit } from "~/modules/asset/service.server";
import { getKit, updateKitLocation } from "~/modules/kit/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const ParamsSchema = z.object({ kitId: z.string() });

const UpdateLocationSchema = z.object({
  currentLocationId: z.string().optional(),
  newLocationId: z.string(),
});

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { kitId } = getParams(params, ParamsSchema);

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const kit = await getKit({
      id: kitId,
      organizationId,
      userOrganizations,
    });

    const { locations, totalLocations } = await getLocationsForCreateAndEdit({
      organizationId,
      request,
      defaultLocation: kit?.locationId,
    });

    return json(
      data({
        showModal: true,
        kit,
        locations,
        totalLocations,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw reason;
  }
}

export async function action({ params, request, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { kitId } = getParams(params, ParamsSchema);

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const formData = await request.formData();
    const payload = parseData(formData, UpdateLocationSchema);

    await updateKitLocation({
      id: kitId,
      organizationId,
      currentLocationId: payload.currentLocationId ?? null,
      newLocationId: payload.newLocationId,
    });

    sendNotification({
      title: "Location updated",
      message: "Your kit's location has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(`/kits/${kitId}/assets`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return reason;
  }
}

export default function UpdateKitLocation() {
  const disabled = useDisabled();
  const { kit } = useLoaderData<typeof loader>();

  return (
    <Form method="post">
      <div className="modal-content-wrapper">
        <div className="mb-2 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
          <MapPinIcon />
        </div>
        <div className="mb-5">
          <h4>Update location</h4>
          <p>
            Adjust the location of{" "}
            <span className="font-medium">{kit.name}</span>.
          </p>
        </div>
        <div className=" relative z-50 mb-8">
          <LocationSelect isBulk={false} locationId={kit?.locationId} />
        </div>

        <div className="flex gap-3">
          <Button to=".." variant="secondary" width="full" disabled={disabled}>
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
  );
}
