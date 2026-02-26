import { atom } from "jotai";
import type { FetcherWithComponents } from "react-router";
import { useParams } from "react-router";
import { MarkdownNoteForm } from "~/components/notes/markdown-note-form";

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
