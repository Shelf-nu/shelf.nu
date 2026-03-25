/**
 * Delete User Note Component
 *
 * Renders a delete button with a confirmation dialog for removing a note
 * from a user's profile. Submits a DELETE request to the note action route.
 * Only the note author can successfully delete (enforced server-side).
 *
 * NOTE: This UI component lives under `user/notes/` for the user-facing context,
 * but the data layer uses the `TeamMemberNote` model for workspace-scoped storage.
 *
 * @see {@link file://./../../../routes/_layout+/settings.team.users.$userId.note.tsx} for the DELETE action handler
 */
import { useFetcher, useParams } from "react-router";
import { TrashIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { useDisabled } from "~/hooks/use-disabled";

/**
 * Delete button with confirmation dialog for a user note.
 *
 * @param props.noteId - The ID of the note to delete
 * @param props.actionUrl - The form action URL. Defaults to the user profile note route
 *   based on params.userId, but can be overridden for the /me route.
 */
export const DeleteUserNote = ({
  noteId,
  actionUrl,
}: {
  noteId: string;
  actionUrl?: string;
}) => {
  const fetcher = useFetcher();
  const params = useParams();
  const disabled = useDisabled(fetcher);
  const action = actionUrl ?? `/settings/team/users/${params.userId}/note`;

  return (
    <AlertDialog>
      <div className="w-full">
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="link"
            className="w-full cursor-default items-center justify-start text-gray-800 hover:text-gray-800"
            data-test-id="deleteUserNoteButton"
            icon="trash"
            width="full"
          >
            Delete
          </Button>
        </AlertDialogTrigger>
      </div>

      <AlertDialogContent>
        <AlertDialogHeader>
          <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
            <TrashIcon />
          </span>
          <AlertDialogTitle>Delete note</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this note? This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="secondary" disabled={disabled}>
              Cancel
            </Button>
          </AlertDialogCancel>

          <fetcher.Form method="delete" action={action}>
            <input type="hidden" name="noteId" value={noteId} />
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              data-test-id="confirmDeleteUserNoteButton"
              disabled={disabled}
            >
              Delete
            </Button>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
