/**
 * "From location" for quantity custody on the phone.
 *
 * A pool placed at two or more locations is asked, once, where its units
 * come from at the moment they leave: when custody is assigned, and when a
 * booking is checked out. This module turns the server's source data into
 * picker rows and turns a picked row back into the request value. Pure, so
 * the Node test runner can cover it (no React Native imports).
 *
 * @see ../../webapp/app/modules/asset/custody-source.ts the web's twin
 */
import type {
  AssetCustodySourceEntry,
  CheckoutSourceQuestion,
  CustodySourceOption,
} from "./api/types";
import { formatQuantity } from "./quantity-format";

/** Picker value for the unplaced units; sent to the server as `null`. */
export const UNPLACED_SOURCE = "unplaced";
/**
 * Picker value for custody whose source was never recorded; the release
 * endpoint accepts this word as-is.
 */
export const UNRECORDED_SOURCE = "unrecorded";

/** One row of a source picker. */
export type SourcePickerOption = {
  value: string;
  label: string;
  /** Smaller line under the label, e.g. "4 pcs · 1 in custody". */
  hint?: string;
};

/**
 * The assign picker's rows: each location with what sits there and what is
 * already committed, then "Unplaced" when the pool has unplaced units.
 */
export function assignSourceOptions(
  options: CustodySourceOption[],
  unitOfMeasure: string | null | undefined
): SourcePickerOption[] {
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    hint: sourceHint(option, unitOfMeasure),
  }));
}

/**
 * What a source holds and has committed, in the words the web dialog uses:
 * "10 sandbags", "4 sandbags · 1 in custody", "40 boxes · 10 on a booking".
 */
export function sourceHint(
  option: Pick<CustodySourceOption, "placed" | "inCustody" | "onBooking">,
  unitOfMeasure: string | null | undefined
): string {
  const parts = [
    formatQuantity(option.placed, unitOfMeasure) ?? String(option.placed),
  ];
  if (option.inCustody > 0) parts.push(`${option.inCustody} in custody`);
  if (option.onBooking > 0) parts.push(`${option.onBooking} on a booking`);
  return parts.join(" · ");
}

/**
 * The row the assign picker opens on: the location with the most units
 * left (ties go to the earlier one). "Unplaced" is never the default unless
 * every location is empty and the unplaced units still have something left.
 * Null when there are no rows.
 */
export function defaultAssignSource(
  options: CustodySourceOption[]
): CustodySourceOption | null {
  let best: CustodySourceOption | null = null;
  for (const option of options) {
    if (option.locationId === null) continue;
    if (!best || option.left > best.left) best = option;
  }
  if (best && best.left > 0) return best;
  const unplaced = options.find((option) => option.locationId === null);
  return unplaced && unplaced.left > 0 ? unplaced : best;
}

/** The request value for a picked assign row: a location id, or `null` for unplaced. */
export function assignSourceRequestValue(value: string): string | null {
  return value === UNPLACED_SOURCE ? null : value;
}

/**
 * One line under a holder's quantity saying where their units came from:
 * "2 from Camera Room · 1 from Studio", "3 unplaced", "location not
 * recorded". Null when the server sent no sources.
 */
export function describeHolderSources(
  sources: AssetCustodySourceEntry[] | undefined
): string | null {
  if (!sources || sources.length === 0) return null;
  return sources
    .map((entry) => {
      if (entry.unrecorded) return "location not recorded";
      if (entry.locationId === null) return `${entry.quantity} unplaced`;
      return `${entry.quantity} from ${entry.name ?? "Unknown location"}`;
    })
    .join(" · ");
}

/**
 * The release picker's rows for one holder: one per source they took units
 * from, with how many. Only shown when there are two or more.
 */
export function releaseSourceOptions(
  sources: AssetCustodySourceEntry[],
  unitOfMeasure: string | null | undefined
): SourcePickerOption[] {
  return sources.map((entry) => ({
    value: releaseSourceValue(entry),
    label: entry.unrecorded
      ? "Location not recorded"
      : entry.locationId === null
      ? "Unplaced"
      : entry.name ?? "Unknown location",
    hint:
      formatQuantity(entry.quantity, unitOfMeasure) ?? String(entry.quantity),
  }));
}

/** The picker value of a holder's source entry. */
export function releaseSourceValue(entry: AssetCustodySourceEntry): string {
  if (entry.unrecorded) return UNRECORDED_SOURCE;
  return entry.locationId ?? UNPLACED_SOURCE;
}

/**
 * The request value for a picked release row: a location id, `null` for the
 * unplaced units, or the word the server uses for an unrecorded source.
 */
export function releaseSourceRequestValue(value: string): string | null {
  if (value === UNPLACED_SOURCE) return null;
  return value;
}

/**
 * The rows of one check-out question: each location the pool is placed at,
 * then "Unplaced" when the pool has unplaced units.
 */
export function checkoutSourceOptions(
  question: CheckoutSourceQuestion
): SourcePickerOption[] {
  const rows: SourcePickerOption[] = question.placements.map((placement) => ({
    value: placement.locationId,
    label: placement.name,
    hint: sourceHint(placement, question.unitOfMeasure),
  }));
  if (question.unplaced > 0) {
    rows.push({
      value: UNPLACED_SOURCE,
      label: "Unplaced",
      hint:
        formatQuantity(question.unplaced, question.unitOfMeasure) ??
        String(question.unplaced),
    });
  }
  return rows;
}

/**
 * The row a check-out question opens on: the server's own default, else the
 * first location, else "Unplaced".
 */
export function defaultCheckoutSource(
  question: CheckoutSourceQuestion
): string {
  if (question.defaultLocationId) return question.defaultLocationId;
  if (question.placements.length > 0) return question.placements[0].locationId;
  return UNPLACED_SOURCE;
}

/**
 * The `sourceLocations` body for a check-out: one answer per asked slice,
 * "Unplaced" sent as `null`.
 */
export function checkoutSourceAnswers(
  answers: Record<string, string>
): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  for (const [sliceId, value] of Object.entries(answers)) {
    body[sliceId] = assignSourceRequestValue(value);
  }
  return body;
}

/**
 * The questions that apply to a check-out of `assetIds` only (the select
 * path): a question whose pool is not in the selection is not asked.
 */
export function questionsForAssets(
  questions: CheckoutSourceQuestion[] | undefined,
  assetIds: Iterable<string>
): CheckoutSourceQuestion[] {
  if (!questions || questions.length === 0) return [];
  const wanted = new Set(assetIds);
  return questions.filter((question) => wanted.has(question.assetId));
}
