/**
 * Asset Model Assets Sheet
 *
 * Lists the assets behind one model-view row, using the same advanced-index
 * columns the user has configured for the list view. Serves both kinds of row:
 * a real asset model, and the synthetic "No model" bucket. Which one it is
 * changes the endpoint and the filter it links out to, and nothing else, so the
 * loading, error, retry and "showing first N" behaviour is one implementation.
 *
 * Loads on open rather than with the page: a model can hold hundreds of assets
 * and a page shows many models, so preloading would be unbounded. The fetch
 * forwards the page's current search string, so the sheet always shows exactly
 * the assets the row's count described.
 *
 * The header row and the name column are pinned, so neither the column names
 * nor the asset a row is about leaves the screen while reading a wide table.
 * The index's own freeze setting stays off here: it anchors the name cell 48px
 * in, beside the bulk-select column this table does not render, so the sheet
 * applies the left-edge classes from the same helper instead.
 *
 * @see {@link file://./../../../modules/asset-model/bucket.ts} Endpoint and filter per bucket
 * @see {@link file://./../../../modules/asset-model/bucket-assets.server.ts} The shared loader
 * @see {@link file://./freeze-column-classes.ts} The sticky-cell classes
 * @see {@link file://./asset-model-sheet-empty-state.ts} The empty-sheet wording
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { AssetIndexSettingsProvider } from "~/context/asset-index-settings-context";
import { useAssetIndexColumns } from "~/hooks/use-asset-index-columns";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import {
  applyAssetModelBucketFilters,
  getAssetModelBucketAssetsEndpoint,
} from "~/modules/asset-model/bucket";
import type { AssetModelBucket } from "~/modules/asset-model/bucket";
import {
  MODEL_VIEW_INAPPLICABLE_PARAMS,
  MODEL_VIEW_SCOPED_PARAMS,
} from "~/modules/asset-model/view-params";
import { tw } from "~/utils/tw";
import { AdvancedAssetRow } from "./advanced-asset-row";
import { AdvancedTableHeader } from "./advanced-table-header";
import { describeEmptyAssetModelSheet } from "./asset-model-sheet-empty-state";
import { freezeColumnClassNames } from "./freeze-column-classes";
import { Button } from "../../shared/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../../shared/sheet";
import { Spinner } from "../../shared/spinner";
import { Th } from "../../table";

/**
 * The endpoint's response body. `payload()` SPREADS its argument onto
 * `{ error: null }`, it does not nest under a `payload` key, so these fields
 * sit at the top level of `fetcher.data`.
 *
 * `unfilteredAssets` is the bucket's asset count with the filters ignored. The
 * endpoint reports it for an empty result set only, and sends `null` otherwise,
 * because that is the only case the sheet has a use for it.
 */
type SheetResponse =
  | {
      error: null;
      assets: AdvancedIndexAsset[];
      totalAssets: number;
      unfilteredAssets: number | null;
    }
  | {
      error: { message: string };
      assets?: undefined;
      totalAssets?: undefined;
      unfilteredAssets?: undefined;
    };

/**
 * The `N assets` trigger plus the sheet it opens.
 *
 * @param bucket - Which rollup row to list. Pass a value with a stable
 *   identity (the row memoises one per `assetModelId`) so the memoised link
 *   below is not rebuilt on every render.
 * @param title - Shown in the sheet title: the model's name, or "No model".
 * @param matchingAssets - The row's filtered count, echoed in the subtitle.
 */
export function AssetModelAssetsSheet({
  bucket,
  title,
  matchingAssets,
}: {
  bucket: AssetModelBucket;
  title: string;
  matchingAssets: number;
}) {
  const [open, setOpen] = useState(false);
  /** The `endpoint:search` the currently-held `fetcher.data` was loaded for. */
  const loadedKeyRef = useRef<string | null>(null);
  /** Bumped to re-run the load effect after a failure, since neither the
   * bucket nor the search string changes on a retry. */
  const [retryToken, setRetryToken] = useState(0);
  const fetcher = useFetcher<SheetResponse>();
  const location = useLocation();
  const columns = useAssetIndexColumns();

  /** Resolved behind the union so a bucket with no id can never be
   * interpolated into a path segment. Stable by value across renders. */
  const endpoint = getAssetModelBucketAssetsEndpoint(bucket);

  useEffect(() => {
    // Keyed on what was actually fetched, not merely on whether anything was.
    // `fetcher.data` stays populated for this component's lifetime, and `open`
    // is local state so toggling it never remounts — so a truthiness check
    // would leave the sheet showing assets from the filters in force at first
    // open, disagreeing with the row's count.
    const loadKey = `${endpoint}:${location.search}`;

    if (!open || fetcher.state !== "idle") {
      return;
    }

    if (fetcher.data && loadedKeyRef.current === loadKey) {
      return;
    }

    const search = new URLSearchParams();
    // Forward the page's own search string untouched: the endpoint strips
    // the view-scoped keys and adds the bucket's predicate. Rebuilding filters
    // here is what makes a sheet disagree with the count that opened it.
    search.set("filters", location.search.replace(/^\?/, ""));

    // `void`: the fetcher owns the request lifecycle and surfaces state through
    // `fetcher.state` / `fetcher.data`, so there is no promise for this effect
    // to await or reject on.
    loadedKeyRef.current = loadKey;

    void fetcher.load(`${endpoint}?${search.toString()}`);
  }, [open, endpoint, location.search, fetcher, retryToken]);

  /**
   * The escape hatch into the flat asset list, carrying the filters that
   * produced this sheet. Built from the page's own search string for the same
   * reason the fetch is: a link assembled from scratch lands the user on a
   * differently-scoped set than the sheet they clicked out of. The view-scoped
   * params have to go or the destination is the rollup again, and the bucket's
   * predicate comes from the same helper the endpoint uses, so the list and
   * the sheet can never describe different sets.
   */
  const viewAllHref = useMemo(() => {
    const params = new URLSearchParams(location.search);

    MODEL_VIEW_SCOPED_PARAMS.forEach((param) => params.delete(param));
    MODEL_VIEW_INAPPLICABLE_PARAMS.forEach((param) => params.delete(param));
    applyAssetModelBucketFilters(params, bucket);

    return `/assets?${params.toString()}`;
  }, [location.search, bucket]);

  // A failed load must not read as an empty bucket. Both render zero rows, and
  // only the error field tells them apart.
  const loadError = fetcher.data?.error ?? null;
  const assets = fetcher.data?.assets ?? [];
  const totalAssets = fetcher.data?.totalAssets ?? 0;
  const isLoading = fetcher.state !== "idle";

  /** A load that came back with nothing in it. Gated on a response being held
   * and on the fetcher being idle, so neither the render before the first load
   * starts nor a reload triggered by changed filters is mistaken for an empty
   * bucket. */
  const isEmptyResult =
    !isLoading && !loadError && Boolean(fetcher.data) && assets.length === 0;

  /**
   * The line under the title. An empty sheet says everything it has to say in
   * the body, so it has no subtitle: two elements stating the same fact read as
   * a rendering fault.
   */
  const subtitle = loadError
    ? "Couldn't load these assets"
    : isEmptyResult
    ? null
    : // The sheet is a peek: it loads one page and does not paginate, so it
    // states when it is showing fewer rows than matched rather than letting
    // the count and the list silently disagree. The footer link is the way to
    // see the rest.
    totalAssets > assets.length
    ? `Showing first ${assets.length} of ${totalAssets} assets matching your filters`
    : `${matchingAssets} ${
        matchingAssets === 1 ? "asset" : "assets"
      } match your filters`;

  /** Clears the cached load key so the effect re-issues the same request. */
  function retry() {
    loadedKeyRef.current = null;
    setRetryToken((token) => token + 1);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="link-gray">
          {matchingAssets} {matchingAssets === 1 ? "asset" : "assets"}
        </Button>
      </SheetTrigger>

      {/* `bg-white` explicitly: the shared variant's `bg-background` has no
          top-level colour in this project's Tailwind config, so every sheet
          supplies its own surface (see booking-assets-sidebar). */}
      <SheetContent
        size="wide"
        className="flex flex-col overflow-hidden bg-white"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {subtitle ? (
            <p className="text-sm text-gray-500">{subtitle}</p>
          ) : null}
        </SheetHeader>

        {/* The ONE scroll container, both axes.
            Deliberately a plain table rather than the shared `Table`: that
            component is built for the index page and brings its own
            `overflow-auto` box capped at `vh - 280px`. Nested inside this
            sheet that yields two scrollbars per axis, dead space below the
            table where the cap reserves height the sheet does not have, and
            an outer scroll that slides the whole table sideways out of view. */}
        <div className="min-h-0 flex-1 overflow-auto">
          {/* `!fetcher.data` covers the render between opening the sheet and the
              effect issuing the request, where the fetcher is still idle and
              holds nothing. Without it that frame draws the empty-bucket
              message at every open. */}
          {isLoading || !fetcher.data ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : loadError ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-gray-600">{loadError.message}</p>
              <Button type="button" variant="secondary" onClick={retry}>
                Try again
              </Button>
            </div>
          ) : assets.length === 0 ? (
            /* No table for an empty set. A model with nothing under it is an
               ordinary row in this view, so this is reached often. Rendering
               the grid anyway gives a dozen empty columns and a horizontal
               scrollbar over nothing, and a message inside a cell spanning
               them all is drawn off-screen, since the cell is as wide as the
               table rather than as wide as the viewport. */
            <div className="px-6 py-8 text-sm text-gray-500">
              {describeEmptyAssetModelSheet({
                bucketKind: bucket.kind,
                unfilteredAssets: fetcher.data?.unfilteredAssets ?? null,
              })}
            </div>
          ) : (
            <AssetIndexSettingsProvider freezeColumn={false}>
              {/* The name column is pinned from the table rather than from the
                  cell: a row's name cell is drawn by the shared
                  `AdvancedIndexColumn`, which takes its own class from the
                  index's freeze setting and its 48px checkbox offset. */}
              <table
                className={tw(
                  "w-full table-auto border-collapse",
                  freezeColumnClassNames.sheetNameCells
                )}
              >
                {/* Sticky above the pinned name cells, which carry a z-index of
                    their own: at equal z-index the later element in the
                    document wins, and the rows would scroll over the header. */}
                <thead
                  className={tw(
                    "sticky top-0 z-20 border-b bg-white",
                    // A sticky element cannot draw its own bottom border, so the
                    // border is a pseudo element.
                    "before:absolute before:inset-x-0 before:bottom-0 before:border-b before:border-gray-200 before:content-['']"
                  )}
                >
                  <tr>
                    {/* `AdvancedTableHeader` emits the CONFIGURED columns only,
                        which never include the name: on the index, `ListHeader`
                        draws that first cell itself. A table that renders the
                        columns alone therefore puts every header one cell left
                        of its data, so this supplies the name header the way
                        `ListHeader` does. */}
                    <Th
                      className={tw(
                        "whitespace-nowrap bg-gray-25 md:border-0",
                        freezeColumnClassNames.sheetNameHeader
                      )}
                    >
                      Name
                    </Th>
                    <AdvancedTableHeader columns={columns} />
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.id}>
                      <AdvancedAssetRow item={asset} extraProps={{ columns }} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </AssetIndexSettingsProvider>
          )}
        </div>

        <div className="border-t pt-3">
          <Button variant="secondary" to={viewAllHref}>
            View all in list →
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
