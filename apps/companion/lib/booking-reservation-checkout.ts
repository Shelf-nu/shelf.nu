/**
 * Check-out rules for bookings that hold book-by-model reservations.
 *
 * A booking can reserve units of an asset model before anyone picks the
 * concrete assets; a unit is assigned when a matching asset is scanned onto
 * the booking. Check-out does not wait for that. The only condition on a
 * check-out is that at least one item goes out, and reserved units still
 * unassigned stay open on the booking, to be scanned later or released. The
 * server enforces the same minimum.
 *
 * These helpers decide whether the fulfil scanner can submit, work out which
 * reserved units a scan leaves unassigned, and write the confirm step every
 * check-out path shows before it leaves units unassigned.
 *
 * Pure by design — no React Native, Expo or `@/` imports — so it runs under
 * Node's test runner via tsx.
 *
 * @see {@link file://./../app/(tabs)/scanner.tsx} fulfil and check-out scanners
 * @see {@link file://./../app/(tabs)/bookings/[id].tsx} booking screen
 * @see {@link file://./booking-reservation-checkout.test.ts}
 */
import type { BookingAsset } from "./api/types";

/** A model reservation and how many of its units are still unassigned. */
export type UnassignedReservation = {
  assetModelName: string;
  /** Units still waiting for a concrete asset. */
  outstandingQuantity: number;
};

/** An outstanding reservation, carrying the model a scanned asset must match. */
export type OutstandingReservation = UnassignedReservation & {
  assetModelId: string;
};

/** The scanned-item fields the reservation matcher reads. */
export type ReservationScan = {
  type: "asset" | "kit";
  /** Asset id for type=asset, kit id for type=kit. */
  targetId: string;
  /** Assets only: the asset's model, or null. Absent on older servers. */
  assetModelId?: string | null;
};

/** How a scan list covers a booking's outstanding reservations. */
export type ReservationMatch = {
  /** Scanned assets that each assign one reserved unit. */
  matched: number;
  /** Units the reservations needed before the scan. */
  required: number;
  /** Scanned assets that assign no reserved unit and join the booking as extras. */
  unmatchedIds: Set<string>;
  /** True when the scan leaves no reserved unit unassigned. */
  isComplete: boolean;
  /** Reservations the scan leaves short, in the order they were given. */
  unassigned: UnassignedReservation[];
};

/** Copy for the step that confirms a check-out leaving reserved units unassigned. */
export type UnassignedCheckoutConfirm = {
  title: string;
  message: string;
  /** Label of the button that goes ahead with the check-out. */
  confirmLabel: string;
};

/**
 * Match scanned items against a booking's outstanding model reservations.
 *
 * Each scanned asset assigns one unit of a reservation for its model, capped
 * at that reservation's outstanding quantity; further units of a satisfied
 * model are unmatched. That is how the server assigns them
 * (`materializeModelRequestForAsset` reports `matched: false` once
 * `fulfilledQuantity >= quantity`). Kits carry no model and never match.
 *
 * @param items The scan list, in scan order.
 * @param outstanding Reservations with units still to assign.
 * @returns The match counts and the reservations the scan leaves short.
 */
export function matchScansToReservations(
  items: readonly ReservationScan[],
  outstanding: readonly OutstandingReservation[]
): ReservationMatch {
  const remaining = outstanding.map((r) => ({ ...r }));
  const required = remaining.reduce(
    (sum, r) => sum + Math.max(r.outstandingQuantity, 0),
    0
  );
  const unmatchedIds = new Set<string>();
  let matched = 0;

  for (const item of items) {
    if (item.type !== "asset") continue;
    const modelId = item.assetModelId ?? null;
    const reservation = modelId
      ? remaining.find(
          (r) => r.assetModelId === modelId && r.outstandingQuantity > 0
        )
      : undefined;
    if (reservation) {
      reservation.outstandingQuantity -= 1;
      matched += 1;
    } else {
      unmatchedIds.add(item.targetId);
    }
  }

  const unassigned = remaining
    .filter((r) => r.outstandingQuantity > 0)
    .map((r) => ({
      assetModelName: r.assetModelName,
      outstandingQuantity: r.outstandingQuantity,
    }));

  return {
    matched,
    required,
    unmatchedIds,
    isComplete: unassigned.length === 0,
    unassigned,
  };
}

/**
 * Whether any of a booking's assets still has something to check out.
 *
 * Each row answers for itself; booking-wide arithmetic cannot. A pooled
 * asset's remaining units and its global status are independent, so
 * subtracting whole returned and checked-out assets from the total both hides
 * the answer while units remain (a partial return cancels the row against its
 * own count) and gives it when none do (a spent row whose status is still
 * AVAILABLE). A quantity-tracked row is answered by the booking-scoped count
 * the server sends for it; every other row, and any row from a server that
 * sends no count, by whether it is still on the booking and not yet out.
 *
 * @param assets The booking's asset rows.
 * @param checkedInAssetIds Assets already checked back in on this booking.
 * @returns `true` when at least one row has something left to check out.
 */
export function hasAssetsLeftToCheckOut(
  assets: readonly Pick<
    BookingAsset,
    "id" | "status" | "remainingToCheckOut"
  >[],
  checkedInAssetIds: ReadonlySet<string>
): boolean {
  return assets.some((a) =>
    typeof a.remainingToCheckOut === "number"
      ? a.remainingToCheckOut > 0
      : a.status !== "CHECKED_OUT" && !checkedInAssetIds.has(a.id)
  );
}

/**
 * Whether a fulfil-and-check-out sends at least one item out, which is the
 * only thing the server requires of it.
 *
 * Without the explicit check-out requirement the scanned units AND the items
 * already on the booking go out, so either one is enough. Under the
 * requirement only scanned units go out, since each item must be seen by the
 * operator before it leaves, so the scan alone has to supply one.
 *
 * Unassigned reservations play no part: they stay open on the booking.
 *
 * @param args.scannedAssetCount Assets in the scan list.
 * @param args.hasBookedAssetsLeftToCheckOut Whether the booking already holds
 *   an asset that has not gone out (see {@link hasAssetsLeftToCheckOut}).
 * @param args.requireExplicitCheckout Whether the workspace requires explicit
 *   check-out for the operator's role.
 * @returns `true` when the check-out would send something out.
 */
export function canFulfilCheckOut({
  scannedAssetCount,
  hasBookedAssetsLeftToCheckOut,
  requireExplicitCheckout,
}: {
  scannedAssetCount: number;
  hasBookedAssetsLeftToCheckOut: boolean;
  requireExplicitCheckout: boolean;
}): boolean {
  if (scannedAssetCount > 0) return true;
  return !requireExplicitCheckout && hasBookedAssetsLeftToCheckOut;
}

/**
 * Name the reserved units still unassigned, one entry per model:
 * "2 × Dell Latitude, 1 × HP and 3 × Pelican case". Rows with nothing
 * outstanding are skipped. A booking can reserve dozens of models, so at most
 * `limit` are named and the rest counted ("… and 5 more models").
 *
 * MIRROR of `summarizeUnassignedUnits` in
 * apps/webapp/app/utils/booking-model-requests.ts, which words the same
 * confirmation on the web. Change one, change both. Extraction target:
 * `@shelf/labels`.
 *
 * @param reservations Reservations and their outstanding counts.
 * @param limit Most models to name before counting the rest.
 * @returns The list, or an empty string when nothing is outstanding.
 */
export function formatUnassignedReservations(
  reservations: readonly UnassignedReservation[],
  limit = 5
): string {
  const open = reservations.filter((r) => r.outstandingQuantity > 0);
  const named = open
    .slice(0, limit)
    .map((r) => `${r.outstandingQuantity} × ${r.assetModelName}`);
  const rest = open.length - named.length;
  const parts =
    rest > 0 ? [...named, `${rest} more model${rest === 1 ? "" : "s"}`] : named;

  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The confirm step for a check-out that leaves reserved units unassigned.
 *
 * MIRROR of the unassigned-units confirmation in
 * apps/webapp/app/components/booking/checkout-dialog.tsx: same title, body and
 * button. The server does not depend on it; it is copy only.
 *
 * Rows with nothing outstanding are skipped, so a booking's whole model
 * request list can be passed as it is.
 *
 * @param reservations Reservations and their outstanding counts.
 * @returns The copy to show, or `null` when no unit would stay unassigned and
 *   the check-out needs no extra confirmation.
 */
export function unassignedCheckoutConfirm(
  reservations: readonly UnassignedReservation[]
): UnassignedCheckoutConfirm | null {
  const list = formatUnassignedReservations(reservations);
  if (list === "") return null;

  const units = reservations.reduce(
    (sum, r) => sum + Math.max(r.outstandingQuantity, 0),
    0
  );
  const message =
    units === 1
      ? `${list} is not assigned yet. It stays on the booking so you can scan it later or release it.`
      : `${list} are not assigned yet. They stay on the booking so you can scan them later or release them.`;

  return {
    title: "Some reserved units aren't assigned",
    message,
    confirmLabel: "Check out anyway",
  };
}

/** A booking's model reservation, as the booking endpoint sends it. */
export type BookingModelRequestRow = {
  assetModelId: string;
  assetModelName: string;
  /** Units of this model with no concrete asset behind them yet. */
  outstandingQuantity: number;
  /** Set once every unit has been assigned. */
  fulfilledAt: string | null;
};

/**
 * The reservations a scan can still assign a unit of, from a booking payload.
 *
 * Both halves are required: `fulfilledAt` is the completion stamp, and
 * `outstandingQuantity` is the work left. A row satisfying one but not the
 * other has nothing to assign and would render "0 × Model".
 *
 * @param rows The booking's reservations; absent on an older server.
 * @returns One entry per reservation with units left, in the order given.
 */
export function toOutstandingReservations(
  rows: readonly BookingModelRequestRow[] | undefined | null
): OutstandingReservation[] {
  return (rows ?? [])
    .filter((r) => r.fulfilledAt === null && r.outstandingQuantity > 0)
    .map((r) => ({
      assetModelId: r.assetModelId,
      assetModelName: r.assetModelName,
      outstandingQuantity: r.outstandingQuantity,
    }));
}

/** What a fulfil-and-check-out sent out, as the operator is told it. */
export type FulfilOutcome = {
  /** Scanned units that assigned a reserved unit. */
  assigned: number;
  /** Scanned assets that assigned nothing and joined the booking as extras. */
  extras: number;
  /** Booked assets the server reports as still to check out. */
  remaining: number;
  /** The booking's name, quoted when the whole booking went out. */
  bookingName: string;
};

/**
 * Report a finished check-out, naming assigned units and extras separately.
 *
 * The submit carries both — units that answer a reservation and scans that
 * merely join the booking — and the scanner's own button names the two halves,
 * so one combined total would contradict it and hide that a unit was never
 * reserved.
 *
 * @param outcome See {@link FulfilOutcome}.
 * @returns The message to show.
 */
export function describeFulfilCheckout({
  assigned,
  extras,
  remaining,
  bookingName,
}: FulfilOutcome): string {
  const units = function plural(n: number, noun: string) {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
  };
  const parts: string[] = [];
  if (assigned > 0) parts.push(`Assigned ${units(assigned, "unit")}`);
  if (extras > 0) {
    parts.push(
      assigned > 0
        ? `added ${units(extras, "extra")}`
        : `Added ${units(extras, "extra")}`
    );
  }
  const lead = parts.join(", ");

  if (remaining > 0) {
    const pronoun = assigned + extras === 1 ? "it" : "them";
    return `${lead} and checked ${pronoun} out. ${remaining} more asset${
      remaining === 1 ? " is" : "s are"
    } still to check out.`;
  }
  return `${lead} and checked out "${bookingName || "the booking"}".`;
}
