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
 * POST /api/mobile/asset/update-location
 *
 * Updates the location of a single asset.
 * Body: { assetId: string, locationId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

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
      },
    });

    if (!asset) {
      return data({ error: { message: "Asset not found" } }, { status: 404 });
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

    // Update the asset's location
    const updatedAsset = await db.asset.update({
      where: { id: assetId },
      data: { locationId },
      select: {
        id: true,
        title: true,
        location: { select: { id: true, name: true } },
      },
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
