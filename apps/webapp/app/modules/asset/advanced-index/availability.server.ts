/**
 * Eager hydration for the advanced index's availability view.
 *
 * Every other advanced-index view mounts the table and streams its hydration
 * columns as deferred promises the client resolves per cell (see
 * `resolver.server.ts`'s `createDeferredHydration`). The availability view
 * doesn't mount the table — it renders an `AvailabilityCalendar` instead — so
 * deferred, per-cell streaming doesn't apply: the calendar needs its data
 * attached to `items` before the loader returns.
 *
 * `useAssetAvailabilityData` (the calendar's data source) reads only
 * `asset.bookings` and `asset.barcodes` beyond the critical-row scalars it
 * already has — no tags, locations, kits, custody, reminders, or custom
 * fields. So this module fetches exactly those two batches, eagerly and in
 * parallel, through the same read-concurrency limiter every other hydration
 * batch uses, and reuses the resolver's row assembler to attach them.
 *
 * @see {@link file://./types.ts} — `CriticalRow`, `HydratedAsset`, `BatchArgs`
 * @see {@link file://./hydrate-heavy.server.ts} — `fetchBookingsBatch`,
 *   `fetchBarcodesBatch`, the two batches this module fetches
 * @see {@link file://./resolver.server.ts} — `assembleHydratedAssets`, reused
 *   here so the availability path and the streamed table path can never
 *   assemble a row differently
 * @see {@link file://../../../utils/read-batch-limiter.server.ts} — `withReadSlot`,
 *   the process-wide read-concurrency gate this module's fetches run through
 */
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { withReadSlot } from "~/utils/read-batch-limiter.server";
import { fetchBarcodesBatch, fetchBookingsBatch } from "./hydrate-heavy.server";
import { assembleHydratedAssets } from "./resolver.server";
import type {
  BatchArgs,
  BatchMap,
  CriticalRow,
  HydratedAsset,
  ViewerScope,
} from "./types";

/** Inputs to {@link hydrateAvailabilityPage}. */
export type HydrateAvailabilityPageArgs = {
  /** The critical (eagerly-available) rows for this page, in query order. */
  items: CriticalRow[];
  /** The caller's active organization; every batch query filters on this. */
  organizationId: string;
  /** The viewer being hydrated for; drives booking custodian redaction. */
  viewerScope: ViewerScope;
  /** Whether the org has the barcode entitlement enabled. When `false` the
   * barcodes batch is skipped entirely (no query, no read slot) rather than
   * fetched and discarded. */
  barcodesEnabled: boolean;
  /** The loader's composed hydration deadline — aborts a batch's queued
   * (not yet started) read slot once it passes. */
  signal: AbortSignal;
};

/**
 * Fetches one hydration batch through the read limiter, degrading to an
 * empty map on any failure (including an abort from `signal`) rather than
 * letting the rejection propagate.
 *
 * Mirrors the existing image-refresh / kit-name degrade pattern in
 * `~/modules/asset/data.server.ts`: log a captured `ShelfError` and continue
 * with an empty result, so one batch's outage never 500s the page — it only
 * costs that batch's data for this page load.
 *
 * @param fetch - The batch fetch to run inside the read slot.
 * @param batch - The `withReadSlot` metrics label, reused in the error
 *   message so a Sentry capture names which batch failed.
 * @param opts - Read-slot options (signal, lane, idCount) plus the context to
 *   attach to the captured error when the fetch fails.
 * @returns The batch's resolved map, or an empty `Map` on failure.
 */
async function fetchDegraded<K extends "bookings" | "barcodes">(
  fetch: () => Promise<BatchMap<K>>,
  batch: K,
  opts: {
    signal: AbortSignal;
    idCount: number;
    organizationId: string;
  }
): Promise<BatchMap<K>> {
  try {
    return await withReadSlot(fetch, {
      signal: opts.signal,
      lane: "interactive",
      batch,
      idCount: opts.idCount,
    });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: `Failed to hydrate ${batch} for the availability view`,
        label: "Assets",
        additionalData: {
          organizationId: opts.organizationId,
          assetCount: opts.idCount,
        },
        shouldBeCaptured: true,
      })
    );
    const empty: BatchMap<K> = new Map();
    return empty;
  }
}

/**
 * Eagerly hydrates a page of availability-view rows with the two columns
 * `AvailabilityCalendar` reads (`bookings`, `barcodes`), attaching them
 * directly onto `items` before the loader returns.
 *
 * The two batches are fetched in parallel and degrade independently: a
 * bookings failure falls back to an empty bookings map without affecting the
 * barcodes fetch (and vice versa), so the calendar renders with no bars for
 * whichever batch failed rather than the whole page erroring out. When
 * `barcodesEnabled` is `false` the barcodes fetch is skipped up front — no
 * read slot spent on a call that would return empty anyway.
 *
 * @param a - The page's critical rows plus the org/viewer/entitlement context
 *   every hydration batch needs, and the deadline signal to compose into the
 *   read slot.
 * @returns One {@link HydratedAsset} per input row, same order as `a.items`,
 *   with `bookings`/`barcodes` attached and every other hydration field at
 *   its empty default (the calendar reads none of them).
 */
export async function hydrateAvailabilityPage(
  a: HydrateAvailabilityPageArgs
): Promise<HydratedAsset[]> {
  const ids = a.items.map((item) => item.id);
  const batchArgs: BatchArgs = {
    ids,
    organizationId: a.organizationId,
    viewerScope: a.viewerScope,
    barcodesEnabled: a.barcodesEnabled,
  };

  const [bookings, barcodes] = await Promise.all([
    fetchDegraded(() => fetchBookingsBatch(batchArgs), "bookings", {
      signal: a.signal,
      idCount: ids.length,
      organizationId: a.organizationId,
    }),
    a.barcodesEnabled
      ? fetchDegraded(() => fetchBarcodesBatch(batchArgs), "barcodes", {
          signal: a.signal,
          idCount: ids.length,
          organizationId: a.organizationId,
        })
      : Promise.resolve<BatchMap<"barcodes">>(new Map()),
  ]);

  return assembleHydratedAssets(a.items, { bookings, barcodes });
}
