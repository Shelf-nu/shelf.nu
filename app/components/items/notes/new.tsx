import { useFetcher, useParams } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { MarkdownEditor } from "~/components/markdown";
import { isFormProcessing } from "~/utils";

export const NewNoteSchema = z.object({
  content: z.string().min(3, "Content is required"),
  itemId: z.string().cuid(),
});

export const NewNote = () => {
  const zo = useZorm("NewQuestionWizardScreen", NewNoteSchema);
  const fetcher = useFetcher();
  const params = useParams();
  const disabled = isFormProcessing(fetcher.state);
  const hasError = zo.errors.content()?.message;

  return (
    <fetcher.Form action="/items/$itemId/note" method="post" ref={zo.ref}>
      <input type="hidden" name={zo.fields.itemId()} value={params.itemId} />
      <MarkdownEditor
        label={"note"}
        disabled={disabled}
        defaultValue={""}
        name={zo.fields.content()}
      />

      {hasError ? (
        <div className="text-sm text-error-500">
          {zo.errors.content()?.message}
        </div>
      ) : null}

      <button type="submit">Create note</button>
    </fetcher.Form>
  );
};
