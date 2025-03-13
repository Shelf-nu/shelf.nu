import type { Group } from "@prisma/client";
import { EllipsisVerticalIcon } from "lucide-react";
import DeleteGroupAlert from "./delete-group-alert";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";

export default function ActionsDropdown({
  group,
}: {
  group: Pick<Group, "id" | "name">;
}) {
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger>
          <EllipsisVerticalIcon className="size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="order w-44 rounded-md bg-white p-0 text-right "
        >
          <DropdownMenuItem asChild>
            <Button
              to={`${group.id}/edit`}
              icon="pen"
              role="link"
              variant="link"
              className="justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
              width="full"
            >
              Edit
            </Button>
          </DropdownMenuItem>

          <DropdownMenuItem asChild>
            <DeleteGroupAlert group={group} />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
