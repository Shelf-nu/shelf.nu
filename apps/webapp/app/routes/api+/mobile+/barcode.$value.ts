import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  MOBILE_ASSET_SELECT,
  MOBILE_KIT_SELECT,
  shapeMobileAssetResponse,
  shapeMobileKitResponse,
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
        kit: { select: MOBILE_KIT_SELECT },
      },
    });

    // Not in the current workspace: try the user's OTHER memberships, the way
    // QR resolution does. A barcode from a sibling workspace must say which
    // workspace owns it (so the app can offer the jump), not claim the code
    // does not exist. Codes outside every membership still 404 below — the
    // response must not reveal other tenants' barcodes.
    let foundOrganizationId = organizationId;
    let foundBarcode = barcode;
    if (!foundBarcode) {
      const memberships = await db.userOrganization.findMany({
        where: { userId: user.id, organizationId: { not: organizationId } },
        select: { organizationId: true },
      });
      for (const membership of memberships) {
        const candidate = await getBarcodeByValue({
          value,
          organizationId: membership.organizationId,
          include: {
            asset: { select: MOBILE_ASSET_SELECT },
            kit: { select: MOBILE_KIT_SELECT },
          },
        });
        if (candidate) {
          foundOrganizationId = membership.organizationId;
          foundBarcode = candidate;
          break;
        }
      }
    }

    if (!foundBarcode) {
      return data(
        {
          error: {
            message: "This barcode was not found in your workspace.",
          },
        },
        { status: 404 }
      );
    }

    if (!foundBarcode.assetId && !foundBarcode.kitId) {
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
        id: foundBarcode.id,
        value: foundBarcode.value,
        type: foundBarcode.type,
        assetId: foundBarcode.assetId,
        kitId: foundBarcode.kitId,
        // The OWNING workspace — not necessarily the requesting one. The
        // scanner compares this against its current workspace to drive the
        // switch-and-view card.
        organizationId: foundOrganizationId,
        // Flatten the Phase-4a/4b pivot rows (assetKits/assetLocations/custody)
        // back into the legacy flat shape the in-App-Store companion expects.
        // Mirrors qr.$qrId.ts. See MOBILE_ASSET_SELECT for the why.
        asset: foundBarcode.asset
          ? shapeMobileAssetResponse(foundBarcode.asset)
          : null,
        // Kit-linked barcodes return the kit so the scanner can batch-operate
        // on it (previously fetched but dropped from the response).
        // shapeMobileKitResponse handles null pass-through.
        kit: shapeMobileKitResponse(foundBarcode.kit ?? null),
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
