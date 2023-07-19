import { VerticalDotsIcon } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { DeleteMember } from "./delete-member";
import { Button } from "../shared";

export function ActionsDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none focus-visible:border-0">
        <i className="inline-block px-3 py-0 text-gray-400 ">
          <VerticalDotsIcon />
        </i>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="order w-[180px] rounded-md bg-white p-0 text-right "
      >
        <DeleteMember />
        <DropdownMenuItem className="px-6 py-3">
          <Button
            to="edit"
            role="link"
            variant="link"
            className="justify-start text-gray-700 hover:text-gray-700"
            width="full"
          >
            Edit
          </Button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
