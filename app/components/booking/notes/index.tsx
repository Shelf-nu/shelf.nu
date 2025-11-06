import { useFetcher, useLoaderData } from "@remix-run/react";
import type { NoteWithUser } from "~/components/assets/notes/note";
import { Note } from "~/components/assets/notes/note";
import { Button } from "~/components/shared/button";
import { useUserData } from "~/hooks/use-user-data";
import type { loader } from "~/routes/_layout+/bookings.$bookingId.activity";
import { isFormProcessing } from "~/utils/form";
import { BookingActionsDropdown } from "./actions-dropdown";
import { NewBookingNote } from "./new";

export const BookingNotes = () => {
  const { booking } = useLoaderData<typeof loader>();

  /* Using user data here for the BookingNote component generated for frontend only as per the optimistic UI approach */
  const user = useUserData();

  const hasNotes = booking?.notes && booking?.notes.length > 0;

  /* Importing fetcher here in the parent file such that we can use fetcher's states to know the status of form processing and form data render the frontend component on the fly (Optimistic UI) and in the new note form this fetcher is passed as a prop */
  const fetcher = useFetcher({ key: "add-note" });
  let onSubmissionContent = "";
  /* Getting the form data using fetcher and storing the content of form in onSubmissionContent Variable */
  if (fetcher.formData) {
    for (const data of fetcher.formData.entries()) {
      onSubmissionContent = data[1].toString();
    }
  }

  // Create optimistic note data that matches the NoteWithUser shape
  const optimisticNote: NoteWithUser | null =
    isFormProcessing(fetcher.state) && onSubmissionContent
      ? {
          id: "optimistic-note", // Temporary ID for optimistic UI
          content: onSubmissionContent,
          type: "COMMENT",
          createdAt: new Date().toISOString(),
          user: user
            ? {
                firstName: user.firstName || "",
                lastName: user.lastName || "",
              }
            : undefined,
        }
      : null;

  return (
    <div>
      {hasNotes ? (
        <div className="mb-4 flex justify-end">
          <Button
            to={`/bookings/${booking.id}/activity.csv`}
            variant="secondary"
            download
            reloadDocument
          >
            Export activity CSV
          </Button>
        </div>
      ) : null}
      <NewBookingNote fetcher={fetcher} />
      {hasNotes ? (
        <ul className="notes-list mt-8 w-full">
          {/* Render optimistic note using the same Note component */}
          {optimisticNote && (
            <Note
              key={optimisticNote.id}
              note={optimisticNote}
              actionsDropdown={
                <BookingActionsDropdown noteId={optimisticNote.id} />
              }
            />
          )}
          {/* Render all existing notes */}
          {(booking.notes as NoteWithUser[]).map((note) => (
            <Note
              key={note.id}
              note={note}
              actionsDropdown={<BookingActionsDropdown noteId={note.id} />}
            />
          ))}
        </ul>
      ) : (
        <div className="flex h-[500px] items-center  justify-center">
          <div className="flex flex-col items-center justify-center p-[16px] text-center md:p-[50px]">
            <img
              src="/static/images/no-notes.svg"
              alt="Graphic for no notes"
              className="mb-6 w-[172px]"
            />
            <h4>No Notes</h4>
            <p>
              Your booking `{booking?.name}` has no notes <br />
              attached to it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
