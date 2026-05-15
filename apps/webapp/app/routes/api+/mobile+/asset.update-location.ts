import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
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
        location: { select: { id: true, name: true } },
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
    // current location. Without this guard the route would write a no-op
    // `tx.asset.update`, an `ASSET_LOCATION_CHANGED` event whose
    // `fromValue === toValue`, and a misleading "updated the location
    // from X to X" note. The bulk path (`bulkUpdateAssetLocation`) does
    // exactly the same filter before recording events — see the
    // singular/bulk parity rule in `.claude/rules/bulk-event-parity.md`.
    if (asset.location?.id === location.id) {
      return data({
        asset: {
          id: asset.id,
          title: asset.title,
          location: asset.location,
        },
      });
    }

    // Update the asset's location and atomically record the
    // ASSET_LOCATION_CHANGED activity event so reports + activity-event
    // aggregations include mobile-initiated location changes.
    const updatedAsset = await db.$transaction(async (tx) => {
      const updated = await tx.asset.update({
        where: { id: assetId },
        data: { locationId },
        select: {
          id: true,
          title: true,
          location: { select: { id: true, name: true } },
        },
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
          fromValue: asset.location?.id ?? null,
          toValue: location.id,
        },
        tx
      );

      return updated;
    });

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

    let noteContent: string;
    if (asset.location) {
      const currentLocationLink = wrapLinkForNote(
        `/locations/${asset.location.id}`,
        asset.location.name.trim()
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
    });

    return data({ asset: updatedAsset });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
