import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  MOBILE_ASSET_SELECT,
} from "~/modules/api/mobile-auth.server";
import { getBarcodeByValue } from "~/modules/barcode/service.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";

/**
 * GET /api/mobile/barcode/:value?orgId=<orgId>
 *
 * Resolves a barcode (additional code) to its linked asset.
 * Used by the mobile scanner as a fallback when a scanned code
 * is not a Shelf QR code.
 *
 * Requires the organization to have `barcodesEnabled: true`.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Validate the barcode value param
    const { value: encodedValue } = getParams(
      params,
      z.object({ value: z.string().min(1) })
    );

    // Check if organization has barcode feature enabled
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { barcodesEnabled: true },
    });

    if (!org?.barcodesEnabled) {
      return data(
        {
          error: {
            message:
              "Barcode scanning is not enabled for this workspace. Contact your admin to enable this feature.",
          },
        },
        { status: 403 }
      );
    }

    // Decode the URL-encoded barcode value
    const value = decodeURIComponent(encodedValue);

    // Look up barcode within the organization, including asset details
    // in a single query. getBarcodeByValue handles case-insensitive
    // matching (tries original case first, then uppercase).
    const barcode = await getBarcodeByValue({
      value,
      organizationId,
      include: {
        asset: { select: MOBILE_ASSET_SELECT },
        kit: true,
      },
    });

    if (!barcode) {
      return data(
        {
          error: {
            message: "This barcode was not found in your workspace.",
          },
        },
        { status: 404 }
      );
    }

    if (!barcode.assetId && !barcode.kitId) {
      return data(
        {
          error: {
            message: "This barcode is not linked to any asset.",
          },
        },
        { status: 422 }
      );
    }

    return data({
      barcode: {
        id: barcode.id,
        value: barcode.value,
        type: barcode.type,
        assetId: barcode.assetId,
        kitId: barcode.kitId,
        organizationId,
        asset: barcode.asset ?? null,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
