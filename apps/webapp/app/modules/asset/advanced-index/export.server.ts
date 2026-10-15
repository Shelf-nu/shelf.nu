/**
 * Bounded, windowed export pipeline for the advanced asset index.
 *
 * The CSV export historically fetched the WHOLE filtered set in one
 * unpaginated mega-query (`getAdvancedPaginatedAndFilterableAssets({ takeAll:
 * true })`) — exactly the lock-table-exhausting shape the streaming rebuild
 * retires for the paginated index, just without a `LIMIT`. This module is the
 * flag-ON replacement: it fetches the same filtered set through the SAME
 * leaf-read building blocks the paginated index uses (the slim id/sort CTEs,
 * the critical-row query, the 8 hydration batches), but bounded into windows
 * of {@link EXPORT_WINDOW_SIZE} ids so a large export never fans out the whole
 * workspace's relations at once, and scheduled through the read-concurrency
 * limiter's `"export"` lane so a big export yields to live index page loads
 * instead of competing with them.
 *
 * Callers (`~/utils/csv.server`'s `resolveExportAssets`) resolve
 * {@link isStreamingEnabled} themselves and only reach this module when the
 * flag is ON; when it's OFF the caller keeps calling the existing
 * `getAdvancedPaginatedAndFilterableAssets({ takeAll: true })` path unchanged.
 *
 * @see {@link file://./types.ts} — `HydratedAsset`, `ViewerScope`, `BatchKey`
 * @see {@link file://./critical-query.server.ts} — `getAdvancedAssetCriticalPage`,
 *   the per-window critical-row query this module scopes to an id restriction
 * @see {@link file://./resolver.server.ts} — `resolveHydrationPlan` (which
 *   batches a column list needs) and `assembleHydratedAssets` (merging a
 *   window's batches onto its critical rows)
 * @see {@link file://../../../utils/read-batch-limiter.server.ts} — `withReadSlot`,
 *   the process-wide concurrency gate every leaf read in this pipeline runs
 *   through, on the `"export"` lane
 */
import { Prisma } from "@prisma/client";
import { withPrismaRetry } from "@shelf/database";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { db } from "~/database/db.server";
import { buildSlimPagedAssetCTEs } from "~/modules/asset/query.server";
import type {
  AdvancedIndexAsset,
  CustomFieldSorting,
} from "~/modules/asset/types";
import type { Column } from "~/modules/asset-index-settings/helpers";
import { isAbortError } from "~/utils/error";
import { type ReadLane, withReadSlot } from "~/utils/read-batch-limiter.server";
import { getAdvancedAssetCriticalPage } from "./critical-query.server";
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
import {
  assembleHydratedAssets,
  resolveHydrationPlan,
} from "./resolver.server";
import type {
  BatchArgs,
  BatchKey,
  BatchMap,
  HydratedAsset,
  ResolvedHydration,
  ViewerScope,
} from "./types";

/**
 * Max asset ids fetched (critical row + hydration batches) in a single
 * hydration wave. Bounds the pipeline's per-wave fan-out regardless of how
 * large the filtered export set is — the whole reason this pipeline exists
 * instead of one unpaginated mega-query.
 */
const EXPORT_WINDOW_SIZE = 500;

/**
 * The fairness lane every leaf read in this pipeline runs under. Never
 * `"interactive"`: a large export must yield to live index page loads for the
 * shared `MAX_READ_CONCURRENCY` budget, not compete with them on equal terms.
 */
const EXPORT_LANE: ReadLane = "export";

/** Inputs to {@link getAdvancedAssetsForExport}. */
export type GetAdvancedAssetsForExportArgs = {
  /** Which CSV this feeds — carried only as a metrics label on the read-slot
   * calls this pipeline makes; it never changes which rows are fetched. That
   * is driven entirely by `columns` (each output resolves its own, already
   * scope-applied, column list before calling this function). */
  output: "human" | "import-ready";
  organizationId: string;
  /** Drives custody redaction in the heavy batches — see {@link ViewerScope}. */
  viewerScope: ViewerScope;
  barcodesEnabled: boolean;
  /** WHERE clause from `generateWhereClause` (org scope + filters). */
  whereClause: Prisma.Sql;
  /** Inner `ORDER BY` body (no leading `ORDER BY `) from `parseSortingOptions`. */
  orderByInner: string;
  customFieldSortings: CustomFieldSorting[];
  /** Raw `sortBy` specs, used to detect active qrId/custody/barcode sort keys. */
  sortBy: string[];
  parsedFilters: Filter[];
  /** This output's own resolved column list (already scope-applied by the
   * caller — "visible" vs "all", or the import-ready output's own broader
   * field set) — decides which of the 8 hydration batches this export needs
   * via {@link resolveHydrationPlan}. */
  columns: Column[];
  /** The org's active custom fields, for resolving a visible `cf_<name>`
   * column to the field id the `customFields` batch should request. */
  activeCustomFields: Array<{ id: string; name: string }>;
  /** Aborts the export: no further windows are scheduled once this fires, and
   * any leaf read still queued (not yet running) for the current window is
   * rejected by the limiter rather than started. */
  signal: AbortSignal;
};

/**
 * Fetches the ordered `{ assetId, __sortRank }` list for the WHOLE filtered
 * export set, with no total count — an export has no use for one, and
 * counting the filtered set is pure overhead on top of fetching it.
 *
 * Builds on the same {@link buildSlimPagedAssetCTEs} CTEs the paginated index
 * uses, with `paginationClause: Prisma.empty` (takeAll), but the final SELECT
 * below reads ONLY `sorted_asset_query` — it never references `count_query`,
 * so a non-MATERIALIZED CTE the planner has no reason to evaluate stays
 * unevaluated. This is the one leaf read that decides EVERY window's ids and
 * their global order; every later window slices this same array, so it alone
 * fixes the order the final `HydratedAsset[]` comes back in.
 *
 * @param args - The slim-phase inputs shared with the critical-row query,
 *   plus the export's abort signal.
 * @returns Every matching asset id, in final `__sortRank` order.
 */
async function fetchExportOrderedIds(args: {
  whereClause: Prisma.Sql;
  orderByInner: string;
  customFieldSortings: CustomFieldSorting[];
  sortBy: string[];
  parsedFilters: Filter[];
  signal: AbortSignal;
  output: "human" | "import-ready";
}): Promise<string[]> {
  const slimCtes = buildSlimPagedAssetCTEs({
    whereClause: args.whereClause,
    orderByInner: args.orderByInner,
    customFieldSortings: args.customFieldSortings,
    sortBy: args.sortBy,
    parsedFilters: args.parsedFilters,
    paginationClause: Prisma.empty,
  });

  return withReadSlot(
    async () => {
      const rows = await withPrismaRetry(
        () =>
          db.$queryRaw<Array<{ assetId: string; __sortRank: number }>>(
            Prisma.sql`${slimCtes}
              SELECT "assetId", "__sortRank"
              FROM sorted_asset_query
              ORDER BY "__sortRank"`
          ),
        { operationIsRead: true }
      );
      return rows.map((row) => row.assetId);
    },
    {
      signal: args.signal,
      lane: EXPORT_LANE,
      batch: `export-ids-${args.output}`,
    }
  );
}

/**
 * Fetches and assembles one bounded window's rows: the critical (eagerly
 * available) row for each of `args.ids`, plus every hydration batch
 * `args.required` calls for, restricted to that same id set.
 *
 * Each leaf DB read (the critical query, and each required batch) is wrapped
 * in its OWN {@link withReadSlot} call and awaited alongside its siblings via
 * `Promise.all` — never nested inside a single outer slot. With
 * `MAX_READ_CONCURRENCY` finite, a parent slot held open while its children
 * wait for slots of their own is a deadlock; none of the leaf reads called
 * here (`getAdvancedAssetCriticalPage`, the `fetch*Batch` functions) acquire a
 * slot internally, so wrapping each one individually is the only slot anyone
 * holds at a time for this window.
 *
 * @param args - This window's ids, the shared query/plan inputs, and the
 *   export's abort signal.
 * @returns This window's rows, in the window's own relative order (the
 *   critical query re-derives it via its own `__sortRank` over the
 *   id-restricted subset, which preserves the same relative order the ids
 *   already carry from {@link fetchExportOrderedIds}).
 */
async function hydrateExportWindow(args: {
  ids: string[];
  organizationId: string;
  whereClause: Prisma.Sql;
  orderByInner: string;
  customFieldSortings: CustomFieldSorting[];
  sortBy: string[];
  parsedFilters: Filter[];
  viewerScope: ViewerScope;
  barcodesEnabled: boolean;
  required: Set<BatchKey>;
  cfFieldIds: string[];
  signal: AbortSignal;
  output: "human" | "import-ready";
}): Promise<HydratedAsset[]> {
  const {
    ids,
    organizationId,
    viewerScope,
    barcodesEnabled,
    required,
    signal,
    output,
  } = args;

  // Restrict the shared slim phase to just this window's ids so the critical
  // query re-derives the SAME relative order (via its own `__sortRank`) over
  // a bounded slice, instead of re-running the full unbounded filtered set —
  // the same `a.id = ANY(...)` shape `generateWhereClause` already uses for
  // its own `assetIds` filter.
  const windowWhereClause = Prisma.sql`${args.whereClause} AND a.id = ANY(${ids}::text[])`;

  const batchArgs: BatchArgs = {
    ids,
    organizationId,
    viewerScope,
    barcodesEnabled,
    requestedFieldIds: args.cfFieldIds,
  };

  /** Wraps one leaf read in its own read-slot, labeled for metrics. */
  const readSlot = <T>(batch: string, fn: () => Promise<T>): Promise<T> =>
    withReadSlot(fn, {
      signal,
      lane: EXPORT_LANE,
      batch: `export-${batch}-${output}`,
      idCount: ids.length,
    });

  const criticalPromise = readSlot("critical", () =>
    getAdvancedAssetCriticalPage({
      organizationId,
      whereClause: windowWhereClause,
      orderByInner: args.orderByInner,
      customFieldSortings: args.customFieldSortings,
      sortBy: args.sortBy,
      parsedFilters: args.parsedFilters,
      paginationClause: Prisma.empty,
    })
  );

  // Only a batch this export's columns actually require is fetched — an
  // unrequired batch resolves to an empty map immediately, with no query
  // issued and no slot acquired, matching `assembleHydratedAssets`'
  // absent-means-empty convention.
  const tagsPromise: Promise<BatchMap<"tags">> = required.has("tags")
    ? readSlot("tags", () => fetchTagsBatch(batchArgs))
    : Promise.resolve(new Map());
  const locationsPromise: Promise<BatchMap<"locations">> = required.has(
    "locations"
  )
    ? readSlot("locations", () => fetchLocationsBatch(batchArgs))
    : Promise.resolve(new Map());
  const kitsPromise: Promise<BatchMap<"kits">> = required.has("kits")
    ? readSlot("kits", () => fetchKitsBatch(batchArgs))
    : Promise.resolve(new Map());
  const customFieldsPromise: Promise<BatchMap<"customFields">> = required.has(
    "customFields"
  )
    ? readSlot("customFields", () => fetchCustomFieldsBatch(batchArgs))
    : Promise.resolve(new Map());
  const remindersPromise: Promise<BatchMap<"reminders">> = required.has(
    "reminders"
  )
    ? readSlot("reminders", () => fetchRemindersBatch(batchArgs))
    : Promise.resolve(new Map());
  const custodyPromise: Promise<BatchMap<"custody">> = required.has("custody")
    ? readSlot("custody", () => fetchCustodyBatch(batchArgs))
    : Promise.resolve(new Map());
  const bookingsPromise: Promise<BatchMap<"bookings">> = required.has(
    "bookings"
  )
    ? readSlot("bookings", () => fetchBookingsBatch(batchArgs))
    : Promise.resolve(new Map());
  const barcodesPromise: Promise<BatchMap<"barcodes">> = required.has(
    "barcodes"
  )
    ? readSlot("barcodes", () => fetchBarcodesBatch(batchArgs))
    : Promise.resolve(new Map());

  const [
    critical,
    tags,
    locations,
    kits,
    customFields,
    reminders,
    custody,
    bookings,
    barcodes,
  ] = await Promise.all([
    criticalPromise,
    tagsPromise,
    locationsPromise,
    kitsPromise,
    customFieldsPromise,
    remindersPromise,
    custodyPromise,
    bookingsPromise,
    barcodesPromise,
  ]);

  const maps: ResolvedHydration = {
    tags,
    locations,
    kits,
    customFields,
    reminders,
    custody,
    bookings,
    barcodes,
  };

  return assembleHydratedAssets(critical.items, maps);
}

/**
 * Fetches the full filtered advanced-index export set through the bounded,
 * windowed leaf pipeline (flag-ON path).
 *
 * 1. Resolves which of the 8 hydration batches `args.columns` actually needs
 *    ({@link resolveHydrationPlan}), once for the whole export.
 * 2. Fetches every matching asset id in final sort order, uncounted
 *    ({@link fetchExportOrderedIds}).
 * 3. Slices those ids into windows of at most {@link EXPORT_WINDOW_SIZE} and
 *    hydrates one window at a time ({@link hydrateExportWindow}), so at most
 *    one window's worth of critical rows and hydration batches are ever in
 *    flight — never the whole export's.
 * 4. Concatenates each window's rows in order. Windows are already ordered
 *    (they are contiguous slices of the single ordered id list from step 2),
 *    and each window's own rows are ordered internally by the critical
 *    query's own `__sortRank` — so simple concatenation reproduces the exact
 *    order a single unpaginated mega-query would have produced.
 *
 * Never throws on an abort, at any point: an already-aborted `signal` at
 * entry returns `[]` with no query issued at all; one that fires mid-export
 * stops scheduling further windows and returns whatever windows had already
 * completed. A window already in flight when the signal aborts is left to
 * settle on its own — a leaf read that has already started cannot be
 * cancelled out from under Prisma (see `read-batch-limiter.server.ts`) — but
 * a leaf read still queued behind the concurrency cap rejects with the
 * limiter's own `AbortError`, which this function catches via `isAbortError`
 * and treats as "stop here" rather than letting it surface as a failure.
 *
 * @param args - See {@link GetAdvancedAssetsForExportArgs}.
 * @returns Every matching asset, fully hydrated, in the same order the legacy
 *   unpaginated mega-query would have produced for the same inputs — or
 *   whatever prefix of that had been hydrated before an abort, on abort.
 */
export async function getAdvancedAssetsForExport(
  args: GetAdvancedAssetsForExportArgs
): Promise<HydratedAsset[]> {
  if (args.signal.aborted) {
    return [];
  }

  const { required, cfFieldIds } = resolveHydrationPlan({
    columns: args.columns,
    // The export is never the availability view — that distinction only
    // matters to the paginated index's streamed-vs-eager split, which this
    // pipeline has no equivalent of (every batch here is awaited, not
    // streamed).
    isAvailabilityView: false,
    barcodesEnabled: args.barcodesEnabled,
    activeCustomFields: args.activeCustomFields,
  });

  let ids: string[];
  try {
    ids = await fetchExportOrderedIds({
      whereClause: args.whereClause,
      orderByInner: args.orderByInner,
      customFieldSortings: args.customFieldSortings,
      sortBy: args.sortBy,
      parsedFilters: args.parsedFilters,
      signal: args.signal,
      output: args.output,
    });
  } catch (cause) {
    if (isAbortError(cause)) {
      return [];
    }
    throw cause;
  }

  const rows: HydratedAsset[] = [];
  for (let start = 0; start < ids.length; start += EXPORT_WINDOW_SIZE) {
    if (args.signal.aborted) {
      break;
    }

    const windowIds = ids.slice(start, start + EXPORT_WINDOW_SIZE);
    try {
      const windowRows = await hydrateExportWindow({
        ids: windowIds,
        organizationId: args.organizationId,
        whereClause: args.whereClause,
        orderByInner: args.orderByInner,
        customFieldSortings: args.customFieldSortings,
        sortBy: args.sortBy,
        parsedFilters: args.parsedFilters,
        viewerScope: args.viewerScope,
        barcodesEnabled: args.barcodesEnabled,
        required,
        cfFieldIds,
        signal: args.signal,
        output: args.output,
      });
      rows.push(...windowRows);
    } catch (cause) {
      if (isAbortError(cause)) {
        break;
      }
      throw cause;
    }
  }

  return rows;
}

/**
 * Converts one flag-ON pipeline row into the shape the CSV builders consume.
 *
 * {@link HydratedAsset} and `AdvancedIndexAsset` (`~/modules/asset/types`)
 * describe the same asset two different ways: this pipeline's rows carry
 * genuinely-typed values (e.g. ISO date strings, `null` for "no custodian"),
 * while `AdvancedIndexAsset` is a hand-written approximation of the legacy raw
 * query's JSON output and inherits that query's own conventions (`Date`-typed
 * fields that are actually ISO strings at runtime — see
 * `advanced-index/service.server.ts`'s `LegacyRowRuntimeShape` for the same
 * pattern on the flag-OFF side; `undefined` rather than `null` for an absent
 * nested relation). Converting field-by-field here — real `new Date(...)`
 * parses, `null` to `undefined` where the legacy shape never allows `null` —
 * keeps that translation explicit and typed, with no `any`/`unknown` cast
 * standing in for it.
 *
 * @param row - One row from {@link getAdvancedAssetsForExport}.
 * @returns The same asset, shaped for `buildCsvExportDataFromAssets` /
 *   `buildImportReadyCsvFromAssets`.
 */
export function toAdvancedIndexExportAsset(
  row: HydratedAsset
): AdvancedIndexAsset {
  return {
    id: row.id,
    sequentialId: row.sequentialId,
    title: row.title,
    description: row.description,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    userId: row.userId,
    mainImage: row.mainImage,
    thumbnailImage: row.thumbnailImage,
    mainImageExpiration: row.mainImageExpiration
      ? new Date(row.mainImageExpiration)
      : null,
    categoryId: row.categoryId,
    organizationId: row.organizationId,
    status: row.status,
    type: row.type,
    valuation: row.valuation,
    quantity: row.quantity,
    unitOfMeasure: row.unitOfMeasure,
    minQuantity: row.minQuantity,
    consumptionType: row.consumptionType,
    availableToBook: row.availableToBook,
    archivedAt: row.archivedAt ? new Date(row.archivedAt) : null,
    qrId: row.qrId,
    assetModelId: row.assetModelId,
    assetModelName: row.assetModelName,
    assetModel: row.assetModel,
    kit: row.kit,
    kits: row.kits,
    category: row.category,
    tags: row.tags,
    location: row.location,
    locations: row.locations,
    custody: row.custody,
    customFields: row.customFields,
    upcomingReminder: row.reminders
      ? {
          id: row.reminders.id,
          name: row.reminders.name,
          message: row.reminders.message,
          alertDateTime: new Date(row.reminders.alertDateTime),
        }
      : undefined,
    bookings: row.bookings.map((booking) => ({
      id: booking.id,
      name: booking.name,
      description: booking.description,
      status: booking.status,
      from: booking.from,
      to: booking.to,
      // The bookings batch never selects a booking tag's color (this surface
      // only ever renders the booking's name for the "upcoming bookings"
      // column) — `null` states that honestly rather than fabricating one.
      tags: booking.tags.map((tag) => ({ ...tag, color: null })),
      custodianTeamMember: booking.custodianTeamMember ?? undefined,
      custodianUser: booking.custodianUser ?? undefined,
      creator: booking.creator ?? undefined,
      assetKitId: booking.assetKitId,
      quantity: booking.quantity ?? undefined,
      kitName: booking.kitName,
    })),
    barcodes: row.barcodes,
  };
}
