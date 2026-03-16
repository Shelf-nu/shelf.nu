import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { createNote } from "~/modules/note/service.server";
import { makeShelfError } from "~/utils/error";
import { wrapUserLinkForNote, wrapLinkForNote } from "~/utils/markdoc-wrappers";

/**
 * POST /api/mobile/bulk-update-location
 *
 * Updates the location of multiple assets at once.
 * Body: { assetIds: string[], locationId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const body = await request.json();
    const { assetIds, locationId } = z
      .object({
        assetIds: z.array(z.string().min(1)).min(1),
        locationId: z.string().min(1),
      })
      .parse(body);

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

    // Fetch all assets with their current locations
    const assets = await db.asset.findMany({
      where: { id: { in: assetIds }, organizationId },
      select: {
        id: true,
        title: true,
        locationId: true,
        location: { select: { id: true, name: true } },
      },
    });

    // Filter out assets already at the target location
    const movable = assets.filter((a) => a.locationId !== locationId);

    if (movable.length === 0) {
      return data(
        { error: { message: "All assets are already at this location" } },
        { status: 400 }
      );
    }

    // Bulk update location
    await db.asset.updateMany({
      where: { id: { in: movable.map((a) => a.id) }, organizationId },
      data: { locationId },
    });

    // Create activity notes
    const actor = wrapUserLinkForNote({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    const newLocationLink = wrapLinkForNote(
      `/locations/${location.id}`,
      location.name.trim()
    );

    await Promise.all(
      movable.map((asset) => {
        let noteContent: string;
        if (asset.location) {
          const prevLocationLink = wrapLinkForNote(
            `/locations/${asset.location.id}`,
            asset.location.name.trim()
          );
          noteContent = `${actor} updated the location from ${prevLocationLink} to ${newLocationLink} via mobile app.`;
        } else {
          noteContent = `${actor} set the location to ${newLocationLink} via mobile app.`;
        }

        return createNote({
          content: noteContent,
          type: "UPDATE",
          userId: user.id,
          assetId: asset.id,
        });
      })
    );

    return data({
      success: true,
      updated: movable.length,
      skipped: assets.length - movable.length,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
