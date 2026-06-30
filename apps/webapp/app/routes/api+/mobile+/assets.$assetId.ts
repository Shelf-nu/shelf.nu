import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  shapeMobileAssetResponse,
} from "~/modules/api/mobile-auth.server";
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

    // Flatten kit / location / custody via the shared mobile shaper so the
    // legacy companion contract (`asset.kit`, `asset.kitId`, `asset.location`,
    // single-or-null `asset.custody`) is preserved. The helper expects a
    // narrower select than this detail route loads — we hand it a projected
    // view, then merge the detail-only fields (notes, customFields, tags,
    // qrCodes, organization, valuation, timestamps, etc.) back on top.
    //
    // why: the detail-endpoint selects a richer `custody` shape than the
    // helper (it includes `createdAt` + nested `custodian.user` for the
    // "Custody Since" + email rows on the asset detail screen) — so we
    // discard the helper's `custody` and re-attach the detail-shaped one
    // below. Same trick for `category` (detail loads id+name+color, helper
    // only types {name}).
    const flattened = shapeMobileAssetResponse({
      id: asset.id,
      title: asset.title,
      status: asset.status,
      mainImage: asset.mainImage,
      availableToBook: asset.availableToBook,
      // Helper's `category` type is `{ name } | null`; widen-then-narrow.
      category: asset.category ? { name: asset.category.name } : null,
      assetKits: asset.assetKits.map((ak) => ({
        kit: { id: ak.kit.id, name: ak.kit.name },
      })),
      assetLocations: asset.assetLocations,
      custody: asset.custody.map((c) => ({
        custodian: { id: c.custodian.id, name: c.custodian.name },
      })),
    });

    // Strip internal user id and the raw pivot arrays the helper already
    // flattened; keep mainImageExpiration so the client can decide when to
    // call the refresh endpoint. Re-attach the richer detail-only custody +
    // category shapes that the companion's asset-detail screen reads.
    const {
      userId: _,
      assetLocations: __,
      assetKits: ___,
      custody: detailCustody,
      category: detailCategory,
      ...assetData
    } = asset;

    return data({
      asset: {
        ...assetData,
        kit: flattened.kit,
        kitId: flattened.kitId,
        location: flattened.location,
        // why: re-attach the detail-shape custody (with createdAt +
        // custodian.user) — the helper's narrower shape drops both.
        custody: detailCustody[0] ?? null,
        // why: re-attach the wider category shape (id + color) the detail
        // endpoint loads — the helper only types {name}.
        category: detailCategory,
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
