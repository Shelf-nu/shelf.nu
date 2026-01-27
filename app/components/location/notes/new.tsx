import type { FetcherWithComponents } from "@remix-run/react";
import { useParams } from "@remix-run/react";
import { atom } from "jotai";
import { MarkdownNoteForm } from "~/components/notes/markdown-note-form";

const isEditingAtom = atom(false);

export const NewLocationNote = ({
  fetcher,
}: {
  fetcher: FetcherWithComponents<any>;
}) => {
  const params = useParams();

  return (
    <MarkdownNoteForm
      fetcher={fetcher}
      action={`/locations/${params.locationId}/note`}
      formId="NewLocationNoteForm"
      editingAtom={isEditingAtom}
    />
  );
};
