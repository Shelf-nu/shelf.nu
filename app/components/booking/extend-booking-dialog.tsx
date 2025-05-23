import { useCallback, useEffect, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import { tw } from "~/utils/tw";
import Input from "../forms/input";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import When from "../when/when";

type ExtendBookingDialogProps = {
  className?: string;
  currentEndDate: string;
};

export const ExtendBookingSchema = z.object({
  endDate: z.coerce.date().refine((endDate) => {
    const now = new Date();
    return endDate > now;
  }, "Please select a date in future."),
});

export default function ExtendBookingDialog({
  className,
  currentEndDate,
}: ExtendBookingDialogProps) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcherWithReset<{
    error?: {
      message: string;
      additionalData?: {
        clashingBookings?: { id: string; name: string }[];
      };
    };
    success: boolean;
  }>();

  const zo = useZorm("ExtendBooking", ExtendBookingSchema);
  const disabled = useDisabled(fetcher);

  function handleOpen() {
    setOpen(true);
  }

  const handleClose = useCallback(() => {
    setOpen(false);
    fetcher.reset();
  }, [fetcher]);

  useEffect(
    function closeOnSuccess() {
      if (fetcher?.data?.success) {
        handleClose();
      }
    },
    [fetcher?.data?.success, handleClose]
  );

  return (
    <>
      <Button
        variant="link"
        className="justify-start rounded px-2 py-1.5 text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
        width="full"
        onClick={handleOpen}
      >
        Extend booking
      </Button>

      <DialogPortal>
        <Dialog
          className={tw("lg:max-w-[450px]", className)}
          open={open}
          onClose={handleClose}
          title={
            <div className="flex size-10 items-center justify-center rounded-full bg-primary-25">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary-50">
                <CalendarIcon className="size-4 text-primary-500" />
              </div>
            </div>
          }
        >
          <div className="px-6 pb-4">
            <h3 className="mb-1">Extend booking</h3>
            <p className="mb-4">
              Change the end date of your booking to a date in the future.
            </p>

            <fetcher.Form ref={zo.ref} method="POST">
              <div className="required-input-label mb-1 text-text-sm font-medium text-gray-700">
                New end date
              </div>

              <Input
                key={currentEndDate}
                defaultValue={currentEndDate}
                label="End Date"
                type="datetime-local"
                hideLabel
                name={zo.fields.endDate()}
                disabled={disabled}
                error={zo.errors.endDate()?.message}
                className="mb-4 w-full"
                placeholder="Booking"
              />

              <When truthy={!!fetcher?.data?.error}>
                <p className="text-sm text-error-500">
                  {fetcher.data?.error?.message}
                </p>
                {fetcher.data?.error?.additionalData?.clashingBookings && (
                  <ul className="mb-4 mt-1 list-inside list-disc pl-4">
                    {fetcher.data.error.additionalData.clashingBookings.map(
                      (booking) => (
                        <li key={booking.id}>
                          <Button
                            variant="link-gray"
                            className={"text-error-500 no-underline"}
                            target="_blank"
                            to={`/bookings/${booking.id}`}
                          >
                            {booking.name}
                          </Button>
                        </li>
                      )
                    )}
                  </ul>
                )}
              </When>

              <input type="hidden" name="intent" value="extend-booking" />

              <div className="flex items-center gap-2">
                <Button
                  disabled={disabled}
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
                <Button className="flex-1" disabled={disabled}>
                  Submit
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
