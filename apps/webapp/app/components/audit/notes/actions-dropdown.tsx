/**
 * Audit note actions — the menu on an audit comment in the activity feed.
 *
 * @see {@link file://./index.tsx} the feed that renders it
 * @see {@link file://../../../routes/_layout+/audits.$auditId.note.tsx} the delete handler
 */
import { useFetcher, useParams } from "react-router";
import { TrashIcon } from "~/components/icons/library";
import { ChevronRight } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

/**
 * The actions menu for one audit comment.
 *
 * The feed renders under `/audits/:auditId/activity`, which has no action of
 * its own, so the delete form names the note route explicitly rather than
 * posting to the current page.
 *
 * @param noteId - The comment to act on
 */
export const ActionsDropdown = ({ noteId }: { noteId: string }) => {
  const fetcher = useFetcher();
  const { auditId } = useParams();
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
          <fetcher.Form method="delete" action={`/audits/${auditId}/note`}>
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
