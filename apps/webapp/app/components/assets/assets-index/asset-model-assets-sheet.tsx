/**
 * Asset Model Assets Sheet
 *
 * Lists the assets behind one model-view row, using the same advanced-index
 * columns the user has configured for the list view.
 *
 * Loads on open rather than with the page: a model can hold hundreds of assets
 * and a page shows many models, so preloading would be unbounded. The fetch
 * forwards the page's current search string, so the sheet always shows exactly
 * the assets the row's count described.
 *
 * The frozen name column is switched off here — freezing anchors the cell to
 * the bulk-select column, which this table does not render.
 *
 * @see {@link file://./../../../routes/api+/asset-models.$assetModelId.assets.ts}
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { AssetIndexSettingsProvider } from "~/context/asset-index-settings-context";
import { useAssetIndexColumns } from "~/hooks/use-asset-index-columns";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import { MODEL_VIEW_SCOPED_PARAMS } from "~/modules/asset-model/view-params";
import { AdvancedAssetRow } from "./advanced-asset-row";
import { AdvancedTableHeader } from "./advanced-table-header";
import { Button } from "../../shared/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../../shared/sheet";
import { Spinner } from "../../shared/spinner";
import { Table } from "../../table";

/**
 * The endpoint's response body. `payload()` SPREADS its argument onto
 * `{ error: null }` — it does not nest under a `payload` key — so these
 * fields sit at the top level of `fetcher.data`.
 */
type SheetResponse =
  | { error: null; assets: AdvancedIndexAsset[]; totalAssets: number }
  | { error: { message: string }; assets?: undefined; totalAssets?: undefined };

/**
 * The `N assets` trigger plus the sheet it opens.
 *
 * @param assetModelId - Model whose assets to list.
 * @param modelName - Shown in the sheet title.
 * @param matchingAssets - The row's filtered count, echoed in the subtitle.
 */
export function AssetModelAssetsSheet({
  assetModelId,
  modelName,
  matchingAssets,
}: {
  assetModelId: string;
  modelName: string;
  matchingAssets: number;
}) {
  const [open, setOpen] = useState(false);
  /** The `modelId:search` the currently-held `fetcher.data` was loaded for. */
  const loadedKeyRef = useRef<string | null>(null);
  /** Bumped to re-run the load effect after a failure, since neither the model
   * nor the search string changes on a retry. */
  const [retryToken, setRetryToken] = useState(0);
  const fetcher = useFetcher<SheetResponse>();
  const location = useLocation();
  const columns = useAssetIndexColumns();

  useEffect(() => {
    // Keyed on what was actually fetched, not merely on whether anything was.
    // `fetcher.data` stays populated for this component's lifetime, and `open`
    // is local state so toggling it never remounts — so a truthiness check
    // would leave the sheet showing assets from the filters in force at first
    // open, disagreeing with the row's count.
    const loadKey = `${assetModelId}:${location.search}`;

    if (!open || fetcher.state !== "idle") {
      return;
    }

    if (fetcher.data && loadedKeyRef.current === loadKey) {
      return;
    }

    const search = new URLSearchParams();
    // Forward the page's own search string untouched — the endpoint strips
    // the view-scoped keys. Rebuilding filters here is what makes a sheet
    // disagree with the count that opened it.
    search.set("filters", location.search.replace(/^\?/, ""));

    // `void`: the fetcher owns the request lifecycle and surfaces state through
    // `fetcher.state` / `fetcher.data`, so there is no promise for this effect
    // to await or reject on.
    loadedKeyRef.current = loadKey;

    void fetcher.load(
      `/api/asset-models/${assetModelId}/assets?${search.toString()}`
    );
  }, [open, assetModelId, location.search, fetcher, retryToken]);

  /**
   * The escape hatch into the flat asset list, carrying the filters that
   * produced this sheet. Built from the page's own search string for the same
   * reason the fetch is: a link assembled from scratch lands the user on a
   * differently-scoped set than the sheet they clicked out of. `view` has to go
   * or the destination is the rollup again, and `set` rather than `append`
   * replaces any model filter already in force instead of conflicting with it.
   */
  const viewAllHref = useMemo(() => {
    const params = new URLSearchParams(location.search);

    MODEL_VIEW_SCOPED_PARAMS.forEach((param) => params.delete(param));
    params.set("assetModel", `is:${assetModelId}`);

    return `/assets?${params.toString()}`;
  }, [location.search, assetModelId]);

  // A failed load must not read as an empty model. Both render zero rows, and
  // only the error field tells them apart.
  const loadError = fetcher.data?.error ?? null;
  const assets = fetcher.data?.assets ?? [];
  const totalAssets = fetcher.data?.totalAssets ?? 0;
  const isLoading = fetcher.state !== "idle";

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
          <SheetTitle>{modelName}</SheetTitle>
          <p className="text-sm text-gray-500">
            {/* The sheet is a peek: it loads one page and does not paginate,
                so it states when it is showing fewer rows than matched rather
                than letting the count and the list silently disagree. The
                footer link is the way to see the rest. */}
            {loadError
              ? "Couldn't load this model's assets"
              : totalAssets > assets.length
              ? `Showing first ${assets.length} of ${totalAssets} assets matching your filters`
              : `${matchingAssets} ${
                  matchingAssets === 1 ? "asset" : "assets"
                } match your filters`}
          </p>
        </SheetHeader>

        {/* Vertical only: the shared `Table` brings its own horizontal
            scroll container, and scrolling both axes here would give a wide
            column set two horizontal scrollbars. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
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
          ) : (
            <AssetIndexSettingsProvider freezeColumn={false}>
              <Table>
                <thead>
                  <tr>
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
              </Table>
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
