import type { Note } from "@prisma/client";

import { HorizontalDotsIcon } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { DeleteNote } from "./delete-note";

interface Props {
  note: Note;
}

export const ActionsDopdown = ({ note }: Props) => (
  <DropdownMenu>
    <DropdownMenuTrigger>
      <HorizontalDotsIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      className="order w-[180px] rounded-md bg-white p-1.5 text-right"
    >
      <div className="relative flex h-[25px] select-none items-center rounded p-1.5 text-left text-[13px] leading-none outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-gradient-to-br hover:bg-gray-100">
        <DeleteNote note={note} />
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
);
