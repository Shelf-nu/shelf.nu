import type { Location } from "@prisma/client";

import { ChevronRight } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { tw } from "~/utils/tw";
import { DeleteLocation } from "./delete-location";
import { Button } from "../shared/button";

interface Props {
  location: {
    name: Location["name"];
    childCount?: number;
  };
  fullWidth?: boolean;
}

export const ActionsDropdown = ({ location, fullWidth }: Props) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger
      type="button"
      className={tw("asset-actions", fullWidth ? "w-full" : "")}
    >
      <Button
        type="button"
        variant="secondary"
        to="#"
        width={fullWidth ? "full" : "auto"}
        data-test-id="assetActionsButton"
      >
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev" />
        </span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      className="order w-[calc(100vw-32px)] bg-white p-1.5 text-right md:w-[180px] "
    >
      <DropdownMenuItem>
        <Button
          to="edit"
          icon="pen"
          role="link"
          variant="link"
          className="justify-start text-gray-700 hover:text-gray-700"
          width="full"
        >
          Edit
        </Button>
      </DropdownMenuItem>

      <DeleteLocation location={location} />
    </DropdownMenuContent>
  </DropdownMenu>
);
