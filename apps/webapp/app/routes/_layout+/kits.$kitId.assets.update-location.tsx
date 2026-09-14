/**
 * Update Kit Location
 *
 * The modal route behind "Update location" on a kit's assets tab. A kit's
 * location owns where its member assets are, so confirming here moves the kit
 * AND cascades to every asset inside it — which is why the form states the
 * member count before the user commits.
 *
 * @see {@link file://./../../modules/kit/service.server.ts} `updateKitLocation`
 * @see {@link file://./kits.$kitId.assets.tsx} the tab this modal sits over
 */
import { MapPinIcon } from "lucide-react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  Form,
  useActionData,
  useLoaderData,
} from "react-router";
import { z } from "zod";
import { LocationSelect } from "~/components/location/location-select";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { getLocationsForCreateAndEdit } from "~/modules/asset/service.server";
import { getKit, updateKitLocation } from "~/modules/kit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { payload, getParams, parseData, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** Browser tab title for the modal. */
export const meta = () => [{ title: appendToMetaTitle("Update kit location") }];

const ParamsSchema = z.object({ kitId: z.string() });

const UpdateLocationSchema = z.object({
  currentLocationId: z.string().optional(),
  newLocationId: z.string(),
});

/**
 * Loads the kit being moved, its member count and the workspace's locations.
 *
 * @returns The kit, the selectable locations, and the flag that renders the route as a modal
 * @throws {ShelfError} 403 when the caller lacks `kit: update`, 404 when the kit is not in their workspace
 */
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
      extraInclude: {
        _count: { select: { assetKits: true } },
      },
    });

    const { locations, totalLocations } = await getLocationsForCreateAndEdit({
      organizationId,
      request,
      defaultLocation: kit?.locationId,
    });

    return payload({
      showModal: true,
      kit,
      locations,
      totalLocations,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * Moves the kit to the submitted location, cascading to its member assets.
 *
 * @returns A redirect back to the kit's assets tab on success, or the failure with its status
 */
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
      userId,
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
    return data(error(reason), { status: reason.status });
  }
}

/**
 * The modal's form: a location picker, the cascade warning, and confirm/cancel.
 */
export default function UpdateKitLocation() {
  const disabled = useDisabled();
  const { kit } = useLoaderData<typeof loader>();
  /**
   * A refused move answers with its reason rather than redirecting, and the
   * modal stays open — so the reason has to be rendered here or the Confirm
   * button appears to do nothing.
   */
  const actionData = useActionData<DataOrErrorResponse>();

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
          {kit._count.assetKits > 0 && (
            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> This will also update the location of all{" "}
                <span className="font-medium">
                  {kit._count.assetKits} asset
                  {kit._count.assetKits > 1 ? "s" : ""}
                </span>{" "}
                within this kit.
              </p>
            </div>
          )}
        </div>
        <div className=" relative z-50 mb-8">
          <LocationSelect isBulk={false} locationId={kit?.locationId} />
        </div>

        {actionData?.error ? (
          <div className="mb-8 text-sm text-error-500" role="alert">
            {actionData.error.message}
          </div>
        ) : null}

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
