import { useState } from "react";
import { useAtomValue } from "jotai";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
import { isSelectingAllItems } from "~/utils/list";
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
  /** If we are filtering by teamMember, we need to send that data as well */
  const teamMemberIds = searchParams.getAll("teamMember");

  const url = `/bookings/export/bookings-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  // @TODO - Here, we have to check if ALL_SELECTED_KEY is included, and if it is, we need to strip the bookingsIds from the searchParams and send all the rest of the search params
  // Then inside the bookings.export loader we can know how to query the bookings
  let fetchSearchParams =
    bookingsIds.length > 0 ? `?bookingsIds=${bookingsIds.join(",")}` : "";

  if (teamMemberIds.length > 0) {
    fetchSearchParams += `&teamMemberIds=${teamMemberIds.join(",")}`;
  }

  /** Handle the download via fetcher and track state */
  const handleExport = async () => {
    setIsDownloading(true);
    try {
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
