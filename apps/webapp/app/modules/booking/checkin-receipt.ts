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
 * `checkedInAt` and `checkedInById` are present only when the slice's recorded
 * check-in answers that departure. A slice that never left, or one dispatched
 * again since its return, carries `null` for both rather than a moment that
 * would contradict the row it sits on.
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
  /** The recorded check-in moment, or `null` while units remain out. */
  checkedInAt: Date | null;
  /** The receiving user's id, or `null` when the marker records none. */
  checkedInById: string | null;
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
  "checkedInAt" | "checkedInById"
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

/**
 * The check-in that answers this slice's current departure, or `null`.
 *
 * A check-in only answers a departure, and only the one it followed. Every
 * other marker is left off the sheet: a moment beside a row this receipt calls
 * never checked out claims a return for units that never moved, and a moment
 * from an earlier trip beside a row it calls still out contradicts the row it
 * sits on. Both readings are worse than a blank cell.
 *
 * The slice marker answers first; then, for an INDIVIDUAL slice, the
 * progressive session naming its asset, which is what the completion gate
 * accepts for rows reconciled before the markers existed.
 */
function resolveCheckIn(
  slice: CheckinReceiptSlice,
  isBookingFinished: boolean
): { at: Date; byId: string | null } | null {
  if (!slice.checkedOutAt) {
    return null;
  }
  const departedAt = slice.checkedOutAt.getTime();

  if (slice.checkedInAt && slice.checkedInAt.getTime() >= departedAt) {
    return { at: slice.checkedInAt, byId: slice.checkedInById };
  }

  // Sessions cannot express partial units, so they never settle a quantity
  // slice; its attributed units do that. And on a live booking they cannot be
  // trusted at all: progressive check-out leaves the original departure in
  // place, so a session answering an earlier trip still passes the test above
  // while the units are out again.
  if (slice.assetType === AssetType.QUANTITY_TRACKED || !isBookingFinished) {
    return null;
  }

  const sessionAt = slice.sessionCheckedInAt;
  if (sessionAt && sessionAt.getTime() >= departedAt) {
    return { at: sessionAt, byId: slice.sessionCheckedInById ?? null };
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

  // A moment prints only on a row that is fully accounted for. A quantity slice
  // can carry a stamped marker while units remain unattributed — untagged logs
  // cap at the booked quantity, so a re-dispatched slice can settle its marker
  // and still owe units — and a row that states both a return time and an
  // outstanding count says two things at once. The unit counts are the truth.
  const printsCheckIn = reconciledBy !== null && state === "RETURNED";

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
    checkedInById: printsCheckIn ? reconciledBy.byId : null,
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
