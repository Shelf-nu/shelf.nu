import type { CustomField } from "@prisma/client";
import { VerticalDotsIcon } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { Button } from "../shared/button";

export function ActionsDropdown({ customField }: { customField: CustomField }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className="outline-none focus-visible:border-0"
        aria-label="Actions Trigger"
      >
        <i className="inline-block px-3 py-0 text-color-400 ">
          <VerticalDotsIcon />
        </i>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="order w-[180px] rounded-md bg-surface p-0 text-right "
      >
        <DropdownMenuItem className="px-4 py-3">
          <Button
            to={`${customField.id}/edit`}
            icon="pen"
            role="link"
            variant="link"
            className="justify-start text-color-700 hover:text-color-700"
            width="full"
          >
            Edit
          </Button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
