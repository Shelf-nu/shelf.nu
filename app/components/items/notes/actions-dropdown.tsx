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
    <DropdownMenuTrigger className="inline-flex items-center gap-2 text-gray-500">
      <HorizontalDotsIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      className="w-[180px] rounded-xl border bg-white text-right"
    >
      <div className="relative flex  items-center rounded-lg px-2 pb-1.5 pt-2.5 text-sm font-medium outline-none focus:bg-gray-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100">
        <DeleteNote note={note} />
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
);
