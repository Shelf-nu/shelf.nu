import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getPrimaryLocation } from "~/modules/asset/utils";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";

/**
 * GET /api/mobile/assets/:assetId
 *
 * Returns full asset details including category, location, custody, and kit.
 *
 * Image URLs are returned as-stored along with `mainImageExpiration`. Mobile
 * clients should call `/api/mobile/asset/refresh-image/:assetId` lazily when
 * they detect a near-expired URL — keeps this loader read-only.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    const { assetId } = getParams(params, z.object({ assetId: z.string() }));

    const asset = await db.asset.findUnique({
      where: {
        // why: inline-scope to org so cross-org probes 404 — matches the
        // pattern used by every other mobile route.
        id: assetId,
        organizationId,
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        mainImage: true,
        mainImageExpiration: true,
        thumbnailImage: true,
        availableToBook: true,
        valuation: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        category: { select: { id: true, name: true, color: true } },
        // Select location through the pivot and synthesise the singular
        // `location` below so the mobile JSON contract stays flat.
        assetLocations: {
          select: { location: { select: { id: true, name: true } } },
        },
        custody: {
          select: {
            createdAt: true,
            custodian: {
              select: {
                id: true,
                name: true,
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    email: true,
                    profilePicture: true,
                  },
                },
              },
            },
          },
        },
        assetKits: {
          select: {
            kit: { select: { id: true, name: true, status: true } },
          },
        },
        tags: { select: { id: true, name: true } },
        qrCodes: { select: { id: true } },
        organization: { select: { currency: true } },
        notes: {
          select: {
            id: true,
            content: true,
            type: true,
            createdAt: true,
            user: {
              select: { firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: "desc" as const },
          take: 25,
        },
        customFields: {
          select: {
            id: true,
            value: true,
            customField: {
              select: {
                id: true,
                name: true,
                type: true,
                helpText: true,
                active: true,
              },
            },
          },
        },
      },
    });

    if (!asset) {
      return data({ error: { message: "Asset not found" } }, { status: 404 });
    }

    // Strip internal user id and the raw `assetLocations` pivot; keep
    // mainImageExpiration so the client can decide when to call the
    // refresh endpoint. Synthesise the singular `location` (Phase 4b).
    const { userId: _, assetLocations: __, ...assetData } = asset;
    const location = getPrimaryLocation(asset);

    return data({ asset: { ...assetData, location } });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
