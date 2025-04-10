import { useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
import { ALL_SELECTED_KEY, isSelectingAllItems } from "~/utils/list";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

export const NRM_ID_PARAM = "nrmIds";

export function ExportNrmButton() {
  const selectedNRMs = useAtomValue(selectedBulkItemsAtom);
  const disabled = selectedNRMs.length === 0;

  const [isDownloading, setIsDownloading] = useState(false);
  const [searchParams] = useSearchParams();

  const allSelected = isSelectingAllItems(selectedNRMs);

  const fetchSearchParams = useMemo(() => {
    const searchParamsCopy = new URLSearchParams(searchParams);

    /** If user is selecting all, then remove other ids and add the ALL_SELECTED_KEY */
    if (allSelected) {
      searchParamsCopy.delete(NRM_ID_PARAM);
      searchParams.append(NRM_ID_PARAM, ALL_SELECTED_KEY);
      return `?${searchParamsCopy.toString()}`;
    }

    /** Otherwise, only add the selected ids */
    return `?${NRM_ID_PARAM}=${selectedNRMs.map((nrm) => nrm.id).join(",")}`;
  }, [allSelected, searchParams, selectedNRMs]);

  async function handleExport() {
    setIsDownloading(true);
    try {
      const url = `/api/settings/export-nrm/nrms-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

      const response = await fetch(url + fetchSearchParams);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", url.split("/").pop() || "nrms.csv");
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Button
      variant="secondary"
      className="w-max"
      disabled={
        disabled
          ? { reason: "You must select at least one NRM to export" }
          : isDownloading
      }
      onClick={handleExport}
    >
      <div className="flex items-center gap-2">
        {isDownloading ? (
          <span>
            <Spinner />
          </span>
        ) : null}{" "}
        <span>
          Export Selection
          {allSelected ? "(All)" : disabled ? "" : `(${selectedNRMs.length})`}
        </span>
      </div>
    </Button>
  );
}
