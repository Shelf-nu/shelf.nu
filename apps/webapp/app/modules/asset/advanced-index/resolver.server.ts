/**
 * Hydration resolver for the advanced asset index.
 *
 * Tasks 6 and 7 built the 8 `fetch*Batch` functions and the shared types this
 * module orchestrates. This file is the layer between "a page's visible
 * columns" and "the resolved data those columns render", in three pure steps:
 *
 * 1. {@link resolveHydrationPlan} — which of the 8 batches does this page's
 *    column list actually need, and which custom-field ids should the
 *    customFields batch fetch?
 * 2. {@link createDeferredHydration} — launch the required batches through
 *    the read-concurrency limiter as unresolved, streamed promises.
 * 3. {@link assembleHydratedAssets} — once those promises have settled, merge
 *    the resolved maps onto the critical rows the page already has.
 *
 * None of the three touches a database directly or awaits a batch — that
 * stays in the fetch functions and in whatever streams/awaits the promises
 * this module hands back (the loader, for step 2; RR7's turbo-stream and the
 * client, for step 3's inputs).
 *
 * @see {@link file://./types.ts} — `BatchKey`, `BatchArgs`, `HydrationSources`,
 *   `ResolvedHydration`, `CriticalRow`, `HydratedAsset`
 * @see {@link file://./hydrate-simple.server.ts} and
 *   {@link file://./hydrate-heavy.server.ts} — the 8 batch fetchers this file
 *   selects between and launches
 * @see {@link file://../../../utils/read-batch-limiter.server.ts} — `withReadSlot`,
 *   the process-wide concurrency gate every deferred batch runs through
 * @see {@link file://./deadlines.ts} — `HYDRATION_DEADLINE_MS`, the signal
 *   callers compose into `deadlineSignal`
 */
import {
  barcodeFields,
  type Column,
} from "~/modules/asset-index-settings/helpers";
import { withReadSlot } from "~/utils/read-batch-limiter.server";
import {
  fetchBarcodesBatch,
  fetchBookingsBatch,
  fetchCustodyBatch,
} from "./hydrate-heavy.server";
import {
  fetchCustomFieldsBatch,
  fetchKitsBatch,
  fetchLocationsBatch,
  fetchRemindersBatch,
  fetchTagsBatch,
} from "./hydrate-simple.server";
import type {
  BatchArgs,
  BatchKey,
  CriticalRow,
  HydratedAsset,
  HydrationSources,
  ResolvedHydration,
  ViewerScope,
} from "./types";

/**
 * Column names that map directly onto a single hydration batch, independent
 * of any entitlement or per-asset lookup. Barcode columns (gated on
 * `barcodesEnabled`) and `cf_<name>` columns (resolved against the org's
 * active fields) need extra logic, so they are handled separately in
 * {@link resolveHydrationPlan} rather than listed here.
 *
 * `"kit"` maps to the `"kits"` batch even though `CriticalRow.kit` already
 * carries the primary membership eagerly: the batch supplies the full array
 * the "+N more" affordance needs, so a visible `kit` column still requires it.
 */
const BATCH_KEY_BY_COLUMN_NAME: Partial<Record<Column["name"], BatchKey>> = {
  tags: "tags",
  location: "locations",
  kit: "kits",
  custody: "custody",
  upcomingReminder: "reminders",
  upcomingBookings: "bookings",
};

/** The five per-barcode-type column names, as a lookup set. */
const BARCODE_COLUMN_NAMES: ReadonlySet<string> = new Set(barcodeFields);

/** Inputs to {@link resolveHydrationPlan}: a page's column list and the org
 * context that decides which of them can actually be fetched. */
export type HydrationResolveArgs = {
  /** The current view's columns, from the asset-index settings loader. */
  columns: Column[];
  /** Whether the page being resolved is the availability view. Not read by
   * this function — the availability-view exclusion applies to which of the
   * REQUIRED batches are streamed, not to which are required in the first
   * place, so it belongs to {@link createDeferredHydration} instead. Carried
   * on this type only so a caller building both functions' args can reuse one
   * object; see that function's doc for where it actually takes effect. */
  isAvailabilityView: boolean;
  /** Whether the org has the barcode entitlement enabled. Gates the
   * `barcodes` batch even when a barcode column is visible — no entitlement,
   * no fetch, regardless of column visibility. */
  barcodesEnabled: boolean;
  /** The org's active custom fields, used to resolve a visible `cf_<name>`
   * column to the field id the `customFields` batch should request. */
  activeCustomFields: Array<{ id: string; name: string }>;
};

/**
 * Decides which hydration batches a page needs, from its visible columns.
 *
 * Walks every visible column and adds the batch it requires to `required`
 * (see {@link BATCH_KEY_BY_COLUMN_NAME} for the direct column→batch table). A
 * barcode column only requires the `barcodes` batch when the org's barcode
 * entitlement is on — an invisible or disabled barcode column never triggers
 * a fetch. A `cf_<name>` column requires `customFields` and contributes its
 * resolved field id to `cfFieldIds`; a `cf_<name>` column whose name matches
 * no active field is a stale column (the field was deactivated or renamed
 * since the column was saved) and is skipped rather than treated as an error.
 *
 * @param a - The page's columns and the org context that gates them.
 * @returns `required` — the batches this page needs — and `cfFieldIds`, the
 *   active custom-field ids to hydrate (meaningful only when `customFields`
 *   is in `required`).
 */
export function resolveHydrationPlan(a: HydrationResolveArgs): {
  required: Set<BatchKey>;
  cfFieldIds: string[];
} {
  const required = new Set<BatchKey>();
  const cfFieldIds: string[] = [];
  const activeFieldIdByName = new Map(
    a.activeCustomFields.map((field) => [field.name, field.id])
  );

  for (const column of a.columns) {
    if (!column.visible) {
      continue;
    }

    const directKey = BATCH_KEY_BY_COLUMN_NAME[column.name];
    if (directKey) {
      required.add(directKey);
      continue;
    }

    if (BARCODE_COLUMN_NAMES.has(column.name)) {
      if (a.barcodesEnabled) {
        required.add("barcodes");
      }
      continue;
    }

    if (column.name.startsWith("cf_")) {
      const fieldName = column.name.slice("cf_".length);
      const fieldId = activeFieldIdByName.get(fieldName);
      if (fieldId) {
        cfFieldIds.push(fieldId);
        required.add("customFields");
      }
    }
  }

  return { required, cfFieldIds };
}

/**
 * Per-batch context {@link createDeferredHydration} needs beyond the plan
 * {@link resolveHydrationPlan} already produced.
 */
type DeferredHydrationArgs = {
  organizationId: string;
  viewerScope: ViewerScope;
  barcodesEnabled: boolean;
  /** From {@link resolveHydrationPlan}. */
  required: Set<BatchKey>;
  /** From {@link resolveHydrationPlan}. */
  cfFieldIds: string[];
  /** When true, `bookings` and `barcodes` are excluded from the streamed set
   * even if `required` contains them — see the function doc. */
  isAvailabilityView: boolean;
};

/**
 * Batches Task 9's `hydrateAvailabilityPage` fetches eagerly onto `items`
 * instead of streaming, when the current page is the availability view.
 */
const AVAILABILITY_VIEW_EAGER_BATCHES: ReadonlySet<BatchKey> = new Set([
  "bookings",
  "barcodes",
]);

/**
 * Launches every required hydration batch as an unresolved promise, gated by
 * the read-concurrency limiter, without awaiting any of them.
 *
 * Each batch's fetch runs through {@link withReadSlot} on the `"interactive"`
 * lane (the `"export"` lane is Task 12's), composed against `deadlineSignal`
 * so a batch that hasn't started by the hydration deadline
 * ({@link file://./deadlines.ts}) is rejected rather than begun. The returned
 * {@link HydrationSources} is handed straight to the loader's deferred
 * response — RR7 streams each promise to the client as it settles.
 *
 * In availability view, `bookings` and `barcodes` are deliberately absent
 * from the returned sources even when {@link resolveHydrationPlan} put them
 * in `required`: Task 9's `hydrateAvailabilityPage` fetches those two eagerly
 * onto `items` for that view instead, so streaming them here would be
 * redundant, duplicate work. Every other required batch still streams
 * normally in availability view.
 *
 * @param ids - The paged asset ids to hydrate (one index page).
 * @param a - Org/viewer context plus the plan from {@link resolveHydrationPlan}.
 * @param deadlineSignal - Aborts a batch's queued (not yet started) read slot
 *   once the hydration deadline passes.
 * @returns One unresolved promise per streamed batch, keyed by {@link BatchKey}.
 */
export function createDeferredHydration(
  ids: string[],
  a: DeferredHydrationArgs,
  deadlineSignal: AbortSignal
): HydrationSources {
  const batchArgs: BatchArgs = {
    ids,
    organizationId: a.organizationId,
    viewerScope: a.viewerScope,
    barcodesEnabled: a.barcodesEnabled,
    requestedFieldIds: a.cfFieldIds,
  };

  /** Builds the shared `withReadSlot` options for one batch, so each case
   * below only names the batch it's launching. */
  const slotOpts = (batch: BatchKey) => ({
    signal: deadlineSignal,
    lane: "interactive" as const,
    batch,
    idCount: ids.length,
  });

  const sources: HydrationSources = {};

  for (const key of a.required) {
    if (a.isAvailabilityView && AVAILABILITY_VIEW_EAGER_BATCHES.has(key)) {
      continue;
    }

    // A switch keyed on BatchKey (rather than a lookup table indexed by
    // `key`) so each assignment target (`sources.tags`, `sources.kits`, …) is
    // a literal property name the compiler can check against `HydrationSources`
    // — a table indexed by the loop variable would type the write as
    // `HydrationSources[BatchKey]`, losing the per-key promise type.
    switch (key) {
      case "tags":
        sources.tags = withReadSlot(
          () => fetchTagsBatch(batchArgs),
          slotOpts("tags")
        );
        break;
      case "locations":
        sources.locations = withReadSlot(
          () => fetchLocationsBatch(batchArgs),
          slotOpts("locations")
        );
        break;
      case "kits":
        sources.kits = withReadSlot(
          () => fetchKitsBatch(batchArgs),
          slotOpts("kits")
        );
        break;
      case "customFields":
        sources.customFields = withReadSlot(
          () => fetchCustomFieldsBatch(batchArgs),
          slotOpts("customFields")
        );
        break;
      case "reminders":
        sources.reminders = withReadSlot(
          () => fetchRemindersBatch(batchArgs),
          slotOpts("reminders")
        );
        break;
      case "custody":
        sources.custody = withReadSlot(
          () => fetchCustodyBatch(batchArgs),
          slotOpts("custody")
        );
        break;
      case "bookings":
        sources.bookings = withReadSlot(
          () => fetchBookingsBatch(batchArgs),
          slotOpts("bookings")
        );
        break;
      case "barcodes":
        sources.barcodes = withReadSlot(
          () => fetchBarcodesBatch(batchArgs),
          slotOpts("barcodes")
        );
        break;
    }
  }

  return sources;
}

/**
 * Merges resolved hydration batch maps onto critical rows, in the rows'
 * original order.
 *
 * Order is preserved because it is the critical query's own order — export,
 * the flag-off legacy path, and the availability view all depend on that
 * order surviving hydration unchanged. Neither `rows` nor `maps` is mutated;
 * this returns a new array of new row objects.
 *
 * For each row, a hydration field falls back to the column's empty default
 * when the corresponding map is absent (that batch wasn't requested for this
 * page) or has no entry for the row's id (the batch ran but found nothing for
 * this asset) — the two cases are indistinguishable to a row and treated
 * identically. `custody` defaults to `null`, never `[]`: absence of custody
 * IS the "nobody holds this" signal, not "known to have zero custodians". The
 * primary `location` is `locations[0]`, matching the placements batch's
 * oldest-pivot-first ordering; the primary `kit` is left untouched from
 * `row.kit` — `CriticalRow` already carries it, and the `kits` batch only
 * adds the full array for the "+N more" affordance.
 *
 * @param rows - The critical (eagerly-available) rows, in query order.
 * @param maps - Resolved batch maps, keyed by {@link BatchKey}; a key absent
 *   from `maps` means that batch was never requested for this page.
 * @returns One {@link HydratedAsset} per input row, same order.
 */
export function assembleHydratedAssets(
  rows: CriticalRow[],
  maps: ResolvedHydration
): HydratedAsset[] {
  return rows.map((row) => {
    const locations = maps.locations?.get(row.id) ?? [];
    return {
      ...row,
      tags: maps.tags?.get(row.id) ?? [],
      location: locations[0] ?? null,
      locations,
      kits: maps.kits?.get(row.id) ?? [],
      customFields: maps.customFields?.get(row.id) ?? [],
      reminders: maps.reminders?.get(row.id) ?? null,
      custody: maps.custody?.get(row.id) ?? null,
      bookings: maps.bookings?.get(row.id) ?? [],
      barcodes: maps.barcodes?.get(row.id) ?? [],
    };
  });
}
