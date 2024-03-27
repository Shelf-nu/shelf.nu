import { HorizontalDotsIcon } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { DeleteNote } from "./delete-note";

interface Props {
  noteId: string;
}

export const ActionsDopdown = ({ noteId }: Props) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger>
      <HorizontalDotsIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      className="order w-[180px] rounded bg-white p-1.5 text-right"
    >
      <div className="relative flex  select-none items-center rounded p-2 text-left text-[13px] leading-none outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-gradient-to-br hover:bg-gray-100">
        <DeleteNote noteId={noteId} />
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
);
