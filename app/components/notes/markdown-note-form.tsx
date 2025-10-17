import type { ChangeEvent, FocusEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FetcherWithComponents } from "@remix-run/react";
import { useAtom, type PrimitiveAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";

import Input from "~/components/forms/input";
import { MarkdownEditor } from "~/components/markdown/markdown-editor";
import { Button } from "~/components/shared/button";

export const MarkdownNoteSchema = z.object({
  content: z.string().min(3, "Content is required"),
});

interface MarkdownNoteFormProps {
  fetcher: FetcherWithComponents<any>;
  editingAtom: PrimitiveAtom<boolean>;
  action: string;
  formId: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  editorLabel?: string;
}

export function MarkdownNoteForm({
  fetcher,
  editingAtom,
  action,
  formId,
  placeholder = "Leave a note",
  submitLabel = "Create note",
  cancelLabel = "Cancel",
  editorLabel = "note",
}: MarkdownNoteFormProps) {
  const zo = useZorm(formId, MarkdownNoteSchema);
  const hasError = zo.errors.content()?.message;
  const [isEditing, setIsEditing] = useAtom(editingAtom);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const isDone = fetcher.state === "idle" && fetcher.data != null;

  const [disabled, setDisabled] = useState(false);

  const handleSubmit = () => {
    setDisabled(true);
  };

  const handleBlur = (
    event: ChangeEvent<HTMLTextAreaElement> & FocusEvent<HTMLTextAreaElement>
  ) => {
    const content = event.currentTarget.value;
    const clickedTarget =
      event?.relatedTarget?.tagName === "A" ||
      event?.relatedTarget?.tagName === "BUTTON" ||
      event?.relatedTarget?.role === "tabpanel";

    if (clickedTarget) return;

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
    if (!isEditing) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isEditing]);

  useEffect(() => {
    setIsEditing(false);
  }, [isDone, setIsEditing]);

  useEffect(() => {
    if (fetcher.state === "idle") {
      setDisabled(false);
    }
  }, [fetcher.state]);

  return (
    <div>
      <fetcher.Form
        action={action}
        method="post"
        ref={zo.ref}
        onSubmit={handleSubmit}
      >
        {isEditing ? (
          <div className="relative flex flex-col pb-12 xl:pb-0">
            <div className="absolute right-2 top-2 flex gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsEditing(false)}
                disabled={disabled}
              >
                {cancelLabel}
              </Button>
              <Button type="submit" size="sm" disabled={disabled}>
                {submitLabel}
              </Button>
            </div>
            <MarkdownEditor
              label={editorLabel}
              defaultValue=""
              name={zo.fields.content()}
              placeholder={placeholder}
              rows={4}
              ref={editorRef}
              className="rounded-b-none"
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              disabled={disabled}
            />
          </div>
        ) : (
          <Input
            icon="write"
            className="text-gray-700"
            label=""
            placeholder={placeholder}
            onFocus={() => setIsEditing(true)}
          />
        )}

        {hasError ? (
          <div className="text-sm text-error-500">{hasError}</div>
        ) : null}
      </fetcher.Form>
    </div>
  );
}
