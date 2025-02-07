import { useState } from "react";
import { toBlob } from "html-to-image";
import { useAtomValue } from "jotai";
import JSZip from "jszip";
import { DownloadIcon } from "lucide-react";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
import { generateHtmlFromComponent } from "~/utils/component-to-html";
import { isSelectingAllItems } from "~/utils/list";
import { Dialog, DialogPortal } from "../layout/dialog";
import type { QrDef } from "../qr/qr-preview";
import { QrPreview } from "../qr/qr-preview";
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
  const [downloadState, setDownloadState] = useState<DownloadState>({
    status: "idle",
  });
  const [searchParams] = useSearchParams();

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const allAssetsSelected = isSelectingAllItems(selectedAssets);

  const disabled =
    selectedAssets.length === 0 || downloadState.status === "loading";

  function handleClose() {
    setDownloadState({ status: "idle" });
    onClose();
  }

  async function handleBulkDownloadQr() {
    const query = new URLSearchParams();

    selectedAssets.forEach((asset) => {
      query.append("assetIds", asset.id);
    });

    setDownloadState({ status: "loading" });

    try {
      /* Getting all validated assets with qr object */
      const response = await fetch(
        `/api/assets/get-assets-for-bulk-qr-download?${query}&${searchParams}`
      ).then((response) => response.json());

      const assets = response.assets as Array<{
        id: string;
        title: string;
        createdAt: string;
        qr: QrDef;
      }>;

      const zip = new JSZip();
      const qrFolder = zip.folder("qr-codes");

      /* Converting our React component to html so that we can later convert it into an image */
      const qrNodes = assets.map((asset) =>
        generateHtmlFromComponent(
          <QrPreview
            style={{
              border: "3px solid #e5e7eb",
              borderRadius: "4px",
              padding: "16px",
            }}
            hideButton
            qrObj={{ qr: asset.qr }}
            item={{ name: asset.title, type: "asset" }}
          />
        )
      );

      const toBlobOptions = {
        width: 470,
        height: 472,
        backgroundColor: "white",
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          transform: "scale(2)",
          transformOrigin: "center",
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

      qrImages.push(firstQrImage);

      /* Appending qr code image to zip file */
      qrImages.forEach((qrImage, index) => {
        const asset = assets[index];
        const filename = `${asset.title}_${asset.qr.id}.jpg`;
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
      downloadLink.download = "qr-codes.zip";

      downloadLink.click();

      setTimeout(() => {
        URL.revokeObjectURL(downloadLink.href);
      }, 4e4);

      setDownloadState({ status: "success" });
    } catch (error) {
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
              <h4 className="mb-1">
                Download qr codes for{" "}
                {allAssetsSelected ? "all" : selectedAssets.length} asset(s).
              </h4>
              <p className="mb-4">
                {allAssetsSelected ? "All" : selectedAssets.length} qr code(s)
                will be downloaded in a zip file.
              </p>
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
                  className="flex-1"
                  variant="secondary"
                  onClick={handleClose}
                  disabled={disabled}
                >
                  Close
                </Button>

                <When truthy={downloadState.status !== "success"}>
                  <Button
                    className="flex-1"
                    onClick={handleBulkDownloadQr}
                    disabled={disabled}
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
