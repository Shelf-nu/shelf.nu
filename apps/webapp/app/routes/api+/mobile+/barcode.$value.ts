/**
 * Mobile barcode resolution.
 *
 * Resolves an additional code (barcode) to the asset or kit it is linked to,
 * for the companion scanner's fallback path when a scanned code is not a
 * Shelf QR. A value the caller's current workspace does not hold is looked up
 * across their other workspaces, and the response carries the OWNING
 * `organizationId` so the app can offer to switch and open it there.
 *
 * @see {@link file://./qr.$qrId.ts} the QR twin of this route
 * @see {@link file://./../../../modules/api/mobile-auth.server.ts} MOBILE_ASSET_SELECT and the shape helpers
 */
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
import { readRawLastPathSegment } from "~/utils/raw-path-param";
import { canUseBarcodes } from "~/utils/subscription.server";

/**
 * GET /api/mobile/barcode/:value?orgId=<orgId>
 *
 * Resolves a barcode to its linked asset or kit, searching the caller's
 * current workspace first and their remaining memberships after.
 *
 * Requires the workspace to hold the barcode capability (`canUseBarcodes`),
 * which every workspace holds on a self-hosted deployment — there is no
 * billing there to gate on.
 *
 * @returns 200 with the barcode, its owning `organizationId`, and the linked
 *   asset or kit; 403 when the workspace lacks the capability; 404 when the
 *   value is in none of the caller's workspaces; 409 when it is in more than
 *   one of them; 422 when it is linked to nothing.
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

    // Same capability helper the sibling-workspace lookup below uses. Reading
    // `barcodesEnabled` directly here would 403 a self-hosted deployment, where
    // `canUseBarcodes` grants every add-on because there is no billing to gate
    // on — and would leave the two checks in this one function disagreeing.
    if (!org || !canUseBarcodes(org)) {
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

    // Read the segment from the URL rather than the route param. React Router
    // re-encodes a decoded `/` back to `%2F`, which makes a barcode containing
    // a slash and one whose literal text is `%2F` indistinguishable by the time
    // a loader sees them; the URL still has the difference.
    const value = readRawLastPathSegment(request, encodedValue);

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
        // The owning workspace must hold the barcode capability itself —
        // resolving through a sibling whose add-on lapsed would bypass its
        // gate. Same canonical rule the /me serializer applies.
        select: {
          organizationId: true,
          organization: { select: { barcodesEnabled: true } },
        },
      });
      const eligibleOrgIds = memberships
        .filter((membership) => canUseBarcodes(membership.organization))
        .map((membership) => membership.organizationId);

      if (eligibleOrgIds.length > 0) {
        // Two phases, mirroring the QR resolver's "authorize first, fetch the
        // heavy payload once" shape. Asking each workspace in turn would issue
        // one query per membership — sequentially, each dragging the full
        // asset+kit payload — on every scan that misses locally, and the
        // ambiguity check means it could never stop early.
        //
        // Phase 1: which of the caller's workspaces hold this value at all.
        // `@@unique([organizationId, value])` is case-SENSITIVE, so one
        // workspace can hold both "abc" and "ABC" as separate rows; `distinct`
        // keeps that from reading as two workspaces and faking an ambiguity.
        const owningOrgIds = await db.barcode.findMany({
          where: {
            OR: [{ value }, { value: value.toUpperCase() }],
            organizationId: { in: eligibleOrgIds },
          },
          select: { organizationId: true },
          distinct: ["organizationId"],
        });

        // Barcode uniqueness is per-workspace, so the same value can exist in
        // several sibling workspaces. Only a UNIQUE match may drive the jump —
        // picking one arbitrarily would open the wrong asset.
        if (owningOrgIds.length > 1) {
          return data(
            {
              error: {
                message:
                  "This barcode exists in more than one of your workspaces. Switch to the right workspace to scan it there.",
              },
            },
            // 409, not 404: the code exists and the caller may see it — what
            // fails is choosing between workspaces.
            { status: 409 }
          );
        }

        if (owningOrgIds.length === 1) {
          // Phase 2: the full payload, once, for the winner. Routed back
          // through `getBarcodeByValue` so the original-case-then-uppercase
          // preference stays identical to the current-workspace path.
          const candidate = await getBarcodeByValue({
            value,
            organizationId: owningOrgIds[0].organizationId,
            include: {
              asset: { select: MOBILE_ASSET_SELECT },
              kit: { select: MOBILE_KIT_SELECT },
            },
          });

          if (candidate) {
            foundOrganizationId = owningOrgIds[0].organizationId;
            foundBarcode = candidate;
          }
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
        // Flatten the pivot relations (assetKits/assetLocations/custody) into
        // the flat `asset.kit` / `.location` / `.custody` shape the companion
        // build in the App Store consumes. Mirrors qr.$qrId.ts; see
        // MOBILE_ASSET_SELECT for the full shape.
        asset: foundBarcode.asset
          ? shapeMobileAssetResponse(foundBarcode.asset)
          : null,
        // Kit-linked barcodes return the kit so the scanner can batch-operate
        // on it. shapeMobileKitResponse handles null pass-through.
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
