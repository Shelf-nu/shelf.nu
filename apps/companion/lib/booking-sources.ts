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
 * A slice's source line as the booking screen prints it.
 *
 * `placed` is true when at least one source is a place units can leave from
 * (a location or Unplaced). Only then does the line read "From ...": a line
 * made only of "Needs a location" or "Unknown" names a problem, not a place,
 * so it prints on its own in the warning style.
 */
export type SliceSourceLine = BookingSourceLine & { placed: boolean };

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
): SliceSourceLine | null {
  const parts = slice.sources ?? [];
  const line = describeSourceLine(parts);
  if (!line) return null;
  return {
    ...line,
    placed: parts.some((p) => p.kind === "LOCATION" || p.kind === "UNPLACED"),
  };
}

/**
 * The words of a source line: "From Demo Warehouse" when the line names a
 * place, else the label alone ("Needs a location", "Unknown").
 *
 * @param line - Output of {@link sliceSourceLine}
 * @returns The text to print
 */
export function sourceLineText(line: SliceSourceLine): string {
  return line.placed ? `From ${line.text}` : line.text;
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
  line: SliceSourceLine | null;
  canUseAuto: boolean;
} {
  if (!slice) return { line: null, canUseAuto: false };
  return {
    line: sliceSourceLine(slice),
    canUseAuto: slice.sourceAllocation === "MANUAL",
  };
}

/**
 * Where a booking row's units come from, for its screen-reader label. The
 * row's explicit label replaces the text of its children, so the visible
 * lines are not announced on their own.
 *
 * Each standalone slice is described once: its planned sources when it has
 * them (", units from Demo Warehouse 8 · Unplaced 7, Short at Demo
 * Warehouse", or ", Needs a location" when no source is a place), else the location its units left from at check-out, gathered
 * into ", booked units from Camera Room, Studio". Kit slices and individual
 * assets add nothing.
 *
 * @param asset - One booking asset row
 * @returns The fragment, or an empty string when no slice has either
 */
export function describeSourcesForA11y(
  asset: Pick<BookingAsset, "type" | "slices">
): string {
  if (asset.type !== "QUANTITY_TRACKED") return "";
  const planned: string[] = [];
  const leftFrom: string[] = [];
  for (const slice of asset.slices ?? []) {
    if (slice.kit) continue;
    const line = sliceSourceLine(slice);
    if (line) {
      const words = line.placed ? `units from ${line.text}` : line.text;
      planned.push([`, ${words}`, ...line.warnings].join(", "));
    } else if (slice.sourceLocation) {
      leftFrom.push(slice.sourceLocation.name);
    }
  }
  return (
    planned.join("") +
    (leftFrom.length > 0 ? `, booked units from ${leftFrom.join(", ")}` : "")
  );
}
