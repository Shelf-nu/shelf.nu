import { useState, useMemo, useCallback, useRef } from "react";
import { toBlob } from "html-to-image";
import { useAtomValue } from "jotai";
import JSZip from "jszip";
import { DownloadIcon } from "lucide-react";
import { useLoaderData } from "react-router";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
import useApiQuery from "~/hooks/use-api-query";
import type { BulkQrDownloadLoaderData } from "~/routes/api+/assets.get-assets-for-bulk-qr-download";
import { generateHtmlFromComponent } from "~/utils/component-to-html";
import { isSelectingAllItems } from "~/utils/list";
import { sanitizeFilename } from "~/utils/misc";
import { QrLabel } from "../code-preview/code-preview";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

type BulkDownloadQrDialogProps = {
  className?: string;
  isDialogOpen: boolean;
  onClose: () => void;
};

type DownloadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success" }
  | { status: "error"; error: string };

export default function BulkDownloadQrDialog({
  className,
  isDialogOpen,
  onClose,
}: BulkDownloadQrDialogProps) {
  const { totalItems } = useLoaderData<{ totalItems: number }>();

  const [downloadState, setDownloadState] = useState<DownloadState>({
    status: "idle",
  });
  const [shouldFetchAssets, setShouldFetchAssets] = useState(false);
  const [searchParams] = useSearchParams();

  /**
   * Tracks whether a download the user explicitly requested is still pending.
   *
   * The dialog stays mounted while the user filters/re-selects behind it (only
   * `isDialogOpen` toggles), so the fetched response must never be reused across
   * requests. This ref lets the (stable) success/error callbacks ignore a
   * resolution whose request was cancelled — e.g. the dialog was closed while
   * the fetch was in flight — instead of triggering a stale download.
   */
  const isDownloadPendingRef = useRef(false);

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const allAssetsSelected = isSelectingAllItems(selectedAssets);

  const isSelectingMoreThan100 =
    selectedAssets.length > 100 || (allAssetsSelected && totalItems > 100);

  const disabled =
    selectedAssets.length === 0 || downloadState.status === "loading";

  function handleClose() {
    // Cancel any in-flight request so a late resolution cannot trigger a
    // download after the dialog has been closed.
    isDownloadPendingRef.current = false;
    setDownloadState({ status: "idle" });
    setShouldFetchAssets(false);
    onClose();
  }

  // Prepare API query parameters
  const apiSearchParams = useMemo(() => {
    if (selectedAssets.length === 0) return undefined;

    const query = new URLSearchParams(searchParams);
    selectedAssets.forEach((asset) => {
      query.append("assetIds", asset.id);
    });
    return query;
  }, [selectedAssets, searchParams]);

  /**
   * Builds the QR zip from the assets returned for THIS request and triggers the
   * browser download.
   *
   * The freshly fetched payload is passed in as an argument and never read from
   * the query cache, so the zip always contains the assets matching the request
   * the user just made — not a response cached from a previous filter/selection.
   *
   * @param data - Asset + QR payload for the current selection/filters
   */
  const processDownload = useCallback(
    async (data: BulkQrDownloadLoaderData) => {
      try {
        const { assets, qrIdDisplayPreference, showShelfBranding } = data;

        const zip = new JSZip();
        const qrFolder = zip.folder("qr-codes");

        /* Converting our React component to html so that we can later convert it into an image */
        const qrNodes = assets.map((asset) =>
          generateHtmlFromComponent(
            <QrLabel
              data={{ qr: asset.qr }}
              title={asset.title}
              qrIdDisplayPreference={qrIdDisplayPreference}
              sequentialId={asset.sequentialId}
              showShelfBranding={showShelfBranding}
            />
          )
        );

        const toBlobOptions = {
          width: 300,
          height: 300,
          backgroundColor: "white",
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
          },
        };

        /**
         * We are converting first qr to image separately because toBlob will cache the font
         * and will not make further network requests for other qr codes.
         */
        const firstQrImage = await toBlob(qrNodes[0], toBlobOptions);

        /* Converting all qr nodes into images */
        const qrImages = await Promise.all(
          qrNodes.slice(1).map((qrNode) => toBlob(qrNode, toBlobOptions))
        );

        /* Appending qr code image to zip file */
        [firstQrImage, ...qrImages].forEach((qrImage, index) => {
          const asset = assets[index];

          // Generate filename based on preference
          let filename: string;
          if (qrIdDisplayPreference === "SAM_ID" && asset.sequentialId) {
            filename = `${asset.sequentialId}_${sanitizeFilename(
              asset.title
            )}_${asset.qr.id}.jpg`;
          } else {
            filename = `${sanitizeFilename(asset.title)}_${asset.qr.id}.jpg`;
          }

          if (!qrImage) {
            return;
          }

          if (qrFolder) {
            qrFolder.file(filename, qrImage);
          } else {
            zip.file(filename, qrImage);
          }
        });

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const downloadLink = document.createElement("a");

        downloadLink.href = URL.createObjectURL(zipBlob);
        downloadLink.download = `qr-codes-${new Date().getTime()}.zip`;

        downloadLink.click();

        setTimeout(() => {
          URL.revokeObjectURL(downloadLink.href);
        }, 4e4);

        setDownloadState({ status: "success" });
      } catch (error) {
        setDownloadState({
          status: "error",
          error:
            error instanceof Error ? error.message : "Something went wrong.",
        });
      } finally {
        // Re-arm the fetch gate so the NEXT Download click triggers a fresh
        // fetch (useApiQuery refires on the enabled false->true edge).
        setShouldFetchAssets(false);
      }
    },
    []
  );

  /**
   * Stable success handler for the assets query. Drives the download with the
   * freshly fetched payload, ignoring a resolution whose request was cancelled
   * (e.g. the dialog was closed while the fetch was in flight).
   */
  const handleQuerySuccess = useCallback(
    (data: BulkQrDownloadLoaderData) => {
      if (!isDownloadPendingRef.current) return;
      isDownloadPendingRef.current = false;
      void processDownload(data);
    },
    [processDownload]
  );

  /** Stable error handler for the assets query. */
  const handleQueryError = useCallback((message: string) => {
    if (!isDownloadPendingRef.current) return;
    isDownloadPendingRef.current = false;
    setShouldFetchAssets(false);
    setDownloadState({ status: "error", error: message });
  }, []);

  /**
   * Fetches assets for the CURRENT request. `enabled` is true only while a
   * download is pending and is re-armed on every click, so each download fetches
   * fresh data for the live selection/filters instead of reusing a cached
   * response. The download is driven by `onSuccess` (not the cached `data`) so a
   * stale response can never be acted on.
   */
  useApiQuery<BulkQrDownloadLoaderData>({
    api: "/api/assets/get-assets-for-bulk-qr-download",
    searchParams: apiSearchParams,
    enabled: shouldFetchAssets && !isSelectingMoreThan100,
    onSuccess: handleQuerySuccess,
    onError: handleQueryError,
  });

  function handleBulkDownloadQr() {
    if (isSelectingMoreThan100) {
      return;
    }

    // Mark a fresh request and (re)arm the fetch. shouldFetchAssets is always
    // false here (it is reset after each download/close), so this false->true
    // edge is what makes useApiQuery fetch the CURRENT selection/filters.
    isDownloadPendingRef.current = true;
    setDownloadState({ status: "loading" });
    setShouldFetchAssets(true);
  }

  return (
    <DialogPortal>
      <Dialog
        open={isDialogOpen}
        onClose={handleClose}
        className={className}
        title={
          <div className="flex items-center justify-center rounded-full border-8 border-primary-50 bg-primary-100 p-2 text-primary-600">
            <DownloadIcon />
          </div>
        }
      >
        <div className="px-6 py-4">
          {downloadState.status === "loading" ? (
            <div className="mb-6 flex flex-col items-center gap-4">
              <Spinner />
              <h3>Generating Zip file ...</h3>
            </div>
          ) : (
            <>
              <When
                truthy={!isSelectingMoreThan100}
                fallback={
                  <p className="mb-4">
                    Bulk downloading QR codes is only available for maximum 100
                    codes at a time. Please select less codes to download.
                  </p>
                }
              >
                <h4 className="mb-1">
                  Download qr codes for{" "}
                  {allAssetsSelected ? "all" : selectedAssets.length} asset(s).
                </h4>
                <p className="mb-4">
                  {allAssetsSelected ? "All" : selectedAssets.length} qr code(s)
                  will be downloaded in a zip file.
                </p>
              </When>

              <When truthy={downloadState.status === "success"}>
                <p className="mb-4 text-success-500">
                  Successfully downloaded qr codes.
                </p>
              </When>

              {downloadState.status === "error" ? (
                <p className="mb-4 text-error-500">{downloadState.error}</p>
              ) : null}

              <div className="flex w-full items-center justify-center gap-4">
                <Button
                  type="button"
                  className="flex-1"
                  variant="secondary"
                  onClick={handleClose}
                  disabled={disabled}
                >
                  Close
                </Button>

                <When truthy={downloadState.status !== "success"}>
                  <Button
                    type="button"
                    className="flex-1"
                    onClick={handleBulkDownloadQr}
                    disabled={disabled || isSelectingMoreThan100}
                  >
                    Download
                  </Button>
                </When>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </DialogPortal>
  );
}
