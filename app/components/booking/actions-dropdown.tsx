import type { Booking } from "@prisma/client";

import { ChevronRight } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { tw } from "~/utils";
import { DeleteBooking } from "./delete-booking";
import { Button } from "../shared";

interface Props {
  booking: {
    name: Booking["name"];
  };
  fullWidth?: boolean;
}

export const ActionsDropdown = ({ booking, fullWidth }: Props) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger
      className={tw("asset-actions", fullWidth ? "w-full" : "")}
    >
      <Button
        variant="secondary"
        width={fullWidth ? "full" : "auto"}
        data-test-id="assetActionsButton"
      >
        <span className="flex items-center gap-2">
          {/* // @TODO for some reason clicking on the actions Actions causes a network request and revalidates the view. That shouldnt be happening. Because the button is within the form it actually makes a submit. THat shouldnt be happenign */}
          Actions <ChevronRight className="chev" />
        </span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      className="order w-[180px] rounded-md bg-white p-1.5 text-right "
    >
      {/* <DropdownMenuItem>
        <Button
          icon="pen"
          role="link"
          variant="link"
          className="justify-start text-gray-700 hover:text-gray-700"
          width="full"
        >
          Cancel
        </Button>
      </DropdownMenuItem> */}

      <DeleteBooking booking={booking} />
    </DropdownMenuContent>
  </DropdownMenu>
);
