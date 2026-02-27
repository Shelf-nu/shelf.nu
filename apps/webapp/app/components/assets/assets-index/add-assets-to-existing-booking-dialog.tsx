import type { Asset, Booking } from "@prisma/client";
import { useAtomValue } from "jotai";
import { useNavigate } from "react-router";
import { useZorm } from "react-zorm";
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
import { DateS } from "~/components/shared/date";
import When from "~/components/when/when";
import useApiQuery from "~/hooks/use-api-query";

export const addAssetsToExistingBookingSchema = z.object({
  id: z
    .string({ required_error: "Please select booking." })
    .min(1, "Please select booking."),
  assetsIds: z.string().array().min(1, "Please select at least one asset."),
  addOnlyRestAssets: z.coerce.boolean().optional().nullable(),
});

export default function AddAssetsToExistingBookingDialog() {
  const navigate = useNavigate();

  const zo = useZorm(
    "AddAssetsToExistingBooking",
    addAssetsToExistingBookingSchema
  );

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const bulkDialogOpenState = useAtomValue(bulkDialogAtom);

  const isDialogOpen = bulkDialogOpenState["booking-exist"] === true;

  const {
    data: bookingsData,
    isLoading: isFetchingBookings,
    error: _bookingsError,
  } = useApiQuery<{ error: null; bookings: Booking[] }>({
    api: "/api/bookings/get-all",
    enabled: isDialogOpen,
  });

  const bookings = bookingsData?.bookings || [];

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="booking-exist"
      arrayFieldId="assetsIds"
      title="Add to existing booking"
      description={`Add selected(${selectedAssets.length}) assets to existing booking.`}
      actionUrl="/api/assets/add-to-booking"
      className="lg:w-[600px]"
      skipCloseOnSuccess
    >
      {({
        disabled,
        handleCloseDialog,
        fetcherData,
        fetcherError,
        fetcherErrorAdditionalData,
      }) => (
        <>
          {/* Handling the initial state of the dialog */}
          <When truthy={!fetcherData?.success}>
            <div className="max-h-[calc(100vh_-_200px)] overflow-auto">
              <Select name="id" disabled={isFetchingBookings || disabled}>
                <SelectTrigger className="mb-4">
                  <SelectValue
                    placeholder={
                      isFetchingBookings
                        ? "Fetching bookings..."
                        : bookings.length === 0
                        ? "No bookings available"
                        : "Select booking"
                    }
                  />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="min-w-[var(--radix-select-trigger-width)]"
                  align="start"
                >
                  {bookings.length > 0 ? (
                    bookings.map((booking) => (
                      <SelectItem key={booking.id} value={booking.id}>
                        <div className="flex flex-col items-start gap-1  text-black">
                          <div className="semi-bold max-w-[250px] truncate">
                            {booking.name}
                          </div>
                          <div className="text-xs text-color-500">
                            <DateS date={booking.from} includeTime /> -{" "}
                            <DateS date={booking.to} includeTime />
                          </div>
                        </div>
                      </SelectItem>
                    ))
                  ) : (
                    <div className="p-2 text-center text-sm text-color-500">
                      No bookings available
                    </div>
                  )}
                </SelectContent>
              </Select>
              <When truthy={!isFetchingBookings && bookings.length === 0}>
                <div className="mb-4 rounded-md border border-color-300 bg-color-25 p-2">
                  <p className="text-sm text-color-600">
                    No draft or reserved bookings found. Create a new booking
                    first to add assets to it.
                  </p>
                </div>
              </When>
              <When truthy={!!zo.errors.id()?.message}>
                <p className="mb-4 text-sm text-error-500">
                  {zo.errors.id()?.message}
                </p>
              </When>

              <When truthy={!!fetcherError || !!fetcherErrorAdditionalData}>
                <div className="mb-4 rounded-md border border-color-300 bg-color-25 p-2">
                  <When truthy={!!fetcherError}>
                    <p>{fetcherError}</p>
                  </When>
                  <When
                    truthy={
                      !!fetcherErrorAdditionalData &&
                      fetcherErrorAdditionalData?.alreadyAddedAssets?.length
                    }
                  >
                    <div className="mt-4">
                      <p>Already added assets are : </p>
                      <ul className="mb-2 list-inside list-disc">
                        {fetcherErrorAdditionalData?.alreadyAddedAssets.map(
                          (asset: Pick<Asset, "id" | "title">) => (
                            <li key={asset.id}>{asset.title}</li>
                          )
                        )}
                      </ul>

                      <input
                        type="hidden"
                        name="addOnlyRestAssets"
                        value="true"
                      />

                      <When
                        truthy={!fetcherErrorAdditionalData?.allAssetsInBooking}
                      >
                        <Button className="w-full" variant="secondary">
                          Add only the rest of the assets
                        </Button>
                      </When>
                    </div>
                  </When>
                </div>
              </When>

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
          </When>

          {/* Handling the after success state of the dialog */}
          <When truthy={!!fetcherData?.success}>
            <div>
              <div className="mb-4 rounded-md border border-success-500 p-2 text-success-500">
                <h5 className="text-success-500">Booking updated</h5>
                <p>
                  The assets you selected have been added to the booking. Do you
                  want to add more or view the booking?
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  width="full"
                  disabled={disabled}
                  onClick={handleCloseDialog}
                >
                  Add more
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  width="full"
                  disabled={disabled}
                  onClick={() => {
                    void navigate(`/bookings/${fetcherData?.bookingId}`);
                  }}
                >
                  View booking
                </Button>
              </div>
            </div>
          </When>
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
