import type { Location } from "@prisma/client";

import { ChevronRight } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { tw } from "~/utils";
import { DeleteLocation } from "./delete-location";
import { Button } from "../shared";

interface Props {
  location: {
    name: Location["name"];
  };
  fullWidth?: boolean;
}

export const ActionsDopdown = ({ location, fullWidth }: Props) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger
      className={tw("asset-actions", fullWidth ? "w-full" : "")}
    >
      <Button
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
      className="order w-[180px] rounded-md bg-white p-1.5 text-right "
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
