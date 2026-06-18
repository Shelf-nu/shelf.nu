import { useState, useMemo, useCallback, useRef } from "react";
import { toBlob } from "html-to-image";
import { useAtomValue } from "jotai";
import JSZip from "jszip";
import { DownloadIcon } from "lucide-react";
import { useLoaderData } from "react-router";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
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
  const [searchParams] = useSearchParams();

  /**
   * Monotonically increasing id of the most recent download request.
   *
   * The dialog stays mounted while the user filters/re-selects behind it (only
   * `isDialogOpen` toggles), and a download can be dismissed (header X, Escape,
   * backdrop) while its fetch is still in flight. A single boolean can't tell
   * which request a late response belongs to once a newer request has started,
   * so every click (and every close) bumps this token; a resolution is only
   * acted on while its captured id still matches the latest one.
   */
  const requestIdRef = useRef(0);

  /**
   * AbortController for the in-flight request, so starting a new download (or
   * closing the dialog) aborts the previous fetch instead of leaving it to
   * resolve and zip stale assets.
   */
  const abortControllerRef = useRef<AbortController | null>(null);

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const allAssetsSelected = isSelectingAllItems(selectedAssets);

  const isSelectingMoreThan100 =
    selectedAssets.length > 100 || (allAssetsSelected && totalItems > 100);

  const disabled =
    selectedAssets.length === 0 || downloadState.status === "loading";

  function handleClose() {
    // Supersede and abort any in-flight request so a late resolution cannot
    // trigger a download after the dialog has been dismissed.
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setDownloadState({ status: "idle" });
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
   * @param requestId - Token of the request that produced `data`; the browser
   * download is skipped if a newer request has since superseded this one.
   */
  const processDownload = useCallback(
    async (data: BulkQrDownloadLoaderData, requestId: number) => {
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

        // A newer request may have superseded this one while we were
        // rasterizing; if so, drop this download silently.
        if (requestId !== requestIdRef.current) return;

        const downloadLink = document.createElement("a");

        downloadLink.href = URL.createObjectURL(zipBlob);
        downloadLink.download = `qr-codes-${new Date().getTime()}.zip`;

        downloadLink.click();

        setTimeout(() => {
          URL.revokeObjectURL(downloadLink.href);
        }, 4e4);

        setDownloadState({ status: "success" });
      } catch (error) {
        // A superseded request must not clobber the UI with its own error.
        if (requestId !== requestIdRef.current) return;
        setDownloadState({
          status: "error",
          error:
            error instanceof Error ? error.message : "Something went wrong.",
        });
      }
    },
    []
  );

  /**
   * Starts a download for the CURRENT selection/filters.
   *
   * Each click supersedes any in-flight request (bumping the token and aborting
   * the previous fetch) and fetches fresh data directly, so a slower earlier
   * response can never be processed in place of this one. We fetch imperatively
   * here — rather than via `useApiQuery` — precisely because this flow needs
   * per-request cancellation that a shared, cache-retaining query hook can't
   * provide.
   */
  async function handleBulkDownloadQr() {
    if (isSelectingMoreThan100 || !apiSearchParams) {
      return;
    }

    // Supersede any in-flight request before starting a fresh one.
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setDownloadState({ status: "loading" });

    try {
      const response = await fetch(
        `/api/assets/get-assets-for-bulk-qr-download?${apiSearchParams.toString()}`,
        { signal: controller.signal }
      );
      const data = (await response.json()) as BulkQrDownloadLoaderData;

      // Ignore the response if a newer request superseded this one in flight.
      if (requestId !== requestIdRef.current) {
        return;
      }

      await processDownload(data, requestId);
    } catch (error) {
      // Aborted/superseded requests resolve here too; only the latest one may
      // surface an error.
      if (requestId !== requestIdRef.current) {
        return;
      }
      setDownloadState({
        status: "error",
        error: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
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
                    onClick={() => void handleBulkDownloadQr()}
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
