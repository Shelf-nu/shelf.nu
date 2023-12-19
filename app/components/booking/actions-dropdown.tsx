import { useMemo } from "react";
import { BookingStatus } from "@prisma/client";

import { ChevronRight } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
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
          {/* <DropdownMenuItem>
        <Button
          icon="pen"
          role="link"lo
          variant="link"
          className="justify-start text-gray-700 hover:text-gray-700"
          width="full"
        >
          Cancel
        </Button>
      </DropdownMenuItem> */}
          {/* @TODO - this needs to be a controlled input */}
          {isCompleted ? (
            <Button
              variant="link"
              className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
              width="full"
              name="intent"
              value="archive"
            >
              Archive
            </Button>
          ) : null}
          <DeleteBooking booking={booking} />
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
};
