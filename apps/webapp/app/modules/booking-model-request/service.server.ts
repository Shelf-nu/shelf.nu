/**
 * BookingModelRequest Service (Phase 3d — Book-by-Model)
 *
 * Lets a booking reserve N units of an `AssetModel` without picking
 * specific assets upfront. Concrete `BookingAsset` rows are only
 * created at scan-to-assign time via
 * {@link materializeModelRequestForAsset}, so downstream code (check-in,
 * conflict detection, PDF, email) keeps treating `BookingAsset.assetId`
 * as always pointing to a concrete asset.
 *
 * ## Availability formula
 *
 * For a given `(assetModel, bookingWindow)`:
 *
 *   available = total − inCustody − reservedConcrete − reservedViaRequest
 *
 * - `total`              — count of INDIVIDUAL assets with this model in the org
 * - `inCustody`          — sum of `Custody.quantity` on those assets
 * - `reservedConcrete`   — sum of `BookingAsset.quantity` for concrete assets
 *                          of this model, across OTHER bookings whose window
 *                          overlaps this one
 * - `reservedViaRequest` — sum of `BookingModelRequest.quantity` for OTHER
 *                          bookings whose window overlaps this one
 *
 * @see {@link file://./../../../../../packages/database/prisma/schema.prisma} — BookingModelRequest model
 * @see {@link file://./../booking/service.server.ts} — downstream booking service
 * @see {@link file://./../../routes/api+/bookings.$bookingId.model-requests.ts} — HTTP surface
 */

import type { Asset, Prisma } from "@prisma/client";
import { AssetType, BookingStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { createSystemBookingNote } from "../booking-note/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Booking";

/** Booking statuses that claim availability for a given window. */
const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
] as const;

/* -------------------------------------------------------------------------- */
/*                          getAssetModelAvailability                         */
/* -------------------------------------------------------------------------- */

type GetAssetModelAvailabilityArgs = {
  assetModelId: string;
  organizationId: string;
  /**
   * Exclude this booking from the reserved-concrete + reserved-via-request
   * sums. Required — we never want a booking's own reservation to reduce
   * its own displayed availability.
   */
  bookingId: string;
  /**
   * Optional booking window. When both `from` and `to` are supplied the
   * reserved counts only include bookings whose window overlaps this
   * one — non-overlapping reservations don't compete for the same pool.
   * When either is missing (e.g. a DRAFT with no dates yet) we count
   * ALL active-status bookings as competing, which is the conservative
   * reading.
   */
  from?: Date | null;
  to?: Date | null;
};

export type AssetModelAvailability = {
  total: number;
  inCustody: number;
  /** Sum of concrete `BookingAsset.quantity` rows competing for this pool. */
  reservedConcrete: number;
  /** Sum of `BookingModelRequest.quantity` rows competing for this pool. */
  reservedViaRequest: number;
  /** Total reserved (concrete + via request). */
  reserved: number;
  available: number;
};

/**
 * Compute availability for an `AssetModel` over a booking window.
 *
 * Safe to call from any loader/action path. Does not mutate. Excludes
 * the supplied `bookingId` from reservation sums.
 */
export async function getAssetModelAvailability({
  assetModelId,
  organizationId,
  bookingId,
  from,
  to,
}: GetAssetModelAvailabilityArgs): Promise<AssetModelAvailability> {
  try {
    const dateOverlap =
      from && to
        ? {
            OR: [
              { from: { lte: to }, to: { gte: from } },
              { from: { gte: from }, to: { lte: to } },
            ],
          }
        : {};

    const [total, custodyAgg, bookingAssetAgg, modelRequestAgg] =
      await Promise.all([
        // Total INDIVIDUAL assets of this model in the org. QUANTITY_TRACKED
        // assets aren't part of the model-request flow (they have their own
        // quantity booking path from Phase 3b).
        db.asset.count({
          where: {
            organizationId,
            assetModelId,
            type: AssetType.INDIVIDUAL,
          },
        }),
        // Units currently held by team members / users.
        db.custody.aggregate({
          where: {
            asset: {
              organizationId,
              assetModelId,
              type: AssetType.INDIVIDUAL,
            },
          },
          _sum: { quantity: true },
        }),
        // Concrete BookingAsset rows for assets of this model, in OTHER
        // active-status bookings whose window overlaps.
        db.bookingAsset.aggregate({
          where: {
            asset: {
              organizationId,
              assetModelId,
              type: AssetType.INDIVIDUAL,
            },
            bookingId: { not: bookingId },
            booking: {
              status: { in: [...ACTIVE_BOOKING_STATUSES] },
              ...dateOverlap,
            },
          },
          _sum: { quantity: true },
        }),
        // Other bookings' model-level requests for this same model.
        db.bookingModelRequest.aggregate({
          where: {
            assetModelId,
            bookingId: { not: bookingId },
            booking: {
              organizationId,
              status: { in: [...ACTIVE_BOOKING_STATUSES] },
              ...dateOverlap,
            },
          },
          _sum: { quantity: true },
        }),
      ]);

    const inCustody = custodyAgg._sum.quantity ?? 0;
    const reservedConcrete = bookingAssetAgg._sum.quantity ?? 0;
    const reservedViaRequest = modelRequestAgg._sum.quantity ?? 0;
    const reserved = reservedConcrete + reservedViaRequest;
    const available = Math.max(0, total - inCustody - reserved);

    return {
      total,
      inCustody,
      reservedConcrete,
      reservedViaRequest,
      reserved,
      available,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: "Failed to compute asset-model availability.",
      additionalData: { assetModelId, bookingId, organizationId },
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                         upsertBookingModelRequest                          */
/* -------------------------------------------------------------------------- */

type UpsertBookingModelRequestArgs = {
  bookingId: string;
  assetModelId: string;
  /** New target quantity. Must be ≥ 1. Use `removeBookingModelRequest` to delete. */
  quantity: number;
  organizationId: string;
  userId: string;
};

/**
 * Upsert a model-level request row. Validates the new `quantity` against
 * current availability inside a transaction so two concurrent upserts
 * can't both pass the guard and oversubscribe the pool.
 *
 * Writes a system booking note on success. Rejected when the booking
 * isn't in a state that accepts edits (we only allow DRAFT / RESERVED
 * here — ONGOING bookings must reconcile by scanning, not by editing
 * the intent).
 */
export async function upsertBookingModelRequest({
  bookingId,
  assetModelId,
  quantity,
  organizationId,
  userId,
}: UpsertBookingModelRequestArgs) {
  try {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ShelfError({
        cause: null,
        label,
        status: 400,
        message: "Quantity must be a positive integer.",
        shouldBeCaptured: false,
      });
    }

    const result = await db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId, organizationId },
        select: {
          id: true,
          name: true,
          status: true,
          from: true,
          to: true,
        },
      });
      if (!booking) {
        throw new ShelfError({
          cause: null,
          label,
          status: 404,
          message: "Booking not found in current workspace.",
          shouldBeCaptured: false,
        });
      }
      if (
        booking.status !== BookingStatus.DRAFT &&
        booking.status !== BookingStatus.RESERVED
      ) {
        throw new ShelfError({
          cause: null,
          label,
          status: 400,
          message:
            "Model-level reservations can only be edited while the booking is DRAFT or RESERVED.",
          shouldBeCaptured: false,
        });
      }

      const assetModel = await tx.assetModel.findUnique({
        where: { id: assetModelId, organizationId },
        select: { id: true, name: true },
      });
      if (!assetModel) {
        throw new ShelfError({
          cause: null,
          label,
          status: 404,
          message: "Asset model not found in current workspace.",
          shouldBeCaptured: false,
        });
      }

      const availability = await getAssetModelAvailability({
        assetModelId,
        organizationId,
        bookingId,
        from: booking.from,
        to: booking.to,
      });

      if (quantity > availability.available) {
        throw new ShelfError({
          cause: null,
          label,
          status: 400,
          message: `Cannot reserve ${quantity} × ${assetModel.name}. Only ${availability.available} available in this window.`,
          shouldBeCaptured: false,
        });
      }

      // Peek at the existing row so we can write a note that
      // distinguishes create / increase / decrease / no-op. Without
      // this, every upsert produced an identical "reserved N × Model"
      // line which was indistinguishable from the next update.
      const existing = await tx.bookingModelRequest.findUnique({
        where: {
          bookingId_assetModelId: { bookingId, assetModelId },
        },
        select: { quantity: true },
      });
      const previousQuantity = existing?.quantity ?? null;

      const request = await tx.bookingModelRequest.upsert({
        where: {
          bookingId_assetModelId: { bookingId, assetModelId },
        },
        create: {
          bookingId,
          assetModelId,
          quantity,
        },
        update: { quantity },
      });

      return { request, booking, assetModel, previousQuantity };
    });

    // Activity note — best-effort, outside the tx so a markdoc hiccup
    // can't roll back the upsert. Phrasing depends on whether this was
    // a create, an increase, a decrease, or a no-op:
    //   - create   : "reserved **N × Model** for this booking."
    //   - increase : "increased the **Model** reservation from **M** to **N**."
    //   - decrease : "decreased the **Model** reservation from **M** to **N**."
    //   - no-op    : skip the note entirely (nothing actually changed)
    const { assetModel, previousQuantity } = result;
    let content: string | null = null;
    if (previousQuantity == null) {
      content = `{actor} reserved **${quantity} × ${assetModel.name}** for this booking.`;
    } else if (quantity > previousQuantity) {
      content = `{actor} increased the **${assetModel.name}** reservation from **${previousQuantity}** to **${quantity}**.`;
    } else if (quantity < previousQuantity) {
      content = `{actor} decreased the **${assetModel.name}** reservation from **${previousQuantity}** to **${quantity}**.`;
    }

    if (content != null) {
      try {
        const actor = await loadActor(userId);
        await createSystemBookingNote({
          bookingId,
          content: content.replace("{actor}", actor),
        });
      } catch {
        // note failure is non-fatal — the reservation itself committed
      }
    }

    return result.request;
  } catch (cause) {
    if (cause instanceof ShelfError) throw cause;
    throw new ShelfError({
      cause,
      label,
      message: "Failed to reserve asset-model units on this booking.",
      additionalData: { bookingId, assetModelId, quantity, organizationId },
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                         removeBookingModelRequest                          */
/* -------------------------------------------------------------------------- */

type RemoveBookingModelRequestArgs = {
  bookingId: string;
  assetModelId: string;
  organizationId: string;
  userId: string;
};

/**
 * Delete a model-level request. Only allowed on DRAFT / RESERVED
 * bookings — ONGOING / OVERDUE must drain requests via scan-to-assign,
 * not manual cancellation (preserves intent audit).
 */
export async function removeBookingModelRequest({
  bookingId,
  assetModelId,
  organizationId,
  userId,
}: RemoveBookingModelRequestArgs) {
  try {
    const assetModelName = await db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId, organizationId },
        select: { id: true, status: true },
      });
      if (!booking) {
        throw new ShelfError({
          cause: null,
          label,
          status: 404,
          message: "Booking not found in current workspace.",
          shouldBeCaptured: false,
        });
      }
      if (
        booking.status !== BookingStatus.DRAFT &&
        booking.status !== BookingStatus.RESERVED
      ) {
        throw new ShelfError({
          cause: null,
          label,
          status: 400,
          message:
            "Model-level reservations can only be cancelled while the booking is DRAFT or RESERVED. Active bookings must reconcile by scanning.",
          shouldBeCaptured: false,
        });
      }

      const existing = await tx.bookingModelRequest.findUnique({
        where: { bookingId_assetModelId: { bookingId, assetModelId } },
        include: { assetModel: { select: { name: true } } },
      });
      if (!existing) {
        // Idempotent: already gone.
        return null;
      }

      await tx.bookingModelRequest.delete({
        where: { bookingId_assetModelId: { bookingId, assetModelId } },
      });

      return existing.assetModel.name;
    });

    if (assetModelName) {
      try {
        const actor = await loadActor(userId);
        await createSystemBookingNote({
          bookingId,
          content: `${actor} cancelled the model-level reservation for **${assetModelName}**.`,
        });
      } catch {
        // non-fatal
      }
    }
  } catch (cause) {
    if (cause instanceof ShelfError) throw cause;
    throw new ShelfError({
      cause,
      label,
      message: "Failed to cancel model-level reservation.",
      additionalData: { bookingId, assetModelId, organizationId },
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                       materializeModelRequestForAsset                      */
/* -------------------------------------------------------------------------- */

type MaterializeArgs = {
  bookingId: string;
  /**
   * The scanned asset. Must include `id` + `assetModelId` + `title` so
   * we can match against outstanding requests and write a
   * human-readable activity note.
   */
  asset: Pick<Asset, "id" | "title" | "assetModelId" | "type">;
  organizationId: string;
  userId: string;
  /**
   * Interactive Prisma transaction client. Required — this function
   * must run in the same tx as the caller's `BookingAsset.create`
   * (typically `addScannedAssetsToBooking`) so a failure anywhere in
   * the scan flow rolls the request-decrement back.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
};

/**
 * Called from the scan-to-assign flow when a scanned asset matches an
 * outstanding model request. Decrements the request's quantity by 1
 * and deletes the row when it hits zero.
 *
 * Returns:
 *   - `{ matched: true, remaining }` — the scan consumed a request unit
 *   - `{ matched: false }` — no outstanding request matches this asset's
 *     model; the caller should fall through to its existing "add as
 *     direct BookingAsset" path
 *
 * Throws `ShelfError` only on internal errors (asset has no model, tx
 * failure). Missing-request is NOT an error — it's a normal case for
 * model-free bookings.
 */
export async function materializeModelRequestForAsset({
  bookingId,
  asset,
  userId,
  tx,
}: MaterializeArgs): Promise<
  { matched: true; remaining: number; modelName: string } | { matched: false }
> {
  try {
    if (!asset.assetModelId) {
      // INDIVIDUAL asset without a model — no model request can
      // possibly match. Caller handles via the direct-booking path.
      return { matched: false };
    }

    const existing = await tx.bookingModelRequest.findUnique({
      where: {
        bookingId_assetModelId: {
          bookingId,
          assetModelId: asset.assetModelId,
        },
      },
      include: { assetModel: { select: { name: true } } },
    });

    if (!existing || existing.quantity < 1) {
      return { matched: false };
    }

    const nextQuantity = existing.quantity - 1;
    if (nextQuantity === 0) {
      // Last unit — delete the row so `booking.modelRequests` doesn't
      // carry a zero-quantity ghost.
      await tx.bookingModelRequest.delete({
        where: {
          bookingId_assetModelId: {
            bookingId,
            assetModelId: asset.assetModelId,
          },
        },
      });
    } else {
      await tx.bookingModelRequest.update({
        where: {
          bookingId_assetModelId: {
            bookingId,
            assetModelId: asset.assetModelId,
          },
        },
        data: { quantity: nextQuantity },
      });
    }

    // Activity note — IN the tx so the note rolls back with the
    // materialization if anything later in the scan pipeline fails.
    // Written directly via the tx client because
    // `createSystemBookingNote` uses the default `db` export.
    const actor = await loadActor(userId);
    const assetLink = wrapLinkForNote(`/assets/${asset.id}`, asset.title);
    await tx.bookingNote.create({
      data: {
        type: "UPDATE",
        content: `${actor} assigned ${assetLink} (${existing.assetModel.name}) to this booking — ${nextQuantity} × ${existing.assetModel.name} remaining.`,
        booking: { connect: { id: bookingId } },
      },
    });

    return {
      matched: true,
      remaining: nextQuantity,
      modelName: existing.assetModel.name,
    };
  } catch (cause) {
    if (cause instanceof ShelfError) throw cause;
    throw new ShelfError({
      cause,
      label,
      message: "Failed to assign scanned asset to a model-level reservation.",
      additionalData: {
        bookingId,
        assetId: asset.id,
        assetModelId: asset.assetModelId,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                                  helpers                                   */
/* -------------------------------------------------------------------------- */

/** Load the actor for an activity note and return the markdoc user link. */
async function loadActor(userId: string): Promise<string> {
  const user = await getUserByID(userId, {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
    } satisfies Prisma.UserSelect,
  });
  return wrapUserLinkForNote({
    id: userId,
    firstName: user?.firstName,
    lastName: user?.lastName,
  });
}
