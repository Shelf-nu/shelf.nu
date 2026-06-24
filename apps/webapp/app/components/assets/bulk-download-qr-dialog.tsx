/**
 * Bulk QR Export dialog — the two-journey hub.
 *
 * Opened from Actions ▸ "Export QR labels" on the asset index. Fetches the
 * selected assets' resolved label data, then offers two opinionated journeys:
 *  - **Print labels** — `<QrLabelSheet>` (react-to-print) plain-paper sheet. Most users.
 *  - **Export for my label printer** — a zip of vector `.svg` labels + a
 *    `manifest.csv`, built from {@link buildLabelZipEntries}. Label-printer users.
 *
 * Replaces the old raster path entirely: no `html-to-image`, no `changedpi`, no
 * `.jpg`, no 100-item cap. Labels are vector and the codes are resolver-driven.
 *
 * @see {@link file://./qr-label-sheet.tsx}
 * @see {@link file://./../../modules/qr/label.ts}
 * @see {@link file://./../../routes/api+/assets.get-assets-for-bulk-qr-download.ts}
 */
import { useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import JSZip from "jszip";
import { DownloadIcon, FileText, Printer, Sparkles } from "lucide-react";
import { useLoaderData } from "react-router";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { QrLabelSheet } from "~/components/assets/qr-label-sheet";
import { UpgradeMessage } from "~/components/marketing/upgrade-message";
import { useSearchParams } from "~/hooks/search-params";
import useApiQuery from "~/hooks/use-api-query";
import { buildLabelZipEntries } from "~/modules/qr/label";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import type { BulkQrDownloadLoaderData } from "~/routes/api+/assets.get-assets-for-bulk-qr-download";
import { isSelectingAllItems } from "~/utils/list";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

type BulkDownloadQrDialogProps = {
  className?: string;
  isDialogOpen: boolean;
  onClose: () => void;
};

type ZipState =
  | { status: "idle" }
  | { status: "building" }
  | { status: "done" }
  | { status: "error"; error: string };

/**
 * @param props.isDialogOpen - controls visibility
 * @param props.onClose - close handler (resets internal view)
 */
export default function BulkDownloadQrDialog({
  className,
  isDialogOpen,
  onClose,
}: BulkDownloadQrDialogProps) {
  const [view, setView] = useState<"choose" | "pdf">("choose");
  const [zip, setZip] = useState<ZipState>({ status: "idle" });
  const [searchParams] = useSearchParams();

  // Paid feature: gated behind the asset-export entitlement (same as CSV export).
  const { canExportAssets } = useLoaderData<AssetIndexLoaderData>();

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const allAssetsSelected = isSelectingAllItems(selectedAssets);

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

  // Bumped on every close so an in-flight zip build that resolves AFTER the
  // dialog was dismissed can't trigger a stray download or flip state to "done".
  const buildTokenRef = useRef(0);

  function handleClose() {
    buildTokenRef.current += 1;
    setView("choose");
    setZip({ status: "idle" });
    onClose();
  }

  async function downloadSvgZip() {
    if (!data) return;
    const token = buildTokenRef.current;
    setZip({ status: "building" });
    try {
      const archive = new JSZip();
      buildLabelZipEntries({
        assets: data.assets,
        qrBaseUrl: data.qrBaseUrl,
        showBranding: data.showBranding,
      }).forEach((entry) => archive.file(entry.path, entry.content));

      const blob = await archive.generateAsync({ type: "blob" });
      // Closed mid-build: abandon silently rather than download after dismissal.
      if (token !== buildTokenRef.current) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `qr-codes-${Date.now()}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 4e4);
      setZip({ status: "done" });
    } catch (cause) {
      if (token !== buildTokenRef.current) return;
      setZip({
        status: "error",
        error: cause instanceof Error ? cause.message : "Something went wrong.",
      });
    }
  }

  // The loader can return an error payload (e.g. a select-all over the export
  // limit). useApiQuery surfaces it as `data` without an `assets` array, so
  // guard before reading `data.assets` instead of crashing.
  const hasAssets = Array.isArray((data as { assets?: unknown })?.assets);

  // Only read `data.assets.length` once we know `data` is a success payload —
  // an error payload is truthy but has no `assets`, so `data?.assets` alone
  // would throw on `.length` before the `hasAssets` guard below can apply.
  const count = allAssetsSelected
    ? hasAssets
      ? data!.assets.length
      : 0
    : selectedAssets.length;

  const apiErrorMessage =
    data && !hasAssets
      ? (data as { error?: { message?: string } }).error?.message ??
        "Something went wrong preparing the labels."
      : null;

  return (
    <DialogPortal>
      <Dialog
        open={isDialogOpen}
        onClose={handleClose}
        className={
          view === "pdf"
            ? "h-dvh w-full md:h-[calc(100vh-4rem)] md:w-[90%] md:py-0"
            : className
        }
        title={
          <div className="flex items-center justify-center rounded-full border-8 border-primary-50 bg-primary-100 p-2 text-primary-600">
            <DownloadIcon />
          </div>
        }
      >
        <div
          className={
            view === "pdf" ? "flex h-full flex-col px-4 pb-4" : "px-6 py-4"
          }
        >
          {!canExportAssets ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex items-center justify-center rounded-full border-8 border-primary-50 bg-primary-100 p-2 text-primary-600">
                <Sparkles />
              </div>
              <h4>Printing QR labels is a premium feature</h4>
              <p className="text-gray-600">
                Upgrade to make sharp, scannable QR labels for your whole
                inventory at once — print a ready-to-cut sheet on a regular
                printer, or download files for a label printer.{" "}
                <UpgradeMessage />
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
              <h3>Preparing {count > 0 ? count : ""} QR codes…</h3>
            </div>
          ) : apiErrorMessage ? (
            <div className="py-6 text-center">
              <p className="mb-4 text-error-500">{apiErrorMessage}</p>
              <Button type="button" variant="secondary" onClick={handleClose}>
                Close
              </Button>
            </div>
          ) : view === "pdf" ? (
            <>
              <button
                type="button"
                onClick={() => setView("choose")}
                className="mb-2 self-start text-sm text-gray-500 hover:text-gray-700"
              >
                ← Back
              </button>
              <div className="min-h-0 grow">
                <QrLabelSheet
                  assets={data.assets}
                  qrBaseUrl={data.qrBaseUrl}
                  showBranding={data.showBranding}
                />
              </div>
            </>
          ) : (
            <>
              <h4 className="mb-1">
                Make QR labels for {data.assets.length}{" "}
                {data.assets.length === 1 ? "asset" : "assets"}
              </h4>
              <p className="mb-4 text-gray-600">
                Pick the option that matches your printer. Each code is already
                linked to its asset — nothing to set up.
              </p>

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setView("pdf")}
                  className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 text-left hover:border-gray-300"
                >
                  <Printer className="mt-0.5 size-5 shrink-0 text-primary-600" />
                  <span>
                    <span className="block font-medium">
                      Print on a regular printer
                    </span>
                    <span className="block text-sm text-gray-500">
                      Inkjet or laser. Prints a sheet of labels you cut out by
                      hand — no special label printer needed. Easiest way to
                      start.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={downloadSvgZip}
                  disabled={zip.status === "building"}
                  className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 text-left hover:border-gray-300 disabled:opacity-60"
                >
                  <FileText className="mt-0.5 size-5 shrink-0 text-primary-600" />
                  <span>
                    <span className="block font-medium">
                      Use a label printer or sticker sheets
                      {zip.status === "building" ? " — preparing…" : ""}
                    </span>
                    <span className="block text-sm text-gray-500">
                      For Brother, Dymo, Avery and similar. Downloads the codes
                      plus a step-by-step how-to (README) inside the zip. A bit
                      more setup.
                    </span>
                  </span>
                </button>
              </div>

              {zip.status === "done" ? (
                <p className="mt-4 text-success-500">
                  Downloaded. Open <strong>README.txt</strong> in the zip for
                  the next steps.
                </p>
              ) : null}
              {zip.status === "error" ? (
                <p className="mt-4 text-error-500">{zip.error}</p>
              ) : null}

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
