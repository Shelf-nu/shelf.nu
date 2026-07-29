/**
 * Booking-Pool Availability — the ONE batch fetcher
 *
 * Canonical DB read behind every booking-family availability surface. Each
 * former inline formula is now a NAMED flag combination of the SAME query +
 * the pure core in `availability.ts` — never a re-implementation. Current
 * call sites and their flag sets (keep this table honest when migrating):
 *
 * | Surface                                   | custodyScope | includeKitSlices | window        | dispositionAware | excludeBookingId |
 * | ----------------------------------------- | ------------ | ---------------- | ------------- | ---------------- | ---------------- |
 * | Asset overview card (loader)              | "operator"   | true             | null (global) | true             | —                |
 * | Booking overview badge map                | "operator"   | false            | null (global) | false            | current booking  |
 * | Booking overview adjust-cap map (#2755)   | "all"        | false            | null (global) | true             | current booking  |
 * | Manage-assets picker                      | "all"        | true             | booking dates | false            | current booking  |
 * | Scanner picker meta (booking context)     | "all"        | true             | booking dates | false            | current booking  |
 * | Mobile booking picker (available-assets)  | "all"        | true             | booking dates (DB-resolved) | false | current booking |
 * | `computeBookingAvailableQuantity` wrapper | "all"        | false            | null (global) | true             | caller-provided  |
 *
 * WINDOWED vs GLOBAL (#2724 — deliberately unresolved here): the pickers
 * scope reservations to bookings whose dates overlap the current booking's
 * window ("non-overlapping bookings don't compete for the same quantity
 * window"), while the checkout guard and the overview treat the pool as
 * global. Whether the guard should become date-aware is an open product
 * question tracked in shelf-nu/shelf.nu#2724; this module only makes the
 * divergence an explicit, named parameter choice. The pickers, the badge
 * map, and the guard wrapper migrated behavior-neutral (each preserves its
 * pre-module semantics bit-for-bit). ONE surface deliberately changed in
 * the migration PR: the asset-overview card now clamps for display (with an
 * explicit over-committed callout) AND runs `dispositionAware: true` —
 * fixing the negative render and the partial-check-in double-count (the
 * pool total was already decremented for CONSUME/LOSS/DAMAGE, so raw booked
 * sums counted those units twice). See the rationale comment at the
 * overview loader's call site (`assets.$assetId.overview.tsx`).
 *
 * TWO AVAILABILITY FAMILIES — do not merge:
 *   - BOOKING family (this module): reservations subtract; answers "can I
 *     reserve N more units?".
 *   - CUSTODY family: `computeAvailableQuantity`
 *     (`~/modules/consumption-log/service.server`), the overview's
 *     `custodyAvailable`, and `low-stock.server.ts`. Per the asset-overview
 *     rationale: "reservations don't subtract here (units are still
 *     physically present), but kits do because dropping below `inKits`
 *     would violate the sum-within-total DB trigger." Custody assignment /
 *     quantity-adjust caps and low-stock math intentionally ignore
 *     bookings — a reserved unit is still on the shelf.
 *
 * IMPORT-CYCLE GUARD: this module must NOT import from
 * `~/modules/booking/service.server` (e.g. `computeCheckedOutForAsset`) —
 * that would close a consumption-log ↔ booking ↔ asset cycle. Disposition
 * awareness is implemented by querying `ConsumptionLog` directly, exactly
 * like the pre-extraction helper did.
 *
 * @see {@link file://./availability.ts} — pure core (client-safe)
 * @see {@link file://../consumption-log/service.server.ts} — custody family + back-compat wrapper
 */

import type { Prisma } from "@prisma/client";
import {
  BookingStatus,
  ConsumptionCategory as ConsumptionCategoryEnum,
} from "@prisma/client";
import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { computeBookingPoolAvailability } from "./availability";

const label: ErrorLabel = "Assets";

/**
 * Booking statuses whose reservations consume pool headroom. Fixed set —
 * every surface in the booking family agrees on it.
 */
export const ACTIVE_POOL_BOOKING_STATUSES = [
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
] as const;

/** Per-asset result row returned by {@link getBookingPoolAvailability}. */
export type BookingPoolAvailabilityRow = {
  /** Workspace stock — `Asset.quantity`. */
  total: number;
  /** Σ `AssetKit.quantity` (0 when `includeKitSlices` is off). */
  inKits: number;
  /** Σ `Custody.quantity` under the requested `custodyScope`. */
  inCustody: number;
  /**
   * Units committed to RESERVED-status bookings (disposition-adjusted when
   * `dispositionAware`). NOTE: "reserved" vs "checkedOut" here splits by
   * BOOKING STATUS, not by physical scan-out. Display surfaces that need
   * the PartialBookingCheckout-based "physically out" split (the asset
   * overview rows) must re-partition THESE two numbers via
   * `splitDisplayBookingCommitments` — they must NOT re-derive the rows
   * from raw `BookingAsset.quantity` sums. Under `dispositionAware` the
   * raw sums do NOT telescope to `reserved + checkedOut` (they are larger
   * by the logged CONSUME/LOSS/DAMAGE/RETURN units), so a raw-sum display
   * row makes the card's own arithmetic fail to reconcile.
   */
  reserved: number;
  /** Units committed to ONGOING/OVERDUE-status bookings (see `reserved` note). */
  checkedOut: number;
  /** Signed headroom — see {@link file://./availability.ts}. */
  raw: number;
  /** `max(0, raw)` — display-safe. */
  available: number;
};

/** Arguments for {@link getBookingPoolAvailability}. */
export type GetBookingPoolAvailabilityArgs = {
  /** Assets to compute availability for (deduped internally). */
  assetIds: string[];
  /**
   * Org scope for every query — REQUIRED (cross-org IDOR guard per
   * `.claude/rules/org-scope-user-supplied-ids.md`). The compiler enforces
   * this: the only unscoped entry point is
   * {@link getBookingPoolAvailabilityUnscopedForLegacyWrapper}, reserved
   * for the legacy `computeBookingAvailableQuantity` wrapper whose callers
   * org-validate the asset id upstream and whose signature predates org
   * threading. New call sites must use this scoped function.
   */
  organizationId: string;
  /**
   * Exclude this booking's own reservations from the reserved count — every
   * booking-editing surface passes its own booking id so the booking doesn't
   * compete with itself.
   */
  excludeBookingId?: string;
  /**
   * Date-overlap scoping (#2724): when set, only reservations from bookings
   * whose [from, to] overlaps the window consume headroom. `null`/omitted =
   * global pool (checkout-guard / overview semantics). See module JSDoc.
   */
  window?: { from: Date; to: Date } | null;
  /**
   * Which `Custody` rows subtract:
   *   - "operator": rows with `kitCustodyId == null` only. Kit-allocated
   *     custody mirrors `AssetKit.quantity`; surfaces that also subtract
   *     `inKits` (or track kits separately) use this to avoid
   *     double-counting (asset overview, booking badge).
   *   - "all": every custody row (checkout guard / picker convention).
   *     CAVEAT: the picker/scanner/mobile surfaces combine "all" WITH
   *     `includeKitSlices: true`, so when a kit holding a QT slice is
   *     itself in custody, the kit-allocated Custody row (mirroring
   *     `AssetKit.quantity`) AND the AssetKit sum both subtract — a
   *     double-count of kit-in-custody units. That is pre-existing
   *     behavior deliberately preserved by the behavior-neutral
   *     migration; fixing it is a documented follow-up alongside the
   *     `dispositionAware` flips, not a silent drift.
   * Required with no default: each call site must state its semantics per
   * `.claude/rules/quantity-semantics-per-surface.md`.
   */
  custodyScope: "operator" | "all";
  /**
   * Subtract Σ `AssetKit.quantity` (kit-earmarked units). Pickers and the
   * overview subtract kits; the guard family historically does not.
   * Defaults to false.
   */
  includeKitSlices?: boolean;
  /**
   * When true (default), each active booking's commitment is
   * `max(0, booked − logged RETURN/CONSUME/LOSS/DAMAGE)` — the Phase-3c
   * refinement that stops double-counting after partial check-in
   * dispositions (the pool total was already decremented for
   * CONSUME/LOSS/DAMAGE). When false, reproduces the raw booked-sum the
   * pickers/badge used pre-migration — those sites migrate with `false`
   * first so this PR is behavior-neutral for them; flipping them is a
   * documented follow-up, not a silent drift.
   *
   * Clamping is PER SLICE against the (bookingId, assetId) logged sum —
   * identical to the pre-extraction `computeBookingAvailableQuantity`
   * loop — so the wrapper's behavior is preserved bit-for-bit. KNOWN
   * QUIRK carried over with it: a booking legitimately holding BOTH a
   * standalone slice and kit-driven slice(s) of the same QT asset (see
   * `.claude/rules/kit-members-via-kit-slices.md`) gets the full logged
   * sum credited once per slice, understating `reserved`. Folding per
   * (bookingId, assetId) BEFORE subtracting is a documented follow-up —
   * changing it here would break the wrapper's bit-for-bit parity that
   * external PR #2744's tests depend on.
   */
  dispositionAware?: boolean;
  /**
   * Prisma client or interactive-transaction client to read through.
   * Defaults to the ambient `db` — which preserves the documented
   * status quo of the checkout/adjust guards (they rely on the caller's
   * row lock + read-committed isolation rather than tx reads; see the
   * comment blocks at their call sites and PR #2744's scoping note).
   */
  // why: Prisma exposes no shared type covering BOTH the extended client and
  // its `$transaction` callback client, so `any` is the honest annotation here
  // (same convention as `createConsumptionLog`'s `tx`). No eslint-disable —
  // `@typescript-eslint/no-explicit-any` is off repo-wide (see .eslintrc).
  client?: any;
};

/**
 * Batch-computes booking-pool availability for a set of assets.
 *
 * One query set for the whole batch (asset totals, optional kit sums,
 * custody sums, active reservations, optional disposition sums) folded
 * through {@link computeBookingPoolAvailability}. Assets not found under
 * the given org scope are simply absent from the returned map — callers
 * that require presence should treat a missing key as not-found.
 *
 * @param args - See {@link GetBookingPoolAvailabilityArgs}
 * @returns Map of assetId → {@link BookingPoolAvailabilityRow}
 * @throws {ShelfError} on query failure
 */
export async function getBookingPoolAvailability(
  args: GetBookingPoolAvailabilityArgs
): Promise<Map<string, BookingPoolAvailabilityRow>> {
  return getBookingPoolAvailabilityInternal(args);
}

/**
 * UNSCOPED legacy entry point — do NOT add call sites.
 *
 * Exists solely for the back-compat `computeBookingAvailableQuantity`
 * wrapper (`~/modules/consumption-log/service.server`), whose signature
 * predates org threading and whose consumers (checkout guard, adjust
 * route, add-to-existing-booking) all org-validate the asset id upstream.
 * Keeping the `null` branch OUT of {@link getBookingPoolAvailability}'s
 * signature means a new unscoped call site cannot appear without touching
 * this module and tripping review (org-scope-user-supplied-ids rule:
 * the compiler, not a JSDoc sentence, forces org scoping).
 *
 * @param args - Same as {@link GetBookingPoolAvailabilityArgs} but with a
 *   nullable `organizationId` (null skips the org filter on every query)
 */
export async function getBookingPoolAvailabilityUnscopedForLegacyWrapper(
  args: Omit<GetBookingPoolAvailabilityArgs, "organizationId"> & {
    organizationId: string | null;
  }
): Promise<Map<string, BookingPoolAvailabilityRow>> {
  return getBookingPoolAvailabilityInternal(args);
}

/** Shared implementation behind the scoped + legacy-unscoped entry points. */
async function getBookingPoolAvailabilityInternal({
  assetIds,
  organizationId,
  excludeBookingId,
  window = null,
  custodyScope,
  includeKitSlices = false,
  dispositionAware = true,
  client,
}: Omit<GetBookingPoolAvailabilityArgs, "organizationId"> & {
  organizationId: string | null;
}): Promise<Map<string, BookingPoolAvailabilityRow>> {
  const prisma = client ?? db;
  const uniqueAssetIds = [...new Set(assetIds)];
  const result = new Map<string, BookingPoolAvailabilityRow>();

  if (uniqueAssetIds.length === 0) {
    return result;
  }

  try {
    /**
     * Asset totals first — and org-scoped when an organizationId is given.
     * Every downstream query is restricted to the ids that survived this
     * lookup, so a foreign-org id supplied by an attacker never reaches
     * the custody/booking aggregations (cross-org IDOR guard).
     */
    const assets: Array<{ id: string; quantity: number | null }> =
      await prisma.asset.findMany({
        where: {
          id: { in: uniqueAssetIds },
          ...(organizationId ? { organizationId } : {}),
        },
        select: { id: true, quantity: true },
      });

    const presentIds = assets.map((a) => a.id);
    if (presentIds.length === 0) {
      return result;
    }

    const bookingAssetWhere: Prisma.BookingAssetWhereInput = {
      assetId: { in: presentIds },
      ...(excludeBookingId ? { bookingId: { not: excludeBookingId } } : {}),
      booking: {
        status: { in: [...ACTIVE_POOL_BOOKING_STATUSES] },
        ...(organizationId ? { organizationId } : {}),
        ...(window
          ? {
              /**
               * Date-overlap filter, verbatim from the picker formulas it
               * replaces: a booking competes when its range intersects the
               * window (first arm) — the contained-range second arm is
               * logically subsumed but kept for query-plan parity with the
               * pre-migration inline versions.
               */
              OR: [
                { from: { lte: window.to }, to: { gte: window.from } },
                { from: { gte: window.from }, to: { lte: window.to } },
              ],
            }
          : {}),
      },
    };

    const [kitSums, custodySums, reservationRows] = await Promise.all([
      includeKitSlices
        ? prisma.assetKit.groupBy({
            by: ["assetId"],
            where: {
              assetId: { in: presentIds },
              ...(organizationId ? { organizationId } : {}),
            },
            _sum: { quantity: true },
          })
        : Promise.resolve(
            [] as Array<{ assetId: string; _sum: { quantity: number | null } }>
          ),
      prisma.custody.groupBy({
        by: ["assetId"],
        where: {
          assetId: { in: presentIds },
          /**
           * "operator" = asset-level custody only. Kit-allocated custody
           * rows (`kitCustodyId != null`) mirror `AssetKit.quantity` and are
           * accounted via `includeKitSlices` on the surfaces that use this
           * scope — counting both would double-subtract.
           */
          ...(custodyScope === "operator" ? { kitCustodyId: null } : {}),
        },
        _sum: { quantity: true },
      }),
      /**
       * Individual rows (not an aggregate) because dispositionAware mode
       * needs the per-slice booked quantity to clamp against per-booking
       * logged sums, and the RESERVED vs ONGOING/OVERDUE split needs the
       * booking status.
       */
      prisma.bookingAsset.findMany({
        where: bookingAssetWhere,
        select: {
          assetId: true,
          bookingId: true,
          quantity: true,
          booking: { select: { status: true } },
        },
      }),
    ]);

    /** (bookingId, assetId) → Σ logged terminal dispositions. */
    const loggedByBookingAsset = new Map<string, number>();
    if (dispositionAware && reservationRows.length > 0) {
      const bookingIds = [
        ...new Set(
          reservationRows.map((r: { bookingId: string }) => r.bookingId)
        ),
      ];
      /**
       * Terminal dispositions shrink a booking's outstanding reservation:
       * RETURN (back in stock), CONSUME / LOSS / DAMAGE (gone — and the
       * pool total was already decremented for these, which is exactly why
       * they must be subtracted here to avoid double-counting). CHECKOUT is
       * excluded: it is a handoff into custody, not a reservation change.
       */
      const loggedGroups = await prisma.consumptionLog.groupBy({
        by: ["bookingId", "assetId"],
        where: {
          assetId: { in: presentIds },
          bookingId: { in: bookingIds },
          category: {
            in: [
              ConsumptionCategoryEnum.RETURN,
              ConsumptionCategoryEnum.CONSUME,
              ConsumptionCategoryEnum.LOSS,
              ConsumptionCategoryEnum.DAMAGE,
            ],
          },
        },
        _sum: { quantity: true },
      });
      for (const group of loggedGroups) {
        if (group.bookingId) {
          loggedByBookingAsset.set(
            `${group.bookingId}::${group.assetId}`,
            group._sum.quantity ?? 0
          );
        }
      }
    }

    /** Fold reservation rows into per-asset reserved / checkedOut sums. */
    const reservedByAsset = new Map<string, number>();
    const checkedOutByAsset = new Map<string, number>();
    for (const row of reservationRows as Array<{
      assetId: string;
      bookingId: string;
      quantity: number;
      booking: { status: BookingStatus };
    }>) {
      const logged = dispositionAware
        ? loggedByBookingAsset.get(`${row.bookingId}::${row.assetId}`) ?? 0
        : 0;
      /**
       * Per-slice clamp at 0 — defence-in-depth against over-logged
       * bookings, preserved verbatim from the pre-extraction helper
       * (including its per-slice — not per-booking-sum — subtraction).
       */
      const effective = Math.max(0, row.quantity - logged);
      const target =
        row.booking.status === BookingStatus.RESERVED
          ? reservedByAsset
          : checkedOutByAsset;
      target.set(row.assetId, (target.get(row.assetId) ?? 0) + effective);
    }

    const kitsByAsset = new Map<string, number>(
      kitSums.map(
        (k: { assetId: string; _sum: { quantity: number | null } }) => [
          k.assetId,
          k._sum.quantity ?? 0,
        ]
      )
    );
    const custodyByAsset = new Map<string, number>(
      custodySums.map(
        (c: { assetId: string; _sum: { quantity: number | null } }) => [
          c.assetId,
          c._sum.quantity ?? 0,
        ]
      )
    );

    for (const asset of assets) {
      const inputs = {
        total: asset.quantity ?? 0,
        inKits: kitsByAsset.get(asset.id) ?? 0,
        inCustody: custodyByAsset.get(asset.id) ?? 0,
        reserved: reservedByAsset.get(asset.id) ?? 0,
        checkedOut: checkedOutByAsset.get(asset.id) ?? 0,
      };
      const { raw, available } = computeBookingPoolAvailability(inputs);
      result.set(asset.id, { ...inputs, raw, available });
    }

    return result;
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while computing booking availability. Please try again or contact support.",
      additionalData: {
        assetIds: uniqueAssetIds,
        organizationId,
        excludeBookingId,
        custodyScope,
        includeKitSlices,
        dispositionAware,
        windowed: Boolean(window),
      },
      label,
    });
  }
}
