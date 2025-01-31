import { useState } from "react";
import domtoimage from "dom-to-image";
import { useAtomValue } from "jotai";
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
import Icon from "../icons/icon";
import type { QrDef } from "../qr/qr-preview";
import { QrLabel } from "../qr/qr-preview";
import { Button } from "../shared/button";

export default function BulkDownloadQrDialog() {
  const [isGeneratingQrCodes, setIsGeneratingQrCodes] = useState(false);
  const [error, setError] = useState("");
  const [searchParams] = useSearchParams();

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);

  async function handleBulkDownloadQr() {
    const query = new URLSearchParams();

    selectedAssets.forEach((asset) => {
      query.append("assetIds", asset.id);
    });

    setIsGeneratingQrCodes(true);

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
          <div className="flex w-full items-center justify-center p-6">
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
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Something went wrong."
      );
    } finally {
      setIsGeneratingQrCodes(false);
    }
  }

  return (
    <Button
      variant="link"
      className="w-full justify-start px-4  py-3 text-gray-700 hover:text-gray-700"
      width="full"
      onClick={handleBulkDownloadQr}
      disabled={!selectedAssets.length || isGeneratingQrCodes}
    >
      <span className="flex items-center gap-2">
        <Icon icon="download" /> Download QR Codes
      </span>
    </Button>
  );
}
