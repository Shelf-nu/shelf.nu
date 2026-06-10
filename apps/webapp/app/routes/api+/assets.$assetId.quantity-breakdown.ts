/**
 * Quantity Breakdown API
 *
 * Returns the data the `AssetStatusBadge` needs to render the qty-aware
 * tooltip for a QUANTITY_TRACKED asset (per-booking + per-kit slice
 * breakdown). Called lazily on tooltip-hover from index / picker /
 * scanner-drawer surfaces so the SSR loader doesn't pay the per-row
 * cost up-front; the asset detail page passes the breakdown inline
 * via the loader instead.
 *
 * Shape matches what `getQuantityData` in `asset-status-badge.tsx`
 * expects — `custody[]`, `bookingAssets[]`, `assetKits[]` — so the
 * client can feed the response straight into the same renderer used
 * for the inline path.
 *
 * @see {@link file://./../../components/assets/asset-status-badge.tsx}
 */

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const asset = await db.asset.findFirst({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        type: true,
        quantity: true,
        custody: { select: { quantity: true } },
        bookingAssets: {
          where: {
            booking: { status: { in: ["RESERVED", "ONGOING", "OVERDUE"] } },
          },
          select: {
            quantity: true,
            assetKitId: true,
            booking: { select: { id: true, name: true, status: true } },
          },
        },
        assetKits: {
          select: {
            id: true,
            quantity: true,
            kit: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!asset) {
      throw new ShelfError({
        cause: null,
        label: "Assets",
        message: "Asset not found",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    return data(payload(asset));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}
