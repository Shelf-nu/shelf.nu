/**
 * Archive, as an action that works from any page: it posts `intent=archive` to
 * the booking's own overview action through a fetcher keyed on the booking,
 * so it does not depend on the page it is rendered on or on an enclosing form.
 * The server sends the success toast.
 *
 * Forwards its ref and spreads extra props so `DropdownMenuItem asChild` can
 * drive it.
 *
 * @see {@link file://./booking-action-trigger.tsx}
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the action
 */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { ArchiveIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useDisabled } from "~/hooks/use-disabled";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { BookingActionTrigger } from "./booking-action-trigger";
import type { BookingActionTriggerVariant } from "./booking-action-trigger";

/** Props for {@link ArchiveBookingAction}. */
type ArchiveBookingActionProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "disabled"
> & {
  booking: { id: string };
  /** Defaults to `"menu-item"`. */
  trigger?: BookingActionTriggerVariant;
};

/**
 * Archives the booking when activated.
 *
 * @param props.booking - The booking to archive
 * @param props.trigger - Menu row or icon button
 */
export const ArchiveBookingAction = forwardRef<
  HTMLButtonElement,
  ArchiveBookingActionProps
>(function ArchiveBookingAction(
  { booking, trigger = "menu-item", ...rest },
  ref
) {
  const fetcher = useFetcher<DataOrErrorResponse>({
    key: `archive-booking-${booking.id}`,
  });
  const busy = useDisabled(fetcher);

  return (
    <BookingActionTrigger
      {...rest}
      ref={ref}
      variant={trigger}
      label="Archive"
      icon={<ArchiveIcon className="size-4" />}
      disabled={busy ? { reason: "Archiving..." } : false}
      onClick={(event) => {
        // Keep the handler a Radix `asChild` parent attached (closing a menu).
        rest.onClick?.(event);
        void fetcher.submit(
          { intent: "archive" },
          { method: "post", action: `/bookings/${booking.id}/overview` }
        );
      }}
    />
  );
});
