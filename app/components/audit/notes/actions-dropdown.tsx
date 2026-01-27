import { useFetcher } from "react-router";
import { TrashIcon } from "~/components/icons/library";
import { ChevronRight } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

export const ActionsDopdown = ({ noteId }: { noteId: string }) => {
  const fetcher = useFetcher();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="cursor-pointer text-gray-500 hover:text-gray-700">
        <ChevronRight className="rotate-90" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="order w-[180px] rounded-md bg-white p-1.5 text-right"
      >
        <DropdownMenuItem className="px-4 py-1">
          <fetcher.Form method="delete">
            <input type="hidden" name="noteId" value={noteId} />
            <button
              type="submit"
              className="flex w-full items-center gap-1 py-1 pr-3 text-left text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700 md:py-0.5"
            >
              <TrashIcon /> Delete note
            </button>
          </fetcher.Form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
