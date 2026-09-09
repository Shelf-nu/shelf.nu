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
 * slice, the completion event, and the users behind the markers.
 *
 * @see {@link file://./checkin-receipt.ts} — the reconciliation rules
 * @see {@link file://./pdf-helpers.ts} — the shared row list
 * @see {@link file://./../../routes/api+/bookings.$bookingId.generate-checkin-receipt.tsx}
 */

import type { OrganizationRoles } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { resolveCheckInTimes } from "~/modules/reports/check-in-time.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { ShelfError } from "~/utils/error";
import { resolveUserDisplayName } from "~/utils/user";
import type {
  CheckinLatenessNote,
  CheckinReceiptRow,
  CheckinReceiptRowAsset,
  CheckinReceiptTotals,
} from "./checkin-receipt";
import { buildCheckinReceipt, formatLatenessNote } from "./checkin-receipt";
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
   * The earliest departure the slice markers still record, and who made it.
   *
   * `BookingAsset.checkedOutAt` holds a slice's CURRENT departure — sending a
   * returned slice out again overwrites it — so on a re-dispatched booking this
   * is the earliest departure still on record, not the first one that ever
   * happened. The sheet labels it "Checked out" for that reason.
   */
  checkedOutAt: Date | null;
  /** Who sent that first slice out; `""` when the marker records none. */
  checkedOutByName: string;
  /** The recorded return moment; `null` when nothing recorded one. */
  returnedAt: Date | null;
  /**
   * How the return compares to the planned end — "on time", "returned early",
   * or "N days M hours after the planned end". `null` when the booking has not
   * finished or nothing recorded a return.
   */
  latenessNote: CheckinLatenessNote | null;
  /** Distinct receiving users, ordered by their first check-in. */
  checkedInByNames: string[];
};

/**
 * Reads a booking's check-in receipt.
 *
 * @param bookingId - The booking to print.
 * @param organizationId - The caller's active workspace; every lookup is scoped
 *   to it.
 * @param userId - The acting user, for the custodian-aware ownership check.
 * @param role - The acting user's role in the workspace.
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
  role: OrganizationRoles | undefined,
  request: Request,
  sortParams?: Pick<SortParams, "orderBy" | "orderDirection">
): Promise<CheckinReceiptDbResult> {
  try {
    const pdfMeta = await fetchAllPdfRelatedData(
      bookingId,
      organizationId,
      userId,
      role,
      request,
      {
        orderBy: sortParams?.orderBy,
        orderDirection: sortParams?.orderDirection,
        // A receipt is a record of the whole booking, so the page's active
        // search must not narrow it.
        search: undefined,
      },
      // The sheet prints the text code only; there is no QR column to fill.
      { includeQrImages: false }
    );

    const { booking, organization, assets, assetIdToDisplayCodeMap } = pdfMeta;

    // `fetchAllPdfRelatedData` strips `bookingAssets` from the booking it
    // returns, and the slice projection behind its rows keeps only the columns
    // the checklist prints — so the markers this sheet is built on need their
    // own read.
    const [slices, dispositionLogs, checkInTimes, checkinSessions] =
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
          },
        }),
        resolveCheckInTimes([bookingId]),
        // Progressive check-in sessions, for slices reconciled before the
        // per-slice markers existed. The completion gate accepts a session at or
        // after a slice's departure as proof an INDIVIDUAL asset came back, so
        // the receipt reads them too — otherwise a booking the gate closed prints
        // as still out.
        db.partialBookingCheckin.findMany({
          where: { bookingId, booking: { organizationId } },
          select: {
            assetIds: true,
            checkinTimestamp: true,
            checkedInById: true,
          },
        }),
      ]);

    // The most recent session naming each asset. Kept as a moment rather than a
    // flag: a slice that departed twice has a session for the first trip whose
    // asset id never leaves the list, and a bare set would let it reconcile the
    // second departure too.
    const latestSessionByAsset = new Map<
      string,
      { at: Date; byId: string | null }
    >();
    for (const session of checkinSessions) {
      if (!session.checkinTimestamp) continue;
      for (const assetId of session.assetIds) {
        const seen = latestSessionByAsset.get(assetId);
        if (!seen || session.checkinTimestamp > seen.at) {
          latestSessionByAsset.set(assetId, {
            at: session.checkinTimestamp,
            byId: session.checkedInById ?? null,
          });
        }
      }
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
        bookingAssetRows: assetSlices.map((slice) => ({
          id: slice.id,
          quantity: slice.quantity,
          assetKitId: slice.assetKitId,
        })),
        consumptionLogs: logsByAsset.get(assetId) ?? [],
      });
      for (const [sliceId, breakdown] of attributed) {
        breakdownByBookingAsset.set(sliceId, breakdown);
      }
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
              sessionCheckedInAt:
                latestSessionByAsset.get(marker.assetId)?.at ?? null,
              sessionCheckedInById:
                latestSessionByAsset.get(marker.assetId)?.byId ?? null,
            },
          ]
        : [];
    });

    const receipt = buildCheckinReceipt({
      slices: printedSlices,
      breakdownByBookingAsset,
    });

    // The earliest departure still on record, and the person who made it. Both
    // come from the same slice: a booking checked out in several passes has
    // several dispatchers, and naming one against another's moment would be a
    // claim nothing recorded.
    const earliestCheckedOutSlice = slices
      .filter((slice) => slice.checkedOutAt !== null)
      .sort(
        (a, b) =>
          (a.checkedOutAt as Date).getTime() -
          (b.checkedOutAt as Date).getTime()
      )[0];

    // Distinct receivers in the order they first received something, taken
    // from the reconciled rows rather than the raw markers so the summary names
    // exactly the people the rows below it name.
    const checkedInUserIdsInOrder = [
      ...new Set(
        receipt.rows
          .filter((row) => row.checkedInAt !== null && row.checkedInById)
          .sort(
            (a, b) =>
              (a.checkedInAt as Date).getTime() -
              (b.checkedInAt as Date).getTime()
          )
          .map((row) => row.checkedInById as string)
      ),
    ];

    // Ids read off the booking's own rows, not supplied by the caller.
    const markerUserIds = [
      ...new Set(
        [
          earliestCheckedOutSlice?.checkedOutById ?? null,
          ...slices.map((slice) => slice.checkedInById),
          ...[...latestSessionByAsset.values()].map((s) => s.byId),
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
          checkedInByName: row.checkedInById
            ? nameByUserId.get(row.checkedInById) ?? ""
            : "",
        },
      ];
    });

    // The recorded return: the status transition into COMPLETE. When no event
    // was written, the latest slice check-in is the closest recorded moment.
    // `Booking.updatedAt` is never a fallback — any later edit moves it.
    const latestSliceCheckIn = slices.reduce<Date | null>((latest, slice) => {
      if (!slice.checkedInAt) return latest;
      return !latest || slice.checkedInAt > latest ? slice.checkedInAt : latest;
    }, null);
    const returnedAt = checkInTimes.get(bookingId) ?? latestSliceCheckIn;

    const plannedTo = resolvePlannedEnd(booking);

    // Lateness is only meaningful once the booking has finished. An OVERDUE
    // booking with a partial check-in still measures against "now", which is
    // not a statement a printed record may make.
    const isFinished =
      booking.status === BookingStatus.COMPLETE ||
      booking.status === BookingStatus.ARCHIVED;
    const latenessMs = isFinished
      ? getLatenessMs({
          status: booking.status,
          scheduledEnd: plannedTo,
          checkInAt: returnedAt,
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
      checkedOutAt: earliestCheckedOutSlice?.checkedOutAt ?? null,
      checkedOutByName: earliestCheckedOutSlice?.checkedOutById
        ? nameByUserId.get(earliestCheckedOutSlice.checkedOutById) ?? ""
        : "",
      returnedAt,
      latenessNote: formatLatenessNote(latenessMs),
      checkedInByNames: checkedInUserIdsInOrder
        .map((id) => nameByUserId.get(id) ?? "")
        .filter((name) => name !== ""),
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Error fetching booking data for the check-in receipt",
      status: 500,
      label: "Booking",
      additionalData: { bookingId, userId },
    });
  }
}
