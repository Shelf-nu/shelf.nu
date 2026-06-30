import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useActionData, useLoaderData } from "react-router";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { LocationMarkerIcon } from "~/components/icons/library";
import { LocationSelect } from "~/components/location/location-select";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import {
  getAsset,
  getLocationsForCreateAndEdit,
  updateAsset,
} from "~/modules/asset/service.server";
import { getPrimaryLocation, isQuantityTracked } from "~/modules/asset/utils";
import styles from "~/styles/layout/custom-modal.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  assertIsPost,
  getParams,
  error,
  parseData,
  payload,
} from "~/utils/http.server";
import type { DataOrErrorResponse } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const meta = () => [{ title: appendToMetaTitle("Update location") }];

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
      include: {
        // Pull both `locationId` and `quantity` so the qty input can
        // pre-fill from the current primary placement and the
        // multi-placement warning can count how many pivot rows the
        // dialog would overwrite.
        assetLocations: {
          select: {
            locationId: true,
            quantity: true,
            location: { select: { id: true } },
          },
        },
      },
    });

    const primaryLocation = getPrimaryLocation(asset);

    const { locations } = await getLocationsForCreateAndEdit({
      organizationId,
      request,
      defaultLocation: primaryLocation?.id ?? null,
    });

    /**
     * The qty input only renders for QUANTITY_TRACKED assets. Surface
     * the asset's total + the current primary placement (if any) so
     * the dialog has everything it needs to compute the input's MAX
     * and pre-fill value without an extra round-trip.
     */
    const isQty = isQuantityTracked(asset);
    const primaryPlacement =
      primaryLocation && "id" in primaryLocation
        ? {
            locationId: primaryLocation.id,
            quantity:
              asset.assetLocations.find(
                (al) => al.locationId === primaryLocation.id
              )?.quantity ?? null,
          }
        : null;

    return payload({
      asset,
      locations,
      isQty,
      assetQuantity: asset.quantity ?? null,
      unitOfMeasure: asset.unitOfMeasure ?? null,
      placementCount: asset.assetLocations.length,
      primaryPlacement,
      showModal: true,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, params, id });
    throw data(error(reason), { status: reason.status });
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

    const { newLocationId, currentLocationId, newLocationQuantity } = parseData(
      await request.formData(),
      z.object({
        newLocationId: z.string().optional(),
        currentLocationId: z.string().optional(),
        /**
         * QUANTITY_TRACKED per-asset placement qty. Coerced through
         * Zod's number pipeline so a blank submission (INDIVIDUAL or
         * qty-tracked left blank) becomes `undefined` rather than
         * `NaN`. The service-layer validator runs the MAX check.
         */
        newLocationQuantity: z.coerce.number().int().positive().optional(),
      })
    );

    await updateAsset({
      id,
      newLocationId,
      currentLocationId,
      newLocationQuantity,
      userId: authSession.userId,
      organizationId,
      request,
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
    return data(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function Custody() {
  const disabled = useDisabled();
  const {
    asset,
    isQty,
    assetQuantity,
    unitOfMeasure,
    placementCount,
    primaryPlacement,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<DataOrErrorResponse>();
  const serverErrorMessage =
    actionData && "error" in actionData && actionData.error?.message
      ? actionData.error.message
      : null;

  /**
   * Pre-fill the qty input with the existing primary placement's qty
   * when present, else the asset's full pool. Bounded by
   * `Asset.quantity` (the dialog collapses any multi-placement to one
   * row, so MAX is the total pool, not the orthogonal picker MAX).
   */
  const max = assetQuantity ?? 1;
  const initialQty =
    primaryPlacement?.quantity != null ? primaryPlacement.quantity : max;
  const [quantity, setQuantity] = useState<number>(initialQty);

  const showMultiPlacementWarning = isQty && placementCount > 1;

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
            <LocationSelect
              locationId={getPrimaryLocation(asset)?.id ?? null}
              isBulk={false}
            />
          </div>

          {isQty ? (
            <div className="mb-6">
              <label
                htmlFor="newLocationQuantity"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Quantity to place at this location
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="newLocationQuantity"
                  name="newLocationQuantity"
                  type="number"
                  min={1}
                  max={max}
                  value={quantity}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return;
                    const capped = Math.max(1, Math.min(Math.floor(raw), max));
                    setQuantity(capped);
                  }}
                  className="h-9 w-24 rounded-md border border-gray-300 px-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  aria-describedby="newLocationQuantity-hint"
                />
                <span
                  id="newLocationQuantity-hint"
                  className="text-xs text-gray-500"
                >
                  of {max} {unitOfMeasure || "units"}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Units not placed at any location stay in the unplaced pool. Use
                the location&apos;s manage-assets picker to spread across
                multiple locations.
              </p>
            </div>
          ) : null}

          {showMultiPlacementWarning ? (
            <div className="mb-6 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800">
              <strong>Multi-placement notice:</strong> This asset is currently
              placed at {placementCount} locations. Saving will replace all
              placements with a single placement at the selected location. Use
              the location&apos;s manage-assets picker if you want to keep
              multiple placements.
            </div>
          ) : null}

          {serverErrorMessage ? (
            <div className="mb-6 rounded-md border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-800">
              {serverErrorMessage}
            </div>
          ) : null}

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
