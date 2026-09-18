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
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { AssetIndexSettingsProvider } from "~/context/asset-index-settings-context";
import { useAssetIndexColumns } from "~/hooks/use-asset-index-columns";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
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
type SheetResponse = {
  error: null;
  assets: AdvancedIndexAsset[];
  totalAssets: number;
};

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
  }, [open, assetModelId, location.search, fetcher]);

  const assets = fetcher.data?.assets ?? [];
  const totalAssets = fetcher.data?.totalAssets ?? 0;
  const isLoading = fetcher.state !== "idle";

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
            {totalAssets > assets.length
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
          <Button
            variant="secondary"
            to={`/assets?assetModel=is%3A${assetModelId}`}
          >
            View all in list →
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
