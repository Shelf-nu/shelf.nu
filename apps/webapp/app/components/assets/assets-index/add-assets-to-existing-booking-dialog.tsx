import { useMemo, useRef, useState } from "react";
import type { Asset, Booking } from "@prisma/client";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useAtomValue } from "jotai";
import { useNavigate } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import Input from "~/components/forms/input";
import { CheckIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import When from "~/components/when/when";
import useApiQuery from "~/hooks/use-api-query";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";

/**
 * Slim booking shape returned by `/api/bookings/get-all` (see
 * `getMinimalBookings`). Only the fields this picker renders — deliberately not
 * the full Prisma `Booking`, so nobody reads a column the endpoint no longer
 * sends.
 */
type PickerBooking = Pick<Booking, "id" | "name" | "status" | "from" | "to">;

export const addAssetsToExistingBookingSchema = z.object({
  id: z
    .string({ required_error: "Please select booking." })
    .min(1, "Please select booking."),
  assetsIds: z.string().array().min(1, "Please select at least one asset."),
  addOnlyRestAssets: z.coerce.boolean().optional().nullable(),
});

/**
 * Searchable booking picker for the bulk "add to existing booking" dialog.
 *
 * Mirrors the look & feel of the shared `DynamicSelect` (searchable popover,
 * check-marked selection, date range per row) but is fed directly from the
 * `/api/bookings/get-all` fetch instead of route-loader data — the assets-index
 * loader does not (and should not, for perf) carry booking data. `get-all`
 * returns every open booking (slim projection), so filtering is done
 * client-side for instant results.
 *
 * @see {@link file://./../../../routes/_layout+/assets.$assetId.overview.add-to-existing-booking.tsx}
 *   the singular-asset flow this is styled to match.
 */
function BookingSelect({
  bookings,
  isLoading,
  disabled,
  errorMessage,
}: {
  /** All open bookings returned by `/api/bookings/get-all`. */
  bookings: PickerBooking[];
  /** Whether the bookings fetch is still in flight. */
  isLoading: boolean;
  /** Disable the trigger (e.g. while the form is submitting). */
  disabled?: boolean;
  /** Zorm/server validation message for the `id` field. */
  errorMessage?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const triggerRef = useRef<HTMLDivElement>(null);
  // Focus the search box when the popover opens (Radix portal mounts a frame
  // late, which the hook accounts for).
  const searchInputRef = useAutoFocus<HTMLInputElement>({ when: isOpen });

  const filteredBookings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return bookings;
    return bookings.filter((booking) =>
      booking.name.toLowerCase().includes(query)
    );
  }, [bookings, searchQuery]);

  const selectedBooking = bookings.find((booking) => booking.id === selectedId);

  const triggerLabel = selectedBooking
    ? selectedBooking.name
    : isLoading
    ? "Fetching bookings..."
    : "Select a booking";

  return (
    <div className="relative z-50 mb-2">
      {/* Value submitted with the form; matches the `id` schema field. */}
      <input type="hidden" name="id" value={selectedId ?? ""} />

      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          // `disabled` on an `asChild` PopoverTrigger doesn't reliably block
          // opening (Radix clones the child), so gate state changes here.
          if (isLoading || disabled) return;
          setIsOpen(open);
        }}
      >
        <PopoverTrigger asChild disabled={isLoading || disabled}>
          <button
            type="button"
            className={tw(
              "w-full",
              (isLoading || disabled) && "cursor-not-allowed opacity-60"
            )}
          >
            <div
              ref={triggerRef}
              className="flex w-full items-center justify-between whitespace-nowrap rounded border border-gray-300 px-[14px] py-2 text-sm hover:cursor-pointer"
            >
              <span
                className={tw(
                  "truncate whitespace-nowrap pr-2",
                  !selectedBooking && "text-gray-500"
                )}
              >
                {triggerLabel}
              </span>
              <ChevronDownIcon />
            </div>
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            className="z-[100] overflow-y-auto rounded-md border border-gray-300 bg-white"
            style={{ width: triggerRef.current?.clientWidth }}
            align="center"
            sideOffset={5}
          >
            <div className="flex items-center justify-between p-3">
              <div className="text-xs font-semibold text-gray-700">
                Existing bookings
              </div>
              <When truthy={Boolean(selectedBooking)}>
                <Button
                  type="button"
                  as="button"
                  variant="link"
                  className="whitespace-nowrap text-xs font-normal text-gray-500 hover:text-gray-600"
                  onClick={() => setSelectedId(undefined)}
                >
                  Clear selection
                </Button>
              </When>
            </div>

            <div className="filters-form relative border-y border-y-gray-200 p-3">
              <Input
                ref={searchInputRef}
                type="text"
                label="Search bookings"
                placeholder="Search bookings"
                hideLabel
                className="text-gray-500"
                icon="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
              />
            </div>

            <div
              className="max-h-[320px] divide-y overflow-y-auto"
              role="listbox"
              aria-label="Existing bookings"
            >
              {filteredBookings.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  {isLoading
                    ? "Fetching bookings..."
                    : searchQuery
                    ? "No bookings found"
                    : "No open bookings available"}
                </div>
              ) : (
                filteredBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className={tw(
                      "flex cursor-pointer touch-manipulation select-none items-center justify-between gap-4 px-4 py-3 outline-none hover:bg-gray-100 focus:bg-gray-100",
                      booking.id === selectedId && "bg-gray-100"
                    )}
                    role="option"
                    aria-selected={booking.id === selectedId}
                    tabIndex={0}
                    onClick={() => {
                      setSelectedId(booking.id);
                      setIsOpen(false);
                    }}
                    onKeyDown={handleActivationKeyPress(() => {
                      setSelectedId(booking.id);
                      setIsOpen(false);
                    })}
                  >
                    <div className="flex min-w-0 flex-col items-start gap-1 text-black">
                      <div className="max-w-[250px] truncate font-medium">
                        {booking.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        <DateS date={booking.from} includeTime /> -{" "}
                        <DateS date={booking.to} includeTime />
                      </div>
                    </div>
                    <When truthy={booking.id === selectedId}>
                      <span className="h-auto w-[18px] shrink-0 text-primary">
                        <CheckIcon />
                      </span>
                    </When>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      <When truthy={Boolean(errorMessage)}>
        <p className="mt-2 text-sm text-error-500">{errorMessage}</p>
      </When>
    </div>
  );
}

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
  } = useApiQuery<{ error: null; bookings: PickerBooking[] }>({
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
      // why: the success panel's "Add more" button re-uses the same selection to
      // add the assets to another booking, so the selection must survive success.
      keepSelectionOnSuccess
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
              <BookingSelect
                bookings={bookings}
                isLoading={isFetchingBookings}
                disabled={disabled}
                errorMessage={zo.errors.id()?.message}
              />
              <div className="mb-4 mt-2 text-gray-500">
                <span className="font-medium text-gray-600">Draft</span>,{" "}
                <span className="font-medium text-gray-600">Reserved</span>,{" "}
                <span className="font-medium text-gray-600">Ongoing</span> and{" "}
                <span className="font-medium text-gray-600">Overdue</span>{" "}
                bookings are shown. Assets added to an ongoing booking stay
                available until you check them out.
              </div>

              <When truthy={!isFetchingBookings && bookings.length === 0}>
                <div className="mb-4 rounded-md border border-gray-300 bg-gray-25 p-2">
                  <p className="text-sm text-gray-600">
                    No open bookings found. Create a new booking first to add
                    assets to it.
                  </p>
                </div>
              </When>

              <When truthy={!!fetcherError || !!fetcherErrorAdditionalData}>
                <div className="mb-4 rounded-md border border-gray-300 bg-gray-25 p-2">
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
                        {fetcherErrorAdditionalData?.alreadyAddedAssets?.map(
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
                        <Button
                          type="submit"
                          className="w-full"
                          variant="secondary"
                        >
                          Add only the rest of the assets
                        </Button>
                      </When>
                    </div>
                  </When>
                </div>
              </When>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
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
