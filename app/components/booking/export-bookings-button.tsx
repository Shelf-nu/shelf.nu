import { useState } from "react";
import { useAtomValue } from "jotai";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
import { ALL_SELECTED_KEY, isSelectingAllItems } from "~/utils/list";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

export function ExportBookingsButton() {
  const selectedBookings = useAtomValue(selectedBulkItemsAtom);
  const disabled = selectedBookings.length === 0;
  const [isDownloading, setIsDownloading] = useState(false);
  const [searchParams] = useSearchParams();

  const allSelected = isSelectingAllItems(selectedBookings);
  const title = `Export selection ${
    disabled ? "" : allSelected ? "(All)" : `(${selectedBookings.length})`
  }`;

  /** Get the bookingsIds from the atom and add them to bookingsIds search param */
  const bookingsIds = selectedBookings.map((booking) => booking.id);

  const hasAllSelected = bookingsIds.includes(ALL_SELECTED_KEY);
  let fetchSearchParams = "";
  /**
   * We have to check if ALL_SELECTED_KEY is included, and if it is, we need to strip the bookingsIds from the searchParams and send all the rest of the search params to the loader
   * Then inside the bookings.export loader we can know how to query the bookings
   * It is important to keep the ALL_SELECTED_KEY because that helps us know how to query
   */
  if (hasAllSelected) {
    const searchParamsCopy = new URLSearchParams(searchParams);
    // Delete bookingsIds
    searchParamsCopy.delete("bookingsIds");
    // Add back ALL_SELECTED_KEY to bookingsIds
    searchParamsCopy.append("bookingsIds", ALL_SELECTED_KEY);
    fetchSearchParams = `?${searchParamsCopy.toString()}`;
  } else {
    // In this case only specific keys are selected so we dont need the filters, we just pass the ids of the selected bookings
    fetchSearchParams = `?bookingsIds=${bookingsIds.join(",")}`;
  }

  /** Handle the download via fetcher and track state */
  const handleExport = async () => {
    setIsDownloading(true);
    try {
      const now = new Date();
      const url = `/bookings/export/bookings-${now
        .toISOString()
        .slice(0, 10)}-${now.getTime()}.csv`;
      const response = await fetch(`${url}${fetchSearchParams}`);
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
        disabled
          ? { reason: "You must select at least 1 booking to export" }
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
