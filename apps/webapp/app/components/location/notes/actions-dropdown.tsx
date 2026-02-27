import { HorizontalDotsIcon } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { DeleteLocationNote } from "./delete-note";

interface Props {
  noteId: string;
}

export const LocationNoteActionsDropdown = ({ noteId }: Props) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger>
      <HorizontalDotsIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      className="order w-[180px] rounded bg-surface p-1.5 text-right"
    >
      <div className="relative flex select-none items-center rounded p-2 text-left text-[13px] leading-none outline-none data-[highlighted]:bg-gradient-to-br hover:bg-color-100">
        <DeleteLocationNote noteId={noteId} />
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
);
