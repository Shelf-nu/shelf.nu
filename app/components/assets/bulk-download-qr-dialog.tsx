import { cloneElement, useState } from "react";
import domtoimage from "dom-to-image";
import { useAtomValue } from "jotai";
import JSZip from "jszip";
import { DownloadIcon } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
import { isSelectingAllItems } from "~/utils/list";
import { tw } from "~/utils/tw";
import Icon from "../icons/icon";
import { Dialog, DialogPortal } from "../layout/dialog";
import type { QrDef } from "../qr/qr-preview";
import { QrLabel } from "../qr/qr-preview";
import { Button } from "../shared/button";
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

      for (const asset of assets) {
        const filename = `${asset.id}.jpg`;

        /* Converting our React compoentn to html so that we can later convert it into an image */
        const qrCodeContent = renderToStaticMarkup(
          <div className="flex w-full items-center justify-center p-6 text-center">
            <QrLabel data={{ qr: asset.qr }} title={asset.title} />
          </div>
        );

        /* Creating div element to convert it into image because domtoimage expects an Html node */
        const div = document.createElement("div");
        div.innerHTML = qrCodeContent;

        /* Converting html to image */
        const qrBlob = await domtoimage.toBlob(div, {
          height: 600,
          width: 600,
          bgcolor: "white",
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            transform: "scale(2)",
            transformOrigin: "center",
          },
        });

        const qrImageFile = new File([qrBlob], filename);

        /* Appending qr code image to zip file */
        if (qrFolder) {
          qrFolder.file(filename, qrImageFile);
        } else {
          zip.file(filename, qrImageFile);
        }
      }

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
          <h4 className="mb-1">
            Download qr codes for{" "}
            {allAssetsSelected ? "all" : selectedAssets.length} asset(s).
          </h4>
          <p className="mb-4">
            {allAssetsSelected ? "All" : selectedAssets.length} qr code(s) will
            be downloaded in a zip file.
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

            <Button
              className="flex-1"
              onClick={handleBulkDownloadQr}
              disabled={disabled}
            >
              Download
            </Button>
          </div>
        </div>
      </Dialog>
    </DialogPortal>
  );
}
