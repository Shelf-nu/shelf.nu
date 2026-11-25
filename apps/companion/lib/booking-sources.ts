/**
 * Pool sources on the booking screen.
 *
 * A standalone slice of a quantity-tracked pool plans its units from one or
 * more sources (locations, Unplaced, Unknown, or "Needs a location"). The
 * server sends them as `slices[].sources`; this module turns them into the
 * line the booking row prints and decides what the booked-quantity sheet
 * offers. Pure, so the Node test runner can cover it (no React Native
 * imports).
 *
 * The words come from `@shelf/quantity-control` (`describeSourceLine`), which
 * the web booking PDF reads too, so both apps describe a split the same way:
 * "Demo Warehouse 8 · Unplaced 7".
 *
 * The phone never sets a split by hand: it has no per-source free units to
 * check one against. It shows the split and can hand a hand-set (`MANUAL`)
 * split back to Shelf with {@link AUTO_SOURCES}; changing the split itself
 * stays on the web.
 *
 * @see ../../../packages/quantity-control/src/source-display.ts
 */
import {
  describeSourceLine,
  type BookingSourceLine,
} from "@shelf/quantity-control";

import type {
  AdjustBookingSourcesInput,
  BookingAsset,
  BookingAssetSlice,
} from "./api/types";

/** The adjust-quantity `sources` value that hands a split back to Shelf. */
export const AUTO_SOURCES: AdjustBookingSourcesInput = { mode: "AUTO" };

/**
 * The line a booking row prints for a slice's sources: one source by name,
 * several as "Demo Warehouse 8 · Unplaced 7", with a "Short at" note per
 * source that cannot cover its units.
 *
 * @param slice - One slice of a booking asset
 * @returns The line, or `null` when the server sent no sources (an older
 *   server, a kit slice, or a slice not planned by source)
 */
export function sliceSourceLine(
  slice: Pick<BookingAssetSlice, "sources">
): BookingSourceLine | null {
  return describeSourceLine(slice.sources ?? []);
}

/**
 * The asset's standalone slice (no kit), the one the booked-quantity sheet
 * changes.
 *
 * @param asset - One booking asset row
 * @returns The slice, or `null` when the asset is booked only through kits or
 *   the server sent no slices
 */
export function standaloneSlice(
  asset: Pick<BookingAsset, "slices">
): BookingAssetSlice | null {
  return asset.slices?.find((slice) => slice.assetKitId === null) ?? null;
}

/**
 * What the booked-quantity sheet says about a slice's sources.
 *
 * @param slice - The standalone slice being changed, if any
 * @returns `line`: the current split to show, or `null`; `canUseAuto`: true
 *   for a split set by hand (`MANUAL`), which the sheet may hand back to
 *   Shelf
 */
export function adjustSheetSources(slice: BookingAssetSlice | null): {
  line: BookingSourceLine | null;
  canUseAuto: boolean;
} {
  if (!slice) return { line: null, canUseAuto: false };
  return {
    line: sliceSourceLine(slice),
    canUseAuto: slice.sourceAllocation === "MANUAL",
  };
}

/**
 * The sources of a booking row for its screen-reader label: ", units from
 * Demo Warehouse 8 · Unplaced 7, Short at Demo Warehouse". The row's explicit
 * label replaces the text of its children, so the visible line is not
 * announced on its own.
 *
 * @param asset - One booking asset row
 * @returns The fragment, or an empty string when no slice has sources
 */
export function describeSourcesForA11y(
  asset: Pick<BookingAsset, "slices">
): string {
  const lines = (asset.slices ?? []).flatMap((slice) => {
    const line = sliceSourceLine(slice);
    return line ? [line] : [];
  });
  if (lines.length === 0) return "";
  return lines
    .map((line) => [`, units from ${line.text}`, ...line.warnings].join(", "))
    .join("");
}
