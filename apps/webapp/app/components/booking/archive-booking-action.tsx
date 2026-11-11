/**
 * Archive, as an action that works from any page: it posts `intent=archive` to
 * the booking's own overview action through a fetcher keyed on the booking,
 * so it does not depend on the page it is rendered on or on an enclosing form.
 * The server sends the success toast.
 *
 * With `discardDraft` it is "Discard draft" instead: it posts
 * `intent=discard-draft`, which archives a DRAFT. That is how members without
 * `booking:delete` drop a draft while the record stays in workspace history.
 *
 * Forwards its ref and spreads extra props so `DropdownMenuItem asChild` can
 * drive it.
 *
 * @see {@link file://./booking-action-trigger.tsx}
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the action
 */
import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { ArchiveIcon, ArchiveXIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useDisabled } from "~/hooks/use-disabled";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { BookingActionTrigger } from "./booking-action-trigger";
import type { BookingActionTriggerVariant } from "./booking-action-trigger";

/** Props for {@link ArchiveBookingAction}. */
type ArchiveBookingActionProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> & {
  booking: { id: string };
  /** Defaults to `"menu-item"`. */
  trigger?: BookingActionTriggerVariant;
  /** Discard a draft (archive a DRAFT) rather than archive a finished booking. */
  discardDraft?: boolean;
};

/**
 * Archives the booking when activated.
 *
 * @param props.booking - The booking to archive
 * @param props.trigger - Menu row or icon button
 * @param props.discardDraft - Post the discard-draft intent with its own label
 */
export const ArchiveBookingAction = forwardRef<
  HTMLElement,
  ArchiveBookingActionProps
>(function ArchiveBookingAction(
  { booking, trigger = "menu-item", discardDraft = false, ...rest },
  ref
) {
  const intent = discardDraft ? "discard-draft" : "archive";
  const fetcher = useFetcher<DataOrErrorResponse>({
    key: `${intent}-booking-${booking.id}`,
  });
  const busy = useDisabled(fetcher);

  return (
    <BookingActionTrigger
      {...rest}
      ref={ref}
      variant={trigger}
      label={discardDraft ? "Discard draft" : "Archive"}
      icon={
        discardDraft ? (
          <ArchiveXIcon className="size-4" />
        ) : (
          <ArchiveIcon className="size-4" />
        )
      }
      disabled={
        busy
          ? { reason: discardDraft ? "Discarding..." : "Archiving..." }
          : false
      }
      onClick={(event) => {
        // Keep the handler a Radix `asChild` parent attached (closing a menu).
        rest.onClick?.(event);
        void fetcher.submit(
          { intent },
          { method: "post", action: `/bookings/${booking.id}/overview` }
        );
      }}
    />
  );
});
