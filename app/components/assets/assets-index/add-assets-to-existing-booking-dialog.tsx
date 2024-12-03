import { useEffect, useState } from "react";
import type { Booking } from "@prisma/client";
import { useAtomValue } from "jotai";
import { z } from "zod";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import { Button } from "~/components/shared/button";

export const addAssetsToExistingBookingSchema = z.object({
  id: z.string(),
  assetsIds: z.string().array().min(1, "Please select at least one asset."),
});

type BookingWithDates = Booking & {
  displayFrom: string;
  displayTo: string;
};

export default function AddAssetsToExistingBookingDialog() {
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const bulkDialogOpenState = useAtomValue(bulkDialogAtom);
  const [isFetchingBookings, setIsFetchingBookings] = useState(false);
  const [bookings, setBookings] = useState<BookingWithDates[]>([]);
  const isDialogOpen = bulkDialogOpenState["booking-exist"] === true;

  useEffect(() => {
    setIsFetchingBookings(true);

    fetch("/api/bookings/get-all")
      .then((response) => response.json())
      .then((data: { bookings: BookingWithDates[] }) => {
        setBookings(data.bookings);
      })
      .finally(() => {
        setIsFetchingBookings(false);
      });
  }, [isDialogOpen]);

  return (
    <BulkUpdateDialogContent
      type="booking-exist"
      arrayFieldId="assetsIds"
      title="Add to existing booking"
      description={`Add selected(${selectedAssets.length}) assets to existing booking.`}
      actionUrl="/api/assets/add-to-booking"
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="max-h-[calc(100vh_-_200px)] overflow-auto">
          <Select name="id" disabled={isFetchingBookings}>
            <SelectTrigger className="mb-4">
              <SelectValue placeholder="Select booking" />
            </SelectTrigger>
            <SelectContent>
              {bookings.map((booking) => (
                <SelectItem asChild key={booking.id} value={booking.id}>
                  <div className="flex flex-col items-start gap-1  text-black">
                    <div className="semi-bold max-w-[250px] truncate">
                      {booking.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {booking.displayFrom} - {booking.displayTo}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedAssets.map((asset, i) => (
            <input
              key={asset.id}
              type="hidden"
              name={`assetIds[${i}]`}
              value={asset.id}
            />
          ))}

          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              width="full"
              disabled={disabled}
            >
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
