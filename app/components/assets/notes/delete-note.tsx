import { useFetcher, useParams } from "@remix-run/react";
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

export const DeleteNote = ({ noteId }: { noteId: string }) => {
  const fetcher = useFetcher();
  const params = useParams();
  return (
    <AlertDialog>
      <div className="w-full">
        <AlertDialogTrigger asChild>
          <Button
            variant="link"
            className="w-full cursor-default justify-start text-gray-800 hover:text-gray-800"
            data-test-id="deleteNoteButton"
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
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>

          <fetcher.Form
            method="delete"
            action={`/assets/${params.assetId}/note`}
          >
            <input type="hidden" name="noteId" value={noteId} />
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              data-test-id="confirmDeleteNoteButton"
            >
              Delete
            </Button>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
