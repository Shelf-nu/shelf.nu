/**
 * "From location" for quantity custody on the phone.
 *
 * A pool placed at two or more locations is asked, once, where its units
 * come from at the moment they leave: when custody is assigned, and when a
 * booking is checked out. This module turns the server's source data into
 * picker rows and turns a picked row back into the request value. Pure, so
 * the Node test runner can cover it (no React Native imports).
 *
 * The picker values, the assign default and the source wording come from
 * `@shelf/quantity-control`, which the web dialogs read too, so both apps
 * pre-select the same location and describe a source in the same words. This
 * file only adds the phone's row shape around them.
 *
 * @see ../../../packages/quantity-control/src/custody-source.ts
 */
import {
  custodySourceKey,
  describeCustodySourceParts,
  sourceCommitmentParts,
  sourceEntryLabel,
  UNPLACED_SOURCE,
} from "@shelf/quantity-control";

import type {
  AssetCustodySourceEntry,
  CheckoutSourceQuestion,
  CustodySourceOption,
} from "./api/types";
import { formatQuantity } from "./quantity-format";

export {
  defaultAssignSourceOption,
  UNPLACED_SOURCE,
  UNRECORDED_SOURCE,
} from "@shelf/quantity-control";

/**
 * Release picker value for "every source, in the server's fixed order". It
 * is never sent: a release without a `locationId` draws the holder's rows the
 * way it always has. Location ids are cuids, so the word cannot collide.
 */
export const ALL_SOURCES = "all";

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
  return [
    formatQuantity(option.placed, unitOfMeasure) ?? String(option.placed),
    ...sourceCommitmentParts(option),
  ].join(" · ");
}

/** The request value for a picked assign row: a location id, or `null` for unplaced. */
export function assignSourceRequestValue(value: string): string | null {
  return value === UNPLACED_SOURCE ? null : value;
}

/**
 * One line under a holder's quantity saying where their units came from, in
 * the web's words: "from Studio" for one source, "2 from Camera Room · 1 from
 * Studio" for several, "3 unplaced", "4 location not recorded". Null when the
 * server sent no sources.
 */
export function describeHolderSources(
  sources: AssetCustodySourceEntry[] | undefined
): string | null {
  if (!sources || sources.length === 0) return null;
  return describeCustodySourceParts(sources)
    .map((part) => part.text)
    .join(" · ");
}

/** The picker value of a holder's source entry. */
export function releaseSourceValue(entry: AssetCustodySourceEntry): string {
  return custodySourceKey({
    locationId: entry.locationId,
    sourceUnknown: entry.unrecorded,
  });
}

/**
 * Whether a holder's release asks which source the units go back from: only
 * when they took units from two or more. With one source there is nothing to
 * choose, and the release is sent without a `locationId`.
 */
export function releaseAsksForSource(
  sources: AssetCustodySourceEntry[] | undefined
): sources is AssetCustodySourceEntry[] {
  return (sources?.length ?? 0) > 1;
}

/**
 * The release picker's rows for a holder with two or more sources: "All
 * sources" first (their whole hold, the default), then one row per source
 * with how many they took from it.
 */
export function releaseSourceOptions(
  sources: AssetCustodySourceEntry[],
  unitOfMeasure: string | null | undefined
): SourcePickerOption[] {
  const total = sources.reduce((sum, entry) => sum + entry.quantity, 0);
  return [
    {
      value: ALL_SOURCES,
      label: "All sources",
      hint: formatQuantity(total, unitOfMeasure) ?? String(total),
    },
    ...sources.map((entry) => ({
      value: releaseSourceValue(entry),
      label: sourceEntryLabel(entry),
      hint:
        formatQuantity(entry.quantity, unitOfMeasure) ?? String(entry.quantity),
    })),
  ];
}

/**
 * The request value for a picked release row: a location id, `null` for the
 * unplaced units, the word the server uses for an unrecorded source, or
 * `undefined` for {@link ALL_SOURCES}, which sends no `locationId` at all.
 */
export function releaseSourceRequestValue(
  value: string
): string | null | undefined {
  if (value === ALL_SOURCES) return undefined;
  if (value === UNPLACED_SOURCE) return null;
  return value;
}

/**
 * Units a picked release row can give back: the holder's whole hold for
 * {@link ALL_SOURCES}, else what they took from that source. Null when the
 * row no longer exists (a refetch dropped it).
 */
export function releaseSourceQuantity(
  sources: AssetCustodySourceEntry[],
  value: string
): number | null {
  if (value === ALL_SOURCES) {
    return sources.reduce((sum, entry) => sum + entry.quantity, 0);
  }
  const entry = sources.find((source) => releaseSourceValue(source) === value);
  return entry ? entry.quantity : null;
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
 * The row a check-out question opens on: the server's own default. A null
 * default means the unplaced units (every location is empty but unplaced
 * units are left), so that row is picked, not the first location. Only a
 * question with neither falls back to the first location.
 */
export function defaultCheckoutSource(
  question: CheckoutSourceQuestion
): string {
  if (question.defaultLocationId) return question.defaultLocationId;
  if (question.unplaced > 0) return UNPLACED_SOURCE;
  if (question.placements.length > 0) return question.placements[0].locationId;
  return UNPLACED_SOURCE;
}

/**
 * The `sourceLocations` body for a check-out: the answers the operator
 * changed, "Unplaced" sent as `null`. A row left on its pre-selected default
 * is not sent, so the server records its own default from the state at
 * check-out time rather than a value that may be a minute old.
 */
export function checkoutSourceAnswers(
  answers: Record<string, string>,
  touched: Iterable<string>
): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  for (const sliceId of touched) {
    const value = answers[sliceId];
    if (value === undefined) continue;
    body[sliceId] = assignSourceRequestValue(value);
  }
  return body;
}

/**
 * One pool a check-out sends out. `bookingAssetId` names the slice when the
 * client knows it; `quantity` left out means every unit still to go out (a
 * bare asset id, as the Scan tab sends it).
 */
export type CheckoutClaim = {
  assetId: string;
  bookingAssetId?: string | null;
  quantity?: number;
};

/**
 * The questions a check-out of `claims` asks, each carrying the units that
 * actually leave from its slice.
 *
 * A question belongs to a pool's standalone slice that has not gone out yet.
 * A claim tagged with that slice reaches it in full. An untagged claim fills
 * the standalone slice before any kit slice (the server's
 * `compareSlicesForGreedyFill` order), so it reaches the question's slice up
 * to that slice's size. A claim tagged with another slice never reaches it.
 * A question nothing reaches is not asked.
 */
export function questionsForCheckouts(
  questions: CheckoutSourceQuestion[] | undefined,
  claims: Iterable<CheckoutClaim>
): CheckoutSourceQuestion[] {
  if (!questions || questions.length === 0) return [];
  const list = [...claims];
  const asked: CheckoutSourceQuestion[] = [];
  for (const question of questions) {
    let leaving = 0;
    for (const claim of list) {
      if (claim.assetId !== question.assetId) continue;
      if (claim.bookingAssetId && claim.bookingAssetId !== question.sliceId) {
        continue;
      }
      leaving += claim.quantity ?? question.quantity;
    }
    const quantity = Math.min(leaving, question.quantity);
    if (quantity > 0) asked.push({ ...question, quantity });
  }
  return asked;
}
