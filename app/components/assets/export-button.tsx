import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/assets._index";
import { Button } from "../shared/button";

export const ExportButton = ({
  canExportAssets,
}: {
  canExportAssets: boolean;
}) => {
  const { totalItems } = useLoaderData<typeof loader>();
  return (
    <Button
      to={`/assets/export/assets-${new Date().toISOString().slice(0, 10)}.csv`}
      variant="secondary"
      download
      reloadDocument
      disabled={
        !canExportAssets || totalItems === 0
          ? {
              reason:
                totalItems === 0
                  ? "You don't have any assets to export"
                  : "Exporting is not available on the free tier of shelf.",
            }
          : false
      }
      title={totalItems === 0 ? "No assets to export" : "Export assets"}
    >
      Download CSV
    </Button>
  );
};
