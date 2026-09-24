import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { getPrimaryLocation, isQuantityTracked } from "~/modules/asset/utils";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createNote } from "~/modules/note/service.server";
import { assetQtyMeta, formatUnitCount } from "~/utils/asset-quantity";
import { makeShelfError, ShelfError } from "~/utils/error";
import { wrapUserLinkForNote, wrapLinkForNote } from "~/utils/markdoc-wrappers";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/asset/update-location
 *
 * Updates the location of a single asset. Mobile twin of the web's
 * asset-overview "Update location" dialog
 * (`_layout+/assets.$assetId.overview.update-location.tsx`): the write is a
 * pivot replace — every manual `AssetLocation` row is cleared and at most one
 * new row is created at the requested location.
 *
 * Body: { assetId: string, locationId: string, quantity?: number }
 *
 * `quantity` is the per-placement `AssetLocation.quantity` for a
 * QUANTITY_TRACKED asset (units to place at the location — NOT a change to
 * `Asset.quantity`, the workspace stock). Omitted → the full pool is placed.
 * Units left over stay in the unplaced pool, exactly like the web dialog.
 * INDIVIDUAL assets ignore it (their single placement is always quantity 1).
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

    const { assetId, locationId, quantity } = await parseMobileBody(
      z.object({
        assetId: z.string().min(1),
        locationId: z.string().min(1),
        quantity: z.number().int().positive().optional(),
      }),
      request,
      "Assets"
    );

    // Verify asset exists and belongs to org
    const asset = await db.asset.findUnique({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        title: true,
        type: true,
        quantity: true,
        unitOfMeasure: true,
        assetLocations: {
          select: {
            quantity: true,
            location: { select: { id: true, name: true } },
          },
        },
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

    // why: short-circuit when the write would not change anything — same
    // primary location, no other placements the replace would collapse, and
    // (for QUANTITY_TRACKED) the same per-row quantity as already placed
    // there. Without this guard the route would write a no-op pivot replace,
    // an `ASSET_LOCATION_CHANGED` event whose `fromValue === toValue`, and a
    // misleading "updated the location from X to X" note. Mirrors the
    // singular/bulk parity rule in `.claude/rules/bulk-event-parity.md`.
    // Same location with a DIFFERENT quantity falls through: re-placing a
    // different amount at the current location is a real placement edit,
    // exactly as the web dialog treats it.
    const currentPrimaryLocation = getPrimaryLocation(asset);
    const currentPrimaryQuantity =
      asset.assetLocations.find(
        (al) => al.location?.id === currentPrimaryLocation?.id
      )?.quantity ?? null;
    // An omitted `quantity` means the full pool, not "leave it as it is", so it
    // has to be resolved before the comparison. Treating it as unchanged left a
    // partially-placed asset at its old amount while the caller had asked for
    // every unit. `pivotQuantity` inside the transaction resolves it the same
    // way, against the locked row.
    const requestedQuantity = isQuantityTracked(asset)
      ? quantity ?? asset.quantity ?? 1
      : 1;
    const quantityUnchanged =
      !isQuantityTracked(asset) || requestedQuantity === currentPrimaryQuantity;
    if (
      currentPrimaryLocation?.id === location.id &&
      asset.assetLocations.length === 1 &&
      quantityUnchanged
    ) {
      return data({
        asset: {
          id: asset.id,
          title: asset.title,
          location: currentPrimaryLocation,
        },
      });
    }

    // Setting a single primary location is a pivot replace: wipe the manual
    // AssetLocation rows then create the new link. QUANTITY_TRACKED assets
    // place the requested `quantity` (or their full pool when omitted) at
    // the location; INDIVIDUAL assets are always quantity 1. The
    // ASSET_LOCATION_CHANGED activity event is recorded atomically so
    // reports + activity-event aggregations include mobile-initiated
    // location changes.
    const {
      refreshedAsset,
      placedQuantity,
      previousLocation,
      previousQuantity,
    } = await db.$transaction(async (tx) => {
      /**
       * Row-lock the asset before writing the pivot, the same lock every
       * stock-lowering path takes. This write RAISES the manual
       * `AssetLocation` sum for a QUANTITY_TRACKED asset, and
       * `enforce_asset_location_sum_within_total` validating at COMMIT only
       * covers one interleaving: a concurrent consume can read the
       * pre-placement rows, conclude they fit under the reduced total, and
       * commit an `Asset` write that fires no location trigger at all.
       *
       * Locking also makes `quantity` trustworthy — the pre-transaction read
       * above can be stale by the time the row is written, which would place
       * more units than the asset owns.
       */
      const locked = await lockAssetForQuantityUpdate(
        tx,
        assetId,
        organizationId
      );

      // Per-placement bound: the requested units must fit the asset's
      // total pool (measured on the locked row, mirroring the web
      // service's in-transaction check in `updateAsset`).
      const isQty = isQuantityTracked(locked);
      if (isQty && quantity != null && quantity > (locked.quantity ?? 0)) {
        throw new ShelfError({
          cause: null,
          title: "Quantity exceeds available pool",
          message: `Requested ${quantity} but the asset has only ${
            locked.quantity ?? 0
          } units total.`,
          additionalData: {
            assetId,
            organizationId,
            quantity,
            totalQuantity: locked.quantity,
          },
          label: "Assets",
          status: 400,
          shouldBeCaptured: false,
        });
      }

      const pivotQuantity = isQty ? quantity ?? locked.quantity ?? 1 : 1;

      /**
       * The placements as they stand under the lock, not as they looked when
       * the request was parsed. Two requests collapsing the same asset would
       * otherwise both describe the pre-transaction world: the second would
       * record removals for rows the first already deleted, and name a
       * primary location that has since changed.
       */
      const placementsBefore = await tx.assetLocation.findMany({
        where: { assetId, assetKitId: null },
        select: {
          quantity: true,
          location: { select: { id: true, name: true } },
        },
      });
      const primaryBefore =
        placementsBefore.find((al) => al.location)?.location ?? null;
      const primaryQuantityBefore =
        placementsBefore.find((al) => al.location?.id === primaryBefore?.id)
          ?.quantity ?? null;

      // Clear MANUAL placements only — kit-driven rows
      // (`assetKitId IS NOT NULL`) are owned by the kit's flow. The kit
      // guard above rejects kit members outright, so this filter mirrors
      // the web service's pivot write rather than changing behavior.
      await tx.assetLocation.deleteMany({
        where: { assetId, assetKitId: null },
      });
      await tx.assetLocation.create({
        data: {
          assetId,
          locationId,
          organizationId,
          quantity: pivotQuantity,
        },
      });

      /**
       * A pivot replace collapses EVERY manual placement, not just the
       * primary one. Each of the others leaves the location it was at, and
       * the single change event below only names the primary, so without
       * these the asset silently stops being at a location that reports and
       * history still show it at.
       *
       * Emitted as removals (`toValue: null`) because that is what happened
       * to them; the arrival at the requested location is the event below.
       */
      const collapsedPlacements = placementsBefore.filter(
        (al) => al.location?.id && al.location.id !== primaryBefore?.id
      );
      for (const placement of collapsedPlacements) {
        await recordEvent(
          {
            organizationId,
            actorUserId: user.id,
            action: "ASSET_LOCATION_CHANGED",
            entityType: "ASSET",
            entityId: assetId,
            assetId,
            locationId: placement.location!.id,
            field: "locationId",
            fromValue: placement.location!.id,
            toValue: null,
            meta: assetQtyMeta(locked, placement.quantity ?? 1),
          },
          tx
        );
      }

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
          fromValue: primaryBefore?.id ?? null,
          toValue: location.id,
          // Qty-tracked: the per-row AssetLocation.quantity placed at the
          // location. No-op for INDIVIDUAL.
          meta: assetQtyMeta(locked, pivotQuantity),
        },
        tx
      );

      const refreshed = await tx.asset.findUniqueOrThrow({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` already org-verified by the `db.asset.findUnique({ where: { id, organizationId } })` guard at the top of this action; this is the in-tx re-read
        where: { id: assetId },
        select: {
          id: true,
          title: true,
          assetLocations: {
            select: { location: { select: { id: true, name: true } } },
          },
        },
      });

      return {
        refreshedAsset: refreshed,
        placedQuantity: pivotQuantity,
        previousLocation: primaryBefore,
        previousQuantity: primaryQuantityBefore,
      };
    });

    const { assetLocations: _, ...updatedAssetRest } = refreshedAsset;
    const updatedAssetWithLocation = {
      ...updatedAssetRest,
      location: getPrimaryLocation(refreshedAsset),
    };

    // Create activity note (matches webapp format)
    const actor = wrapUserLinkForNote({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
    });

    const newLocationLink = wrapLinkForNote(
      `/locations/${location.id}`,
      location.name.trim()
    );

    // Qty-tracked placements name the unit count the way the web note does
    // ("moved 4 pcs from X to Y."); INDIVIDUAL keeps the original phrasing
    // (`formatUnitCount` returns null for it).
    const unitCount = formatUnitCount(asset, placedQuantity);

    let noteContent: string;
    if (previousLocation && previousLocation.id === location.id) {
      // Nothing moved: the asset stays where it is and only the placed amount
      // changed. Phrasing this as a move reads as "moved 6 pcs from Storage to
      // Storage", which describes a journey that did not happen.
      const previousUnitCount = formatUnitCount(asset, previousQuantity);
      noteContent =
        unitCount && previousUnitCount
          ? `${actor} changed the quantity at ${newLocationLink} from ${previousUnitCount} to ${unitCount} via mobile app.`
          : `${actor} updated the placement at ${newLocationLink} via mobile app.`;
    } else if (previousLocation) {
      const currentLocationLink = wrapLinkForNote(
        `/locations/${previousLocation.id}`,
        previousLocation.name.trim()
      );
      noteContent = unitCount
        ? `${actor} moved ${unitCount} from ${currentLocationLink} to ${newLocationLink} via mobile app.`
        : `${actor} updated the location from ${currentLocationLink} to ${newLocationLink} via mobile app.`;
    } else {
      noteContent = unitCount
        ? `${actor} placed ${unitCount} at ${newLocationLink} via mobile app.`
        : `${actor} set the location to ${newLocationLink} via mobile app.`;
    }

    await createNote({
      content: noteContent,
      type: "UPDATE",
      userId: user.id,
      assetId: asset.id,
      organizationId,
    });

    return data({
      asset: updatedAssetWithLocation,
      // Additive: the per-row AssetLocation.quantity now placed at the
      // location (1 for INDIVIDUAL) so the app can confirm the partial
      // placement without a second round trip.
      placedQuantity,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
