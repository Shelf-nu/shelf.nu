import type { ChangeEvent } from "react";
import { useEffect, useRef } from "react";
import { useFetcher, useParams } from "@remix-run/react";
import { atom, useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { MarkdownEditor, clearMarkdownAtom } from "~/components/markdown";
import { Button } from "~/components/shared";
import { Spinner } from "~/components/shared/spinner";
import { isFormProcessing } from "~/utils";

export const NewNoteSchema = z.object({
  content: z.string().min(3, "Content is required"),
});

const isEditingAtom = atom(false);

export const NewNote = () => {
  const zo = useZorm("NewQuestionWizardScreen", NewNoteSchema);
  const fetcher = useFetcher();
  const params = useParams();
  const disabled = isFormProcessing(fetcher.state);
  const hasError = zo.errors.content()?.message;
  const [isEditing, setIsEditing] = useAtom(isEditingAtom);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [, clearMarkdown] = useAtom(clearMarkdownAtom);

  const handelBlur = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const content = e.currentTarget.value;
    if (content === "") {
      setIsEditing(false);
    }
  };

  useEffect(() => {
    if (isEditing) {
      editorRef?.current?.focus();
    }
  }, [isEditing]);

  return (
    <fetcher.Form
      action={`/items/${params.itemId}/note`}
      method="post"
      ref={zo.ref}
      onSubmit={clearMarkdown}
    >
      {isEditing ? (
        <div className="flex flex-col">
          <div className="relative h-0 overflow-visible text-right">
            <div className="absolute right-0 flex gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="" disabled={disabled}>
                {disabled ? <Spinner /> : "Create note"}
              </Button>
            </div>
          </div>
          <MarkdownEditor
            label={"note"}
            disabled={disabled}
            defaultValue={""}
            name={zo.fields.content()}
            placeholder={"Leave a note"}
            // @ts-ignore
            rows={4}
            onBlur={handelBlur}
            ref={editorRef}
          />
        </div>
      ) : (
        <Input
          label=""
          placeholder="Leave a note"
          onFocus={() => setIsEditing(true)}
        />
      )}

      {hasError ? (
        <div className="text-sm text-error-500">
          {zo.errors.content()?.message}
        </div>
      ) : null}
    </fetcher.Form>
  );
};
