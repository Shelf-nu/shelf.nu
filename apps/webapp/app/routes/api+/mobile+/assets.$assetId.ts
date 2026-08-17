import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getQuantityData } from "~/components/assets/asset-status-badge/quantity-data";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
  shapeMobileAssetResponse,
} from "~/modules/api/mobile-auth.server";
import {
  filterMobileCustodyListForViewer,
  viewerCanSeeLegacyCustody,
} from "~/modules/api/mobile-custody-visibility.server";
import { ASSET_MODEL_IMAGE_SELECT } from "~/modules/asset/image-select";
import { getAssetQuantityRows } from "~/modules/asset/quantity-breakdown.server";
import { isQuantityTracked } from "~/modules/asset/utils";
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

    // Custody visibility is permission-gated (web parity): viewers without
    // custody-view permission (SELF_SERVICE/BASE, unless the org overrides
    // allow) must not receive other holders' custody. Resolve the flag once
    // here; the filtering happens below, after shaping.
    const { canSeeAllCustody } = await getMobileUserContext(
      user.id,
      organizationId
    );

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
        // The web asset overview shows "Asset ID SAM-0017"; the companion
        // scanner even invites you to type a SAM ID ("Enter QR, barcode, or
        // SAM ID"), but no mobile screen could show you one because this
        // payload never carried it.
        sequentialId: true,
        /**
         * `name` drives the detail screen's Model row, which web has always
         * shown and mobile never did; the image columns feed the shaper's
         * cover-image cascade.
         *
         * Merged into ONE key with a spread of the shared constant rather than
         * re-listing the image columns — same reasoning as
         * `modules/asset/fields.ts`. Hardcoding them here would silently drop a
         * future third image column on this surface only, while every other
         * surface kept resolving the cascade.
         */
        assetModel: {
          select: {
            name: true,
            ...ASSET_MODEL_IMAGE_SELECT.assetModel.select,
          },
        },
        mainImageExpiration: true,
        thumbnailImage: true,
        availableToBook: true,
        valuation: true,
        // Quantity fields (additive) — surfaced so the companion detail
        // screen can DISPLAY quantity. Null for INDIVIDUAL assets.
        type: true,
        quantity: true,
        minQuantity: true,
        unitOfMeasure: true,
        consumptionType: true,
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
          // Oldest-first so the flattened single custody + custodyList are
          // deterministic (the relation is otherwise unordered).
          orderBy: { createdAt: "asc" as const },
          select: {
            createdAt: true,
            // why: feeds the helper's many-aware `custodyList` (additive);
            // the detail screen's existing `custody` read is unchanged.
            quantity: true,
            // why: discriminates operator rows (null) from kit-allocated rows
            // so the shaper can compute `releasableQuantity` per holder.
            kitCustodyId: true,
            custodian: {
              select: {
                id: true,
                name: true,
                // why: powers the server-side custody-visibility filter below
                // ("is this row the caller's own?"). Also web parity: the web
                // asset page ships custodian.userId to the client
                // (asset-custody-card.tsx:87 reads it) — additive here.
                userId: true,
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
      // Part of the helper's param shape. This route serves its own copy from
      // `assetData` below, so the helper's is unused here.
      sequentialId: asset.sequentialId,
      mainImage: asset.mainImage,
      // Passed through so the helper can resolve the model-image cascade —
      // the detail screen renders the model's cover image for an asset that
      // has none of its own.
      thumbnailImage: asset.thumbnailImage,
      assetModel: asset.assetModel,
      availableToBook: asset.availableToBook,
      // Helper's `category` type is `{ name } | null`; widen-then-narrow.
      category: asset.category ? { name: asset.category.name } : null,
      // Quantity scalars the helper now requires (this route only consumes
      // the helper's flattened kit/location below, but the param type must
      // be satisfied).
      type: asset.type,
      quantity: asset.quantity,
      minQuantity: asset.minQuantity,
      unitOfMeasure: asset.unitOfMeasure,
      consumptionType: asset.consumptionType,
      assetKits: asset.assetKits.map((ak) => ({
        kit: { id: ak.kit.id, name: ak.kit.name },
      })),
      assetLocations: asset.assetLocations,
      custody: asset.custody.map((c) => ({
        quantity: c.quantity,
        kitCustodyId: c.kitCustodyId,
        custodian: {
          id: c.custodian.id,
          name: c.custodian.name,
          userId: c.custodian.userId,
        },
      })),
    });

    // Quantity breakdown (additive). For QUANTITY_TRACKED assets we fetch the
    // per-booking/custody slices (with the effective ONGOING/OVERDUE math
    // applied by the shared helper) and reduce them via the same pure
    // `getQuantityData` the web badge uses. INDIVIDUAL assets skip the query
    // entirely and report `null`.
    let quantityBreakdown: {
      total: number;
      available: number;
      inCustody: number;
      reserved: number;
      checkedOut: number;
      custodyAvailable: number;
    } | null = null;
    if (isQuantityTracked(asset)) {
      const rows = await getAssetQuantityRows(db, {
        assetId,
        organizationId,
      });
      const breakdown = getQuantityData(rows);
      quantityBreakdown = breakdown
        ? {
            total: breakdown.total,
            available: breakdown.available,
            inCustody: breakdown.inCustody,
            reserved: breakdown.reserved,
            checkedOut: breakdown.checkedOut,
            // Assign cap for the quantity-custody dialog. Mirrors
            // `checkOutQuantity`'s availability rule: total − in custody −
            // checked out on active bookings; RESERVED is deliberately NOT
            // subtracted (reservations re-validate at their own checkout).
            // Floored at 0 so a transiently over-allocated asset can't
            // render a negative cap.
            custodyAvailable: Math.max(
              0,
              breakdown.total - breakdown.inCustody - breakdown.checkedOut
            ),
          }
        : null;
    }

    // Strip internal user id and the raw pivot arrays the helper already
    // flattened; keep mainImageExpiration so the client can decide when to
    // call the refresh endpoint. Re-attach the richer detail-only custody +
    // category shapes that the companion's asset-detail screen reads.
    const {
      userId: _,
      assetLocations: __,
      assetKits: ___,
      // The image fields are dropped here on purpose — the helper already
      // resolved the cover-image cascade into flat fields, and shipping the
      // nested relation alongside them would give the client two sources of
      // truth for one decision. The model's identity is re-attached below as
      // `assetModel` so the detail screen can show it, the way web does.
      assetModel: detailAssetModel,
      custody: detailCustody,
      category: detailCategory,
      ...assetData
    } = asset;

    // The model's name only. The detail screen renders it as read-only text —
    // unlike web, mobile has no asset-model screen to link to — so shipping an
    // id nothing navigates to would work against the single-source-of-truth
    // narrowing the destructure above exists for.
    const assetModel = detailAssetModel
      ? { name: detailAssetModel.name }
      : null;

    // Custody visibility parity (server-side, since mobile clients are
    // untrusted): when the caller lacks custody-view permission, filter
    // `custodyList` to their OWN entries and report how many holders were
    // hidden — mirroring the web's QuantityCustodyList filter + hidden-count
    // (quantity-custody-list.tsx:121-126).
    const { custodyList, custodyListOthersCount } =
      filterMobileCustodyListForViewer({
        custodyList: flattened.custodyList,
        custodyRows: detailCustody,
        viewerUserId: user.id,
        canSeeAllCustody,
      });

    // Legacy single `custody`: the web HIDES its single-custodian card from
    // viewers without custody-view permission unless they ARE the custodian —
    // assets.$assetId.overview.tsx:1826-1836 passes
    // hasPermission={userCanViewSpecificCustody(...)} and CustodyCard renders
    // nothing when !hasPermission (asset-custody-card.tsx:63). Mirror that
    // exactly: null the field when the caller may not see it.
    const primaryCustody = detailCustody[0] ?? null;
    const visibleCustody =
      primaryCustody &&
      viewerCanSeeLegacyCustody({
        custodianUserId: primaryCustody.custodian.userId,
        viewerUserId: user.id,
        canSeeAllCustody,
      })
        ? primaryCustody
        : null;

    return data({
      asset: {
        ...assetData,
        // why: `assetData` carries the RAW image columns. Take the resolved
        // ones from the helper so an asset with no image of its own renders
        // its model's cover image on the detail screen.
        mainImage: flattened.mainImage,
        thumbnailImage: flattened.thumbnailImage,
        imageSource: flattened.imageSource,
        kit: flattened.kit,
        kitId: flattened.kitId,
        location: flattened.location,
        // Name only (no id, no image fields — see the destructure above).
        assetModel,
        // why: re-attach the detail-shape custody (with createdAt +
        // custodian.user) — the helper's narrower shape drops both.
        // Nulled when the caller lacks custody-view permission (see above).
        custody: visibleCustody,
        // Many-aware custody list (additive) — every visible holder + their
        // quantity, so the detail screen can show per-custodian quantities
        // for QUANTITY_TRACKED assets. Filtered to the caller's own entries
        // when they lack custody-view permission.
        custodyList,
        // Additive: number of holders hidden from this caller (0 when the
        // caller can see all custody) so the app can render "+N others".
        custodyListOthersCount,
        // why: re-attach the wider category shape (id + color) the detail
        // endpoint loads — the helper only types {name}.
        category: detailCategory,
        // Aggregated quantity breakdown (additive). Null for INDIVIDUAL
        // assets and for QUANTITY_TRACKED assets with no custody/booking
        // activity (see getQuantityData's null contract).
        quantityBreakdown,
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
