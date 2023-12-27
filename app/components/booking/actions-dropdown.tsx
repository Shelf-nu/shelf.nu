import { useMemo } from "react";
import { BookingStatus } from "@prisma/client";

import { useSubmit } from "@remix-run/react";
import { ChevronRight } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import type { BookingWithCustodians } from "~/routes/_layout+/bookings._index";
import { tw } from "~/utils";
import { DeleteBooking } from "./delete-booking";
import { Button } from "../shared";

interface Props {
  booking: BookingWithCustodians;
  fullWidth?: boolean;
}

export const ActionsDropdown = ({ booking, fullWidth }: Props) => {
  const isCompleted = useMemo(
    () => booking.status === BookingStatus.COMPLETE,
    [booking.status]
  );

  const submit = useSubmit();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={tw("asset-actions", fullWidth ? "w-full" : "")}
      >
        <Button
          variant="secondary"
          data-test-id="bookingActionsButton"
          as="span"
        >
          <span className="flex items-center gap-2">
            Actions <ChevronRight className="chev rotate-90" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent
          align="end"
          className="order w-[180px] rounded-md bg-white p-1.5 text-right "
        >
          {isCompleted ? (
            <DropdownMenuItem asChild>
              <Button
                variant="link"
                className="justify-start text-gray-700 hover:cursor-pointer hover:text-gray-700"
                width="full"
                name="intent"
                value="archive"
                as="span"
                /**
                 * Here we have to deal with a interesting case that is in a way a conflict between how react works and web platform
                 * So this button within the react code, is inside a form that is in the parent component, however because its a radix dropdown, it gets rendered within a portal
                 * So the button is actually rendered outside the form, and when you click on it, it does not submit the form
                 * So we have to manually submit the data here.
                 *
                 * Keep in mind that even though its rendered in the DOM within a portal, react will still detect it as being inside the form, so there could be some hydration errors
                 */
                onClick={() => {
                  const formData = new FormData();
                  formData.append("intent", "archive");
                  submit(formData, { method: "post" });
                }}
              >
                Archive
              </Button>
            </DropdownMenuItem>
          ) : null}
          <DeleteBooking booking={booking} />
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
};
