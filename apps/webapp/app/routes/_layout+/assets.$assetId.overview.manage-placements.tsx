/**
 * Asset Overview — Manage Placements Dialog
 *
 * Multi-row editor scoped to ONE asset. Lets the user spread a
 * QUANTITY_TRACKED asset across multiple locations at distinct
 * per-location quantities, or remove placements entirely. INDIVIDUAL
 * assets get the same surface but are capped at one row by the
 * server-side validator.
 *
 * This complements (but does not replace) the single-location
 * `update-location` dialog from Phase 4b-Polish-2 — that flow stays
 * the "quick set primary placement" path; this flow is the multi-
 * placement path the user opens via the "Edit placements" link on the
 * asset-overview "Placed at locations" card.
 *
 * Server contract: a JSON `placements` field encoding
 * `Array<{ locationId, quantity }>`. The full submitted set replaces
 * the asset's current set atomically — see {@link replaceAssetPlacements}
 * for the diff math and the invariant checks.
 *
 * @see {@link file://./../../modules/asset/service.server.ts} — `replaceAssetPlacements`
 * @see {@link file://./assets.$assetId.overview.update-location.tsx} — single-placement quick-set dialog
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useActionData, useLoaderData } from "react-router";
import { z } from "zod";
import { ManagePlacementsForm } from "~/components/assets/manage-placements-form";
import { LocationMarkerIcon } from "~/components/icons/library";
import {
  getAsset,
  getLocationsForCreateAndEdit,
  replaceAssetPlacements,
} from "~/modules/asset/service.server";
import { isQuantityTracked } from "~/modules/asset/utils";
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

export const meta = () => [{ title: appendToMetaTitle("Manage placements") }];

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

/**
 * Parses the `placements` JSON blob submitted by the multi-row editor.
 *
 * Wire format: a JSON-encoded `Array<{ locationId: string;
 * quantity: number }>` in a single hidden form field. Mirror of the
 * `assetQuantities` pattern used by the manage-assets pickers (see
 * `kits.$kitId.assets.manage-assets.tsx` and
 * `locations.$locationId.assets.manage-assets.tsx`) but encodes the
 * full placement set rather than a map.
 *
 * The semantic checks (INDIVIDUAL cap, sum-within-total, org scoping,
 * kit-guard) all live in `replaceAssetPlacements` — this schema only
 * guards the *shape* of the payload.
 */
const PlacementsSchema = z
  .string()
  .optional()
  .default("[]")
  .transform((raw, ctx): Array<{ locationId: string; quantity: number }> => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("expected array");
      }
      const result: Array<{ locationId: string; quantity: number }> = [];
      for (const entry of parsed as unknown[]) {
        if (typeof entry !== "object" || entry === null) {
          throw new Error("each entry must be an object");
        }
        const e = entry as Record<string, unknown>;
        const locationId =
          typeof e.locationId === "string" ? e.locationId : null;
        const rawQty =
          typeof e.quantity === "number" ? e.quantity : Number(e.quantity);
        if (!locationId) {
          throw new Error("missing locationId");
        }
        if (
          !Number.isFinite(rawQty) ||
          !Number.isInteger(rawQty) ||
          rawQty < 1
        ) {
          throw new Error(`invalid quantity for ${locationId}`);
        }
        result.push({ locationId, quantity: rawQty });
      }
      return result;
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid placements payload: ${
          e instanceof Error ? e.message : "parse error"
        }`,
      });
      return z.NEVER;
    }
  });

const ParamsSchema = z.object({ assetId: z.string() });

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId: id } = getParams(params, ParamsSchema, {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    // getAsset + getLocationsForCreateAndEdit only need organizationId
    // from requirePermission above — independent, parallelise.
    const [asset, { locations }] = await Promise.all([
      getAsset({
        organizationId,
        id,
        userOrganizations,
        request,
        include: {
          // Pull the current placement set so the form can pre-populate
          // existing rows with their qty. Polish-4: `assetKitId` +
          // `assetKit.kit` discriminate kit-driven rows so the form can
          // render them read-only with a "via {kit}" indicator.
          assetLocations: {
            select: {
              locationId: true,
              quantity: true,
              assetKitId: true,
              location: { select: { id: true, name: true } },
              assetKit: {
                select: {
                  id: true,
                  kit: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
      getLocationsForCreateAndEdit({
        organizationId,
        request,
        defaultLocation: null,
      }),
    ]);

    const isQty = isQuantityTracked(asset);

    // Split manual vs kit-driven. Manual rows are the editable set the
    // form's diff math operates on; kit-driven rows are surfaced as
    // read-only context so the user understands what's at each
    // location and why the available pool reflects them.
    const manualPlacements = asset.assetLocations
      .filter((al) => al.assetKitId === null)
      .map((al) => ({
        locationId: al.locationId,
        locationName: al.location.name,
        quantity: al.quantity,
      }));
    const kitDrivenPlacements = asset.assetLocations
      .filter((al) => al.assetKitId !== null && al.assetKit?.kit)
      .map((al) => ({
        locationId: al.locationId,
        locationName: al.location.name,
        quantity: al.quantity,
        kit: al.assetKit!.kit,
      }));

    return payload({
      asset,
      isQty,
      assetQuantity: asset.quantity ?? null,
      unitOfMeasure: asset.unitOfMeasure ?? null,
      locations,
      currentPlacements: manualPlacements,
      kitDrivenPlacements,
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
  const { assetId: id } = getParams(params, ParamsSchema, {
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

    const { placements } = parseData(
      await request.formData(),
      z.object({ placements: PlacementsSchema }),
      { additionalData: { userId, organizationId, id } }
    );

    await replaceAssetPlacements({
      assetId: id,
      organizationId,
      userId,
      placements,
    });

    sendNotification({
      title: "Placements updated",
      message: "The asset's placements have been updated.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(`/assets/${id}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function ManagePlacementsRoute() {
  const {
    isQty,
    assetQuantity,
    unitOfMeasure,
    locations,
    currentPlacements,
    kitDrivenPlacements,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<DataOrErrorResponse>();
  const serverErrorMessage =
    actionData && "error" in actionData && actionData.error?.message
      ? actionData.error.message
      : null;

  return (
    <div className="modal-content-wrapper">
      <div className="mb-2 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
        <LocationMarkerIcon />
      </div>
      <div className="mb-5">
        <h4>Manage placements</h4>
        <p className="text-sm text-gray-600">
          {isQty
            ? "Spread this asset across one or more locations. Units not placed anywhere stay in the unplaced pool."
            : "Set the single location this asset sits at."}
        </p>
      </div>
      <ManagePlacementsForm
        isQty={isQty}
        assetQuantity={assetQuantity}
        unitOfMeasure={unitOfMeasure}
        locations={locations}
        initialPlacements={currentPlacements}
        kitDrivenPlacements={kitDrivenPlacements}
        serverErrorMessage={serverErrorMessage}
      />
    </div>
  );
}
