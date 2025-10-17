import type { FetcherWithComponents } from "@remix-run/react";
import { useParams } from "@remix-run/react";
import { atom } from "jotai";
import { MarkdownNoteForm } from "~/components/notes/markdown-note-form";

export { MarkdownNoteSchema as NewBookingNoteSchema } from "~/components/notes/markdown-note-form";

const isEditingAtom = atom(false);

export const NewBookingNote = ({
  fetcher,
}: {
  fetcher: FetcherWithComponents<any>;
}) => {
  const params = useParams();

  return (
    <MarkdownNoteForm
      fetcher={fetcher}
      action={`/bookings/${params.bookingId}/activity`}
      formId="NewBookingNote"
      editingAtom={isEditingAtom}
    />
  );
};
