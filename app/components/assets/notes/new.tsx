import type { ChangeEvent, FocusEvent } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { FetcherWithComponents } from "@remix-run/react";
import { useParams } from "@remix-run/react";
import { atom, useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import {
  MarkdownEditor,
  clearMarkdownAtom,
} from "~/components/markdown/markdown-editor";
import { Button } from "~/components/shared/button";

export const NewNoteSchema = z.object({
  content: z.string().min(3, "Content is required"),
});

const isEditingAtom = atom(false);

export const NewNote = ({
  fetcher,
}: {
  fetcher: FetcherWithComponents<any>;
}) => {
  const zo = useZorm("NewQuestionWizardScreen", NewNoteSchema);
  const params = useParams();
  const hasError = zo.errors.content()?.message;
  const [isEditing, setIsEditing] = useAtom(isEditingAtom);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [, clearMarkdown] = useAtom(clearMarkdownAtom);
  const isDone = fetcher.state === "idle" && fetcher.data != null;

  const handelBlur = (
    e: ChangeEvent<HTMLTextAreaElement> & FocusEvent<HTMLTextAreaElement>
  ) => {
    const content = e.currentTarget.value;

    /** This handles that the related target(element clicked on that causes the blur) is not a link(markdown info) or a button(submit/cancel buttons) */
    const clickedTargetILink =
      e?.relatedTarget?.tagName === "A" ||
      e?.relatedTarget?.tagName === "BUTTON" ||
      e?.relatedTarget?.role === "tabpanel";

    if (clickedTargetILink) return;

    if (content === "") {
      setIsEditing(false);
    }
  };

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const content = event.currentTarget.value;
      if (
        content !== "" &&
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        fetcher.submit(event.currentTarget.form);
      }
    },
    [fetcher]
  );

  useEffect(() => {
    if (isEditing) {
      editorRef?.current?.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    clearMarkdown();
  }, [isDone, clearMarkdown]);

  return (
    <div ref={wrapperRef}>
      <fetcher.Form
        action={`/assets/${params.assetId}/note`}
        method="post"
        ref={zo.ref}
        onSubmit={clearMarkdown}
      >
        {isEditing ? (
          <div className="relative flex flex-col pb-12 xl:pb-0">
            <div className="absolute bottom-0 right-0 flex gap-1 xl:bottom-auto">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="">
                Create note
              </Button>
            </div>
            <MarkdownEditor
              label={"note"}
              defaultValue={""}
              name={zo.fields.content()}
              placeholder={"Leave a note"}
              // @ts-ignore
              rows={4}
              ref={editorRef}
              className="rounded-b-none"
              onBlur={handelBlur}
              onKeyDown={handleKeyDown}
              maxLength={100000}
            />
          </div>
        ) : (
          <Input
            icon="write"
            className="text-gray-700"
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
    </div>
  );
};
