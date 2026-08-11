/**
 * POST /api/mobile/asset/adjust-quantity
 *
 * Named `asset.…` (singular) like every other mobile asset mutation — a
 * plural `assets.adjust-quantity` gets captured by the loader-only
 * `assets.$assetId` sibling ("adjust-quantity" parses as an asset id) and
 * the POST 405s. Found the hard way on the simulator.
 *
 * Adjusts total stock of a QUANTITY_TRACKED asset. Mobile twin of the web's
 * `/api/assets/adjust-quantity` route — same Zod schema (incl. the
 * category/direction pairing refine), same `adjustQuantity` service call,
 * same best-effort audit note and low-stock check. Only the
 * auth/permission/envelope skeleton differs (bearer auth + the mobile error
 * envelope, per `custody.assign-quantity.ts`).
 *
 * Body: { assetId: string, quantity: number, category: "RESTOCK"|"ADJUSTMENT"|"LOSS",
 *         direction: "add"|"subtract", note?: string }
 * Org: `?orgId=` query param or `x-shelf-organization` header.
 *
 * Success envelope: `{ success: true, asset }` where `asset` is the
 * refreshed asset shaped for mobile (custody visibility already filtered
 * for the caller) so the app can update state without a second round trip.
 *
 * @see {@link file://./../assets.adjust-quantity.ts} — the mirrored web route
 * @see {@link file://./../../../modules/consumption-log/service.server.ts} — adjustQuantity
 * @see {@link file://./custody.assign-quantity.ts} — the skeleton this follows
 */

import type { Prisma } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  getMobileAssetForViewer,
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { adjustQuantity } from "~/modules/consumption-log/service.server";
import { createNote } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  appendUserTextToNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * Zod schema for the adjust-quantity JSON body. Identical to the web's
 * `AdjustQuantitySchema` (assets.adjust-quantity.ts) — the `.refine`
 * enforces the category/direction pairing so a `ConsumptionLog` row's
 * category can never contradict the sign of the change: RESTOCK must add,
 * LOSS must subtract, ADJUSTMENT can go either way.
 */
const MobileAdjustQuantitySchema = z
  .object({
    assetId: z.string().min(1, "Asset ID is required"),
    quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
    category: z.enum(["RESTOCK", "ADJUSTMENT", "LOSS"]),
    direction: z.enum(["add", "subtract"]),
    note: z
      .string()
      .optional()
      .transform((val) => (val === "" ? undefined : val)),
  })
  .refine(
    ({ category, direction }) =>
      category === "ADJUSTMENT" ||
      (category === "RESTOCK" && direction === "add") ||
      (category === "LOSS" && direction === "subtract"),
    {
      message:
        "Invalid category/direction combination — RESTOCK must add, LOSS must subtract.",
      path: ["direction"],
    }
  );

export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    // Same limiter bucket as the other mobile quantity mutations — a stuck
    // retry loop or rapid taps shouldn't hammer a row-locking transaction.
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    // RBAC: same entity/action the web adjust route requires — SELF_SERVICE
    // and BASE both 403 (they cannot update assets).
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    // canSeeAllCustody shapes the refreshed asset returned to the app.
    const { canSeeAllCustody } = await getMobileUserContext(
      user.id,
      organizationId
    );

    // why: safeParse + a 400 ShelfError mirrors the web route's parseData
    // behavior; raw `.parse` would surface a ZodError as a 500 through
    // makeShelfError's unknown-error branch (per custody.assign-quantity.ts).
    // The json() guard matters too: malformed JSON rejects with a
    // SyntaxError, which the outer catch would otherwise report as a 500.
    const body: unknown = await request.json().catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Invalid request body",
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    });
    const parsed = MobileAdjustQuantitySchema.safeParse(body);
    if (!parsed.success) {
      throw new ShelfError({
        cause: parsed.error,
        message: "Invalid request body",
        additionalData: { validationErrors: parsed.error.flatten() },
        label: "Assets",
        status: 400,
      });
    }
    const { assetId, quantity, category, direction, note } = parsed.data;

    // All quantity validation (type gate, org scoping, row-locked
    // negative-stock check) lives inside the service — no duplication here.
    await adjustQuantity({
      assetId,
      quantity,
      category,
      direction,
      userId: user.id,
      organizationId,
      note,
    });

    /** Best-effort audit note — don't fail the action if note creation fails */
    try {
      const actorUser = await getUserByID(user.id, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } satisfies Prisma.UserSelect,
      });

      const actor = wrapUserLinkForNote(actorUser);
      const sign = direction === "add" ? "+" : "-";
      const categoryLabel = category.toLowerCase();
      const baseLine = `${actor} adjusted quantity by **${sign}${quantity}** (${categoryLabel}).`;
      const noteContent = appendUserTextToNote(baseLine, note);

      await createNote({
        content: noteContent,
        type: "UPDATE",
        userId: user.id,
        assetId,
        organizationId,
      });
    } catch (noteError) {
      Logger.error(
        new ShelfError({
          cause: noteError,
          message: "Failed to create audit note for quantity operation",
          label: "Assets",
          additionalData: { assetId, userId: user.id },
        })
      );
    }

    // No route-level sendNotification success toast here: that's the web's
    // SSE emitter and mobile has no listener (matches the custody routes).

    // Everything past adjustQuantity is best-effort: the mutation has
    // already committed, so a failure here must NOT surface as an action
    // error — the client would show a failure (and could retry a
    // non-idempotent adjustment) for a change that actually landed.

    /** Check low-stock threshold and notify if breached (web parity) */
    try {
      await checkAndNotifyLowStock({
        assetId,
        userId: user.id,
        organizationId,
      });
    } catch (lowStockError) {
      Logger.error(
        new ShelfError({
          cause: lowStockError,
          message: "Failed low-stock check after quantity adjustment",
          label: "Assets",
          additionalData: { assetId, userId: user.id },
        })
      );
    }

    // Refreshed asset, shaped for mobile with the caller's custody
    // visibility already applied, so the app can update state directly.
    // Null on failure — the app refetches the detail regardless.
    let asset = null;
    try {
      asset = await getMobileAssetForViewer({
        assetId,
        organizationId,
        viewerUserId: user.id,
        canSeeAllCustody,
      });
    } catch (refreshError) {
      Logger.error(
        new ShelfError({
          cause: refreshError,
          message: "Failed to refresh asset after quantity adjustment",
          label: "Assets",
          additionalData: { assetId, userId: user.id },
        })
      );
    }

    return data({ success: true, asset });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
