/**
 * Bulk QR export dialog — the hub of the two print journeys.
 *
 * Opened from Actions ▸ "Export QR labels" on the asset index. Fetches the
 * selected assets' resolved label data, then offers:
 *  - **Print on a regular printer** — `<QrLabelSheet>`: plain paper you cut,
 *    or a pre-cut sticker sheet template.
 *  - **Print on a label printer** — `<QrLabelStockSheet>`: one label per
 *    print on die-cut stock, or the SVG files for label software.
 *
 * Paid feature: gated by the asset-export entitlement (same as CSV export);
 * free workspaces see the upgrade prompt instead of fetching.
 *
 * @see {@link file://./qr-label-sheet.tsx}
 * @see {@link file://./qr-label-stock-sheet.tsx}
 * @see {@link file://./../../routes/api+/assets.get-assets-for-bulk-qr-download.ts}
 */
import { useMemo, useState, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { DownloadIcon, Printer, Sparkles, Tags } from "lucide-react";
import { useLoaderData } from "react-router";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { QrLabelSheet } from "~/components/assets/qr-label-sheet";
import { QrLabelStockSheet } from "~/components/assets/qr-label-stock-sheet";
import { UpgradeMessage } from "~/components/marketing/upgrade-message";
import { useSearchParams } from "~/hooks/search-params";
import useApiQuery from "~/hooks/use-api-query";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import type { BulkQrDownloadLoaderData } from "~/routes/api+/assets.get-assets-for-bulk-qr-download";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

type BulkDownloadQrDialogProps = {
  className?: string;
  isDialogOpen: boolean;
  onClose: () => void;
};

/** Which screen of the dialog is showing. */
type DialogView = "choose" | "sheet" | "stock";

/**
 * @param props.isDialogOpen - controls visibility
 * @param props.onClose - close handler (resets internal view)
 */
export default function BulkDownloadQrDialog({
  className,
  isDialogOpen,
  onClose,
}: BulkDownloadQrDialogProps) {
  const [view, setView] = useState<DialogView>("choose");
  const [searchParams] = useSearchParams();

  // Paid feature: gated behind the asset-export entitlement (same as CSV export).
  const { canExportAssets } = useLoaderData<AssetIndexLoaderData>();

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);

  // Build the query: current filters + each selected asset id (ALL_SELECTED_KEY
  // included when selecting all, so the loader re-applies the index filters).
  const apiSearchParams = useMemo(() => {
    if (selectedAssets.length === 0) return undefined;
    const query = new URLSearchParams(searchParams);
    selectedAssets.forEach((asset) => query.append("assetIds", asset.id));
    return query;
  }, [selectedAssets, searchParams]);

  const { data, isLoading } = useApiQuery<BulkQrDownloadLoaderData>({
    api: "/api/assets/get-assets-for-bulk-qr-download",
    searchParams: apiSearchParams,
    // Don't even fetch for free users — the loader would 403; show the upsell instead.
    enabled: isDialogOpen && canExportAssets && !!apiSearchParams,
  });

  function handleClose() {
    setView("choose");
    onClose();
  }

  // The print journeys need the roomy dialog.
  const isFullScreen = view === "sheet" || view === "stock";

  // The loader can return an error payload (e.g. a select-all over the export
  // limit). useApiQuery surfaces it as `data` without an `assets` array, so
  // guard before reading `data.assets` instead of crashing.
  const hasAssets = Array.isArray((data as { assets?: unknown })?.assets);

  const apiErrorMessage =
    data && !hasAssets
      ? (data as { error?: { message?: string } }).error?.message ??
        "Something went wrong preparing the labels."
      : null;

  const title = !canExportAssets
    ? "Printing QR labels is a premium feature"
    : view === "sheet"
    ? "Print on a regular printer"
    : view === "stock"
    ? "Print on a label printer"
    : hasAssets
    ? `Make QR labels for ${data!.assets.length} ${
        data!.assets.length === 1 ? "asset" : "assets"
      }`
    : "Make QR labels";

  return (
    <DialogPortal>
      <Dialog
        open={isDialogOpen}
        onClose={handleClose}
        className={
          isFullScreen
            ? "h-dvh w-full md:h-[calc(100vh-4rem)] md:w-[90%] md:py-0"
            : className
        }
        title={
          <div className="w-full">
            <div className="mb-2 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
              {canExportAssets ? <DownloadIcon /> : <Sparkles />}
            </div>
            <h4>{title}</h4>
          </div>
        }
      >
        <div
          className={
            isFullScreen ? "flex h-full flex-col px-4 pb-4" : "px-6 py-4"
          }
        >
          {!canExportAssets ? (
            <div className="flex flex-col gap-3">
              <p className="text-gray-600">
                Upgrade to make sharp, scannable QR labels for your whole
                inventory at once: print a sheet on a regular printer, or send
                one label at a time to a label printer. <UpgradeMessage />
              </p>
              <div className="mt-4 flex w-full justify-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleClose}
                  width="full"
                >
                  Not now
                </Button>
                <Button to="/account-details/subscription" width="full">
                  Upgrade
                </Button>
              </div>
            </div>
          ) : isLoading || !data ? (
            <div className="mb-6 flex flex-col items-center gap-4 py-6">
              <Spinner />
              <p className="font-medium text-gray-700">
                Preparing your labels…
              </p>
            </div>
          ) : apiErrorMessage ? (
            <div className="py-6 text-center">
              <p className="mb-4 text-error-500">{apiErrorMessage}</p>
              <Button type="button" variant="secondary" onClick={handleClose}>
                Close
              </Button>
            </div>
          ) : isFullScreen ? (
            <>
              <button
                type="button"
                onClick={() => setView("choose")}
                className="mb-2 self-start text-sm text-gray-500 hover:text-gray-700"
              >
                ← Back
              </button>
              <div className="min-h-0 grow">
                {view === "sheet" ? (
                  <QrLabelSheet
                    assets={data.assets}
                    qrBaseUrl={data.qrBaseUrl}
                    showBranding={data.showBranding}
                  />
                ) : (
                  <QrLabelStockSheet
                    assets={data.assets}
                    qrBaseUrl={data.qrBaseUrl}
                    showBranding={data.showBranding}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <p className="mb-4 text-gray-600">
                Pick the option that matches your printer. Each code is already
                linked to its asset, so there is nothing to set up.
              </p>

              {data.skippedAssetCount > 0 ? (
                <p className="mb-4 rounded-md border border-warning-300 bg-warning-50 p-3 text-sm text-warning-800">
                  {data.skippedAssetCount} of the selected assets{" "}
                  {data.skippedAssetCount === 1 ? "has" : "have"} no QR code
                  yet, so {data.skippedAssetCount === 1 ? "it is" : "they are"}{" "}
                  not included.
                </p>
              ) : null}

              <div className="flex flex-col gap-3">
                <JourneyCard
                  icon={
                    <Printer className="mt-0.5 size-5 shrink-0 text-primary-600" />
                  }
                  title="Print on a regular printer"
                  body="Inkjet or laser. Plain paper you cut by hand, or Avery-style label sheets."
                  onClick={() => setView("sheet")}
                />
                <JourneyCard
                  icon={
                    <Tags className="mt-0.5 size-5 shrink-0 text-primary-600" />
                  }
                  title="Print on a label printer"
                  body="WASP, Brother, Dymo and similar. One ready-to-stick label per print, or download the files for your label software."
                  onClick={() => setView("stock")}
                />
              </div>

              <div className="mt-6 flex justify-end">
                <Button type="button" variant="secondary" onClick={handleClose}>
                  Close
                </Button>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </DialogPortal>
  );
}

/** One journey option on the choose screen. */
function JourneyCard({
  icon,
  title,
  body,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 text-left hover:border-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
    >
      {icon}
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-gray-500">{body}</span>
      </span>
    </button>
  );
}
