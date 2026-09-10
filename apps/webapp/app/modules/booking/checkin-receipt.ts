/**
 * Check-in Receipt Reconciliation
 *
 * Turns a booking's `BookingAsset` slices — plus the disposition units already
 * attributed to each of them — into the per-row states, the totals block and
 * the status stamp that the printed check-in receipt shows.
 *
 * Pure: no database, no date formatting, no React. The server helper does the
 * reading and the attribution and hands the result here, so every rule below is
 * unit-testable on its own.
 *
 * **The reference is the completion gate in `checkinBooking`**, which decides
 * whether a booking may close: it judges a slice by its own markers and by the
 * stored `checkedOutQuantity` counter. The booking page's progress bar answers a
 * different question — it derives "sent" from scan sessions and therefore reads
 * 0 for a booking checked out with the button. The receipt is the paper form of
 * what the gate judged, so it must not be aligned to the bar.
 *
 * @see {@link file://./checkin-receipt.server.ts}
 * @see {@link file://./service.server.ts} — `checkinBooking`'s completion gate
 * @see {@link file://./../../components/booking/booking-checkin-receipt-pdf.tsx}
 */

import { AssetType } from "@prisma/client";

import type { ResolvedDisplayCode } from "~/modules/barcode/display";
import { COMPLIANCE_GRACE_PERIOD_MS, formatOverdueDuration } from "./lateness";

/**
 * Units attributed to one slice, split by what happened to them.
 *
 * Structurally the `DispositionCategoryBreakdown` produced by
 * `attributeCategorizedDispositionsByBookingAsset`. Restated here so this
 * module stays free of the `.server` import that would drag the whole booking
 * service into a pure file.
 */
export type CheckinReceiptDispositionBreakdown = {
  returned: number;
  consumed: number;
  lost: number;
  damaged: number;
};

/**
 * One booked slice, as the receipt judges it.
 *
 * `quantity` is THIS slice's booked units (an INDIVIDUAL slice is 1), and
 * `checkedOutQuantity` is the cumulative counter of units ever dispatched on
 * it — never decremented, so a slice sent out twice carries more than it
 * booked.
 */
export type CheckinReceiptSlice = {
  /** `BookingAsset.id` — the receipt row's identity. */
  bookingAssetId: string;
  assetId: string;
  /** Decides which of the two reconciliation rules below applies. */
  assetType: AssetType;
  /** THIS slice's booked units. */
  quantity: number;
  /** When this slice was last dispatched; `null` means it never went out. */
  checkedOutAt: Date | null;
  /** Cumulative units dispatched on this slice. */
  checkedOutQuantity: number | null;
  /** When this slice was last fully reconciled. */
  checkedInAt: Date | null;
  /**
   * Who received it. NULL beside a set `checkedInAt` on rows whose markers were
   * backfilled, so a renderer prints a blank here — never the custodian, the
   * printing user, or any other substitute name.
   */
  checkedInById: string | null;
  /**
   * The most recent progressive check-in session naming this slice's ASSET, for
   * rows reconciled before the per-slice markers existed.
   *
   * The completion gate accepts such a session as proof an INDIVIDUAL asset
   * came back, so the receipt has to read it too or a legacy booking the gate
   * closed prints as still out. Sessions are asset-grained and cannot express
   * partial units, so they answer for INDIVIDUAL slices only; a quantity slice
   * is settled by its attributed units instead.
   */
  sessionCheckedInAt?: Date | null;
  /** Who ran that session. */
  sessionCheckedInById?: string | null;
  /**
   * Tagged RETURN entries naming THIS slice, in the order they were written.
   *
   * A quantity slice returned in part keeps `checkedInAt` null, because that
   * marker means fully reconciled, so its units come back with no marker to
   * date them. The log that recorded those units carries the moment and the
   * person, and that is a record rather than a substitution.
   *
   * Returns only. A consumed, lost or damaged unit was written off rather than
   * handed over, so the person who logged it received nothing and must not
   * appear as a receiver — and a later write-off must not date the row after
   * the units actually came back.
   *
   * A log qualifies when it names the slice, or when it names an asset that has
   * only one slice on the booking and so can mean nothing else. Where an asset
   * has several slices an untagged log is split between them by a greedy pass
   * that carries no times, and choosing one would be a guess.
   */
  returnRecords?: Array<{ at: Date; byId: string }>;
};

/**
 * What the row's "Returned" cell states.
 *
 * - `NEVER_CHECKED_OUT` — nothing left on this slice, so there is nothing to
 *   reconcile. It is not missing.
 * - `RETURNED` — every dispatched unit is accounted for, whether it came back,
 *   was consumed, or was written off as lost or damaged.
 * - `STILL_OUT` — units remain unaccounted for.
 */
export type CheckinReceiptRowState =
  | "NEVER_CHECKED_OUT"
  | "RETURNED"
  | "STILL_OUT";

/**
 * One printed line of the items table.
 *
 * The counts are UNITS, not rows: a QUANTITY_TRACKED slice reports every unit it
 * moved, and an INDIVIDUAL slice reports 1 or 0. `sent` is what left on the
 * departure the slice is on now, and the four disposition counts plus
 * `stillOut` always add back up to it.
 *
 * `checkedInAt` and `checkedInByIds` carry what dated this row's return, from
 * the slice marker, a progressive session, or the disposition logs naming the
 * slice. A slice that never left, or one dispatched again since its return,
 * carries nothing rather than a moment that would contradict the row it sits
 * on.
 */
export type CheckinReceiptRow = {
  bookingAssetId: string;
  assetId: string;
  /** `true` when the counts below are units rather than a single item. */
  isQuantityTracked: boolean;
  state: CheckinReceiptRowState;
  /** Units this slice sent out. An INDIVIDUAL slice sends 1 or 0. */
  sent: number;
  returned: number;
  consumed: number;
  lost: number;
  damaged: number;
  /** `sent` minus everything accounted for, floored at 0. */
  stillOut: number;
  /** The recorded check-in moment, or `null` when nothing dates this row. */
  checkedInAt: Date | null;
  /**
   * The receiving users, in the order they first received something. Usually
   * one; a slice returned across several sessions by different people names
   * each of them. Empty when nothing recorded a receiver.
   */
  checkedInByIds: string[];
};

/** The ledger printed under the items table. Every line prints, zeros included. */
export type CheckinReceiptTotals = {
  /** Rows on the sheet, not units. */
  itemsBooked: number;
  unitsSentOut: number;
  returned: number;
  consumed: number;
  lost: number;
  damaged: number;
  stillOut: number;
};

/** Everything the printed sheet derives from the slice markers. */
export type CheckinReceipt = {
  rows: CheckinReceiptRow[];
  totals: CheckinReceiptTotals;
  /**
   * The line printed in the header's stamp box. The only place on the sheet
   * where completeness is stated — there is no status row.
   */
  stamp: string;
};

/** Plural-aware "3 days" / "1 hour" for the lateness note's duration. */
function durationUnit(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

/** How a return compares to the planned end, as the Returned row states it. */
export type CheckinLatenessNote = {
  text: string;
  /** `true` only past the grace period; the sheet marks a late return. */
  isLate: boolean;
};

/**
 * States how a return compares to the planned end, for the Returned row.
 *
 * The same 15-minute grace the Booking Compliance report applies, so the sheet
 * and the report can never disagree about whether a booking was on time. A
 * close earlier than the grace allows is stated as early rather than as a
 * negative lateness.
 *
 * The wording carries no verb, because the row it sits on is labelled
 * "Returned" only when units actually came back and "Accounted for" otherwise.
 *
 * The duration prints its two most significant non-zero units. A receipt states
 * how late a return was, not a stopwatch reading, and a lateness past the grace
 * period is at least fifteen minutes — so there is always a unit to print.
 *
 * @param latenessMs - Lateness as `getLatenessMs` measures it, or `null` when
 *   the booking has not finished or nothing recorded a return.
 * @returns The note to append to the Returned row, or `null` when there is
 *   nothing measurable to say.
 */
export function formatLatenessNote(
  latenessMs: number | null
): CheckinLatenessNote | null {
  if (latenessMs === null) {
    return null;
  }

  if (Math.abs(latenessMs) <= COMPLIANCE_GRACE_PERIOD_MS) {
    return { text: "on time", isLate: false };
  }

  if (latenessMs < 0) {
    return { text: "early", isLate: false };
  }

  const { days, hours, minutes } = formatOverdueDuration(latenessMs);
  const parts = [
    days > 0 ? durationUnit(days, "day") : null,
    hours > 0 ? durationUnit(hours, "hour") : null,
    minutes > 0 ? durationUnit(minutes, "minute") : null,
  ].filter((part): part is string => part !== null);

  return {
    text: `${parts.slice(0, 2).join(" ")} after the planned end`,
    isLate: true,
  };
}

/**
 * The asset facts each printed row carries beside its reconciliation.
 *
 * All of them come from the booking checklist's row list, so the two sheets
 * name, group and identify a slice the same way.
 */
export type CheckinReceiptRowAsset = {
  title: string;
  /** THIS slice's booked units. */
  quantity: number;
  /** The kit this slice was booked under, when it came from one. */
  kitName: string | null;
  /** `true` when the slice's kit no longer contains it. */
  isRemovedFromKit: boolean;
  /** The code the workspace shows for this asset on screen. */
  displayCode: ResolvedDisplayCode | undefined;
  /**
   * The receiving user's display name, or `""` when the marker records none.
   * Never substituted with the custodian or the printing user.
   */
  checkedInByName: string;
};

/**
 * A printed row on the wire: the check-in moment is already a formatted date,
 * and the receiving user is a name. The user's id stays on the server — the
 * sheet prints the name and nothing links back to the account.
 */
export type CheckinReceiptViewRow = Omit<
  CheckinReceiptRow,
  "checkedInAt" | "checkedInByIds"
> &
  CheckinReceiptRowAsset & {
    /** The recorded check-in moment in the printing user's format. */
    checkedInOn: string | null;
  };

/**
 * The booking facts the sheet's header and key-value block print.
 *
 * Deliberately narrower than the booking row the server reads: only what the
 * sheet shows crosses the wire. Both custodian shapes are carried because the
 * sheet resolves the custodian name with the same expression the booking
 * checklist uses, so the two documents can never name a different person.
 */
export type CheckinReceiptViewBooking = {
  id: string;
  name: string;
  description: string | null;
  custodianUser: {
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
  custodianTeamMember: { name: string } | null;
  tags: Array<{ id: string; name: string }>;
};

/**
 * The whole sheet as the API loader sends it.
 *
 * Every moment on it is already a string, formatted once on the server in the
 * printing user's date format — the sheet itself does no date work beyond the
 * "Printed" line, which is the moment the paper leaves the printer.
 */
export type CheckinReceiptView = {
  booking: CheckinReceiptViewBooking;
  organization: {
    name: string;
    imageId: string | null;
    /** Cache key for the workspace logo. */
    updatedAt: string;
  };
  rows: CheckinReceiptViewRow[];
  totals: CheckinReceiptTotals;
  /** The completeness line printed in the header's stamp box. */
  stamp: string;
  /** The agreed period, never the live one. `null` when neither end is set. */
  plannedFrom: string | null;
  plannedTo: string | null;
  /** The first moment anything left on this booking. */
  checkedOutAt: string | null;
  /** Who sent that first slice out; `""` when the marker records none. */
  checkedOutByName: string;
  /** The recorded return moment; `null` when nothing recorded one. */
  returnedAt: string | null;
  /** How that return compares to the planned end. */
  latenessNote: CheckinLatenessNote | null;
  /** Distinct receiving users, ordered by their first check-in. */
  checkedInByNames: string[];
};

/** Arguments for {@link buildCheckinReceipt}. */
export type BuildCheckinReceiptArgs = {
  /** The booking's slices, in the order the sheet prints them. */
  slices: CheckinReceiptSlice[];
  /**
   * Whether the booking has finished (COMPLETE or ARCHIVED).
   *
   * Gates the legacy-session fallback. Progressive check-out keeps a slice's
   * ORIGINAL `checkedOutAt` and only clears the check-in pair, so on a live
   * booking a session from an earlier trip still sorts at or after the recorded
   * departure and would read as a return for units that are out right now. A
   * finished booking has already passed the completion gate, which is what
   * makes the fallback safe there and nowhere else.
   */
  isBookingFinished: boolean;
  /**
   * Disposition units per `BookingAsset.id`, already attributed across each
   * asset's slices with capacity shared between the four categories. A slice
   * with no entry has had nothing attributed to it and counts as all zeros.
   */
  breakdownByBookingAsset: Map<string, CheckinReceiptDispositionBreakdown>;
};

const NO_DISPOSITIONS: CheckinReceiptDispositionBreakdown = {
  returned: 0,
  consumed: 0,
  lost: 0,
  damaged: 0,
};

/** What dated a row's return, and who it names. */
type ResolvedCheckIn = {
  at: Date;
  /** Receivers in the order they first received something. */
  byIds: string[];
  /**
   * `true` when the moment came from disposition logs, which date only the
   * units they record. A marker or a session dates the whole slice, so those
   * print only once every unit is accounted for; a log prints as soon as it
   * exists, because it is the record of the units already back.
   */
  datesRecordedUnits: boolean;
};

/** Distinct ids in first-seen order, dropping empties. */
function distinctInOrder(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * What dated this row's return, or `null` when nothing did.
 *
 * Three records can answer, in order of how directly they speak for the slice.
 *
 * 1. The slice marker, which means fully reconciled.
 * 2. For an INDIVIDUAL slice on a finished booking, the progressive session
 *    naming its asset — what the completion gate accepts for rows reconciled
 *    before the markers existed.
 * 3. For a QUANTITY_TRACKED slice, the RETURN logs that name it. Units
 *    returned in part never set the marker, so without this a partial return
 *    prints with no date and no name against it. Write-offs are excluded: a
 *    consumed, lost or damaged unit was not handed to anybody.
 *
 * The first two are held to the departure they claim to answer: a moment beside
 * a row this receipt calls never checked out claims a return for units that
 * never moved, and one from an earlier trip beside a row it calls still out
 * contradicts the row it sits on.
 *
 * Tier 3 is not, deliberately. The attributed unit counts beside it span every
 * log on the slice regardless of trip, so filtering the moment by departure
 * would date a different set of units from the one the row reports.
 */
function resolveCheckIn(
  slice: CheckinReceiptSlice,
  isBookingFinished: boolean
): ResolvedCheckIn | null {
  if (!slice.checkedOutAt) {
    return null;
  }
  const departedAt = slice.checkedOutAt.getTime();

  if (slice.checkedInAt && slice.checkedInAt.getTime() >= departedAt) {
    return {
      at: slice.checkedInAt,
      byIds: distinctInOrder([slice.checkedInById]),
      datesRecordedUnits: false,
    };
  }

  if (slice.assetType === AssetType.QUANTITY_TRACKED) {
    // Sessions cannot express partial units, so they never settle a quantity
    // slice. Its return logs can, and they carry both the moment and the
    // person.
    const records = slice.returnRecords ?? [];
    if (records.length === 0) {
      return null;
    }
    const latest = records.reduce((newest, record) =>
      record.at > newest.at ? record : newest
    );
    return {
      at: latest.at,
      byIds: distinctInOrder(
        [...records]
          .sort((a, b) => a.at.getTime() - b.at.getTime())
          .map((record) => record.byId)
      ),
      datesRecordedUnits: true,
    };
  }

  // On a live booking a session cannot be trusted at all: progressive
  // check-out leaves the original departure in place, so one answering an
  // earlier trip still passes the test above while the units are out again.
  if (!isBookingFinished) {
    return null;
  }

  const sessionAt = slice.sessionCheckedInAt;
  if (sessionAt && sessionAt.getTime() >= departedAt) {
    return {
      at: sessionAt,
      byIds: distinctInOrder([slice.sessionCheckedInById]),
      datesRecordedUnits: false,
    };
  }

  return null;
}

/** The columns {@link resolveSentUnits} reads. */
export type SentUnitsFields = {
  /** THIS slice's booked units. */
  quantity: number;
  /** When the slice was last dispatched; `null` means it never went out. */
  checkedOutAt: Date | null;
  /** Cumulative units dispatched on the slice. */
  checkedOutQuantity: number | null;
};

/**
 * Units a slice sent out on its current trip.
 *
 * The cumulative counter when it holds anything — it is only ever incremented
 * on dispatch, so a positive counter is itself proof units left; otherwise the
 * whole booked quantity for a slice whose marker is stamped, which is what a
 * stamped row with a zero counter means; otherwise nothing, because neither
 * record says anything left.
 *
 * This is also the capacity a slice may absorb when untagged disposition logs
 * are attributed. Sizing that from the booked quantity instead lets a return
 * land on a slice that never went out, which puts returned units on a row the
 * sheet calls never checked out. One definition, so the two cannot drift.
 */
export function resolveSentUnits(slice: SentUnitsFields): number {
  const counted = slice.checkedOutQuantity ?? 0;
  if (counted > 0) {
    return counted;
  }
  return slice.checkedOutAt ? slice.quantity : 0;
}

/** Reconciles one slice into the row the sheet prints for it. */
function buildRow(
  slice: CheckinReceiptSlice,
  breakdownByBookingAsset: Map<string, CheckinReceiptDispositionBreakdown>,
  isBookingFinished: boolean
): CheckinReceiptRow {
  const isQuantityTracked = slice.assetType === AssetType.QUANTITY_TRACKED;
  const dispositions =
    breakdownByBookingAsset.get(slice.bookingAssetId) ?? NO_DISPOSITIONS;

  const sent = isQuantityTracked
    ? resolveSentUnits(slice)
    : slice.checkedOutAt
    ? 1
    : 0;

  const reconciledBy = resolveCheckIn(slice, isBookingFinished);
  const isReconciledHere = reconciledBy !== null;

  // An INDIVIDUAL slice carries no disposition units: its whole obligation is
  // the one item, and the markers alone say whether it came back.
  const returned = isQuantityTracked
    ? dispositions.returned
    : isReconciledHere
    ? 1
    : 0;
  const consumed = isQuantityTracked ? dispositions.consumed : 0;
  const lost = isQuantityTracked ? dispositions.lost : 0;
  const damaged = isQuantityTracked ? dispositions.damaged : 0;

  const stillOut = Math.max(0, sent - (returned + consumed + lost + damaged));

  const state: CheckinReceiptRowState =
    sent === 0 ? "NEVER_CHECKED_OUT" : stillOut > 0 ? "STILL_OUT" : "RETURNED";

  // A marker or a session dates the whole slice, so it prints only once every
  // unit it sent is accounted for — otherwise the row states a return time
  // beside an outstanding count and says two things at once. A disposition log
  // dates only the units it records, so it prints as soon as it exists: on a
  // partly-returned row it is the moment the units already back came back.
  const printsCheckIn =
    reconciledBy !== null &&
    (reconciledBy.datesRecordedUnits || state === "RETURNED");

  return {
    bookingAssetId: slice.bookingAssetId,
    assetId: slice.assetId,
    isQuantityTracked,
    state,
    sent,
    returned,
    consumed,
    lost,
    damaged,
    stillOut,
    checkedInAt: printsCheckIn ? reconciledBy.at : null,
    checkedInByIds: printsCheckIn ? reconciledBy.byIds : [],
  };
}

/**
 * Reconciles a booking's slices into the printed check-in receipt.
 *
 * @param args - The booking's slices and the disposition units attributed to
 *   each of them.
 * @returns One row per slice in the order given, the totals ledger, and the
 *   status stamp.
 */
export function buildCheckinReceipt(
  args: BuildCheckinReceiptArgs
): CheckinReceipt {
  const { slices, breakdownByBookingAsset, isBookingFinished } = args;

  const rows = slices.map((slice) =>
    buildRow(slice, breakdownByBookingAsset, isBookingFinished)
  );

  const totals = rows.reduce<CheckinReceiptTotals>(
    (sum, row) => ({
      itemsBooked: sum.itemsBooked + 1,
      unitsSentOut: sum.unitsSentOut + row.sent,
      returned: sum.returned + row.returned,
      consumed: sum.consumed + row.consumed,
      lost: sum.lost + row.lost,
      damaged: sum.damaged + row.damaged,
      stillOut: sum.stillOut + row.stillOut,
    }),
    {
      itemsBooked: 0,
      unitsSentOut: 0,
      returned: 0,
      consumed: 0,
      lost: 0,
      damaged: 0,
      stillOut: 0,
    }
  );

  // The word "return" appears on this sheet only where units actually came
  // back. Four things this line must never say.
  //
  // A booking nothing ever left on has no return to state either way: saying
  // everything came back would put a return on paper that never happened, and
  // archiving a reserved booking reaches this sheet exactly that way.
  //
  // A unit written off as consumed, lost or damaged is accounted for but was
  // not returned. Nothing is outstanding, yet "all items returned" printed over
  // a ledger reading "Lost 6" is a false claim on a document that gets signed
  // and attached to a claim.
  //
  // Units outstanding with nothing returned is not a partial return either. The
  // outstanding count is the fact worth leading with, and the sentence in front
  // of it has to match the ledger below.
  //
  // The outstanding count is units rather than rows: an INDIVIDUAL item counts
  // 1, a quantity slice counts every unit it still owes.
  const anyReturned = totals.returned > 0;
  const stamp =
    totals.unitsSentOut === 0
      ? "Nothing was checked out"
      : totals.stillOut > 0
      ? anyReturned
        ? `Partial return · ${totals.stillOut} still out`
        : `Nothing returned · ${totals.stillOut} still out`
      : totals.returned === totals.unitsSentOut
      ? "All items returned"
      : "All items accounted for";

  return { rows, totals, stamp };
}
