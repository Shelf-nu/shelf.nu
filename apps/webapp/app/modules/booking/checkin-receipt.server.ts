/**
 * Check-in Receipt Data
 *
 * Reads everything the printed check-in receipt states about a booking: the
 * printable per-slice rows, what happened to each slice's units, when the
 * booking was sent out and returned, who received it, and how late that was.
 *
 * The row list, the sort, the kit resolution, the printed asset codes and the
 * custodian-aware ownership check are all reused from the booking checklist's
 * `fetchAllPdfRelatedData`, so the two sheets can never disagree about what was
 * booked. This module adds only what the checklist has no reason to read: the
 * slice check-out / check-in markers, the disposition units attributed to each
 * slice, the completion event, the check-in events that say how each row came
 * back (scanned, selected, one click; web or phone), and the users behind the
 * markers.
 *
 * @see {@link file://./checkin-receipt.ts} — the reconciliation rules
 * @see {@link file://./pdf-helpers.ts} — the shared row list
 * @see {@link file://./../../routes/api+/bookings.$bookingId.generate-checkin-receipt.tsx}
 */

import { AssetType, BookingStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { resolveCheckInTimes } from "~/modules/reports/check-in-time.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { rethrowIfClientError, ShelfError } from "~/utils/error";
import type { RoleAccess } from "~/utils/permissions/role-access";
import { resolveUserDisplayName } from "~/utils/user";
import type {
  CheckinLatenessNote,
  CheckinReceiptRow,
  CheckinReceiptRowAsset,
  CheckinReceiptTotals,
} from "./checkin-receipt";
import {
  buildCheckinReceipt,
  formatLatenessNote,
  isRowCheckedIn,
  resolveReceiptMoments,
  resolveSentUnits,
  summariseCheckinMethods,
} from "./checkin-receipt";
import {
  describeBookingMethodCapitalised,
  readBookingMethodMeta,
} from "./checkout-method";
import {
  getLatenessMs,
  resolvePlannedEnd,
  resolvePlannedStart,
} from "./lateness";
import type { PdfDbResult, SortParams } from "./pdf-helpers";
import { fetchAllPdfRelatedData } from "./pdf-helpers";
import { attributeCategorizedDispositionsByBookingAsset } from "./service.server";

/**
 * The four dispositions that account for a unit coming off a booking.
 *
 * `ConsumptionCategory` also holds CHECKOUT, RESTOCK and ADJUSTMENT, which
 * describe units moving the other way or not moving at all; the attributor
 * accepts only these four.
 */
const CHECKIN_DISPOSITION_CATEGORIES = [
  "RETURN",
  "CONSUME",
  "LOSS",
  "DAMAGE",
] as const;

/**
 * One printed line of the receipt's items table, with its moments still as
 * `Date`s — the API loader formats them.
 */
export type CheckinReceiptDbRow = CheckinReceiptRow & CheckinReceiptRowAsset;

/** Everything the check-in receipt renders, with dates still unformatted. */
export type CheckinReceiptDbResult = {
  booking: PdfDbResult["booking"];
  organization: PdfDbResult["organization"];
  /** One row per booked slice, in the checklist's sort order. */
  rows: CheckinReceiptDbRow[];
  totals: CheckinReceiptTotals;
  /** The completeness line printed in the header's stamp box. */
  stamp: string;
  /** The period the booking was agreed for, never the live one. */
  plannedFrom: Date | null;
  plannedTo: Date | null;
  /**
   * The earliest departure a user is recorded making, from the slice markers
   * that name a dispatcher ({@link resolveReceiptMoments}).
   *
   * `BookingAsset.checkedOutAt` holds a slice's CURRENT departure (sending a
   * returned slice out again overwrites it), so on a re-dispatched booking this
   * is the earliest departure still on record, not the first one that ever
   * happened. The sheet labels it "Checked out" for that reason. `null` when no
   * slice names its dispatcher.
   */
  checkedOutAt: Date | null;
  /** Who made that departure. */
  checkedOutByName: string;
  /**
   * The booking's recorded return: its completion event, else the latest row
   * moment while no row with returned units is undated; `null` otherwise.
   */
  returnedAt: Date | null;
  /**
   * How the closing moment compares to the planned end — "on time", "early", or
   * "N days M hours after the planned end". Carries no verb, because the row it
   * sits on is a return only when units came back. `null` when the booking has
   * not finished or nothing recorded a moment.
   */
  latenessNote: CheckinLatenessNote | null;
  /**
   * Distinct receiving users, ordered by their first check-in. Empty when a
   * row with returned units records no receiver; the rows carry their own.
   */
  checkedInByNames: string[];
  /**
   * The one method line for the header when every checked-in row recorded the
   * same method; `null` when they differ or none recorded one.
   */
  checkedInHow: string | null;
};

/**
 * The events that say how a row was checked in. Both the one-click check-in
 * and the progressive one write one per asset, each carrying `meta.method` and
 * `meta.surface`.
 */
const CHECKIN_EVENT_ACTIONS = [
  "BOOKING_CHECKED_IN",
  "BOOKING_PARTIAL_CHECKIN",
] as const;

/**
 * The events that mark an asset's departure. The latest one is the boundary of
 * the asset's current dispatch: only check-in events from then on describe the
 * return the receipt prints, and an earlier trip's return is left behind.
 */
const CHECKOUT_EVENT_ACTIONS = [
  "BOOKING_CHECKED_OUT",
  "BOOKING_PARTIAL_CHECKOUT",
] as const;

/**
 * Reads a booking's check-in receipt.
 *
 * @param bookingId - The booking to print.
 * @param organizationId - The caller's active workspace; every lookup is scoped
 *   to it.
 * @param userId - The acting user, for the custodian-aware ownership check.
 * @param access - The acting user's access, or undefined for system callers.
 * @param request - The incoming request, for the client hint the shared helper
 *   reads.
 * @param sortParams - The booking page's active sort. The search term is
 *   deliberately not honoured: a receipt lists every booked row.
 * @returns The receipt's rows, totals, stamp and booking-level moments.
 * @throws {ShelfError} If the booking cannot be read or the caller may not see
 *   it.
 */
export async function fetchCheckinReceiptData(
  bookingId: string,
  organizationId: string,
  userId: string,
  access: RoleAccess | undefined,
  request: Request,
  sortParams?: Pick<SortParams, "orderBy" | "orderDirection">
): Promise<CheckinReceiptDbResult> {
  try {
    const pdfMeta = await fetchAllPdfRelatedData(
      bookingId,
      organizationId,
      userId,
      access,
      request,
      {
        orderBy: sortParams?.orderBy,
        orderDirection: sortParams?.orderDirection,
        // A receipt is a record of the whole booking, so the page's active
        // search must not narrow it.
        search: undefined,
      },
      // The sheet prints the text code only; there is no picture to draw.
      { includeCodeImages: false }
    );

    const { booking, organization, assets, assetIdToDisplayCodeMap } = pdfMeta;

    // `fetchAllPdfRelatedData` strips `bookingAssets` from the booking it
    // returns, and the slice projection behind its rows keeps only the columns
    // the checklist prints — so the markers this sheet is built on need their
    // own read.
    const [slices, dispositionLogs, checkInTimes, dispatchEvents] =
      await Promise.all([
        db.bookingAsset.findMany({
          where: { bookingId, booking: { organizationId } },
          select: {
            id: true,
            assetId: true,
            quantity: true,
            assetKitId: true,
            checkedOutAt: true,
            checkedOutById: true,
            checkedOutQuantity: true,
            checkedInAt: true,
            checkedInById: true,
            asset: { select: { type: true } },
          },
        }),
        db.consumptionLog.findMany({
          where: {
            bookingId,
            booking: { organizationId },
            category: { in: [...CHECKIN_DISPOSITION_CATEGORIES] },
          },
          select: {
            assetId: true,
            bookingAssetId: true,
            category: true,
            quantity: true,
            // A quantity slice returned in part never gets a check-in marker,
            // so its log is the only record of when those units came back and
            // who took them.
            createdAt: true,
            userId: true,
          },
        }),
        resolveCheckInTimes([bookingId]),
        // How each asset came back, and when it last left. Events carry no org
        // column of their own beyond `organizationId`, so the booking's org
        // scopes them.
        db.activityEvent.findMany({
          where: {
            bookingId,
            organizationId,
            action: {
              in: [...CHECKIN_EVENT_ACTIONS, ...CHECKOUT_EVENT_ACTIONS],
            },
          },
          select: { assetId: true, action: true, occurredAt: true, meta: true },
          orderBy: { occurredAt: "asc" },
        }),
      ]);

    // When each asset last left: the start of the dispatch the receipt prints
    // the return of. An asset with no check-out event (one dispatched before
    // events were recorded) has every check-in event count.
    const latestDispatchAtByAsset = new Map<string, Date>();
    for (const event of dispatchEvents) {
      if (!event.assetId) continue;
      if (
        (CHECKOUT_EVENT_ACTIONS as readonly string[]).includes(event.action)
      ) {
        latestDispatchAtByAsset.set(event.assetId, event.occurredAt);
      }
    }

    // The assets whose latest dispatch bounds which check-in events count.
    // Events name the asset, not the slice, so the boundary holds only for an
    // INDIVIDUAL asset with ONE slice: one unit, one trip per printed row.
    // - With several slices, a later departure of one slice would discard the
    //   other slice's return and lend it the later method.
    // - A QUANTITY_TRACKED row counts the units of every trip
    //   (`checkedOutQuantity` grows on each check-out), so an earlier trip's
    //   return is part of what it prints.
    // Every other asset keeps all its check-in events, and all must agree.
    const sliceCountByAsset = new Map<string, number>();
    const individualAssetIds = new Set<string>();
    for (const slice of slices) {
      sliceCountByAsset.set(
        slice.assetId,
        (sliceCountByAsset.get(slice.assetId) ?? 0) + 1
      );
      if (slice.asset.type === AssetType.INDIVIDUAL) {
        individualAssetIds.add(slice.assetId);
      }
    }
    const dispatchBoundedAssetIds = new Set(
      [...individualAssetIds].filter(
        (assetId) => sliceCountByAsset.get(assetId) === 1
      )
    );

    // The method each asset's check-in events of the current dispatch recorded,
    // in the order they were written. An event without a readable method
    // (written before methods were recorded, or by a phone bundle that declared
    // none) contributes `null`.
    const checkedInHowEventsByAsset = new Map<string, Array<string | null>>();
    for (const event of dispatchEvents) {
      if (!event.assetId) continue;
      if (
        !(CHECKIN_EVENT_ACTIONS as readonly string[]).includes(event.action)
      ) {
        continue;
      }
      const dispatchedAt = latestDispatchAtByAsset.get(event.assetId);
      if (
        dispatchedAt &&
        dispatchBoundedAssetIds.has(event.assetId) &&
        event.occurredAt < dispatchedAt
      ) {
        continue;
      }
      const meta = readBookingMethodMeta(event.meta);
      const phrase =
        meta && meta.method ? describeBookingMethodCapitalised(meta) : null;
      const forAsset = checkedInHowEventsByAsset.get(event.assetId) ?? [];
      forAsset.push(phrase);
      checkedInHowEventsByAsset.set(event.assetId, forAsset);
    }

    // Attribution runs once per ASSET with all four categories together:
    // capacity is shared between them, so a per-category pass would refill each
    // slice for every category and attribute far more than was booked. One
    // asset's rows per call — never two assets' rows in the same call.
    const slicesByAsset = new Map<string, typeof slices>();
    for (const slice of slices) {
      const forAsset = slicesByAsset.get(slice.assetId) ?? [];
      forAsset.push(slice);
      slicesByAsset.set(slice.assetId, forAsset);
    }

    const logsByAsset = new Map<
      string,
      Array<{
        bookingAssetId: string | null;
        category: (typeof CHECKIN_DISPOSITION_CATEGORIES)[number];
        quantity: number;
      }>
    >();
    for (const log of dispositionLogs) {
      const forAsset = logsByAsset.get(log.assetId) ?? [];
      forAsset.push({
        bookingAssetId: log.bookingAssetId ?? null,
        category:
          log.category as (typeof CHECKIN_DISPOSITION_CATEGORIES)[number],
        quantity: log.quantity,
      });
      logsByAsset.set(log.assetId, forAsset);
    }

    const breakdownByBookingAsset = new Map<
      string,
      { returned: number; consumed: number; lost: number; damaged: number }
    >();
    for (const [assetId, assetSlices] of slicesByAsset) {
      const attributed = attributeCategorizedDispositionsByBookingAsset({
        // Capacity is what each slice actually SENT, from the same rule the
        // printed row is measured against — never the booked quantity. Booked
        // quantity is wrong in both directions: it strands a re-dispatched
        // slice's second trip, whose cumulative counter runs above it, and it
        // hands capacity to a slice that never left, so an untagged log lands
        // as a return on a row the sheet calls never checked out.
        bookingAssetRows: assetSlices.map((slice) => ({
          id: slice.id,
          quantity: resolveSentUnits(slice),
          assetKitId: slice.assetKitId,
        })),
        consumptionLogs: logsByAsset.get(assetId) ?? [],
      });
      for (const [sliceId, breakdown] of attributed) {
        breakdownByBookingAsset.set(sliceId, breakdown);
      }
    }

    // Moments and people for the rows the markers cannot date.
    //
    // RETURN logs only. The other three categories record a write-off, not a
    // hand-over: whoever logged a loss received nothing, so they are not a
    // receiver, and on a slice carrying both a later write-off must not date
    // the row after the moment the units actually came back.
    //
    // A log names its slice, or names an asset that has only one. The phone
    // sends quantity dispositions without a slice id, so untagged logs are
    // ordinary current data rather than legacy residue, and refusing them all
    // would leave every mobile partial return with no moment and no receiver.
    // Where the asset has exactly one slice on the booking there is nothing to
    // decide — the log can only describe that slice. Where it has several, the
    // greedy pass that splits the units carries no times, so choosing one would
    // be a guess and the row stays blank.
    const returnRecordsBySlice = new Map<
      string,
      Array<{ at: Date; byId: string }>
    >();
    for (const log of dispositionLogs) {
      if (log.category !== "RETURN") continue;

      const assetSlices = slicesByAsset.get(log.assetId) ?? [];
      const sliceId =
        log.bookingAssetId ??
        (assetSlices.length === 1 ? assetSlices[0].id : null);
      if (!sliceId) continue;

      const forSlice = returnRecordsBySlice.get(sliceId) ?? [];
      forSlice.push({ at: log.createdAt, byId: log.userId });
      returnRecordsBySlice.set(sliceId, forSlice);
    }

    /**
     * The phrase a printed row may carry, resolved per asset.
     *
     * Events name the asset, not the slice, and a row aggregates every unit
     * that came back in the current dispatch. A quantity slice returned in
     * parts by different methods, or an asset whose slices (loose and through a
     * kit) came back by different methods, cannot be described by one phrase,
     * so a phrase is given only when every check-in event that counts agrees;
     * otherwise the rows stay blank rather than lending one return's method to
     * the rest.
     */
    const checkedInHowByAsset = new Map<string, string | null>();
    for (const [assetId, phrases] of checkedInHowEventsByAsset) {
      const distinct = new Set(phrases);
      checkedInHowByAsset.set(assetId, distinct.size === 1 ? phrases[0] : null);
    }

    // Reconcile exactly the slices the sheet prints, in the order it prints
    // them, so the totals can never describe a different set of rows from the
    // table above them. Attribution above deliberately spans every slice: one
    // missing from the print list still holds capacity that untagged logs are
    // attributed against.
    const markersByBookingAssetId = new Map(
      slices.map((slice) => [slice.id, slice])
    );
    const printedSlices = assets.flatMap((asset) => {
      const marker = markersByBookingAssetId.get(asset.bookingAssetId);
      return marker
        ? [
            {
              bookingAssetId: marker.id,
              assetId: marker.assetId,
              assetType: marker.asset.type,
              quantity: marker.quantity,
              checkedOutAt: marker.checkedOutAt,
              checkedOutQuantity: marker.checkedOutQuantity,
              checkedInAt: marker.checkedInAt,
              checkedInById: marker.checkedInById,
              returnRecords: returnRecordsBySlice.get(marker.id),
            },
          ]
        : [];
    });

    const isFinished =
      booking.status === BookingStatus.COMPLETE ||
      booking.status === BookingStatus.ARCHIVED;

    const receipt = buildCheckinReceipt({
      slices: printedSlices,
      breakdownByBookingAsset,
      isBookingFinished: isFinished,
    });

    // The header's departure, return and receivers, read from the reconciled
    // rows rather than the raw markers so it never states more than the rows
    // below it. The departures span every slice, printed or not.
    const moments = resolveReceiptMoments({
      rows: receipt.rows,
      departures: slices,
      completedAt: checkInTimes.get(bookingId) ?? null,
    });

    // Ids read off the booking's own rows, not supplied by the caller.
    const markerUserIds = [
      ...new Set(
        [
          moments.checkedOutById,
          ...slices.map((slice) => slice.checkedInById),
          ...dispositionLogs.map((log) => log.userId),
        ].filter((id): id is string => id !== null)
      ),
    ];
    const markerUsers =
      markerUserIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: markerUserIds } },
            select: { id: true, ...USER_NAME_SELECT },
          })
        : [];
    const nameByUserId = new Map(
      markerUsers.map((user) => [user.id, resolveUserDisplayName(user)])
    );

    const printableAssetsById = new Map(
      assets.map((asset) => [asset.bookingAssetId, asset])
    );
    const rows: CheckinReceiptDbRow[] = receipt.rows.flatMap((row) => {
      const asset = printableAssetsById.get(row.bookingAssetId);
      if (!asset) return [];
      return [
        {
          ...row,
          title: asset.title,
          quantity: asset.quantity,
          kitName: asset.kit?.name ?? null,
          isRemovedFromKit: asset.isRemovedFromKit,
          displayCode: assetIdToDisplayCodeMap[asset.id],
          // A slice returned across several sessions by different people names
          // each of them, in the order they first received something.
          checkedInByName: row.checkedInByIds
            .map((id) => nameByUserId.get(id) ?? "")
            .filter((name) => name !== "")
            .join(", "),
          // Only a checked-in row says how it came back, dated or not; a row
          // still out has no return to describe.
          checkedInHow: isRowCheckedIn(row)
            ? checkedInHowByAsset.get(row.assetId) ?? null
            : null,
        },
      ];
    });

    const plannedTo = resolvePlannedEnd(booking);

    // Lateness is only meaningful once the booking has finished. An OVERDUE
    // booking with a partial check-in still measures against "now", which is
    // not a statement a printed record may make.
    const latenessMs = isFinished
      ? getLatenessMs({
          status: booking.status,
          scheduledEnd: plannedTo,
          checkInAt: moments.returnedAt,
        })
      : null;

    return {
      booking,
      organization,
      rows,
      totals: receipt.totals,
      stamp: receipt.stamp,
      plannedFrom: resolvePlannedStart(booking),
      plannedTo,
      checkedOutAt: moments.checkedOutAt,
      checkedOutByName: moments.checkedOutById
        ? nameByUserId.get(moments.checkedOutById) ?? ""
        : "",
      returnedAt: moments.returnedAt,
      latenessNote: formatLatenessNote(latenessMs),
      checkedInByNames: moments.checkedInByIds
        .map((id) => nameByUserId.get(id) ?? "")
        .filter((name) => name !== ""),
      checkedInHow: summariseCheckinMethods(rows),
    };
  } catch (cause) {
    // A refusal (the caller may not see this booking or its documents) keeps
    // its own 4xx status; only unexpected failures become a 500.
    rethrowIfClientError(cause);
    throw new ShelfError({
      cause,
      message: "Error fetching booking data for the check-in receipt",
      status: 500,
      label: "Booking",
      additionalData: { bookingId, userId },
    });
  }
}
