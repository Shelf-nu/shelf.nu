/**
 * User Notes Container Component
 *
 * Displays admin notes on a user's profile within the current workspace.
 * Follows the same optimistic UI pattern used by LocationNotes and BookingNotes.
 *
 * NOTE: These UI components live under `components/user/notes/` because they are
 * displayed on user profile pages, but they are backed by the `TeamMemberNote` Prisma
 * model and `team-member-note` service module. The data layer uses TeamMember for
 * workspace-scoped identity (consistent with Custody, Booking, etc.), while the
 * UI layer reflects the user-facing concept of "notes on a user's profile".
 *
 * Features:
 * - Optimistic UI: shows a temporary note immediately while the server processes
 * - Permission-gated: create form and delete actions are conditionally rendered
 * - Author-only delete: only the note author sees the delete action
 * - Empty state: displays a friendly message when no notes exist
 *
 * @see {@link file://./../../assets/notes/note.tsx} for the shared Note display component
 * @see {@link file://./../../../routes/_layout+/settings.team.users.$userId.notes.tsx} for the user profile route
 * @see {@link file://./../../../routes/_layout+/me.notes.tsx} for the /me route
 * @see {@link file://./../../../modules/team-member-note/service.server.ts} for the data layer
 */
import { useFetcher } from "react-router";
import type { NoteWithUser } from "~/components/assets/notes/note";
import { Note } from "~/components/assets/notes/note";
import { useUserData } from "~/hooks/use-user-data";
import type { TeamMemberNoteWithUser } from "~/modules/team-member-note/service.server";
import { isFormProcessing } from "~/utils/form";
import { UserNoteActionsDropdown } from "./actions-dropdown";
import { NewUserNote } from "./new";

/**
 * Container component for displaying and managing user notes.
 *
 * @param props.notes - The notes array from the route loader (typed from Prisma)
 * @param props.canCreate - Whether the current user can create notes (admin/owner only)
 * @param props.canDelete - Whether the current user can delete notes (admin/owner only)
 * @param props.actionUrl - Override the action URL for create/delete (e.g., `/me/note`)
 */
export const UserNotes = ({
  notes,
  canCreate = true,
  canDelete = true,
  actionUrl,
}: {
  notes: TeamMemberNoteWithUser[];
  canCreate?: boolean;
  canDelete?: boolean;
  actionUrl?: string;
}) => {
  /* Using user data for the optimistic Note component rendered on the frontend
   * before the server responds. This provides immediate visual feedback. */
  const user = useUserData();

  const hasNotes = notes && notes.length > 0;

  /* Fetcher is created here in the parent so we can track its state for optimistic UI
   * and pass it down to the NewUserNote form component */
  const fetcher = useFetcher({ key: "add-user-note" });
  let onSubmissionContent = "";
  /* Extract the submitted form content from the fetcher to display as an optimistic note */
  if (fetcher.formData) {
    for (const data of fetcher.formData.entries()) {
      onSubmissionContent = data[1].toString();
    }
  }

  /* Build an optimistic note that matches the NoteWithUser shape.
   * This is rendered immediately while the server processes the request,
   * then replaced by the real note when the loader revalidates. */
  const optimisticNote: NoteWithUser | null =
    isFormProcessing(fetcher.state) && onSubmissionContent
      ? {
          id: "optimistic-note",
          content: onSubmissionContent,
          type: "COMMENT",
          createdAt: new Date().toISOString(),
          user: user
            ? {
                firstName: user.firstName || "",
                lastName: user.lastName || "",
                displayName: user.displayName || "",
              }
            : undefined,
        }
      : null;

  return (
    <div className="relative">
      {canCreate ? (
        <NewUserNote fetcher={fetcher} actionUrl={actionUrl} />
      ) : null}
      {hasNotes || optimisticNote ? (
        <ul className="notes-list mt-8 w-full">
          {/* Optimistic note has a placeholder ID — don't render actions until the real note exists */}
          {optimisticNote && (
            <Note
              key={optimisticNote.id}
              note={optimisticNote}
              actionsDropdown={undefined}
            />
          )}
          {/* Render all existing notes. Only show delete for notes authored by the current user. */}
          {notes.map((note) => {
            const isAuthor = canDelete && user?.id === note.userId;
            return (
              <Note
                key={note.id}
                note={note as unknown as NoteWithUser}
                actionsDropdown={
                  isAuthor ? (
                    <UserNoteActionsDropdown
                      noteId={note.id}
                      actionUrl={actionUrl}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </ul>
      ) : (
        <div className="flex h-[500px] items-center justify-center">
          <div className="flex flex-col items-center justify-center p-[16px] text-center md:p-[50px]">
            <img
              src="/static/images/no-notes.svg"
              alt="Graphic for no notes"
              className="mb-6 w-[172px]"
            />
            <h4>No Notes</h4>
            <p>
              This user has no admin notes
              <br />
              in this workspace.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
