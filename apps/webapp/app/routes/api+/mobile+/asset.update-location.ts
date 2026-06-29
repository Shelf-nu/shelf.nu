import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getPrimaryLocation, isQuantityTracked } from "~/modules/asset/utils";
import { createNote } from "~/modules/note/service.server";
import { makeShelfError } from "~/utils/error";
import { wrapUserLinkForNote, wrapLinkForNote } from "~/utils/markdoc-wrappers";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/asset/update-location
 *
 * Updates the location of a single asset.
 * Body: { assetId: string, locationId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const body = await request.json();
    const { assetId, locationId } = z
      .object({
        assetId: z.string().min(1),
        locationId: z.string().min(1),
      })
      .parse(body);

    // Verify asset exists and belongs to org
    const asset = await db.asset.findUnique({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        title: true,
        type: true,
        quantity: true,
        assetLocations: {
          select: { location: { select: { id: true, name: true } } },
        },
        assetKits: {
          select: { kit: { select: { id: true, name: true } } },
        },
      },
    });

    if (!asset) {
      return data({ error: { message: "Asset not found" } }, { status: 404 });
    }

    // Prevent location update if asset belongs to a kit
    const parentKit = asset.assetKits[0]?.kit;
    if (parentKit) {
      return data(
        {
          error: {
            message: `This asset's location is managed by its parent kit "${parentKit.name}". Please update the kit's location instead.`,
          },
        },
        { status: 400 }
      );
    }

    // Verify location exists and belongs to org
    const location = await db.location.findFirst({
      where: { id: locationId, organizationId },
      select: { id: true, name: true },
    });

    if (!location) {
      return data(
        { error: { message: "Location not found" } },
        { status: 404 }
      );
    }

    // why: short-circuit when the requested location matches the asset's
    // current primary placement. Without this guard the route would write a
    // no-op pivot replace, an `ASSET_LOCATION_CHANGED` event whose
    // `fromValue === toValue`, and a misleading "updated the location from
    // X to X" note. Mirrors the singular/bulk parity rule in
    // `.claude/rules/bulk-event-parity.md`.
    const currentPrimaryLocation = getPrimaryLocation(asset);
    if (currentPrimaryLocation?.id === location.id) {
      return data({
        asset: {
          id: asset.id,
          title: asset.title,
          location: currentPrimaryLocation,
        },
      });
    }

    // Setting a single primary location is a pivot replace: wipe any
    // existing AssetLocation rows then create the new link.
    // QUANTITY_TRACKED assets place their full quantity at the location;
    // INDIVIDUAL assets are always quantity 1. The ASSET_LOCATION_CHANGED
    // activity event is recorded atomically so reports + activity-event
    // aggregations include mobile-initiated location changes.
    const pivotQuantity =
      isQuantityTracked(asset) && asset.quantity != null ? asset.quantity : 1;

    const updatedAsset = await db.$transaction(async (tx) => {
      await tx.assetLocation.deleteMany({ where: { assetId } });
      await tx.assetLocation.create({
        data: { assetId, locationId, organizationId, quantity: pivotQuantity },
      });

      await recordEvent(
        {
          organizationId,
          actorUserId: user.id,
          action: "ASSET_LOCATION_CHANGED",
          entityType: "ASSET",
          entityId: assetId,
          assetId,
          locationId: location.id,
          field: "locationId",
          fromValue: currentPrimaryLocation?.id ?? null,
          toValue: location.id,
        },
        tx
      );

      return tx.asset.findUniqueOrThrow({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` already org-verified by the `db.asset.findUnique({ where: { id, organizationId } })` guard at the top of this action; this is the in-tx re-read
        where: { id: assetId },
        select: {
          id: true,
          title: true,
          assetLocations: {
            select: { location: { select: { id: true, name: true } } },
          },
        },
      });
    });

    const { assetLocations: _, ...updatedAssetRest } = updatedAsset;
    const updatedAssetWithLocation = {
      ...updatedAssetRest,
      location: getPrimaryLocation(updatedAsset),
    };

    // Create activity note (matches webapp format)
    const actor = wrapUserLinkForNote({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    const newLocationLink = wrapLinkForNote(
      `/locations/${location.id}`,
      location.name.trim()
    );

    const previousLocation = getPrimaryLocation(asset);

    let noteContent: string;
    if (previousLocation) {
      const currentLocationLink = wrapLinkForNote(
        `/locations/${previousLocation.id}`,
        previousLocation.name.trim()
      );
      noteContent = `${actor} updated the location from ${currentLocationLink} to ${newLocationLink} via mobile app.`;
    } else {
      noteContent = `${actor} set the location to ${newLocationLink} via mobile app.`;
    }

    await createNote({
      content: noteContent,
      type: "UPDATE",
      userId: user.id,
      assetId: asset.id,
      organizationId,
    });

    return data({ asset: updatedAssetWithLocation });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
