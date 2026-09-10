import { AssetStatus } from "@prisma/client";
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
import { serializeImageExpiration } from "~/modules/asset/image-resolution";
import { ASSET_MODEL_IMAGE_SELECT } from "~/modules/asset/image-select";
import { getAssetQuantityRows } from "~/modules/asset/quantity-breakdown.server";
import { isQuantityTracked } from "~/modules/asset/utils";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { canSeeBooking } from "~/utils/booking-authorization.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";
import {
  resolveTeamMemberName,
  resolveUserDisplayName,
  type UserNameFields,
} from "~/utils/user";

/**
 * GET /api/mobile/assets/:assetId
 *
 * Returns full asset details including category, location, custody, and kit.
 * For an INDIVIDUAL asset checked out on a booking, `activeBooking` names that
 * booking and who holds the asset through it.
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
    // allow) must not receive other holders' custody. Resolve the flags once
    // here; the filtering happens below, after shaping. `canSeeAllBookings`
    // is the booking screen's own read gate, which `activeBooking.canOpen`
    // answers in advance.
    const { canSeeAllCustody, canSeeAllBookings } = await getMobileUserContext(
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
        // The workspace-scoped "SAM-0017" ID. The detail screen shows it, as
        // the web asset overview does, because the scanner's manual entry
        // accepts it ("Enter QR, barcode, or SAM ID").
        sequentialId: true,
        /**
         * `name` drives the detail screen's Model row, as on the web asset
         * overview; the image columns feed the shaper's cover-image cascade.
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
        // `location` below so the mobile JSON contract stays flat. The
        // per-row `quantity` is the units placed at that location
        // (AssetLocation.quantity — NOT workspace stock); it feeds the
        // `placementCount` / `locationQuantity` fields the qty-aware
        // "Update location" sheet reads.
        assetLocations: {
          select: {
            quantity: true,
            location: { select: { id: true, name: true } },
          },
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
                // (`CustodyCard` links the custodian's profile with it).
                userId: true,
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    displayName: true,
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
        // The active booking the asset is out on. Same filter as the web
        // asset overview (`getAssetOverviewFields`): ONGOING or OVERDUE, and
        // not partially checked in for this asset. Read only to build
        // `activeBooking` below; the rows themselves never reach the client.
        bookingAssets: {
          where: {
            booking: {
              status: { in: ["ONGOING", "OVERDUE"] },
              NOT: {
                partialCheckins: { some: { assetIds: { has: assetId } } },
              },
            },
          },
          select: {
            booking: {
              select: {
                id: true,
                name: true,
                from: true,
                custodianTeamMember: {
                  select: { id: true, name: true, userId: true },
                },
                custodianUser: { select: { id: true, ...USER_NAME_SELECT } },
              },
            },
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
              select: { firstName: true, lastName: true, displayName: true },
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
      // Quantity scalars the helper requires (this route only consumes
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
      // Read into `activeBooking` below; the raw rows stay on the server.
      bookingAssets: _bookingAssets,
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
    // hidden — mirroring the web's `QuantityCustodyList` filter and hidden
    // count (its `canViewAllCustody` prop).
    const { custodyList, custodyListOthersCount } =
      filterMobileCustodyListForViewer({
        custodyList: flattened.custodyList,
        custodyRows: detailCustody,
        viewerUserId: user.id,
        canSeeAllCustody,
      });

    // Legacy single `custody`: the web HIDES its single-custodian card from
    // viewers without custody-view permission unless they ARE the custodian —
    // assets.$assetId.overview.tsx:1757-1769 passes
    // hasPermission={userCanViewSpecificCustody(...)} and CustodyCard renders
    // nothing when !hasPermission (asset-custody-card.tsx:66-68). Mirror that
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

    // Custody held through a booking, for an asset checked out on one. A
    // booking checkout writes no Custody row, so this is the only way the
    // detail screen can say who has the asset. It follows the web asset
    // overview's CustodyCard on every point:
    // - the asset must be CHECKED_OUT. Assets added to an ONGOING booking stay
    //   AVAILABLE until they are checked out, and the web shows no card then;
    // - the `bookingAssets` select above decides which booking, and the first
    //   row wins, as it does on the web;
    // - INDIVIDUAL assets only. A quantity-tracked asset's custody is its
    //   quantity breakdown;
    // - only viewers who may see all custody. The web's "is it yours" check
    //   reads the custody row's user, which a booking checkout does not write,
    //   so a booking's own custodian without that permission sees no card.
    const checkedOutOn =
      !isQuantityTracked(asset) &&
      asset.status === AssetStatus.CHECKED_OUT &&
      canSeeAllCustody
        ? asset.bookingAssets[0]?.booking ?? null
        : null;

    const activeBooking = checkedOutOn
      ? {
          id: checkedOutOn.id,
          name: checkedOutOn.name,
          from: checkedOutOn.from,
          custodianName: resolveBookingHolderName(checkedOutOn),
          // Seeing custody and seeing bookings are separate workspace
          // overrides, so a viewer shown this booking may still be refused by
          // the booking screen. This is that screen's own gate, answered here
          // so the app only offers a tap that will open.
          canOpen: canSeeBooking({
            canSeeAllBookings,
            booking: {
              custodianUserId: checkedOutOn.custodianUser?.id ?? null,
              custodianTeamMember: checkedOutOn.custodianTeamMember,
            },
            userId: user.id,
          }),
        }
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
        mainImageExpiration: serializeImageExpiration(
          flattened.imageSource,
          assetData.mainImageExpiration
        ),
        kit: flattened.kit,
        kitId: flattened.kitId,
        location: flattened.location,
        // Placement metadata (additive) for the qty-aware "Update location"
        // sheet: how many AssetLocation rows exist (drives the
        // multi-placement collapse warning — the update is a pivot replace)
        // and the units placed at the primary location (the sheet's
        // pre-fill). `locationQuantity` is the per-row placement quantity,
        // NOT workspace stock.
        placementCount: asset.assetLocations.length,
        locationQuantity:
          asset.assetLocations.find(
            (al) => al.location.id === flattened.location?.id
          )?.quantity ?? null,
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
        // Additive: the booking an INDIVIDUAL asset is checked out on and who
        // holds it through that booking; null otherwise (see above).
        activeBooking,
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

/**
 * The name of whoever holds a booking, resolved the way the web asset
 * overview's `CustodyCard` resolves it: the custodian user's display name when
 * the booking has a user custodian, otherwise the custodian team member's
 * name.
 *
 * @param booking - The booking's two custody links
 * @returns The name, or `null` when the booking has no custodian or the
 *   custodian's name is empty
 */
function resolveBookingHolderName(booking: {
  custodianUser: UserNameFields | null;
  custodianTeamMember: { name: string } | null;
}): string | null {
  if (booking.custodianUser) {
    return resolveUserDisplayName(booking.custodianUser) || null;
  }
  if (booking.custodianTeamMember) {
    return (
      resolveTeamMemberName({ name: booking.custodianTeamMember.name }) || null
    );
  }
  return null;
}
