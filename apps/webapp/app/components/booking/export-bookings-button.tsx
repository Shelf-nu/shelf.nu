import { useState } from "react";
import { useAtomValue } from "jotai";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
import { ALL_SELECTED_KEY, isSelectingAllItems } from "~/utils/list";
import { bookingsListEntries, useBookingsList } from "./bookings-list-fields";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

/**
 * Downloads the selected bookings as CSV: the ticked rows, or with "Select all"
 * every booking the current list holds at its current filters.
 */
export function ExportBookingsButton() {
  const selectedBookings = useAtomValue(selectedBulkItemsAtom);
  const disabled = selectedBookings.length === 0;
  const [isDownloading, setIsDownloading] = useState(false);
  const [searchParams] = useSearchParams();
  const list = useBookingsList();

  const allSelected = isSelectingAllItems(selectedBookings);
  const title = `Export selection ${
    disabled ? "" : allSelected ? "(All)" : `(${selectedBookings.length})`
  }`;

  /** Get the bookingsIds from the atom and add them to bookingsIds search param */
  const bookingsIds = selectedBookings.map((booking) => booking.id);

  const hasAllSelected = bookingsIds.includes(ALL_SELECTED_KEY);
  let fetchSearchParams = "";
  /**
   * "Select all" sends the page's filters, ALL_SELECTED_KEY in place of the
   * ids, and the list the page shows (index, a kit's tab or an asset's tab).
   * The export resolves the rows from those exactly as the list's loader does.
   */
  if (hasAllSelected) {
    const searchParamsCopy = new URLSearchParams(searchParams);
    searchParamsCopy.delete("bookingsIds");
    searchParamsCopy.append("bookingsIds", ALL_SELECTED_KEY);
    for (const [name, value] of bookingsListEntries(list)) {
      searchParamsCopy.set(name, value);
    }
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
      type="button"
      onClick={handleExport}
      variant="secondary"
      className="flex-1 whitespace-nowrap font-medium"
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
