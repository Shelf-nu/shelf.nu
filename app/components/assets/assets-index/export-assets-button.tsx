import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { UpgradeMessage } from "~/components/marketing/upgrade-message";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { isSelectingAllItems } from "~/utils/list";

export function ExportAssetsButton() {
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const { canImportAssets } = useLoaderData<AssetIndexLoaderData>();
  const disabled = selectedAssets.length === 0;
  const [isDownloading, setIsDownloading] = useState(false);

  const allSelected = isSelectingAllItems(selectedAssets);
  const title = `Export selection ${
    disabled ? "" : allSelected ? "(All)" : `(${selectedAssets.length})`
  }`;

  /** Get the assetIds from the atom and add them to assetIds search param */
  const assetIds = selectedAssets.map((asset) => asset.id);
  const url = `/assets/export/assets-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  const searchParams =
    assetIds.length > 0 ? `?assetIds=${assetIds.join(",")}` : "";

  /** Handle the download via fetcher and track state */
  const handleExport = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(`${url}${searchParams}`);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", url.split("/").pop() || "export.csv");
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Button
      onClick={handleExport}
      variant="secondary"
      className="font-medium"
      title={title}
      disabled={
        !canImportAssets
          ? {
              reason: (
                <>
                  Exporting is not available on the free tier of shelf.{" "}
                  <UpgradeMessage />
                </>
              ),
            }
          : disabled
          ? { reason: "You must select at least 1 asset to export" }
          : isDownloading
      }
    >
      <div className="flex items-center gap-1">
        {isDownloading ? (
          <span>
            <Spinner />
          </span>
        ) : null}{" "}
        <span>{title}</span>
      </div>
    </Button>
  );
}
