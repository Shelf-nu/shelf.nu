/**
 * User Note Actions Dropdown
 *
 * Renders a three-dot menu with available actions for a note on a user's profile.
 * Currently supports delete only. Additional actions (e.g., edit)
 * can be added here in the future.
 *
 * NOTE: This UI component lives under `user/notes/` for the user-facing context,
 * but the data layer uses the `TeamMemberNote` model for workspace-scoped storage.
 */
import { HorizontalDotsIcon } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { DeleteUserNote } from "./delete-note";

interface Props {
  /** The ID of the note this dropdown belongs to */
  noteId: string;
  /** Override the action URL for delete (e.g., `/me/note` instead of the default user profile route) */
  actionUrl?: string;
}

/**
 * Three-dot actions dropdown for a single user note.
 *
 * @param props.noteId - The note ID, passed to child action components
 * @param props.actionUrl - Optional action URL override, forwarded to DeleteUserNote
 */
export const UserNoteActionsDropdown = ({ noteId, actionUrl }: Props) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label="Note actions">
        <HorizontalDotsIcon aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      className="order w-[180px] rounded bg-white p-1.5 text-right"
    >
      <div className="relative flex select-none items-center rounded p-2 text-left text-[13px] leading-none outline-none data-[highlighted]:bg-gradient-to-br hover:bg-gray-100">
        <DeleteUserNote noteId={noteId} actionUrl={actionUrl} />
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
);
