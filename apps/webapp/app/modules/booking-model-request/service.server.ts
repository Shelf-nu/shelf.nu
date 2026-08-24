/**
 * BookingModelRequest Service (Phase 3d — Book-by-Model)
 *
 * Lets a booking reserve N units of an `AssetModel` without picking
 * specific assets upfront. Downstream code (check-in, conflict detection,
 * PDF, email) keeps treating `BookingAsset.assetId` as always pointing to a
 * concrete asset, because a reservation never produces a `BookingAsset` row
 * on its own — a real asset has to arrive.
 *
 * A reservation is discharged whenever a matching asset lands on the booking,
 * regardless of how it got there: "Manage assets", the web scanner, the asset
 * index, or the mobile API. Every one of those routes through
 * {@link fulfilModelRequestsForAssets}. That helper's JSDoc explains why this
 * is deliberately surface-independent — it used to be scanner-only, and the
 * asymmetry hard-blocked check-out.
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
import { stripMarkdocDelimiters } from "~/utils/markdoc-sanitize";
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
  /**
   * Prisma client or active transaction; defaults to the global `db`.
   *
   * A caller deciding whether a reservation fits MUST pass its own `tx`.
   * Reading through the global client runs the counts outside the caller's
   * transaction, so they neither see its uncommitted writes nor participate
   * in the locks it holds, and two concurrent reservations both measure the
   * same free pool and both commit.
   */
  db?: AssetModelAvailabilityClient;
};

/**
 * The tagged-template `$queryRaw` an interactive transaction exposes. Declared
 * structurally so the transaction client satisfies it without a cast.
 */
type RawQueryClient = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
};

/**
 * The exact reads {@link getAssetModelAvailability} issues. Structural rather
 * than Prisma's own client type so an interactive transaction client
 * satisfies it without casting.
 */
export type AssetModelAvailabilityClient = {
  asset: {
    count: (args: { where: Prisma.AssetWhereInput }) => Promise<number>;
  };
  custody: {
    aggregate: (args: {
      where: Prisma.CustodyWhereInput;
      _sum: { quantity: true };
    }) => Promise<{ _sum: { quantity: number | null } }>;
  };
  bookingAsset: {
    aggregate: (args: {
      where: Prisma.BookingAssetWhereInput;
      _sum: { quantity: true };
    }) => Promise<{ _sum: { quantity: number | null } }>;
  };
  bookingModelRequest: {
    aggregate: (args: {
      where: Prisma.BookingModelRequestWhereInput;
      _sum: { quantity: true; fulfilledQuantity: true };
    }) => Promise<{
      _sum: { quantity: number | null; fulfilledQuantity: number | null };
    }>;
  };
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
 * Serializes reservations competing for one `AssetModel`'s pool.
 *
 * Availability is a read-then-decide: count what is free, then write a row
 * claiming some of it. Under READ COMMITTED a plain `SELECT` inside a
 * transaction takes no lock, so two concurrent reservations both read the
 * same free pool and both commit — the sum then exceeds what exists. Taking
 * `FOR UPDATE` on the model row first makes the second caller wait for the
 * first to commit and re-read the pool it actually left behind.
 *
 * The model row is the right grain: contention is exactly "requests for this
 * model", and every writer of a `BookingModelRequest` passes through here.
 *
 * Scoped by `organizationId` as well as `id`, so a caller supplying another
 * workspace's model id takes no lock at all rather than contending on a row
 * it cannot see — the same rule as `lockAssetForQuantityUpdate`.
 *
 * @param tx - Prisma interactive transaction client
 * @param assetModelId - Model whose pool is being claimed
 * @param organizationId - The caller's authenticated organization id
 * @throws {ShelfError} 404 if the model is not in the caller's workspace
 */
async function lockAssetModelForReservation(
  tx: RawQueryClient,
  assetModelId: string,
  organizationId: string
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "AssetModel" WHERE id = ${assetModelId} AND "organizationId" = ${organizationId} FOR UPDATE
  `;

  if (!rows || rows.length === 0) {
    throw new ShelfError({
      cause: null,
      label,
      status: 404,
      message: "Asset model not found in current workspace.",
      shouldBeCaptured: false,
    });
  }
}

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
  db: dbClient,
}: GetAssetModelAvailabilityArgs): Promise<AssetModelAvailability> {
  const client = dbClient ?? db;

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
        client.asset.count({
          where: {
            organizationId,
            assetModelId,
            type: AssetType.INDIVIDUAL,
          },
        }),
        // Units currently held by team members / users.
        client.custody.aggregate({
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
        client.bookingAsset.aggregate({
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
        // We only count units that are STILL OUTSTANDING (fulfilledAt
        // IS NULL); fulfilled units have been materialised into
        // concrete `BookingAsset` rows and are already counted in
        // `reservedConcrete` above. Summing both `quantity` and
        // `fulfilledQuantity` lets us compute outstanding-only as
        // `SUM(quantity) - SUM(fulfilledQuantity)` in a single query.
        client.bookingModelRequest.aggregate({
          where: {
            assetModelId,
            bookingId: { not: bookingId },
            fulfilledAt: null,
            booking: {
              organizationId,
              status: { in: [...ACTIVE_BOOKING_STATUSES] },
              ...dateOverlap,
            },
          },
          _sum: { quantity: true, fulfilledQuantity: true },
        }),
      ]);

    const inCustody = custodyAgg._sum.quantity ?? 0;
    const reservedConcrete = bookingAssetAgg._sum.quantity ?? 0;
    const reservedViaRequest =
      (modelRequestAgg._sum.quantity ?? 0) -
      (modelRequestAgg._sum.fulfilledQuantity ?? 0);
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
/*                          getBookingModelTabData                            */
/* -------------------------------------------------------------------------- */

/** The upper bound on how many `AssetModel` rows the picker fetches at once. */
const MODEL_PICKER_LIMIT = 50;

/**
 * Shape of the booking record `getBookingModelTabData` needs. Callers pass
 * their already-fetched `booking` through untouched — this is a projection,
 * not a re-fetch. Deliberately excludes `bookingAssets`: the manage-assets
 * route pre-filters those to standalone (non-kit) rows for its own picker,
 * and coupling this shared helper to that filter would silently break the
 * manage-kits route, which has no such pre-filter.
 */
type BookingForModelTab = {
  id: string;
  from: Date | null;
  to: Date | null;
  modelRequests: Array<{
    assetModelId: string;
    quantity: number;
    fulfilledQuantity: number;
    fulfilledAt: Date | null;
    assetModel: { name: string };
  }>;
};

/** Per-model row shown in the Models tab's picker + summary list. */
type BookingModelTabAssetModel = {
  id: string;
  name: string;
  total: number;
  available: number;
  reservedConcrete: number;
  reservedViaRequest: number;
  inCustody: number;
};

/** Payload the "Book-by-Model / Models tab" UI needs from the loader. */
export type BookingModelTabData = {
  /** Whether the org has any `AssetModel` at all — hides the tab when false. */
  showModelsTab: boolean;
  /** Per-model availability for the current booking's window. */
  assetModels: BookingModelTabAssetModel[];
  /** `assetModels` reshaped for {@link DynamicSelect}'s seed list. */
  initialAssetModels: Array<{
    id: string;
    name: string;
    metadata: {
      total: number;
      available: number;
      reservedConcrete: number;
      reservedViaRequest: number;
      inCustody: number;
    };
  }>;
  /** Full-org model count (not the truncated `MODEL_PICKER_LIMIT` list). */
  totalAssetModels: number;
  /**
   * How many models match the current `search` (equals `totalAssetModels`
   * when no search is applied). This is the pagination denominator: a client
   * that pages through the list needs the count of MATCHING rows, not the
   * full-org count, to know when it has reached the end.
   */
  matchedAssetModels: number;
  /** This booking's existing model-level requests, outstanding + fulfilled. */
  modelRequests: Array<{
    assetModelId: string;
    assetModelName: string;
    quantity: number;
    fulfilledQuantity: number;
    fulfilledAt: string | null;
  }>;
};

/**
 * Build the "Book-by-Model / Models tab" payload for a booking's
 * manage-assets / manage-kits loaders.
 *
 * Always counts the org's `AssetModel`s so the UI knows whether to render
 * the Models tab at all (hidden when the org has none). When there is at
 * least one model, also fetches the first `MODEL_PICKER_LIMIT` (sorted by
 * name) plus each one's availability in the booking's window, and projects
 * the booking's existing model-level requests for the tab's "active /
 * fulfilled" split.
 *
 * Does not mutate. Org-scoped: both the count and the model list are
 * filtered to `organizationId`, and `organizationId` is forwarded into
 * {@link getAssetModelAvailability}.
 *
 * @param organizationId - The caller's active organization. Required —
 * scopes both the model count and list, preventing cross-org leakage.
 * @param booking - The booking these models are being reserved against.
 * Only `id`, `from`, `to`, and `modelRequests` are read.
 * @param search - Optional case-insensitive name filter. The seed list is
 * capped at `MODEL_PICKER_LIMIT`, so without this a model sorting after the
 * cap is unreachable. The web's DynamicSelect searches beyond the seed via
 * the `model-filters` endpoint; passing `search` here gives the same reach
 * to callers (e.g. the mobile picker) that render this list directly.
 * `totalAssetModels` stays the full-org count so "showing N of M" is honest.
 * @returns The Models tab payload; see {@link BookingModelTabData}.
 */
export async function getBookingModelTabData({
  organizationId,
  booking,
  search,
  page,
  perPage,
}: {
  organizationId: string;
  booking: BookingForModelTab;
  search?: string;
  /**
   * 1-based page for callers that paginate the model list (the mobile
   * picker). Omitted by the web loaders, which render a seed list and reach
   * the rest through search — they keep the historical single-page shape.
   */
  page?: number;
  /**
   * Page size for paginating callers. Defaults to `MODEL_PICKER_LIMIT` so
   * omitting both params reproduces the pre-pagination behaviour exactly.
   */
  perPage?: number;
}): Promise<BookingModelTabData> {
  try {
    const assetModelsCount = await db.assetModel.count({
      where: { organizationId },
    });
    const showModelsTab = assetModelsCount > 0;

    // Case-insensitive name filter, applied to the seed fetch only (not the
    // full-org count/showModelsTab). Trimmed; blank search = no filter.
    // Escape the LIKE metacharacters (`%` `_` and the escape char `\`) so a
    // literal search like "model_1" matches literally instead of treating `_`
    // as a single-char wildcard (Prisma `contains` compiles to ILIKE).
    const trimmedSearch = search?.trim();
    const searchWhere = trimmedSearch
      ? {
          name: {
            contains: trimmedSearch.replace(/[\\%_]/g, "\\$&"),
            mode: "insensitive" as const,
          },
        }
      : {};

    let assetModels: BookingModelTabAssetModel[] = [];

    /**
     * Count of models matching the search. Paginating callers need this to
     * know when they've reached the end; without a search it's the same query
     * as the full-org count, so reuse that rather than issuing a second one.
     */
    const matchedAssetModels = trimmedSearch
      ? await db.assetModel.count({ where: { organizationId, ...searchWhere } })
      : assetModelsCount;

    // Page size defaults to the historical cap, so callers that pass neither
    // param (the web loaders) get byte-identical behaviour to before.
    const effectivePerPage =
      perPage && perPage > 0 ? Math.min(perPage, 100) : MODEL_PICKER_LIMIT;
    const effectivePage = page && page > 1 ? page : 1;

    if (showModelsTab) {
      const rawModels = await db.assetModel.findMany({
        where: { organizationId, ...searchWhere },
        select: { id: true, name: true },
        /**
         * `AssetModel.name` is NOT unique, so name alone is not a stable sort:
         * tied rows can repeat on one page and vanish from the next, leaving
         * models unreachable — exactly what this pagination exists to prevent.
         * `id` breaks the tie deterministically.
         */
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (effectivePage - 1) * effectivePerPage,
        take: effectivePerPage,
      });

      const availabilities = await Promise.all(
        rawModels.map((m) =>
          getAssetModelAvailability({
            assetModelId: m.id,
            organizationId,
            bookingId: booking.id,
            from: booking.from,
            to: booking.to,
          })
        )
      );

      assetModels = rawModels.map((m, i) => ({
        id: m.id,
        name: m.name,
        total: availabilities[i].total,
        available: availabilities[i].available,
        reservedConcrete: availabilities[i].reservedConcrete,
        reservedViaRequest: availabilities[i].reservedViaRequest,
        inCustody: availabilities[i].inCustody,
      }));
    }

    // Ship all requests (outstanding + fulfilled). The Models tab UI splits
    // them into "Active reservations" (editable, not yet fully fulfilled)
    // and "Fulfilled" (historical, read-only) — the audit trail for "this
    // booking started life as 3 × Dell" on an ONGOING booking.
    const modelRequests = booking.modelRequests.map((req) => ({
      assetModelId: req.assetModelId,
      assetModelName: req.assetModel.name,
      quantity: req.quantity,
      fulfilledQuantity: req.fulfilledQuantity,
      fulfilledAt:
        req.fulfilledAt instanceof Date
          ? req.fulfilledAt.toISOString()
          : req.fulfilledAt,
    }));

    // Shape for `DynamicSelect`. The picker reads `initialAssetModels` as
    // its seed list and `totalAssetModels` to decide whether to offer the
    // "show all / search" affordance. Availability goes on `metadata` so
    // the renderItem can show e.g. "5 / 5 available" inline per option.
    const initialAssetModels = assetModels.map((m) => ({
      id: m.id,
      name: m.name,
      metadata: {
        total: m.total,
        available: m.available,
        reservedConcrete: m.reservedConcrete,
        reservedViaRequest: m.reservedViaRequest,
        inCustody: m.inCustody,
      },
    }));

    return {
      showModelsTab,
      assetModels,
      initialAssetModels,
      totalAssetModels: assetModelsCount,
      matchedAssetModels,
      modelRequests,
    };
  } catch (cause) {
    // Don't re-wrap a ShelfError already thrown by getAssetModelAvailability
    // — that would bury its original status/message under a generic one.
    if (cause instanceof ShelfError) throw cause;
    throw new ShelfError({
      cause,
      label,
      message: "Failed to build the Models tab payload for this booking.",
      additionalData: { organizationId, bookingId: booking.id },
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

      // Peek at the existing row first — we need its `fulfilledQuantity`
      // both for the "can't shrink below already-fulfilled" guard and
      // for the availability delta calculation ("only claim the still-
      // outstanding share against the pool").
      const existing = await tx.bookingModelRequest.findUnique({
        where: {
          bookingId_assetModelId: { bookingId, assetModelId },
        },
        select: { quantity: true, fulfilledQuantity: true },
      });
      const previousQuantity = existing?.quantity ?? null;
      const existingFulfilled = existing?.fulfilledQuantity ?? 0;

      if (quantity < existingFulfilled) {
        throw new ShelfError({
          cause: null,
          label,
          status: 400,
          message: `Cannot shrink reservation below ${existingFulfilled} — that many units have already been assigned via scan. Remove the assigned assets from the booking first, or raise the quantity to match.`,
          shouldBeCaptured: false,
        });
      }

      // Claim the pool before measuring it. Both statements have to be in
      // this transaction: the lock serializes competing reservations, and
      // `db: tx` is what makes the counts observe it.
      await lockAssetModelForReservation(tx, assetModelId, organizationId);

      const availability = await getAssetModelAvailability({
        assetModelId,
        organizationId,
        bookingId,
        from: booking.from,
        to: booking.to,
        db: tx,
      });

      // We only need fresh pool availability for the NEW outstanding
      // units this upsert will claim. Fulfilled units are already
      // reflected as concrete `BookingAsset` rows (not double-counted
      // against our own request since `availability` excludes this
      // booking), so the delta against the pool is `newOutstanding`.
      const newOutstanding = quantity - existingFulfilled;
      if (newOutstanding > availability.available) {
        throw new ShelfError({
          cause: null,
          label,
          status: 400,
          message: `Cannot reserve ${quantity} × ${assetModel.name}. Only ${availability.available} more available in this window.`,
          shouldBeCaptured: false,
        });
      }

      // `fulfilledAt` transitions:
      //   - create: always null (nothing fulfilled yet)
      //   - update with newQuantity === fulfilledQuantity: mark complete
      //   - update with newQuantity > fulfilledQuantity: re-open (null)
      //   - update with newQuantity < fulfilledQuantity: rejected above
      const justCompleted = quantity === existingFulfilled && quantity > 0;
      const fulfilledAt = justCompleted ? new Date() : null;

      const request = await tx.bookingModelRequest.upsert({
        where: {
          bookingId_assetModelId: { bookingId, assetModelId },
        },
        create: {
          bookingId,
          assetModelId,
          quantity,
        },
        update: {
          quantity,
          fulfilledAt,
        },
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
    // Model names are user-supplied and render as literal text in the note.
    const modelName = stripMarkdocDelimiters(assetModel.name);
    let content: string | null = null;
    if (previousQuantity == null) {
      content = `{actor} reserved **${quantity} × ${modelName}** for this booking.`;
    } else if (quantity > previousQuantity) {
      content = `{actor} increased the **${modelName}** reservation from **${previousQuantity}** to **${quantity}**.`;
    } else if (quantity < previousQuantity) {
      content = `{actor} decreased the **${modelName}** reservation from **${previousQuantity}** to **${quantity}**.`;
    }

    if (content != null) {
      try {
        const actor = await loadActor(userId);
        await createSystemBookingNote({
          bookingId,
          organizationId,
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

      // If any units have been fulfilled, the corresponding
      // `BookingAsset` rows exist on the booking. Deleting the
      // request here would orphan those rows from their "how they
      // got here" context and silently destroy the audit trail. Ask
      // the operator to unassign the concrete assets first (which
      // doesn't currently decrement `fulfilledQuantity` — intentional,
      // a scan is a historical fact). Or they can edit the quantity
      // down to match `fulfilledQuantity` to close out the request.
      if (existing.fulfilledQuantity > 0) {
        throw new ShelfError({
          cause: null,
          label,
          status: 400,
          message: `Cannot cancel — ${existing.fulfilledQuantity} unit(s) have already been assigned. Edit the quantity down to ${existing.fulfilledQuantity} to close out, or remove the assigned assets from the booking first.`,
          shouldBeCaptured: false,
        });
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
          organizationId,
          content: `${actor} cancelled the model-level reservation for **${stripMarkdocDelimiters(
            assetModelName
          )}**.`,
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
  /**
   * Actor for the activity note. Optional because not every add-assets path
   * threads one through (`api/assets.add-to-booking` writes its own
   * user-attributed note instead, so passing a user here would duplicate it).
   * Fulfilment itself must not depend on attribution — a reservation that
   * silently survived because the caller had no `userId` would hard-block
   * check-out. Without an actor the note is written in the system voice.
   */
  userId?: string;
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
 * outstanding model request. Increments the request's `fulfilledQuantity`
 * by 1 and — when fulfilment catches up to the reserved `quantity` —
 * stamps `fulfilledAt`. The row is **never deleted**: keeping it
 * preserves the audit trail ("this booking originally reserved 3 ×
 * Dell, now shows as fulfilled") and lets the Models tab on ONGOING
 * bookings render a historical readout instead of an empty state.
 *
 * Returns:
 *   - `{ matched: true, requestId, remaining }` — the scan consumed a request
 *     unit. The caller MUST stamp `requestId` onto the `BookingAsset` row it
 *     creates for this asset (`bookingModelRequestId`), or the link between
 *     promise and delivery survives only in the activity note written below.
 *   - `{ matched: false }` — no outstanding request matches this asset's
 *     model (no row exists, or the row is already fully fulfilled);
 *     the caller should fall through to its existing "add as direct
 *     BookingAsset" path.
 *
 * Throws `ShelfError` only on internal errors (tx failure). Missing /
 * fully-fulfilled request is NOT an error — it's a normal case for
 * model-free bookings or scans beyond the reserved count.
 */
export async function materializeModelRequestForAsset({
  bookingId,
  asset,
  userId,
  tx,
}: MaterializeArgs): Promise<
  | { matched: true; requestId: string; remaining: number; modelName: string }
  | { matched: false }
> {
  try {
    if (!asset.assetModelId) {
      // Asset without a model — no model request can possibly match.
      // Caller handles via the direct-booking path.
      return { matched: false };
    }

    /**
     * Only INDIVIDUAL assets are model units.
     *
     * `getAssetModelAvailability` counts the pool as INDIVIDUAL-only, so
     * accepting anything with a matching `assetModelId` here made the two
     * halves disagree about what a unit is: a QUANTITY_TRACKED asset could
     * discharge a reservation whose availability math never counted it,
     * over-stating what the booking actually holds.
     *
     * The UI producers are closed today (the asset form hides the model
     * selector for QT, and `bulkUpdateAssetModel` skips them), but CSV import,
     * direct API writes and an INDIVIDUAL → QT conversion are not. One clause
     * makes both halves agree regardless of how the row got its model.
     */
    if (asset.type !== AssetType.INDIVIDUAL) {
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

    if (!existing) {
      return { matched: false };
    }

    /**
     * Claim one unit ATOMICALLY: capacity check, increment and completion
     * stamp in a single statement.
     *
     * All three have to move together. A relative `{ increment: 1 }` alone
     * fixes the lost update on the column but leaves the guard and the stamp
     * reading a PRE-write snapshot, which is strictly worse than the absolute
     * write it replaced:
     *
     *   T1 reads 0, T2 reads 0. Both compute `justCompleted = (1 === 2)` =
     *   false. Both increment. The row lands on `2/2` with `fulfilledAt` still
     *   NULL — invisible to `getOutstandingModelRequests` (`2 < 2` is false),
     *   still hard-blocking check-out (the guard matched `fulfilledAt: null`
     *   alone), and un-removable (`removeBookingModelRequest` refuses while
     *   `fulfilledQuantity > 0`). No visible row to fix. The old absolute write
     *   at least produced a visible, recoverable under-count.
     *
     * The stale capacity check had the mirror problem: on a 1-unit request two
     * concurrent fulfilments both read 0, both passed, both incremented, and
     * the row over-filled to `2/1`.
     *
     * `WHERE "fulfilledQuantity" < "quantity"` makes the capacity check part of
     * the write, so the second transaction claims nothing and its asset lands
     * as an ordinary add. The `CASE` computes completion from the POST-write
     * value, so whichever transaction takes the last unit stamps it.
     * `COALESCE` keeps an existing stamp rather than moving it.
     *
     * Column names are literal — `BookingModelRequest` declares no `@map`.
     * @see {@link file://./../../../../../.claude/rules/raw-sql-respects-prisma-map.md}
     */
    const claimed = await tx.$queryRaw<
      Array<{ fulfilledQuantity: number; quantity: number }>
    >`
      UPDATE "BookingModelRequest"
      SET "fulfilledQuantity" = "fulfilledQuantity" + 1,
          "fulfilledAt" = CASE
            WHEN "fulfilledQuantity" + 1 >= "quantity"
              THEN COALESCE("fulfilledAt", NOW())
            ELSE "fulfilledAt"
          END
      WHERE "id" = ${existing.id}
        AND "fulfilledQuantity" < "quantity"
      RETURNING "fulfilledQuantity", "quantity"
    `;

    if (claimed.length === 0) {
      // Either it was already full when we read it, or a concurrent
      // transaction took the last unit between our read and this write. Both
      // mean the same thing to the caller: this asset is "over the count" and
      // lands as an ordinary `BookingAsset`.
      return { matched: false };
    }

    // Remaining is derived from what the database actually committed, not from
    // the pre-write snapshot, so a concurrent claim is reflected in the note.
    const remaining = Math.max(
      0,
      claimed[0].quantity - claimed[0].fulfilledQuantity
    );

    // Activity note — IN the tx so the note rolls back with the
    // materialization if anything later in the pipeline fails.
    const actor = userId ? await loadActor(userId) : null;
    const assetLink = wrapLinkForNote(`/assets/${asset.id}`, asset.title);
    const modelNameForNote = stripMarkdocDelimiters(existing.assetModel.name);
    // Same sentence either way; only the subject changes, so the feed reads
    // consistently whether or not the caller threaded an actor through.
    const content = actor
      ? `${actor} assigned ${assetLink} (${modelNameForNote}) to this booking — ${remaining} × ${modelNameForNote} remaining.`
      : `${assetLink} (${modelNameForNote}) was assigned to this booking — ${remaining} × ${modelNameForNote} remaining.`;
    await tx.bookingNote.create({
      data: {
        type: "UPDATE",
        content,
        booking: { connect: { id: bookingId } },
      },
    });

    return {
      matched: true,
      requestId: existing.id,
      remaining,
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
/*                       fulfilModelRequestsForAssets                         */
/* -------------------------------------------------------------------------- */

/**
 * Discharge a booking's outstanding model reservations using assets that are
 * being added to it, whatever surface they arrived from.
 *
 * ## Why this is shared rather than scanner-local
 *
 * A `BookingModelRequest` means "this booking needs N units of model M, any
 * units". Naming a concrete unit of M and putting it on the booking ANSWERS
 * that — the promise and the delivery describe the same physical thing. If the
 * reservation survives, the booking demands N unnamed units PLUS the named one,
 * which is not what the operator asked for, and because unfulfilled requests
 * are a hard block on check-out, the booking then cannot leave at all.
 *
 * Until this helper existed, {@link materializeModelRequestForAsset} had
 * exactly one production caller: the scan path. Adding the very same asset
 * through "Manage assets" (`updateBookingAssets`) left the reservation
 * untouched — verified against a live database, not inferred: identical asset,
 * identical reservation, scanner ⇒ `1/1 fulfilled, checkout allowed`, picker ⇒
 * `0/1 fulfilled, checkout HARD BLOCKED`. The operator's only escape was to
 * delete the reservation they had correctly made.
 *
 * Routing every add-assets path through here makes fulfilment a property of an
 * asset landing on the booking, not of the device it was added with. Web
 * scanner, "Manage assets", asset-index bulk add, the mobile
 * `api/mobile/bookings.add-scanned-assets` endpoint and the companion app all
 * inherit identical behaviour, and a future surface gets it by construction
 * rather than by remembering to call this.
 *
 * Callers MUST persist the returned provenance — see
 * {@link file://./../../../../../packages/database/prisma/schema.prisma}
 * `BookingAsset.bookingModelRequestId`.
 *
 * @param args.bookingId - Booking being fulfilled.
 * @param args.assets - The assets being added. Pre-fetched by every caller
 *   already, so it is taken as data rather than re-queried here.
 * @param args.organizationId - Caller's org, for the error payload.
 * @param args.userId - Actor, for the per-assignment activity note.
 * @param args.tx - Interactive transaction client. Required: the decrements,
 *   the notes and the caller's `BookingAsset` writes must commit or roll back
 *   as one.
 * @returns `assetId → BookingModelRequest.id` for every asset that discharged
 *   a reservation. Assets with no model, or whose model has no outstanding
 *   request, are absent — that is the normal case, not an error.
 * @throws {ShelfError} Only on internal failure.
 */
export async function fulfilModelRequestsForAssets({
  bookingId,
  assets,
  organizationId,
  userId,
  tx,
}: {
  bookingId: string;
  assets: Array<Pick<Asset, "id" | "title" | "assetModelId" | "type">>;
  organizationId: string;
  /** Optional actor for the notes — see {@link materializeModelRequestForAsset}. */
  userId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
}): Promise<Map<string, string>> {
  const fulfilledRequestIdByAssetId = new Map<string, string>();

  /**
   * Short-circuit the overwhelmingly common case: the booking has no
   * outstanding reservations, so no asset can discharge one.
   *
   * Without this, the loop below costs one sequential `findUnique` per
   * model-tagged asset INSIDE the caller's interactive transaction. An
   * assets-index select-all through `api/assets.add-to-booking` can carry
   * hundreds of them, and Prisma's default interactive-transaction timeout is
   * 5s — so a bulk add that worked before this PR could start failing with
   * P2028 and roll the whole thing back. One indexed count up front is the
   * difference between one round-trip and N.
   */
  if (assets.length === 0) return fulfilledRequestIdByAssetId;

  const outstandingCount = await tx.bookingModelRequest.count({
    where: { bookingId, fulfilledAt: null },
  });
  if (outstandingCount === 0) return fulfilledRequestIdByAssetId;

  for (const asset of assets) {
    // Sequential, not `Promise.all`: several assets of the SAME model compete
    // for one request row, and each call reads `fulfilledQuantity` then writes
    // back. Running them concurrently inside one transaction would let two
    // reads see the same value and the second write clobber the first, so
    // three scanned units would decrement a 3-unit reservation by one.
    const result = await materializeModelRequestForAsset({
      bookingId,
      asset,
      organizationId,
      userId,
      tx,
    });

    if (result.matched) {
      fulfilledRequestIdByAssetId.set(asset.id, result.requestId);
    }
  }

  return fulfilledRequestIdByAssetId;
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
