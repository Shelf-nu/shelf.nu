import type { FetcherWithComponents } from "@remix-run/react";
import { useParams } from "@remix-run/react";
import { atom } from "jotai";
import { MarkdownNoteForm } from "~/components/notes/markdown-note-form";

export { MarkdownNoteSchema as NewNoteSchema } from "~/components/notes/markdown-note-form";

const isEditingAtom = atom(false);

export const NewNote = ({
  fetcher,
}: {
  fetcher: FetcherWithComponents<any>;
}) => {
  const params = useParams();

  return (
    <MarkdownNoteForm
      fetcher={fetcher}
      action={`/assets/${params.assetId}/note`}
      formId="NewQuestionWizardScreen"
      editingAtom={isEditingAtom}
    />
  );
};
